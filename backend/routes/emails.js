const express = require('express');
const db = require('../db/database');
const router = express.Router();

// GET /api/companies/:id/emails — list emails with optional tag filter
router.get('/:id/emails', (req, res) => {
  const { tag } = req.query;
  let query = 'SELECT * FROM emails WHERE company_id = ?';
  const params = [req.params.id];

  if (tag && tag !== 'all') {
    query += ' AND tag = ?';
    params.push(tag);
  }

  query += ' ORDER BY created_at DESC, id DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/companies/:id/emails/:emailId — single email detail
router.get('/:id/emails/:emailId', (req, res) => {
  const row = db.prepare('SELECT * FROM emails WHERE id = ? AND company_id = ?').get(req.params.emailId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Email non trouvé' });
  // Mark as read
  if (!row.read) {
    db.prepare('UPDATE emails SET read = 1 WHERE id = ?').run(row.id);
    row.read = 1;
  }
  res.json(row);
});

// POST /api/companies/:id/emails/:emailId/draft-reply — draft AI response
router.post('/:id/emails/:emailId/draft-reply', async (req, res) => {
  const row = db.prepare('SELECT * FROM emails WHERE id = ? AND company_id = ?').get(req.params.emailId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Email non trouvé' });
  
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  const config = company ? JSON.parse(company.config) : {};
  
  try {
    const { draftReply } = require('../services/responder');
    const draft = await draftReply(row, config);
    res.json({ draft });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/companies/:id/emails/:emailId/send-reply — send real response via Gmail
router.post('/:id/emails/:emailId/send-reply', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Texte requis' });

  const row = db.prepare('SELECT * FROM emails WHERE id = ? AND company_id = ?').get(req.params.emailId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Email non trouvé' });

  try {
    const { sendReply } = require('../services/sender');
    // Using string matching to grab Message-ID is complex, we just pass threadId if present
    const sent = await sendReply(req.params.id, row.from_email, row.subject, null, row.thread_id, text);
    
    // Log activity 
    // Find if there is a lead associated with this email
    const lead = db.prepare('SELECT id FROM leads WHERE source_email_id = ?').get(row.id);
    if (lead) {
      db.prepare('INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)').run(
        req.params.id, lead.id, 'reply_sent', `Réponse envoyée (via IA) à ${row.from_email}`
      );
      // Automatically advance stage to contacted
      db.prepare("UPDATE leads SET stage = 'contacted' WHERE id = ?").run(lead.id);
    }

    res.json({ success: true, messageId: sent.id });
  } catch (e) {
    console.error('Send error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
