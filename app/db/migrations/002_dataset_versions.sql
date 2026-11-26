-- Migration 002 (schema version 1 -> 2): dataset history and join-key indexes.
-- Portable SQL (SQLite and Postgres). Applied once by lib/schema-version.ts when a database
-- created at version 1 is opened. CHECK and NOT NULL constraints on the raw tables arrive with
-- the next import or reset, which recreates those tables from db/schema.sql.

CREATE TABLE IF NOT EXISTS dataset_versions (
  id TEXT NOT NULL PRIMARY KEY,
  data_version TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('original', 'upload', 'reset')),
  imported_at TEXT NOT NULL,
  row_counts TEXT,
  mapping TEXT,
  cleaning TEXT,
  schema_version INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);

-- A version-1 database always holds the original workbook: record it as the active dataset.
INSERT INTO dataset_versions (id, data_version, source_name, source_kind, imported_at, row_counts, mapping, cleaning, schema_version, is_active)
  SELECT 'dv-initial', value, 'Attendee_Dataset.xlsx', 'original',
         COALESCE((SELECT value FROM app_meta WHERE key = 'seeded_at'), ''), NULL, NULL, NULL, 2, 1
    FROM app_meta
   WHERE key = 'data_version' AND NOT EXISTS (SELECT 1 FROM dataset_versions);

INSERT INTO app_meta (key, value)
  SELECT 'dataset_name', 'Attendee_Dataset.xlsx' WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'dataset_name');
INSERT INTO app_meta (key, value)
  SELECT 'dataset_kind', 'original' WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'dataset_kind');

CREATE INDEX IF NOT EXISTS idx_campaigns_id ON campaigns (campaign_id);
CREATE INDEX IF NOT EXISTS idx_daily_campaign_date ON daily_marketing (campaign_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_people_campaign ON people (first_campaign_id);
CREATE INDEX IF NOT EXISTS idx_interactions_person ON interactions (person_id);
CREATE INDEX IF NOT EXISTS idx_registrations_person ON registrations (person_id);
CREATE INDEX IF NOT EXISTS idx_registrations_campaign ON registrations (campaign_id);
CREATE INDEX IF NOT EXISTS idx_history_registration ON registration_history (registration_id);
CREATE INDEX IF NOT EXISTS idx_checkins_person ON checkins (person_id);
CREATE INDEX IF NOT EXISTS idx_checkins_registration ON checkins (registration_id);
