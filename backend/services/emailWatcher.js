/**
 * Email Watcher — IMAP listener for new emails
 * Parses incoming emails, scores them via IA, creates leads, sends notifications
 * 
 * NOTE: This is disabled by default. Enable by setting IMAP_* env vars.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Imap = require('node-imap');
const { simpleParser } = require('mailparser');
const db = require('../db/database');
const { scoreEmail } = require('./scorer');
const { notifyHotLead } = require('./notifier');

let imapConnection = null;

/**
 * Start watching a company's email inbox
 * @param {number} companyId
 */
function startWatching(companyId) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) {
    console.error('Company not found:', companyId);
    return;
  }

  const config = JSON.parse(company.config);

  // Check IMAP credentials
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) {
    console.log('⚠️ IMAP not configured — email watcher disabled');
    return;
  }

  const imap = new Imap({
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASS,
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT) || 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  });

  imap.once('ready', () => {
    console.log('📧 IMAP connecté — surveillance de la boîte mail');
    openInbox(imap, companyId, config);
  });

  imap.once('error', (err) => {
    console.error('IMAP error:', err.message);
  });

  imap.once('end', () => {
    console.log('IMAP connexion fermée');
  });

  imap.connect();
  imapConnection = imap;
}

function openInbox(imap, companyId, config) {
  imap.openBox('INBOX', false, (err) => {
    if (err) {
      console.error('Cannot open INBOX:', err.message);
      return;
    }

    // Listen for new emails
    imap.on('mail', () => {
      fetchNewEmails(imap, companyId, config);
    });

    console.log('📬 En attente de nouveaux emails…');
  });
}

function fetchNewEmails(imap, companyId, config) {
  imap.search(['UNSEEN'], (err, results) => {
    if (err || !results.length) return;

    const fetch = imap.fetch(results, { bodies: '', markSeen: true });

    fetch.on('message', (msg) => {
      msg.on('body', (stream) => {
        simpleParser(stream, async (err, parsed) => {
          if (err) return console.error('Parse error:', err.message);

          const emailData = {
            from_name: parsed.from?.text?.split('<')[0]?.trim() || 'Inconnu',
            from_email: parsed.from?.value?.[0]?.address || '',
            subject: parsed.subject || '(sans objet)',
            snippet: (parsed.text || '').substring(0, 200),
            body: parsed.text || '',
          };

          await processEmail(emailData, companyId, config);
        });
      });
    });
  });
}

async function processEmail(emailData, companyId, config) {
  try {
    // 1. Score via IA
    const scoring = await scoreEmail(emailData, config);

    // 2. Save email to DB
    const emailResult = db.prepare(`
      INSERT INTO emails (company_id, from_name, from_email, subject, snippet, body, score, tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(companyId, emailData.from_name, emailData.from_email, emailData.subject, emailData.snippet, emailData.body, scoring.score, scoring.tag);

    console.log(`📩 Email traité: ${emailData.from_name} — Score ${scoring.score} (${scoring.tag})`);

    // 3. If it's a lead, create a lead entry
    if (scoring.tag === 'lead') {
      const leadResult = db.prepare(`
        INSERT INTO leads (company_id, name, email, score, stage, source_email_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(companyId, emailData.from_name, emailData.from_email, scoring.score, 'new', emailResult.lastInsertRowid);

      // Log
      db.prepare(
        'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
      ).run(companyId, leadResult.lastInsertRowid, 'ia_qualified', `IA: Score ${scoring.score} — ${scoring.reason}`);

      // 4. If hot lead, notify
      if (scoring.score >= (config.hot_threshold || 80)) {
        const lead = { name: emailData.from_name, email: emailData.from_email, score: scoring.score };
        await notifyHotLead(lead, config);

        db.prepare(
          'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
        ).run(companyId, leadResult.lastInsertRowid, 'notification_sent', 'Lead chaud détecté — équipe notifiée');
      }
    }
  } catch (err) {
    console.error('Process email error:', err.message);
  }
}

function stopWatching() {
  if (imapConnection) {
    imapConnection.end();
    imapConnection = null;
  }
}

module.exports = { startWatching, stopWatching, processEmail };
