-- Growth Center schema, version 3 (see SCHEMA_VERSION in lib/schema-version.ts).
-- Plain SQL that runs unchanged on SQLite and Postgres. This file is the single source of truth
-- for a fresh database; db/migrations/NNN_*.sql upgrade databases created by older versions.
--
-- Running this file replaces the dataset: every data and app table below is dropped and
-- recreated, so nothing from a previous import survives (no leakage). Only dataset_versions
-- (history metadata, no data rows) is kept across imports.
--
-- Conventions that keep it portable:
--   * every table has a TEXT primary key (no SERIAL / AUTOINCREMENT);
--   * timestamps are TEXT 'YYYY-MM-DD HH:MM:SS' in IST (Asia/Kolkata), dates are 'YYYY-MM-DD',
--     so string comparison is chronological on both engines;
--   * money and counts are INTEGER (whole INR, event counts);
--   * CHECK constraints pin the vocabularies the metrics read; NULL is allowed where the source
--     may leave a value out.
-- Extra columns from an upload (x_<name> TEXT) and side tables for unused sheets (x_<sheet>) are
-- added by lib/seed.ts at import time and listed in app_meta.extra_fields / extra_tables.

DROP VIEW IF EXISTS v_daily_marketing;
DROP VIEW IF EXISTS v_people;
DROP VIEW IF EXISTS v_interactions;
DROP VIEW IF EXISTS v_registrations;
DROP VIEW IF EXISTS v_registration_history;
DROP VIEW IF EXISTS v_checkins;

DROP TABLE IF EXISTS event;
DROP TABLE IF EXISTS targets;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS daily_marketing;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS registration_history;
DROP TABLE IF EXISTS checkins;
DROP TABLE IF EXISTS campaigns_meta;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS action_items;
DROP TABLE IF EXISTS chat_sessions;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS app_meta;
DROP TABLE IF EXISTS data_edits;

-- ---------------------------------------------------------------------------
-- Raw source tables: one per source sheet, imported as given (duplicates kept).
-- _rid is a surrogate row key; the stable source IDs are NOT unique on purpose
-- (import copies share them; the v_* views and lib/metrics.ts count each ID once).
-- ---------------------------------------------------------------------------

-- The event the data describes (one row).
CREATE TABLE event (
  _rid TEXT NOT NULL PRIMARY KEY,
  event_name TEXT,
  history_start TEXT,                              -- first date the data covers
  history_end TEXT,                                -- last date the data covers
  event_starts_at TEXT,
  event_ends_at TEXT,
  timezone TEXT,
  currency TEXT,
  fictional TEXT
);

-- Goal plans; the latest row effective at or before a date applies.
CREATE TABLE targets (
  _rid TEXT NOT NULL PRIMARY KEY,
  effective_at TEXT,
  identified_external_people_goal INTEGER CHECK (identified_external_people_goal >= 0),
  registration_goal INTEGER CHECK (registration_goal >= 0),
  unique_external_visitors_goal INTEGER CHECK (unique_external_visitors_goal >= 0),
  marketing_budget_inr INTEGER CHECK (marketing_budget_inr >= 0),
  target_version TEXT
);

CREATE TABLE campaigns (
  _rid TEXT NOT NULL PRIMARY KEY,
  campaign_name TEXT,
  channel TEXT,
  target_audience TEXT,
  objective TEXT,
  owner_name TEXT,
  created_at TEXT,
  planned_start_at TEXT,
  planned_end_at TEXT,
  campaign_id TEXT NOT NULL,
  owner_id TEXT
);
CREATE INDEX idx_campaigns_id ON campaigns (campaign_id);

