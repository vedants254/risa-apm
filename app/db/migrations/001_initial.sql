-- Migration 001 (schema version 1): the original Growth Center schema, kept as a record of version 1.
-- Not applied by the migrator (fresh databases run db/schema.sql); tests use it to build a v1 database.
-- Running this file resets the database: views and tables are dropped and recreated.
-- Conventions that keep it portable:
--   * every table has a TEXT primary key (no SERIAL / AUTOINCREMENT);
--   * timestamps are TEXT 'YYYY-MM-DD HH:MM:SS' in IST (Asia/Kolkata), dates are 'YYYY-MM-DD',
--     so string comparison is chronological on both engines;
--   * money and counts are INTEGER (whole INR, event counts).

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
-- Raw source tables: one per xlsx tab, imported as given (duplicates kept).
-- _rid is a surrogate row key; the stable source IDs are NOT unique on purpose.
-- ---------------------------------------------------------------------------

CREATE TABLE event (
  _rid TEXT PRIMARY KEY,
  event_name TEXT,
  history_start TEXT,
  history_end TEXT,
  event_starts_at TEXT,
  event_ends_at TEXT,
  timezone TEXT,
  currency TEXT,
  fictional TEXT
);

CREATE TABLE targets (
  _rid TEXT PRIMARY KEY,
  effective_at TEXT,
  identified_external_people_goal INTEGER,
  registration_goal INTEGER,
  unique_external_visitors_goal INTEGER,
  marketing_budget_inr INTEGER,
  target_version TEXT
);

CREATE TABLE campaigns (
  _rid TEXT PRIMARY KEY,
  campaign_name TEXT,
  channel TEXT,
  target_audience TEXT,
  objective TEXT,
  owner_name TEXT,
  created_at TEXT,
  planned_start_at TEXT,
  planned_end_at TEXT,
  campaign_id TEXT,
  owner_id TEXT
);

CREATE TABLE daily_marketing (
  _rid TEXT PRIMARY KEY,
  campaign_name TEXT,
  owner_name TEXT,
  activity_date TEXT,
  impressions INTEGER,
  clicks INTEGER,
  reported_reach INTEGER,
  landing_page_sessions INTEGER,
  registration_starts INTEGER,
  marketing_spend_inr INTEGER,
  platform TEXT,
  activity_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_daily_activity ON daily_marketing (activity_id);

CREATE TABLE people (
  _rid TEXT PRIMARY KEY,
  person_name TEXT,
  person_type TEXT,
  first_seen_at TEXT,
  first_touch_source TEXT,
  first_campaign_name TEXT,
  owner_name TEXT,
  person_id TEXT,
  first_campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_people_person ON people (person_id);

CREATE TABLE interactions (
  _rid TEXT PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  occurred_at TEXT,
  event_type TEXT,
  detail TEXT,
  interaction_id TEXT,
  person_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_interactions_id ON interactions (interaction_id);

CREATE TABLE registrations (
  _rid TEXT PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  registered_at TEXT,
  registration_id TEXT,
  person_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_registrations_id ON registrations (registration_id);

CREATE TABLE registration_history (
  _rid TEXT PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  effective_at TEXT,
  status TEXT,
  history_id TEXT,
  registration_id TEXT,
  person_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_history_id ON registration_history (history_id);

CREATE TABLE checkins (
  _rid TEXT PRIMARY KEY,
  person_name TEXT,
  campaign_name TEXT,
  owner_name TEXT,
  occurred_at TEXT,
  result TEXT,
  verification TEXT,
  source TEXT,
  event_id TEXT,
  person_id TEXT,
  registration_id TEXT,
  campaign_id TEXT,
  owner_id TEXT
);
CREATE INDEX idx_checkins_event ON checkins (event_id);

-- Deduplicated read views (first copy per stable ID). Used by the copilot's
-- read-only SQL tool; lib/metrics.ts applies the same rule in TypeScript.
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
-- App tables (management layer).
-- ---------------------------------------------------------------------------

-- Operational metadata per campaign. Source campaign facts stay in `campaigns`.
CREATE TABLE campaigns_meta (
  campaign_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',          -- active | paused | stopped
  owner_name TEXT,
  owner_id TEXT,
  planned_budget_inr INTEGER,
  notes TEXT,
  updated_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
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
  id TEXT PRIMARY KEY,
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
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
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
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Internal bookkeeping, e.g. data_version (bumped on every write so caches refresh).
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Log of edits made through the Data page / APIs.
CREATE TABLE data_edits (
  id TEXT PRIMARY KEY,
  at TEXT,
  table_name TEXT,
  row_ref TEXT,
  action TEXT,                                    -- insert | update | delete | reset
  detail TEXT
);
