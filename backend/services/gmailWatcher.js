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
const activeWatchers = new Map();
const POLL_DELAY = 15000; // 15 seconds

/**
 * Get an authenticated Gmail client for a specific company
 */
function getGmailClient(companyId) {
  const company = db.prepare('SELECT gmail_tokens FROM companies WHERE id = ?').get(companyId);
  if (!company || !company.gmail_tokens) {
    return null;
  }

  const tokens = JSON.parse(company.gmail_tokens);
  // Bypass require('./authGmail') as it expects local flow
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens on expiry
  oauth2Client.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) tokens.refresh_token = newTokens.refresh_token;
    tokens.access_token = newTokens.access_token;
    tokens.expiry_date = newTokens.expiry_date;
    const tokenStr = JSON.stringify(tokens, null, 2);
    
    try {
      db.prepare('UPDATE companies SET gmail_tokens = ? WHERE id = ?').run(tokenStr, companyId);
    } catch(e) {}
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Fetch unread emails from Gmail
 */
async function fetchNewEmails(gmail) {
  // Build query: recent emails in inbox, optionally after a timestamp
  let query = 'in:inbox';
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
  let htmlBody = '';
  const getTextBody = (part) => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8') + '\n';
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlBody += Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8') + '\n';
    }
    if (part.parts) part.parts.forEach(getTextBody);
  };
  getTextBody(message.payload);

  if (!body && htmlBody) {
    body = htmlBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim();
  }

  // Fallback to snippet
  if (!body) body = message.snippet || '';

  // Extract real received date from Gmail
  const dateHeader = getHeader('Date');
  let receivedAt = null;
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    if (!isNaN(parsed.getTime())) {
      receivedAt = parsed.toISOString().replace('T', ' ').substring(0, 19);
    }
  }
  // Fallback: use Gmail's internalDate (Unix ms)
  if (!receivedAt && message.internalDate) {
    receivedAt = new Date(parseInt(message.internalDate)).toISOString().replace('T', ' ').substring(0, 19);
  }

  return {
    messageId: message.id,
    from_name: fromName,
    from_email: fromEmail,
    subject: subject || '(sans objet)',
    snippet: message.snippet || '',
    body: body.substring(0, 2000),
    received_at: receivedAt,
    threadId: message.threadId || '',
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
  if (existing) return false;

  // 1. Score via IA
  const scoring = await scoreEmail(emailData, config);

  // 2. Save to DB with real received date and threadId
  const emailResult = db.prepare(`
    INSERT INTO emails (company_id, from_name, from_email, subject, snippet, body, score, tag, thread_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(companyId, emailData.from_name, emailData.from_email, emailData.subject, emailData.snippet, emailData.body, scoring.score, scoring.tag, emailData.threadId, emailData.received_at || new Date().toISOString().replace('T', ' ').substring(0, 19));

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
  return true;
}

/**
 * Start polling Gmail for new emails
 */
async function startGmailWatcher(companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) { console.error(`Company ${companyId} not found`); return; }
  const config = JSON.parse(company.config);

  // Prevent multiple watchers for the same company
  if (activeWatchers.has(companyId)) {
    clearInterval(activeWatchers.get(companyId).interval);
  }

  console.log(`📧 Démarrage du watcher Gmail (Entreprise ${companyId})...`);

  // To track lastCheckTime per company
  let lastCheckTime = activeWatchers.has(companyId) ? activeWatchers.get(companyId).lastCheckTime : null;

  const poll = async () => {
    try {
      const gmail = getGmailClient(companyId);
      if (!gmail) return;

      // Build query: recent emails in inbox, optionally after a timestamp
      let query = 'in:inbox';
      if (lastCheckTime) {
        query += ` after:${Math.floor(lastCheckTime / 1000)}`;
      }

      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 20,
      });

      const messages = res.data.messages || [];
      if (messages.length > 0) {
        const fullMessages = [];
        for (const msg of messages) {
          const full = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full',
          });
          fullMessages.push(full.data);
        }

        console.log(`\n📬 ${fullMessages.length} nouveau(x) email(s) détecté(s) (Entreprise ${companyId}):`);
        const chronological = fullMessages.slice().reverse();
        let addedCount = 0;
        for (const msg of chronological) {
          const inserted = await processGmailMessage(gmail, msg, companyId, config);
          if (inserted) addedCount++;
        }
        
        // Log the batch processing activity
        if (addedCount > 0) {
           db.prepare('INSERT INTO activity_log (company_id, action, detail) VALUES (?, ?, ?)')
             .run(companyId, 'watcher_batch', `IA a analysé et qualifié ${addedCount} nouveaux emails sur ${messages.length} importés.`);
        }
      }

      lastCheckTime = Date.now();
      activeWatchers.get(companyId).lastCheckTime = lastCheckTime;
    } catch (err) {
      if (err.message?.includes('invalid_grant') || err.message?.includes('Token')) {
        console.error(`⚠️ Token expiré pour Entreprise ${companyId}`);
        stopGmailWatcher(companyId); // Stop polling if token is hopelessly invalid
      } else {
        console.error(`Watcher error (Entreprise ${companyId}):`, err.message);
      }
    }
  };

  // Save the state
  activeWatchers.set(companyId, {
    lastCheckTime: lastCheckTime,
    interval: setInterval(poll, POLL_DELAY)
  });

  // Initial poll
  await poll();
  
  console.log(`✅ Watcher Gmail actif pour Entreprise ${companyId} — vérification toutes les ${POLL_DELAY / 1000}s\n`);
}

function stopGmailWatcher(companyId) {
  if (activeWatchers.has(companyId)) {
    clearInterval(activeWatchers.get(companyId).interval);
    activeWatchers.delete(companyId);
    console.log(`🛑 Watcher Gmail arrêté pour Entreprise ${companyId}`);
  }
}

module.exports = { startGmailWatcher, stopGmailWatcher };
