const { google } = require('googleapis');
const db = require('../db/database');
const fs = require('fs');
const path = require('path');

function getGmailClient(companyId) {
  const company = db.prepare('SELECT gmail_tokens FROM companies WHERE id = ?').get(companyId);
  if (!company || !company.gmail_tokens) return null;
  
  const tokens = JSON.parse(company.gmail_tokens);
  // Re-instantiate simple OAuth from env
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials(tokens);
  
  // Auto-refresh mechanism
  oauth2Client.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) tokens.refresh_token = newTokens.refresh_token;
    tokens.access_token = newTokens.access_token;
    tokens.expiry_date = newTokens.expiry_date;
    const tokenStr = JSON.stringify(tokens, null, 2);
    try {
      db.prepare('UPDATE companies SET gmail_tokens = ? WHERE id = ?').run(tokenStr, companyId);
      fs.writeFileSync(path.join(__dirname, '..', 'gmail_tokens.json'), tokenStr);
    } catch(e) {}
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Ensure string is correctly encoded for base64 MIME (UTF-8)
function toBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send an email as a reply via Gmail API
 */
async function sendReply(companyId, toEmail, originalSubject, messageId, threadId, body) {
  const gmail = getGmailClient(companyId);
  if (!gmail) throw new Error("Gmail non connecté");

  // Format subject: add Re: if not present
  const subject = originalSubject.toLowerCase().startsWith('re:') ? originalSubject : `Re: ${originalSubject}`;
  
  // Create RFC822 email payload manually
  const messageParts = [
    `To: ${toEmail}`,
    `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`
  ];
  
  if (messageId) {
    messageParts.push(`In-Reply-To: <${messageId}>`);
    messageParts.push(`References: <${messageId}>`);
  }
  
  messageParts.push('');
  messageParts.push(body);
  
  const rawEmail = messageParts.join('\r\n');
  const encodedEmail = toBase64(rawEmail);

  // Send
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
      threadId: threadId || undefined
    }
  });

  return res.data;
}

module.exports = { sendReply };
