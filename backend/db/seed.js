/**
 * Seed script — populate DB with demo data matching the dashboard frontend
 */
const db = require('./database');

// Clear existing data
db.exec('DELETE FROM activity_log');
db.exec('DELETE FROM leads');
db.exec('DELETE FROM emails');
db.exec('DELETE FROM companies');

// ========== COMPANY ==========
const defaultConfig = {
  email_provider: 'gmail',
  email_address: 'contact@autoflow.fr',
  hot_threshold: 80,
  warm_threshold: 50,
  keywords: ['démo', 'tarifs', 'automatisation', 'intégration'],
  notifications: {
    slack: true,
    email: true,
    sms: false,
    teams: false
  },
  crm_destination: 'autoflow',
  hot_action: 'ticket_and_notify',
  cold_action: 'archive_weekly'
};

const insertCompany = db.prepare('INSERT INTO companies (name, email, config) VALUES (?, ?, ?)');
const company = insertCompany.run('AutoFlow Demo', 'contact@autoflow.fr', JSON.stringify(defaultConfig));
const companyId = company.lastInsertRowid;

// ========== EMAILS ==========
const insertEmail = db.prepare(`
  INSERT INTO emails (company_id, from_name, from_email, subject, snippet, body, score, tag, read, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const emails = [
  { from_name: 'Sophie Martin', from_email: 'sophie.martin@startup.fr', subject: 'Demande de démo AutoFlow', snippet: 'Bonjour, nous cherchons à automatiser notre process de qualification de leads et souhaitons planifier une démo…', score: 92, tag: 'lead', read: 0, ago: '-12 minutes' },
  { from_name: 'Marie Rousseau', from_email: 'marie.rousseau@saasb2b.fr', subject: 'Intéressée par le plan Business', snippet: 'Suite à notre échange lors du salon Tech4Biz, je souhaiterais en savoir plus sur vos tarifs entreprise…', score: 97, tag: 'lead', read: 0, ago: '-28 minutes' },
  { from_name: 'Pierre Dubois', from_email: 'p.dubois@pme-lyon.fr', subject: 'Question sur les intégrations Salesforce', snippet: 'Pouvez-vous me confirmer que votre plateforme supporte la synchronisation bidirectionnelle avec Salesforce…', score: 68, tag: 'lead', read: 0, ago: '-1 hours' },
  { from_name: 'Jean-Paul Moreau', from_email: 'jp.moreau@industrie-tls.fr', subject: 'Problème de connexion Slack', snippet: "L'intégration Slack que nous avons configurée la semaine dernière ne fonctionne plus depuis ce matin…", score: 15, tag: 'support', read: 0, ago: '-2 hours' },
  { from_name: 'Camille Laurent', from_email: 'c.laurent@grandgroupe.fr', subject: 'RFP - Automatisation processus RH', snippet: "Nous lançons un appel d'offre pour automatiser nos processus d'onboarding et souhaitons inclure AutoFlow…", score: 95, tag: 'lead', read: 0, ago: '-3 hours' },
  { from_name: 'Alice Bernard', from_email: 'alice.b@conseil-stras.fr', subject: 'Re: Suivi de notre échange', snippet: 'Merci pour les informations. Nous reviendrons vers vous après notre comité de direction la semaine prochaine…', score: 55, tag: 'lead', read: 1, ago: '-1 days' },
  { from_name: 'Newsletter Pro', from_email: 'noreply@newsletter-pro.com', subject: '🎉 Offre spéciale -50% sur nos services', snippet: 'Profitez de notre offre exceptionnelle limitée dans le temps sur tous nos packages premium…', score: 3, tag: 'spam', read: 1, ago: '-1 days' },
];

const emailIds = {};
emails.forEach((e, i) => {
  const result = insertEmail.run(companyId, e.from_name, e.from_email, e.subject, e.snippet, e.snippet, e.score, e.tag, e.read, e.ago);
  emailIds[e.from_name] = result.lastInsertRowid;
});

// ========== LEADS ==========
const insertLead = db.prepare(`
  INSERT INTO leads (company_id, name, email, phone, company_name, city, score, stage, source_email_id, plan, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const leads = [
  // New
  { name: 'Sophie Martin', email: 'sophie.martin@startup.fr', phone: '+33 6 12 34 56 78', company_name: 'Startup Tech SAS', city: 'Paris', score: 92, stage: 'new', from: 'Sophie Martin', ago: '-12 minutes' },
  { name: 'Camille Laurent', email: 'c.laurent@grandgroupe.fr', phone: '+33 1 45 67 89 00', company_name: 'Grand Groupe SA', city: 'Bordeaux', score: 95, stage: 'new', from: 'Camille Laurent', ago: '-3 hours' },
  { name: 'Pierre Dubois', email: 'p.dubois@pme-lyon.fr', phone: '+33 4 78 12 34 56', company_name: 'PME Lyon SARL', city: 'Lyon', score: 68, stage: 'new', from: 'Pierre Dubois', ago: '-1 hours' },
  { name: 'Thomas Petit', email: 't.petit@ecommerce-mrs.fr', phone: '+33 4 91 23 45 67', company_name: 'E-Shop Marseille', city: 'Marseille', score: 61, stage: 'new', from: null, ago: '-5 hours' },
  // Qualified
  { name: 'Marie Rousseau', email: 'marie.rousseau@saasb2b.fr', phone: '+33 2 40 12 34 56', company_name: 'SaaS B2B SAS', city: 'Nantes', score: 97, stage: 'qualified', from: 'Marie Rousseau', ago: '-28 minutes' },
  { name: 'Jean-Paul Moreau', email: 'jp.moreau@industrie-tls.fr', phone: '+33 5 61 12 34 56', company_name: 'Industrie Toulouse SA', city: 'Toulouse', score: 91, stage: 'qualified', from: 'Jean-Paul Moreau', ago: '-1 days' },
  { name: 'Claire Dupont', email: 'c.dupont@fintech-paris.fr', phone: '+33 1 42 12 34 56', company_name: 'Fintech Paris', city: 'Paris', score: 74, stage: 'qualified', from: null, ago: '-2 days' },
  // Contacted
  { name: 'Alice Bernard', email: 'alice.b@conseil-stras.fr', phone: '+33 3 88 12 34 56', company_name: 'Conseil Strasbourg', city: 'Strasbourg', score: 55, stage: 'contacted', from: 'Alice Bernard', ago: '-2 days' },
  { name: 'Hugo Lefèvre', email: 'h.lefevre@sante-lille.fr', phone: '+33 3 20 12 34 56', company_name: 'Santé Lille', city: 'Lille', score: 62, stage: 'contacted', from: null, ago: '-4 days' },
  // Converted
  { name: 'Lucas Simon', email: 'l.simon@tech-paris.fr', phone: '+33 1 55 12 34 56', company_name: 'Tech Paris SAS', city: 'Paris', score: 88, stage: 'converted', from: null, ago: '-7 days', plan: 'Business' },
  { name: 'Emma Blanc', email: 'e.blanc@edtech-nice.fr', phone: '+33 4 93 12 34 56', company_name: 'EdTech Nice', city: 'Nice', score: 82, stage: 'converted', from: null, ago: '-10 days', plan: 'Starter' },
];

leads.forEach(l => {
  insertLead.run(companyId, l.name, l.email, l.phone, l.company_name, l.city, l.score, l.stage, l.from ? emailIds[l.from] : null, l.plan || null, l.ago);
});

// ========== ACTIVITY LOG ==========
const insertActivity = db.prepare(`
  INSERT INTO activity_log (company_id, lead_id, action, detail, created_at)
  VALUES (?, ?, ?, ?, datetime('now', ?))
`);

insertActivity.run(companyId, null, 'workflow_executed', 'Workflow Email → CRM exécuté', '-2 minutes');
insertActivity.run(companyId, null, 'ia_qualified', 'IA : 3 leads qualifiés détectés', '-8 minutes');
insertActivity.run(companyId, null, 'sync_warning', 'Sync HubSpot ralentie', '-22 minutes');
insertActivity.run(companyId, null, 'notification_sent', 'Notification Slack envoyée à l\'équipe', '-35 minutes');
insertActivity.run(companyId, null, 'ticket_created', 'Ticket CRM #1284 créé automatiquement', '-1 hours');
insertActivity.run(companyId, null, 'report_generated', 'Rapport hebdomadaire généré', '-2 hours');

console.log('✅ Base de données peuplée avec les données de démo !');
console.log(`   → 1 entreprise (ID: ${companyId})`);
console.log(`   → ${emails.length} emails`);
console.log(`   → ${leads.length} leads`);
console.log('   → 6 entrées de log');
