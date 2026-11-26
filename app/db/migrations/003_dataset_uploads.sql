-- Migration 003 (schema version 2 -> 3): uploaded files waiting between "analyse" and "import".
-- Portable SQL (SQLite and Postgres).

-- Files waiting between "analyse" and "import" (base64 JSON, so it is portable). Kept across
-- imports; a row is deleted when its file is imported and expires after a day otherwise.
CREATE TABLE IF NOT EXISTS dataset_uploads (
  id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,                       -- ISO UTC
  expires_at TEXT NOT NULL,                       -- ISO UTC
  files TEXT NOT NULL,                            -- JSON [{name, data (base64)}]
  meta TEXT                                       -- JSON {files, mode, model, mapping}
);
