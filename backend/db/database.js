const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'autoflow.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    -- Config stored as JSON for flexibility per client
    config TEXT NOT NULL DEFAULT '{}',
    -- Gmail OAuth tokens stored per company
    gmail_tokens TEXT
  );

  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    from_name TEXT,
    from_email TEXT,
    subject TEXT,
    snippet TEXT,
    body TEXT,
    score INTEGER DEFAULT 0,
    tag TEXT DEFAULT 'lead',
    read INTEGER DEFAULT 0,
    thread_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company_name TEXT,
    city TEXT,
    score INTEGER DEFAULT 0,
    stage TEXT DEFAULT 'new',
    source_email_id INTEGER,
    plan TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (source_email_id) REFERENCES emails(id)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    lead_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (lead_id) REFERENCES leads(id)
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    lead_id INTEGER,
    email_id INTEGER,
    title TEXT,
    start_time TEXT,
    end_time TEXT,
    status TEXT DEFAULT 'suggested', -- suggested, confirmed, dismissed
    google_event_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (lead_id) REFERENCES leads(id),
    FOREIGN KEY (email_id) REFERENCES emails(id)
  );

  CREATE INDEX IF NOT EXISTS idx_emails_company ON emails(company_id);
  CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(company_id, stage);
  CREATE INDEX IF NOT EXISTS idx_activity_company ON activity_log(company_id);
  CREATE INDEX IF NOT EXISTS idx_meetings_company ON meetings(company_id);
`);

// Simple migration for existing DBs
try {
  db.exec('ALTER TABLE emails ADD COLUMN thread_id TEXT');
} catch(e) {}

try {
  db.exec('ALTER TABLE companies ADD COLUMN password_hash TEXT');
} catch(e) {}

try {
  db.exec('ALTER TABLE companies ADD COLUMN auth_token TEXT');
} catch(e) {}

module.exports = db;
