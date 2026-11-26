/**
 * Write-side data access: campaigns meta, tasks, action items, raw table edits, settings,
 * chat history. Every write that can change a metric bumps data_version so lib/metrics.ts
 * recomputes immediately (tasks/action items are read live and do not need it).
 */
import { getDb, newId, nowIst, type Param, type Row } from "./db";
import { RAW_TABLES, coerce, seedDatabase } from "./seed";
import { DEFAULT_SETTINGS, type SettingsKey } from "./settings";
import { ensureSeeded } from "./seed";

export async function bumpVersion(): Promise<void> {
  await ensureSeeded(); // applies pending migrations, so dataset_versions exists
  const v = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await getDb().run("UPDATE app_meta SET value = ? WHERE key = 'data_version'", [v]);
  // The active dataset row tracks the live data_version (edits are part of that dataset).
  await getDb().run("UPDATE dataset_versions SET data_version = ? WHERE is_active = 1", [v]);
}

/** The active dataset (dataset_versions.id). Stable across edits; changes on every import or reset. */
export async function currentDatasetId(): Promise<string> {
  await ensureSeeded();
  const r = await getDb().get<{ id: string }>("SELECT id FROM dataset_versions WHERE is_active = 1");
  return r?.id ?? "unknown";
}

async function logEdit(table: string, ref: string | null, action: string, detail: unknown) {
  await getDb().run(
    "INSERT INTO data_edits (id, at, table_name, row_ref, action, detail) VALUES (?, ?, ?, ?, ?, ?)",
    [newId("ed"), nowIst(), table, ref, action, typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 2000)],
  );
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
  const s = String(v).trim().toLowerCase() as T;
  if (!allowed.includes(s)) throw new Error(`${field} must be one of: ${allowed.join(", ")} (got "${String(v)}").`);
  return s;
}
function optDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${field} must be YYYY-MM-DD (got "${s}").`);
  return s;
}
const optText = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

// ---------------------------------------------------------------------------
// Campaigns (meta)
// ---------------------------------------------------------------------------
export const CAMPAIGN_STATUSES = ["active", "paused", "stopped"] as const;

export async function listCampaigns() {
  await ensureSeeded();
  return getDb().all(
    `SELECT c.campaign_id, c.campaign_name, c.channel, c.target_audience, c.objective, c.owner_name AS source_owner_name,
            c.planned_start_at, c.planned_end_at,
            m.status, m.owner_name, m.owner_id, m.planned_budget_inr, m.notes, m.updated_at
       FROM campaigns c LEFT JOIN campaigns_meta m ON m.campaign_id = c.campaign_id
      WHERE c._rid IN (SELECT MIN(_rid) FROM campaigns GROUP BY campaign_id)
      ORDER BY c.campaign_id`,
  );
}

export async function listOwners(): Promise<{ owner_id: string; owner_name: string }[]> {
  await ensureSeeded();
  const rows = await getDb().all<{ owner_id: string; owner_name: string }>(
    `SELECT DISTINCT owner_id, owner_name FROM campaigns WHERE owner_name IS NOT NULL
     UNION SELECT DISTINCT owner_id, owner_name FROM people WHERE owner_name IS NOT NULL
     ORDER BY owner_name`,
  );
  return rows;
}

export interface CampaignInput {
  campaign_id?: string;
  campaign_name?: string;
  channel?: string;
  status?: string;
  owner_name?: string;
  planned_budget_inr?: number | string | null;
  notes?: string | null;
}

export async function createCampaign(input: CampaignInput) {
  const db = getDb();
  const name = optText(input.campaign_name);
  if (!name) throw new Error("campaign_name is required.");
  const existing = await db.all<{ campaign_id: string }>("SELECT campaign_id FROM campaigns");
  let id = optText(input.campaign_id);
  if (!id) {
    const max = existing.reduce((m, r) => Math.max(m, Number(String(r.campaign_id).replace(/\D/g, "")) || 0), 0);
    id = `C${String(max + 1).padStart(2, "0")}`;
  }
  if (existing.some((r) => r.campaign_id === id)) throw new Error(`campaign_id ${id} already exists.`);
  const owner = optText(input.owner_name);
  const ownerId = owner ? (await listOwners()).find((o) => o.owner_name === owner)?.owner_id ?? null : null;
  const now = nowIst();
  await db.tx(async (t) => {
    await t.run(
      `INSERT INTO campaigns (_rid, campaign_name, channel, target_audience, objective, owner_name, created_at, planned_start_at, planned_end_at, campaign_id, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId("cp-u"), name, optText(input.channel) ?? "other", null, null, owner, now, null, null, id, ownerId],
    );
    await t.run(
      "INSERT INTO campaigns_meta (campaign_id, status, owner_name, owner_id, planned_budget_inr, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        oneOf(input.status, CAMPAIGN_STATUSES, "status", "active"),
        owner,
        ownerId,
        input.planned_budget_inr === undefined || input.planned_budget_inr === null || input.planned_budget_inr === ""
          ? null
          : Math.round(Number(input.planned_budget_inr)),
        optText(input.notes),
        now,
      ],
    );
  });
  await logEdit("campaigns", id, "insert", input);
  await bumpVersion();
  return { campaign_id: id };
}

