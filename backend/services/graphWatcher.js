/**
 * Microsoft Graph Email Watcher
 * 
 * Polls Outlook for new emails via Microsoft Graph API.
 * More reliable than IMAP — never gets blocked by Microsoft.
 * 
 * Flow: reads tokens.json → refreshes token → polls /me/messages → scores → creates leads
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const msal = require('@azure/msal-node');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { scoreEmail } = require('./scorer');
const { notifyHotLead } = require('./notifier');
const { msalConfig, scopes, TOKENS_PATH } = require('./authOutlook');

let pollInterval = null;
const POLL_DELAY = 30000; // 30 seconds

/**
 * Get a valid access token (refreshes automatically)
 */
async function getAccessToken() {
  if (!fs.existsSync(TOKENS_PATH)) {
    console.log('⚠️ Pas de tokens Outlook — lance: npm run auth:outlook');
    return null;
  }

  const tokenData = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  
  const pca = new msal.PublicClientApplication(msalConfig);

  // Restore cache
  if (tokenData.msalCache) {
    pca.getTokenCache().deserialize(tokenData.msalCache);
  }

  // Try silent token acquisition (auto-refresh)
  try {
    const accounts = await pca.getTokenCache().getAllAccounts();
    if (accounts.length > 0) {
      const result = await pca.acquireTokenSilent({
        scopes,
        account: accounts[0],
      });

      // Update saved tokens
      tokenData.accessToken = result.accessToken;
      tokenData.expiresOn = result.expiresOn?.toISOString();
      tokenData.msalCache = pca.getTokenCache().serialize();
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokenData, null, 2));

      return result.accessToken;
    }
  } catch (err) {
    console.error('Token refresh failed:', err.message);
    console.log('👉 Relance: npm run auth:outlook');
    return null;
  }

  return tokenData.accessToken;
}

/**
 * Fetch unread emails from Outlook via Graph API
 */
async function fetchNewEmails(accessToken) {
  const url = 'https://graph.microsoft.com/v1.0/me/messages?$filter=isRead eq false&$top=20&$orderby=receivedDateTime desc&$select=id,from,subject,bodyPreview,body,receivedDateTime,isRead';

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.value || [];
}

/**
 * Mark an email as read in Outlook
 */
async function markAsRead(accessToken, messageId) {
  await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ isRead: true }),
  });
}

/**
 * Process a Graph email — score, save, create lead, notify
 */
async function processGraphEmail(graphEmail, companyId, config, accessToken) {
  const fromName = graphEmail.from?.emailAddress?.name || 'Inconnu';
  const fromEmail = graphEmail.from?.emailAddress?.address || '';
  const subject = graphEmail.subject || '(sans objet)';
  const snippet = graphEmail.bodyPreview || '';
  const body = graphEmail.body?.content || snippet;

  // Check if already processed (by subject + from)
  const existing = db.prepare(
    'SELECT id FROM emails WHERE company_id = ? AND from_email = ? AND subject = ?'
  ).get(companyId, fromEmail, subject);
  if (existing) return;

  const emailData = { from_name: fromName, from_email: fromEmail, subject, snippet, body };

  // 1. Score via IA
  const scoring = await scoreEmail(emailData, config);

  // 2. Save to DB
  const emailResult = db.prepare(`
    INSERT INTO emails (company_id, from_name, from_email, subject, snippet, body, score, tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(companyId, fromName, fromEmail, subject, snippet, body, scoring.score, scoring.tag);

  console.log(`  📩 ${fromName} — Score ${scoring.score} (${scoring.tag}) — "${subject}"`);

  // 3. Create lead if it's a lead
  if (scoring.tag === 'lead') {
    const leadResult = db.prepare(`
      INSERT INTO leads (company_id, name, email, score, stage, source_email_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(companyId, fromName, fromEmail, scoring.score, 'new', emailResult.lastInsertRowid);

    db.prepare(
      'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(companyId, leadResult.lastInsertRowid, 'ia_qualified', `IA: Score ${scoring.score} — ${scoring.reason}`);

    // 4. Notify if hot lead
    if (scoring.score >= (config.hot_threshold || 80)) {
      const lead = { name: fromName, email: fromEmail, score: scoring.score, company_name: '' };
      await notifyHotLead(lead, config);

      db.prepare(
        'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
      ).run(companyId, leadResult.lastInsertRowid, 'notification_sent', 'Lead chaud — équipe notifiée');
    }
  }

  // 5. Mark as read in Outlook
  await markAsRead(accessToken, graphEmail.id);
}

/**
 * Start polling Outlook for new emails
 */
async function startGraphWatcher(companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) { console.error('Company not found'); return; }
  const config = JSON.parse(company.config);

  console.log('📧 Démarrage du watcher Outlook (Microsoft Graph)...');

  const poll = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const emails = await fetchNewEmails(token);
      if (emails.length > 0) {
        console.log(`\n📬 ${emails.length} nouveau(x) email(s) détecté(s) :`);
        for (const email of emails) {
          await processGraphEmail(email, companyId, config, token);
        }
      }
    } catch (err) {
      console.error('Watcher error:', err.message);
    }
  };

  // Initial poll
  await poll();

  // Then poll every 30 seconds
  pollInterval = setInterval(poll, POLL_DELAY);
  console.log(`✅ Watcher actif — vérification toutes les ${POLL_DELAY / 1000}s\n`);
}

function stopGraphWatcher() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = { startGraphWatcher, stopGraphWatcher, getAccessToken };