-- One row per campaign per day. Spend is net: negative values are credits or refunds.
CREATE TABLE daily_marketing (
  _rid TEXT NOT NULL PRIMARY KEY,
  campaign_name TEXT,
  owner_name TEXT,
  activity_date TEXT NOT NULL,
  impressions INTEGER CHECK (impressions >= 0),
  clicks INTEGER CHECK (clicks >= 0),
  reported_reach INTEGER CHECK (reported_reach >= 0),
  landing_page_sessions INTEGER CHECK (landing_page_sessions >= 0),
  registration_starts INTEGER CHECK (registration_starts >= 0),
  marketing_spend_inr INTEGER,
  platform TEXT,
  activity_id TEXT NOT NULL,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_daily_activity ON daily_marketing (activity_id);
CREATE INDEX idx_daily_campaign_date ON daily_marketing (campaign_id, activity_date);

-- Only person_type = 'external' counts toward goals. 'unknown' marks values an upload could not map.
CREATE TABLE people (
  _rid TEXT NOT NULL PRIMARY KEY,
  person_name TEXT,
  person_type TEXT CHECK (person_type IN ('external', 'internal', 'staff', 'test', 'unknown')),
  first_seen_at TEXT,
  first_touch_source TEXT,
  first_campaign_name TEXT,
  owner_name TEXT,
  person_id TEXT NOT NULL,
  first_campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_people_person ON people (person_id);
CREATE INDEX idx_people_campaign ON people (first_campaign_id);

CREATE TABLE interactions (
  _rid TEXT NOT NULL PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  occurred_at TEXT,
  event_type TEXT,
  detail TEXT,
  interaction_id TEXT NOT NULL,
  person_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_interactions_id ON interactions (interaction_id);
CREATE INDEX idx_interactions_person ON interactions (person_id);

CREATE TABLE registrations (
  _rid TEXT NOT NULL PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  registered_at TEXT,
  registration_id TEXT NOT NULL,
  person_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_registrations_id ON registrations (registration_id);
CREATE INDEX idx_registrations_person ON registrations (person_id);
CREATE INDEX idx_registrations_campaign ON registrations (campaign_id);

-- Status versions; the latest version effective at or before a date is the status then.
CREATE TABLE registration_history (
  _rid TEXT NOT NULL PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  effective_at TEXT,
  status TEXT CHECK (status IN ('interested', 'confirmed', 'waitlisted', 'cancelled')),
  history_id TEXT NOT NULL,
  registration_id TEXT,
  person_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_history_id ON registration_history (history_id);
CREATE INDEX idx_history_registration ON registration_history (registration_id);

-- Admission observations. A verified visitor needs result 'admitted' and verification 'verified'.
CREATE TABLE checkins (
  _rid TEXT NOT NULL PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  occurred_at TEXT,
  result TEXT CHECK (result IN ('admitted', 'denied', 'pending')),
  verification TEXT CHECK (verification IN ('verified', 'unverified')),
  source TEXT,
  event_id TEXT NOT NULL,
  person_id TEXT,
  registration_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_checkins_event ON checkins (event_id);
CREATE INDEX idx_checkins_person ON checkins (person_id);
CREATE INDEX idx_checkins_registration ON checkins (registration_id);

-- Deduplicated read views (first copy per stable ID). Used by the copilot's
-- read-only SQL tool; lib/metrics.ts applies the same rule in TypeScript.
-- lib/seed.ts re-creates them after adding extra columns, so they include those too.
CREATE VIEW v_daily_marketing AS
  SELECT * FROM daily_marketing WHERE _rid IN (SELECT MIN(_rid) FROM daily_marketing GROUP BY activity_id);
CREATE VIEW v_people AS
  SELECT * FROM people WHERE _rid IN (SELECT MIN(_rid) FROM people GROUP BY person_id);
CREATE VIEW v_interactions AS
  SELECT * FROM interactions WHERE _rid IN (SELECT MIN(_rid) FROM interactions GROUP BY interaction_id);
CREATE VIEW v_registrations AS
  SELECT * FROM registrations WHERE _rid IN (SELECT MIN(_rid) FROM registrations GROUP BY registration_id);
CREATE VIEW v_registration_history AS
  SELECT * FROM registration_history WHERE _rid IN (SELECT MIN(_rid) FROM registration_history GROUP BY history_id);
CREATE VIEW v_checkins AS
  SELECT * FROM checkins WHERE _rid IN (SELECT MIN(_rid) FROM checkins GROUP BY event_id);

-- ---------------------------------------------------------------------------
-- App tables (management layer). Recreated with the data so nothing carries over.
-- ---------------------------------------------------------------------------

-- Operational metadata per campaign. Source campaign facts stay in `campaigns`.
CREATE TABLE campaigns_meta (
  campaign_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped')),
  owner_name TEXT,
  owner_id TEXT,
  planned_budget_inr INTEGER,
  notes TEXT,
  updated_at TEXT
);

CREATE TABLE tasks (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  campaign_id TEXT,
  owner_name TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo',            -- todo | in_progress | done
  priority TEXT NOT NULL DEFAULT 'medium',        -- low | medium | high
  source TEXT NOT NULL DEFAULT 'manual',          -- manual | copilot | recommendation
  created_at TEXT,
  updated_at TEXT
);

-- Decisions / action items (scale, change, stop, investigate) tied to campaigns.
CREATE TABLE action_items (
  id TEXT NOT NULL PRIMARY KEY,
  campaign_id TEXT,
  kind TEXT NOT NULL DEFAULT 'investigate',       -- scale | change | stop | investigate | other
  description TEXT NOT NULL,
  owner_name TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',            -- open | done | dropped
  source TEXT NOT NULL DEFAULT 'manual',          -- manual | copilot | recommendation
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE chat_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT,
  created_at TEXT
);

CREATE TABLE chat_messages (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,                             -- user | assistant | tool
  content TEXT,
  tool_calls TEXT,                                -- JSON (assistant tool calls)
  tool_call_id TEXT,
  name TEXT,
  meta TEXT,                                      -- JSON (snapshot date, proposals, card state)
  created_at TEXT
);
CREATE INDEX idx_chat_session ON chat_messages (session_id, seq);

-- Editable settings (decision thresholds, projection assumptions) as JSON values.
-- Reset to defaults on every import: thresholds tuned for one dataset do not carry to another.
CREATE TABLE app_settings (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT
);

-- Internal bookkeeping: data_version (bumped on every write so caches refresh), schema_version,
-- dataset_name, dataset_kind, extra_fields, extra_tables.
CREATE TABLE app_meta (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT
);

-- Log of edits made through the Data page / APIs. Starts with one "Imported <file>" entry.
CREATE TABLE data_edits (
  id TEXT NOT NULL PRIMARY KEY,
  at TEXT,
  table_name TEXT,
  row_ref TEXT,
  action TEXT,                                    -- insert | update | delete | reset | import
  detail TEXT
);

-- ---------------------------------------------------------------------------
-- Dataset history (kept across imports). Metadata only: never rows of an old dataset.
-- Exactly one row has is_active = 1, and its data_version equals app_meta.data_version.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dataset_versions (
  id TEXT NOT NULL PRIMARY KEY,
  data_version TEXT NOT NULL,
  source_name TEXT NOT NULL,                      -- file name(s) the data came from
  source_kind TEXT NOT NULL CHECK (source_kind IN ('original', 'upload', 'reset')),
  imported_at TEXT NOT NULL,                      -- IST
  row_counts TEXT,                                -- JSON {table: rows}
  mapping TEXT,                                   -- JSON mapping incl. value maps (null for the original workbook)
  cleaning TEXT,                                  -- JSON cleaning counts (null when imported as given)
  schema_version INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);

-- Files waiting between "analyse" and "import" (base64 JSON, so it is portable). Kept across
-- imports; a row is deleted when its file is imported and expires after a day otherwise.
CREATE TABLE IF NOT EXISTS dataset_uploads (
  id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,                       -- ISO UTC
  expires_at TEXT NOT NULL,                       -- ISO UTC
  files TEXT NOT NULL,                            -- JSON [{name, data (base64)}]
  meta TEXT                                       -- JSON {files, mode, model, mapping}
);