export async function updateCampaign(id: string, input: CampaignInput) {
  const db = getDb();
  const exists = await db.get("SELECT campaign_id FROM campaigns_meta WHERE campaign_id = ?", [id]);
  if (!exists) throw new Error(`Unknown campaign_id "${id}".`);
  const sets: string[] = [];
  const params: Param[] = [];
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(oneOf(input.status, CAMPAIGN_STATUSES, "status"));
  }
  if (input.owner_name !== undefined) {
    const owner = optText(input.owner_name);
    sets.push("owner_name = ?", "owner_id = ?");
    params.push(owner, owner ? (await listOwners()).find((o) => o.owner_name === owner)?.owner_id ?? null : null);
  }
  if (input.planned_budget_inr !== undefined) {
    const v = input.planned_budget_inr;
    const n = v === null || v === "" ? null : Math.round(Number(v));
    if (n !== null && !Number.isFinite(n)) throw new Error("planned_budget_inr must be a number.");
    sets.push("planned_budget_inr = ?");
    params.push(n);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(optText(input.notes));
  }
  if (input.campaign_name !== undefined || input.channel !== undefined) {
    if (input.campaign_name !== undefined)
      await db.run("UPDATE campaigns SET campaign_name = ? WHERE campaign_id = ?", [optText(input.campaign_name), id]);
    if (input.channel !== undefined)
      await db.run("UPDATE campaigns SET channel = ? WHERE campaign_id = ?", [optText(input.channel), id]);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(nowIst(), id);
    await db.run(`UPDATE campaigns_meta SET ${sets.join(", ")} WHERE campaign_id = ?`, params);
  }
  await logEdit("campaigns_meta", id, "update", input);
  await bumpVersion();
  return { campaign_id: id };
}

