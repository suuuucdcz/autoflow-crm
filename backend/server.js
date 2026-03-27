/**
 * AutoFlow CRM Backend — Main Server
 * Multi-tenant API for the dashboard
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const companiesRoutes = require('./routes/companies');
const emailsRoutes = require('./routes/emails');
const leadsRoutes = require('./routes/leads');
const activityRoutes = require('./routes/activity');

// Import services
const { scoreEmail } = require('./services/scorer');
const { startWatching } = require('./services/emailWatcher');
const { startGraphWatcher } = require('./services/graphWatcher');
const { startGmailWatcher } = require('./services/gmailWatcher');
const fs = require('fs');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve dashboard frontend (so everything runs on one port)
app.use(express.static(path.join(__dirname, '..')));

// API Routes
app.use('/api/companies', companiesRoutes);
app.use('/api/companies', emailsRoutes);
app.use('/api/companies', leadsRoutes);
app.use('/api/companies', activityRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const tokensExist = fs.existsSync(path.join(__dirname, 'tokens.json'));
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    db: db ? 'connected' : 'disconnected',
    email_watcher: tokensExist ? 'graph' : (process.env.IMAP_HOST ? 'imap' : 'disabled'),
  });
});

// Scoring test endpoint — score an email on the fly
app.post('/api/test-score', async (req, res) => {
  try {
    const { email, companyId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email data required' });

    // Get company config
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId || 1);
    const config = company ? JSON.parse(company.config) : { keywords: [] };

    const result = await scoreEmail(email, config);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually process a new email (simulates receiving an email)
app.post('/api/companies/:id/process-email', async (req, res) => {
  try {
    const { processEmail } = require('./services/emailWatcher');
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
    if (!company) return res.status(404).json({ error: 'Entreprise non trouvée' });

    const config = JSON.parse(company.config);
    const emailData = req.body;

    if (!emailData.from_name || !emailData.subject) {
      return res.status(400).json({ error: 'from_name et subject requis' });
    }

    await processEmail(emailData, parseInt(req.params.id), config);
    res.json({ success: true, message: 'Email traité avec succès' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// KPI endpoint for dashboard overview
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

// Start server
app.listen(PORT, async () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🚀 AutoFlow CRM Backend              ║
  ║   http://localhost:${PORT}                ║
  ║                                          ║
  ║   API:   http://localhost:${PORT}/api     ║
  ║   Dash:  http://localhost:${PORT}         ║
  ╚══════════════════════════════════════════╝
  `);

  // Auto-start email watcher (priority: Gmail → Outlook → IMAP)
  const gmailTokens = path.join(__dirname, 'gmail_tokens.json');
  const outlookTokens = path.join(__dirname, 'tokens.json');
  if (fs.existsSync(gmailTokens)) {
    console.log('  📧 Mode : Gmail (Google API)');
    await startGmailWatcher(1);
  } else if (fs.existsSync(outlookTokens)) {
    console.log('  📧 Mode : Outlook (Microsoft Graph)');
    await startGraphWatcher(1);
  } else if (process.env.IMAP_HOST && process.env.IMAP_USER) {
    console.log('  📧 Mode : IMAP');
    startWatching(1);
  } else {
    console.log('  ⚠️  Email watcher désactivé');
    console.log('  👉 Lance: npm run auth:gmail     pour connecter Gmail');
    console.log('  👉 Lance: npm run auth:outlook   pour connecter Outlook');
    console.log('  ℹ️  Ou utilisez POST /api/companies/1/process-email pour simuler');
  }
});
