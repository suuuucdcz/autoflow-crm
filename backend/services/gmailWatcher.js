/**
 * Gmail Watcher — polls Gmail for new emails via Google API
 *
 * More reliable than IMAP — uses OAuth2, never gets blocked.
 * Flow: reads gmail_tokens.json → refreshes token → polls messages → scores → creates leads
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { scoreEmail } = require('./scorer');
const { notifyHotLead } = require('./notifier');
const { getOAuth2Client, TOKENS_PATH } = require('./authGmail');

let pollInterval = null;
const POLL_DELAY = 30000; // 30 seconds
let lastCheckTime = null;

/**
 * Get an authenticated Gmail client
 */
function getGmailClient() {
  if (!fs.existsSync(TOKENS_PATH)) {
    console.log('⚠️ Pas de tokens Gmail — lance: npm run auth:gmail');
    return null;
  }

  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens on expiry
  oauth2Client.on('tokens', (newTokens) => {
    const saved = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    if (newTokens.refresh_token) saved.refresh_token = newTokens.refresh_token;
    saved.access_token = newTokens.access_token;
    saved.expiry_date = newTokens.expiry_date;
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(saved, null, 2));
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Fetch unread emails from Gmail
 */
async function fetchNewEmails(gmail) {
  // Build query: unread emails, optionally after a timestamp
  let query = 'is:unread category:primary';
  if (lastCheckTime) {
    const after = Math.floor(lastCheckTime / 1000);
    query += ` after:${after}`;
  }

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 20,
  });

  const messages = res.data.messages || [];
  const fullMessages = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });
    fullMessages.push(full.data);
  }

  return fullMessages;
}

/**
 * Extract email data from Gmail message format
 */
function parseGmailMessage(message) {
  const headers = message.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from = getHeader('From');
  // Parse "Name <email@example.com>" format
  const nameMatch = from.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  const fromName = nameMatch ? nameMatch[1].trim() : from;
  const fromEmail = nameMatch ? nameMatch[2].trim() : from;

  const subject = getHeader('Subject');

  // Get body text
  let body = '';
  const getTextBody = (part) => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) part.parts.forEach(getTextBody);
  };
  getTextBody(message.payload);

  // Fallback to snippet
  if (!body) body = message.snippet || '';

  return {
    messageId: message.id,
    from_name: fromName,
    from_email: fromEmail,
    subject: subject || '(sans objet)',
    snippet: message.snippet || '',
    body: body.substring(0, 2000), // Limit body size for IA scoring
  };
}

/**
 * Mark a message as read in Gmail
 */
async function markAsRead(gmail, messageId) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}

/**
 * Process a single Gmail message
 */
async function processGmailMessage(gmail, message, companyId, config) {
  const emailData = parseGmailMessage(message);

  // Skip if already processed
  const existing = db.prepare(
    'SELECT id FROM emails WHERE company_id = ? AND from_email = ? AND subject = ?'
  ).get(companyId, emailData.from_email, emailData.subject);
  if (existing) return;

  // 1. Score via IA
  const scoring = await scoreEmail(emailData, config);

  // 2. Save to DB
  const emailResult = db.prepare(`
    INSERT INTO emails (company_id, from_name, from_email, subject, snippet, body, score, tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(companyId, emailData.from_name, emailData.from_email, emailData.subject, emailData.snippet, emailData.body, scoring.score, scoring.tag);

  console.log(`  📩 ${emailData.from_name} — Score ${scoring.score} (${scoring.tag}) — "${emailData.subject}"`);

  // 3. Create lead if it's a lead
  if (scoring.tag === 'lead') {
    const leadResult = db.prepare(`
      INSERT INTO leads (company_id, name, email, score, stage, source_email_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(companyId, emailData.from_name, emailData.from_email, scoring.score, 'new', emailResult.lastInsertRowid);

    db.prepare(
      'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(companyId, leadResult.lastInsertRowid, 'ia_qualified', `IA: Score ${scoring.score} — ${scoring.reason}`);

    // 4. Notify if hot lead
    if (scoring.score >= (config.hot_threshold || 80)) {
      const lead = { name: emailData.from_name, email: emailData.from_email, score: scoring.score, company_name: '' };
      await notifyHotLead(lead, config);

      db.prepare(
        'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
      ).run(companyId, leadResult.lastInsertRowid, 'notification_sent', 'Lead chaud — équipe notifiée');
    }
  }

  // 5. Mark as read
  await markAsRead(gmail, emailData.messageId);
}

/**
 * Start polling Gmail for new emails
 */
async function startGmailWatcher(companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) { console.error('Company not found'); return; }
  const config = JSON.parse(company.config);

  console.log('📧 Démarrage du watcher Gmail (Google API)...');

  const poll = async () => {
    try {
      const gmail = getGmailClient();
      if (!gmail) return;

      const messages = await fetchNewEmails(gmail);
      if (messages.length > 0) {
        console.log(`\n📬 ${messages.length} nouveau(x) email(s) détecté(s) :`);
        for (const msg of messages) {
          await processGmailMessage(gmail, msg, companyId, config);
        }
      }

      lastCheckTime = Date.now();
    } catch (err) {
      if (err.message?.includes('invalid_grant') || err.message?.includes('Token')) {
        console.error('⚠️ Token expiré — relance: npm run auth:gmail');
      } else {
        console.error('Watcher error:', err.message);
      }
    }
  };

  // Initial poll
  await poll();

  // Then poll every 30 seconds
  pollInterval = setInterval(poll, POLL_DELAY);
  console.log(`✅ Watcher Gmail actif — vérification toutes les ${POLL_DELAY / 1000}s\n`);
}

function stopGmailWatcher() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

module.exports = { startGmailWatcher, stopGmailWatcher };
