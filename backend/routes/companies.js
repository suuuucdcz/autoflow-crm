const express = require('express');
const db = require('../db/database');
const router = express.Router();

// GET /api/companies/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entreprise non trouvée' });
  row.config = JSON.parse(row.config);
  res.json(row);
});

// PUT /api/companies/:id/config — update config
router.put('/:id/config', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Entreprise non trouvée' });

  // Merge new config with existing
  const existing = JSON.parse(company.config);
  const updated = { ...existing, ...req.body };

  db.prepare('UPDATE companies SET config = ? WHERE id = ?').run(JSON.stringify(updated), req.params.id);

  res.json({ success: true, config: updated });
});

module.exports = router;
