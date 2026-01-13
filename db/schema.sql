-- SQLite Schema for C4C Raffle Web Application
-- Designed for high-traffic concurrent access

CREATE TABLE IF NOT EXISTS raffles (
    id INTEGER PRIMARY KEY,
    number INTEGER,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    donated_by TEXT,
    image TEXT NOT NULL,
    winning_number TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_raffles_number ON raffles(number);
CREATE INDEX IF NOT EXISTS idx_raffles_winning ON raffles(winning_number);

CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY DEFAULT 1,
    rules TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    logo TEXT NOT NULL,
    website_url TEXT,
    created_at TEXT NOT NULL
);

-- Version tracking for cache invalidation
CREATE TABLE IF NOT EXISTS data_versions (
    key TEXT PRIMARY KEY,
    version INTEGER DEFAULT 0,
    updated_at TEXT
);

-- Insert default version entries
INSERT OR IGNORE INTO data_versions (key, version, updated_at) VALUES ('raffles', 0, datetime('now'));
INSERT OR IGNORE INTO data_versions (key, version, updated_at) VALUES ('rules', 0, datetime('now'));
INSERT OR IGNORE INTO data_versions (key, version, updated_at) VALUES ('sponsors', 0, datetime('now'));
