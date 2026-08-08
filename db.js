const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "green-lotto.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    national_id TEXT NOT NULL,
    age INTEGER NOT NULL,
    employment_status TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    payment_status TEXT NOT NULL DEFAULT 'pending',
    checkout_request_id TEXT,
    merchant_request_id TEXT,
    mpesa_receipt TEXT,
    amount_paid INTEGER,
    paid_at TEXT,
    ticket_number TEXT UNIQUE,
    failure_reason TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_checkout_request_id ON applications (checkout_request_id);
  CREATE INDEX IF NOT EXISTS idx_phone ON applications (phone);
`);

module.exports = db;
