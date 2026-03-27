/**
 * Notifier — Send alerts via Slack and/or Email
 * Configured per company
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const nodemailer = require('nodemailer');

/**
 * Send notification for a hot lead
 * @param {Object} lead - { name, company_name, score, email }
 * @param {Object} config - company config with notifications settings
 */
async function notifyHotLead(lead, config) {
  const notifications = config.notifications || {};
  const results = [];

  // Slack
  if (notifications.slack && process.env.SLACK_WEBHOOK_URL) {
    try {
      const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🔥 *Nouveau lead chaud détecté !*\n*${lead.name}* — ${lead.company_name || 'N/A'}\nScore IA : *${lead.score}/100*\nEmail : ${lead.email || 'N/A'}`,
        }),
      });
      results.push({ channel: 'slack', success: res.ok });
    } catch (err) {
      console.error('Slack notification error:', err.message);
      results.push({ channel: 'slack', success: false, error: err.message });
    }
  }

  // Email
  if (notifications.email && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: `"AutoFlow CRM" <${process.env.SMTP_USER}>`,
        to: config.email_address || process.env.SMTP_USER,
        subject: `🔥 Lead chaud : ${lead.name} (Score ${lead.score})`,
        html: `
          <h2>Nouveau lead chaud détecté</h2>
          <p><strong>${lead.name}</strong> — ${lead.company_name || 'N/A'}</p>
          <p>Score IA : <strong>${lead.score}/100</strong></p>
          <p>Email : ${lead.email || 'N/A'}</p>
          <p>Ville : ${lead.city || 'N/A'}</p>
          <hr>
          <p><em>AutoFlow CRM — Notification automatique</em></p>
        `,
      });
      results.push({ channel: 'email', success: true });
    } catch (err) {
      console.error('Email notification error:', err.message);
      results.push({ channel: 'email', success: false, error: err.message });
    }
  }

  return results;
}

module.exports = { notifyHotLead };
