const express = require('express');
const db = require('../db/database');
const router = express.Router();

// GET /api/companies/:id/leads — list leads with optional stage filter
router.get('/:id/leads', (req, res) => {
  const { stage } = req.query;
  let query = 'SELECT * FROM leads WHERE company_id = ?';
  const params = [req.params.id];

  if (stage) {
    query += ' AND stage = ?';
    params.push(stage);
  }

  query += ' ORDER BY score DESC, created_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/companies/:id/leads/:leadId — single lead with source email
router.get('/:id/leads/:leadId', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND company_id = ?').get(req.params.leadId, req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead non trouvé' });

  // Get source email if exists
  if (lead.source_email_id) {
    lead.source_email = db.prepare('SELECT * FROM emails WHERE id = ?').get(lead.source_email_id);
  }

  // Get activity for this lead
  lead.activity = db.prepare(
    'SELECT * FROM activity_log WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(lead.id);

  res.json(lead);
});

// PUT /api/companies/:id/leads/:leadId — update lead (stage, score, etc.)
router.put('/:id/leads/:leadId', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND company_id = ?').get(req.params.leadId, req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead non trouvé' });

  const allowed = ['stage', 'score', 'name', 'email', 'phone', 'company_name', 'city', 'plan'];
  const updates = [];
  const values = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(req.body[key]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

  values.push(req.params.leadId);
  db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Log activity
  if (req.body.stage && req.body.stage !== lead.stage) {
    db.prepare(
      'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, lead.id, 'stage_change', `${lead.name}: ${lead.stage} → ${req.body.stage}`);
  }

  res.json({ success: true });
});

// POST /api/companies/:id/leads — create lead manually
router.post('/:id/leads', (req, res) => {
  const { name, email, phone, company_name, city, score, stage } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });

  const result = db.prepare(`
    INSERT INTO leads (company_id, name, email, phone, company_name, city, score, stage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, name, email || null, phone || null, company_name || null, city || null, score || 0, stage || 'new');

  // Log
  db.prepare(
    'INSERT INTO activity_log (company_id, lead_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, result.lastInsertRowid, 'lead_created', `Lead créé: ${name}`);

  res.status(201).json({ id: result.lastInsertRowid, success: true });
});

module.exports = router;
