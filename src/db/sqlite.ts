import Database from 'better-sqlite3';
import { getConfig } from '../config.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const config = getConfig();
  const dbPath = config.dev_mode ? ':memory:' : config.database_path;

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  runMigrations(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_reason TEXT,
      tier TEXT NOT NULL DEFAULT 'lobby',
      language TEXT NOT NULL DEFAULT 'en',
      consent INTEGER NOT NULL DEFAULT 0,

      score_final INTEGER,
      score_behavioral INTEGER,
      score_explicit INTEGER,
      score_fit INTEGER,

      visitor_name TEXT,
      visitor_company TEXT,
      visitor_role TEXT,
      visitor_phone TEXT,

      trello_card_id TEXT,
      booking_time TEXT,
      payment_provider TEXT,
      payment_status TEXT,
      payment_id TEXT,

      ip_hash TEXT,
      referrer TEXT,
      user_agent TEXT,
      messages_count INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      guard_level INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT,
      action_json TEXT,
      structured_json TEXT,
      tokens INTEGER,
      created_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      event_type TEXT NOT NULL,
      details TEXT,
      ip_hash TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    );
  `);
}

function runMigrations(db: Database.Database): void {
  // Add tokens_input / tokens_output columns (v2.5.0)
  const cols = db.pragma('table_info(messages)') as Array<{ name: string }>;
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('tokens_input')) {
    db.exec('ALTER TABLE messages ADD COLUMN tokens_input INTEGER');
  }
  if (!colNames.includes('tokens_output')) {
    db.exec('ALTER TABLE messages ADD COLUMN tokens_output INTEGER');
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
