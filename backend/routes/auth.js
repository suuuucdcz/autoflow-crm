const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const router = express.Router();

// Utility for hashing passwords (simple SHA-256 for this MVP)
// For true production, bcrypt or argon2 would be used
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate a random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
  }

  // Check if email already exists
  const existing = db.prepare('SELECT id FROM companies WHERE email = ?').get(email);
  if (existing) {
    return res.status(400).json({ error: 'Cet email est déjà utilisé' });
  }

  const token = generateToken();
  const pwdHash = hashPassword(password);
  
  // Default config
  const config = JSON.stringify({
    email_provider: 'gmail', hot_threshold: 80, warm_threshold: 50,
    keywords: ['démo', 'tarifs', 'automatisation', 'intégration'],
    notifications: { slack: false, email: false, sms: false, teams: false },
    crm_destination: 'autoflow'
  });

  try {
    const result = db.prepare(`
      INSERT INTO companies (name, email, password_hash, auth_token, config)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, email, pwdHash, token, config);

    res.status(201).json({
      success: true,
      company_id: result.lastInsertRowid,
      token,
      name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const pwdHash = hashPassword(password);
  const company = db.prepare('SELECT id, name, password_hash, auth_token FROM companies WHERE email = ?').get(email);

  // Fallback for company 1 if it has no password yet (legacy compatibility)
  if (company && company.id === 1 && !company.password_hash) {
    const newPwdHash = hashPassword(password);
    const newToken = generateToken();
    db.prepare('UPDATE companies SET password_hash = ?, auth_token = ? WHERE id = 1')
      .run(newPwdHash, newToken);
    
    return res.json({
      success: true,
      company_id: 1,
      token: newToken,
      name: company.name
    });
  }

  if (!company || company.password_hash !== pwdHash) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  // Ensure they have a token
  let token = company.auth_token;
  if (!token) {
    token = generateToken();
    db.prepare('UPDATE companies SET auth_token = ? WHERE id = ?').run(token, company.id);
  }

  res.json({
    success: true,
    company_id: company.id,
    token,
    name: company.name
  });
});

// GET /api/auth/me - Verify token
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const token = authHeader.split(' ')[1];
  const company = db.prepare('SELECT id, name, email FROM companies WHERE auth_token = ?').get(token);

  if (!company) {
    return res.status(401).json({ error: 'Token invalide' });
  }

  res.json({
    success: true,
    company_id: company.id,
    name: company.name,
    email: company.email
  });
});

module.exports = router;
