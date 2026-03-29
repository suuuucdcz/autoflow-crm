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

module.exports = router;
