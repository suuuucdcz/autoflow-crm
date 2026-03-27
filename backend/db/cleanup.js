const db = require('./db/database');

// Demo email addresses from the seed script
const demoEmails = [
  'sophie.martin@startup.fr',
  'marie.rousseau@saasb2b.fr',
  'p.dubois@pme-lyon.fr',
  'jp.moreau@industrie-tls.fr',
  'c.laurent@grandgroupe.fr',
  'alice.b@conseil-stras.fr',
  'noreply@newsletter-pro.com',
];

const demoLeadEmails = [
  ...demoEmails,
  't.petit@ecommerce-mrs.fr',
  'c.dupont@fintech-paris.fr',
  'h.lefevre@sante-lille.fr',
  'l.simon@tech-paris.fr',
  'e.blanc@edtech-nice.fr',
];

// Delete demo leads and their activity
demoLeadEmails.forEach(e => {
  const lead = db.prepare('SELECT id FROM leads WHERE email = ?').get(e);
  if (lead) {
    db.prepare('DELETE FROM activity_log WHERE lead_id = ?').run(lead.id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
  }
});

// Delete demo emails
demoEmails.forEach(e => {
  db.prepare('DELETE FROM emails WHERE from_email = ?').run(e);
});

// Delete orphan activity (seed logs with no lead_id)
db.prepare('DELETE FROM activity_log WHERE lead_id IS NULL').run();

const emails = db.prepare('SELECT COUNT(*) as c FROM emails').get().c;
const leads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
console.log(`✅ Données démo supprimées. Restant : ${emails} emails, ${leads} leads (vrais).`);