export async function deleteCampaign(id: string) {
  const db = getDb();
  const used = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM daily_marketing WHERE campaign_id = ?", [id]);
  if (Number(used?.n ?? 0) > 0)
    throw new Error(`Campaign ${id} has source activity rows; set its status to "stopped" instead of deleting it.`);
  await db.run("DELETE FROM campaigns WHERE campaign_id = ?", [id]);
  await db.run("DELETE FROM campaigns_meta WHERE campaign_id = ?", [id]);
  await logEdit("campaigns", id, "delete", "");
  await bumpVersion();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_SOURCES = ["manual", "copilot", "recommendation"] as const;

export interface TaskInput {
  title?: string;
  description?: string | null;
  campaign_id?: string | null;
  owner_name?: string | null;
  due_date?: string | null;
  status?: string;
  priority?: string;
  source?: string;
}

export async function listTasks(filter: { status?: string; campaign_id?: string; owner_name?: string; source?: string } = {}) {
  await ensureSeeded();
  const where: string[] = [];
  const params: Param[] = [];
  for (const k of ["status", "campaign_id", "owner_name", "source"] as const) {
    if (filter[k]) {
      where.push(`t.${k} = ?`);
      params.push(filter[k] as string);
    }
  }
  return getDb().all(
    `SELECT t.*, c.campaign_name FROM tasks t
       LEFT JOIN (SELECT campaign_id, MIN(campaign_name) AS campaign_name FROM campaigns GROUP BY campaign_id) c
         ON c.campaign_id = t.campaign_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
               CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               t.due_date, t.created_at DESC`,
    params,
  );
}

async function checkCampaign(id: string | null) {
  if (!id) return null;
  const r = await getDb().get("SELECT campaign_id FROM campaigns WHERE campaign_id = ?", [id]);
  if (!r) throw new Error(`Unknown campaign_id "${id}".`);
  return id;
}

export async function createTask(input: TaskInput) {
  const title = optText(input.title);
  if (!title) throw new Error("title is required.");
  const id = newId("task");
  const now = nowIst();
  await getDb().run(
    `INSERT INTO tasks (id, title, description, campaign_id, owner_name, due_date, status, priority, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      optText(input.description),
      await checkCampaign(optText(input.campaign_id)),
      optText(input.owner_name),
      optDate(input.due_date, "due_date"),
      oneOf(input.status, TASK_STATUSES, "status", "todo"),
      oneOf(input.priority, PRIORITIES, "priority", "medium"),
      oneOf(input.source, TASK_SOURCES, "source", "manual"),
      now,
      now,
    ],
  );
  await logEdit("tasks", id, "insert", { title, source: input.source });
  return getDb().get("SELECT * FROM tasks WHERE id = ?", [id]);
}

export async function updateTask(id: string, input: TaskInput) {
  const sets: string[] = [];
  const params: Param[] = [];
  if (input.title !== undefined) {
    const t = optText(input.title);
    if (!t) throw new Error("title cannot be empty.");
    sets.push("title = ?");
    params.push(t);
  }
  if (input.description !== undefined) (sets.push("description = ?"), params.push(optText(input.description)));
  if (input.campaign_id !== undefined) (sets.push("campaign_id = ?"), params.push(await checkCampaign(optText(input.campaign_id))));
  if (input.owner_name !== undefined) (sets.push("owner_name = ?"), params.push(optText(input.owner_name)));
  if (input.due_date !== undefined) (sets.push("due_date = ?"), params.push(optDate(input.due_date, "due_date")));
  if (input.status !== undefined) (sets.push("status = ?"), params.push(oneOf(input.status, TASK_STATUSES, "status")));
  if (input.priority !== undefined) (sets.push("priority = ?"), params.push(oneOf(input.priority, PRIORITIES, "priority")));
  if (!sets.length) return getDb().get("SELECT * FROM tasks WHERE id = ?", [id]);
  sets.push("updated_at = ?");
  params.push(nowIst(), id);
  const r = await getDb().run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) throw new Error(`Unknown task id "${id}".`);
  await logEdit("tasks", id, "update", input);
  return getDb().get("SELECT * FROM tasks WHERE id = ?", [id]);
}

export async function deleteTask(id: string) {
  const r = await getDb().run("DELETE FROM tasks WHERE id = ?", [id]);
  if (!r.changes) throw new Error(`Unknown task id "${id}".`);
  await logEdit("tasks", id, "delete", "");
}

// ---------------------------------------------------------------------------
// Action items (decision log)
// ---------------------------------------------------------------------------
export const ACTION_KINDS = ["scale", "change", "stop", "investigate", "other"] as const;
export const ACTION_STATUSES = ["open", "done", "dropped"] as const;

export interface ActionInput {
  campaign_id?: string | null;
  kind?: string;
  description?: string;
  owner_name?: string | null;
  due_date?: string | null;
  status?: string;
  source?: string;
}

export async function listActions() {
  await ensureSeeded();
  return getDb().all(
    `SELECT a.*, c.campaign_name FROM action_items a
       LEFT JOIN (SELECT campaign_id, MIN(campaign_name) AS campaign_name FROM campaigns GROUP BY campaign_id) c
         ON c.campaign_id = a.campaign_id
      ORDER BY CASE a.status WHEN 'open' THEN 0 ELSE 1 END, a.created_at DESC`,
  );
}

export async function createAction(input: ActionInput) {
  const desc = optText(input.description);
  if (!desc) throw new Error("description is required.");
  const id = newId("act");
  const now = nowIst();
  await getDb().run(
    `INSERT INTO action_items (id, campaign_id, kind, description, owner_name, due_date, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      await checkCampaign(optText(input.campaign_id)),
      oneOf(input.kind, ACTION_KINDS, "kind", "investigate"),
      desc,
      optText(input.owner_name),
      optDate(input.due_date, "due_date"),
      oneOf(input.status, ACTION_STATUSES, "status", "open"),
      oneOf(input.source, TASK_SOURCES, "source", "manual"),
      now,
      now,
    ],
  );
  await logEdit("action_items", id, "insert", input);
  return getDb().get("SELECT * FROM action_items WHERE id = ?", [id]);
}

export async function updateAction(id: string, input: ActionInput) {
  const sets: string[] = [];
  const params: Param[] = [];
  if (input.description !== undefined) (sets.push("description = ?"), params.push(optText(input.description)));
  if (input.kind !== undefined) (sets.push("kind = ?"), params.push(oneOf(input.kind, ACTION_KINDS, "kind")));
  if (input.status !== undefined) (sets.push("status = ?"), params.push(oneOf(input.status, ACTION_STATUSES, "status")));
  if (input.owner_name !== undefined) (sets.push("owner_name = ?"), params.push(optText(input.owner_name)));
  if (input.due_date !== undefined) (sets.push("due_date = ?"), params.push(optDate(input.due_date, "due_date")));
  if (input.campaign_id !== undefined) (sets.push("campaign_id = ?"), params.push(await checkCampaign(optText(input.campaign_id))));
  if (!sets.length) return;
  sets.push("updated_at = ?");
  params.push(nowIst(), id);
  const r = await getDb().run(`UPDATE action_items SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) throw new Error(`Unknown action id "${id}".`);
  await logEdit("action_items", id, "update", input);
}

export async function deleteAction(id: string) {
  await getDb().run("DELETE FROM action_items WHERE id = ?", [id]);
  await logEdit("action_items", id, "delete", "");
}

// ---------------------------------------------------------------------------
// Raw table editor (Data page)
// ---------------------------------------------------------------------------
export const EDITABLE_TABLES = Object.fromEntries(RAW_TABLES.map((t) => [t.table, t]));
const ID_COLUMN: Record<string, string> = {
  daily_marketing: "activity_id",
  people: "person_id",
  interactions: "interaction_id",
  registrations: "registration_id",
  registration_history: "history_id",
  checkins: "event_id",
  campaigns: "campaign_id",
  targets: "target_version",
  event: "event_name",
};

function spec(table: string) {
  const s = EDITABLE_TABLES[table];
  if (!s) throw new Error(`Unknown table "${table}". Editable: ${Object.keys(EDITABLE_TABLES).join(", ")}`);
  return s;
}

export async function listRows(table: string, opts: { q?: string; limit?: number; offset?: number; sort?: string } = {}) {
  await ensureSeeded();
  const s = spec(table);
  const cols = Object.keys(s.columns);
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);
  const offset = Math.max(0, opts.offset ?? 0);
  const where: string[] = [];
  const params: Param[] = [];
  if (opts.q) {
    const textCols = cols.filter((c) => s.columns[c] !== "int");
    where.push(`(${textCols.map((c) => `LOWER(${c}) LIKE ?`).join(" OR ")})`);
    for (let i = 0; i < textCols.length; i++) params.push(`%${opts.q.toLowerCase()}%`);
  }
  const order = opts.sort && cols.includes(opts.sort.replace(/^-/, "")) ? `${opts.sort.replace(/^-/, "")} ${opts.sort.startsWith("-") ? "DESC" : "ASC"}, _rid` : "_rid";
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const [rows, total, dups] = await Promise.all([
    db.all(`SELECT _rid, ${cols.join(", ")} FROM ${table} ${w} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} ${w}`, params),
    db.get<{ n: number }>(
      `SELECT COUNT(*) - COUNT(DISTINCT ${ID_COLUMN[table]}) AS n FROM ${table}`,
    ),
  ]);
  return {
    table,
    columns: cols.map((c) => ({ name: c, type: s.columns[c] })),
    id_column: ID_COLUMN[table],
    rows,
    total: Number(total?.n ?? 0),
    duplicate_copies: Number(dups?.n ?? 0),
    limit,
    offset,
  };
}

function rowValues(table: string, input: Row, partial: boolean) {
  const s = spec(table);
  const out: Record<string, Param> = {};
  for (const [c, t] of Object.entries(s.columns)) {
    if (!(c in input)) {
      if (!partial) out[c] = null;
      continue;
    }
    try {
      out[c] = coerce(input[c], t);
    } catch (e) {
      throw new Error(`${c}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Fill readable labels for daily marketing rows from the campaign, so edits stay consistent. */
async function fillDailyLabels(vals: Record<string, Param>) {
  if (!vals.campaign_id) return;
  const c = await getDb().get<{ campaign_name: string; owner_name: string; owner_id: string }>(
    "SELECT campaign_name, owner_name, owner_id FROM campaigns WHERE campaign_id = ?",
    [vals.campaign_id as string],
  );
  if (!c) throw new Error(`Unknown campaign_id "${vals.campaign_id}".`);
  vals.campaign_name ??= c.campaign_name;
  vals.owner_name ??= c.owner_name;
  vals.owner_id ??= c.owner_id;
}

export async function insertRow(table: string, input: Row) {
  const s = spec(table);
  const vals = rowValues(table, input, false);
  if (table === "daily_marketing") {
    if (!vals.campaign_id || !vals.activity_date) throw new Error("campaign_id and activity_date are required.");
    await fillDailyLabels(vals);
    vals.activity_id ??= `AD-${vals.campaign_id}-${String(vals.activity_date).slice(5).replace("-", "")}-U${Date.now().toString(36).slice(-4)}`;
    for (const k of ["impressions", "clicks", "reported_reach", "landing_page_sessions", "registration_starts", "marketing_spend_inr"])
      vals[k] ??= 0;
    vals.platform ??= "manual entry";
  }
  const idc = ID_COLUMN[table];
  if (!vals[idc]) throw new Error(`${idc} is required.`);
  const rid = newId(`${s.prefix}-u`);
  const cols = Object.keys(vals);
  await getDb().run(
    `INSERT INTO ${table} (_rid, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`,
    [rid, ...cols.map((c) => vals[c])],
  );
  await logEdit(table, String(vals[idc]), "insert", vals);
  await bumpVersion();
  return { _rid: rid, ...vals };
}

/**
 * Update a raw row. Import copies share the stable ID, so the edit is applied to every
 * copy with the same ID (otherwise dedupe would keep the unedited first copy).
 */
export async function updateRow(table: string, rid: string, input: Row) {
  spec(table);
  const db = getDb();
  const idc = ID_COLUMN[table];
  const cur = await db.get<Row>(`SELECT * FROM ${table} WHERE _rid = ?`, [rid]);
  if (!cur) throw new Error(`Row ${rid} not found in ${table}.`);
  const vals = rowValues(table, input, true);
  delete vals[idc]; // stable IDs are not editable
  if (table === "daily_marketing" && vals.campaign_id && vals.campaign_id !== cur.campaign_id) {
    vals.campaign_name = null;
    vals.owner_name = null;
    vals.owner_id = null;
    await fillDailyLabels(vals);
  }
  const cols = Object.keys(vals);
  if (!cols.length) return cur;
  const r = await db.run(
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${idc} = ?`,
    [...cols.map((c) => vals[c]), cur[idc] as string],
  );
  await logEdit(table, String(cur[idc]), "update", { changes: vals, copies_updated: r.changes });
  await bumpVersion();
  return db.get(`SELECT * FROM ${table} WHERE _rid = ?`, [rid]);
}

export async function deleteRow(table: string, rid: string) {
  spec(table);
  const db = getDb();
  const idc = ID_COLUMN[table];
  const cur = await db.get<Row>(`SELECT * FROM ${table} WHERE _rid = ?`, [rid]);
  if (!cur) throw new Error(`Row ${rid} not found in ${table}.`);
  const r = await db.run(`DELETE FROM ${table} WHERE ${idc} = ?`, [cur[idc] as string]);
  await logEdit(table, String(cur[idc]), "delete", { copies_deleted: r.changes });
  await bumpVersion();
}

export async function listEdits(limit = 30) {
  await ensureSeeded();
  return getDb().all(`SELECT * FROM data_edits ORDER BY at DESC, id DESC LIMIT ${Math.min(200, limit)}`);
}

export async function resetToOriginal() {
  const report = await seedDatabase("reset");
  return report;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function updateSettings(key: SettingsKey, value: Record<string, unknown>) {
  const defaults = DEFAULT_SETTINGS[key] as Record<string, number>;
  if (!defaults) throw new Error(`Unknown settings key "${key}".`);
  const clean: Record<string, number> = { ...defaults };
  const cur = await getDb().get<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]);
  if (cur) Object.assign(clean, JSON.parse(cur.value));
  for (const [k, v] of Object.entries(value)) {
    if (!(k in defaults)) throw new Error(`Unknown setting ${key}.${k}`);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key}.${k} must be a non-negative number.`);
    clean[k] = n;
  }
  await getDb().run("DELETE FROM app_settings WHERE key = ?", [key]);
  await getDb().run("INSERT INTO app_settings (key, value) VALUES (?, ?)", [key, JSON.stringify(clean)]);
  await logEdit("app_settings", key, "update", clean);
  await bumpVersion();
  return clean;
}

// ---------------------------------------------------------------------------
// Chat history
// ---------------------------------------------------------------------------
export interface ChatMessage {
  id: string;
  session_id: string;
  seq: number;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
  meta: string | null;
  created_at: string;
}

export async function getChat(sessionId = "default"): Promise<ChatMessage[]> {
  await ensureSeeded();
  return getDb().all<ChatMessage>("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY seq", [sessionId]);
}

export async function appendChat(sessionId: string, msg: Omit<ChatMessage, "id" | "seq" | "session_id" | "created_at">) {
  const db = getDb();
  const r = await db.get<{ m: number | null }>("SELECT MAX(seq) AS m FROM chat_messages WHERE session_id = ?", [sessionId]);
  const seq = Number(r?.m ?? 0) + 1;
  const id = newId("msg");
  await db.run(
    `INSERT INTO chat_messages (id, session_id, seq, role, content, tool_calls, tool_call_id, name, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, sessionId, seq, msg.role, msg.content, msg.tool_calls, msg.tool_call_id, msg.name, msg.meta, nowIst()],
  );
  return id;
}

export async function updateChatMeta(id: string, meta: unknown) {
  await getDb().run("UPDATE chat_messages SET meta = ? WHERE id = ?", [JSON.stringify(meta), id]);
}

export async function clearChat(sessionId = "default") {
  await getDb().run("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
}
