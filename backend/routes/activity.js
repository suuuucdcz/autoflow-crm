const express = require('express');
const db = require('../db/database');
const router = express.Router();

// GET /api/companies/:id/activity — recent activity log
router.get('/:id/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const rows = db.prepare(
    'SELECT * FROM activity_log WHERE company_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(req.params.id, limit);
  res.json(rows);
});

module.exports = router;
