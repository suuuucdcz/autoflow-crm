/**
 * AutoFlow CRM Backend — Main Server
 * Multi-tenant API for the dashboard
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

// Import routes
const companiesRoutes = require('./routes/companies');
const emailsRoutes = require('./routes/emails');
const leadsRoutes = require('./routes/leads');
const activityRoutes = require('./routes/activity');

// Import services
const { scoreEmail } = require('./services/scorer');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Auto-detect base URL (works locally & deployed)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(cors());
app.use(express.json());

// Serve dashboard frontend
app.use(express.static(path.join(__dirname, '..')));

// API Routes
app.use('/api/companies', companiesRoutes);
app.use('/api/companies', emailsRoutes);
app.use('/api/companies', leadsRoutes);
app.use('/api/companies', activityRoutes);

// ==============================
// Gmail OAuth (browser-based)
// ==============================
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/gmail/callback`
  );
}

// Step 1: Redirect user to Google consent
app.get('/auth/gmail', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).send('GOOGLE_CLIENT_ID non configuré dans .env');
  }
  const companyId = req.query.company || 1;
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent',
    state: String(companyId),
  });
  res.redirect(url);
});

// Step 2: Google redirects back here with the code
app.get('/auth/gmail/callback', async (req, res) => {
  const code = req.query.code;
  const companyId = req.query.state || 1;

  if (!code) return res.status(400).send('Pas de code reçu');

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    // Save tokens to DB
    const tokenData = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
      email: email,
    });

    db.prepare('UPDATE companies SET gmail_tokens = ?, email = ? WHERE id = ?')
      .run(tokenData, email, companyId);

    // Also save to file for the watcher (backward compat)
    fs.writeFileSync(path.join(__dirname, 'gmail_tokens.json'), tokenData);

    // Log activity
    db.prepare('INSERT INTO activity_log (company_id, action, detail) VALUES (?, ?, ?)')
      .run(companyId, 'gmail_connected', `Gmail connecté : ${email}`);

    // Start watcher for this company
    try {
      const { startGmailWatcher } = require('./services/gmailWatcher');
      startGmailWatcher(parseInt(companyId));
    } catch (e) { console.error('Watcher start error:', e.message); }

    // Redirect back to dashboard
    res.send(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"><title>Gmail connecté</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; display: flex;
               justify-content: center; align-items: center; height: 100vh;
               background: #f5f5f7; margin: 0; }
        .card { background: white; border-radius: 16px; padding: 48px;
                text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
        h1 { color: #1d1d1f; font-size: 24px; }
        p { color: #86868b; }
        .email { color: #0071e3; font-weight: 600; }
        .btn { display: inline-block; margin-top: 20px; padding: 12px 32px;
               background: #0071e3; color: white; border-radius: 8px;
               text-decoration: none; font-weight: 500; }
      </style></head>
      <body><div class="card">
        <h1>✅ Gmail connecté !</h1>
        <p>Compte : <span class="email">${email}</span></p>
        <p>Le watcher va maintenant surveiller tes emails.</p>
        <a href="/" class="btn">Retour au Dashboard</a>
      </div></body></html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send(`Erreur: ${err.message}`);
  }
});

// Check Gmail connection status
app.get('/api/companies/:id/gmail-status', async (req, res) => {
  const company = db.prepare('SELECT gmail_tokens FROM companies WHERE id = ?').get(req.params.id);
  if (company && company.gmail_tokens) {
    const tokens = JSON.parse(company.gmail_tokens);
    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(tokens);
      await oauth2Client.getAccessToken();
      res.json({ connected: true, email: tokens.email });
    } catch (e) {
      console.error('Statut Gmail: Jeton expiré ou invalide');
      res.json({ connected: false, error: 'Jeton expiré' });
    }
  } else {
    res.json({ connected: false });
  }
});

// Disconnect Gmail
app.post('/api/companies/:id/gmail-disconnect', (req, res) => {
  db.prepare('UPDATE companies SET gmail_tokens = NULL WHERE id = ?').run(req.params.id);
  // Remove local tokens file
  const tokensPath = path.join(__dirname, 'gmail_tokens.json');
  if (fs.existsSync(tokensPath)) fs.unlinkSync(tokensPath);
  res.json({ success: true });
});

// ==============================
// Other API endpoints
// ==============================

// Health check
app.get('/api/health', (req, res) => {
  const gmailTokens = fs.existsSync(path.join(__dirname, 'gmail_tokens.json'));
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    db: db ? 'connected' : 'disconnected',
    email_watcher: gmailTokens ? 'gmail' : 'disabled',
    base_url: BASE_URL,
  });
});

// Scoring test endpoint
app.post('/api/test-score', async (req, res) => {
  try {
    const { email, companyId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email data required' });
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId || 1);
    const config = company ? JSON.parse(company.config) : { keywords: [] };
    const result = await scoreEmail(email, config);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// KPI endpoint
app.get('/api/companies/:id/kpi', (req, res) => {
  const id = req.params.id;
  const totalEmails = db.prepare('SELECT COUNT(*) as c FROM emails WHERE company_id = ?').get(id)?.c || 0;
  const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE company_id = ?').get(id)?.c || 0;
  const hotLeads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE company_id = ? AND score >= 80').get(id)?.c || 0;
  const converted = db.prepare("SELECT COUNT(*) as c FROM leads WHERE company_id = ? AND stage = 'converted'").get(id)?.c || 0;
  const avgScore = db.prepare('SELECT ROUND(AVG(score)) as avg FROM leads WHERE company_id = ?').get(id)?.avg || 0;

  res.json({
    total_emails: totalEmails,
    total_leads: totalLeads,
    hot_leads: hotLeads,
    converted,
    avg_score: avgScore,
    conversion_rate: totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0,
  });
});

// Admin: remove demo seed data
app.post('/api/admin/cleanup-demo', (req, res) => {
  const demoEmails = [
    'sophie.martin@startup.fr','marie.rousseau@saasb2b.fr','p.dubois@pme-lyon.fr',
    'jp.moreau@industrie-tls.fr','c.laurent@grandgroupe.fr','alice.b@conseil-stras.fr',
    'noreply@newsletter-pro.com'
  ];
  const demoLeadEmails = [
    ...demoEmails,'t.petit@ecommerce-mrs.fr','c.dupont@fintech-paris.fr',
    'h.lefevre@sante-lille.fr','l.simon@tech-paris.fr','e.blanc@edtech-nice.fr'
  ];

  let deletedLeads = 0, deletedEmails = 0;

  demoLeadEmails.forEach(e => {
    const lead = db.prepare('SELECT id FROM leads WHERE email = ?').get(e);
    if (lead) {
      db.prepare('DELETE FROM activity_log WHERE lead_id = ?').run(lead.id);
      db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
      deletedLeads++;
    }
  });

  demoEmails.forEach(e => {
    const r = db.prepare('DELETE FROM emails WHERE from_email = ?').run(e);
    deletedEmails += r.changes;
  });

  db.prepare('DELETE FROM activity_log WHERE lead_id IS NULL').run();

  const remaining = {
    emails: db.prepare('SELECT COUNT(*) as c FROM emails').get().c,
    leads: db.prepare('SELECT COUNT(*) as c FROM leads').get().c,
  };

  res.json({ success: true, deleted: { emails: deletedEmails, leads: deletedLeads }, remaining });
});

// Ensure default company exists
const defaultCompany = db.prepare('SELECT id FROM companies WHERE id = 1').get();
if (!defaultCompany) {
  db.prepare("INSERT INTO companies (name, email, config) VALUES (?, ?, ?)").run(
    'Mon entreprise', '', JSON.stringify({
      email_provider: 'gmail', hot_threshold: 80, warm_threshold: 50,
      keywords: ['démo', 'tarifs', 'automatisation', 'intégration'],
      notifications: { slack: false, email: false, sms: false, teams: false },
      crm_destination: 'autoflow'
    })
  );
}

// Start server
app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🚀 AutoFlow CRM Backend              ║
  ║   ${BASE_URL.padEnd(36)}║
  ╚══════════════════════════════════════════╝
  `);

  // Auto-start Gmail watcher if tokens exist
  const gmailTokens = path.join(__dirname, 'gmail_tokens.json');
  if (fs.existsSync(gmailTokens)) {
    console.log('  📧 Gmail watcher démarré');
    const { startGmailWatcher } = require('./services/gmailWatcher');
    await startGmailWatcher(1);
  } else {
    // Check DB for tokens
    const company = db.prepare('SELECT gmail_tokens FROM companies WHERE id = 1').get();
    if (company && company.gmail_tokens) {
      // Restore file from DB
      fs.writeFileSync(gmailTokens, company.gmail_tokens);
      console.log('  📧 Gmail watcher démarré (tokens restaurés)');
      const { startGmailWatcher } = require('./services/gmailWatcher');
      await startGmailWatcher(1);
    } else {
      console.log('  ⚠️  Gmail non connecté');
      console.log(`  👉 Ouvre: ${BASE_URL}/auth/gmail`);
    }
  }
});
