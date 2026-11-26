# CampusFest Growth Center

The working product for the RISA Labs Growth APM take-home, Challenge A (attendee growth). It is an analytics dashboard, a campaign and task manager, and an embedded AI Growth Analyst & Copilot. All of them read the same live metrics from one database.

It starts on the synthetic CampusFest 2025 dataset (a copy ships in `seed-data/Attendee_Dataset.xlsx`; the original file is never modified). Any attendee-growth dataset in the same spirit can be uploaded instead: see [Bring your own dataset](#bring-your-own-dataset).

## Setup

Requirements: Node 22.5+ (built and tested on Node 26, which provides `node:sqlite`) and npm.

```bash
cd app
npm install
cp .env.local.example .env.local   # then set OPENAI_API_KEY (optional: the dashboard works without it)
npm run seed                       # creates data/growth.db from the xlsx (raw tables, duplicates kept)
npm run dev                        # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run seed` | Recreates the schema (`db/schema.sql`) and imports all 11 tabs. The Data page's "Reset to original data" button does the same. |
| `npm run test:golden` | Checks `lib/metrics.ts` against `../analysis/golden_metrics.json` at every snapshot date in that file. |
| `npm run test:tools` | Runs every copilot tool directly, with no LLM key needed. Also covers the SQL guard, the calculator, confirm-gating, and live recomputation after data edits. |
| `npm run test:grounding` | Unit tests for the copilot's numeric grounding check (rounding, ₹ lakh forms, %, ratios, dates ignored, invented numbers caught). |
| `npm run test:copilot` | Runs the 3-step demo workflow through the real copilot loop. A scripted stand-in replaces the LLM. Also covers persistence, the confirm cards, the grounding correction round and dataset isolation of chat history. |
| `npm run test:dataset` | The upload pipeline with no live model call: fast path on the original workbook, a messy CSV export (renamed columns, DD/MM dates, ₹ amounts, "Yes"/"Attendee" values, duplicates) that must reproduce the original metrics, the model retry path, the sponsor workbook refusal, no leakage after importing B over A, and schema migrations. |
| `npm test` | Runs all five test suites. |
| `npm run typecheck` | Runs `tsc --noEmit`. |

The tests use a temporary copy of the database, so they never change your local data.

### Environment (`.env.local`)

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for the copilot chat. Without it, the panel shows "Set OPENAI_API_KEY". |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Any chat-completions model that supports tool calling. |
| `LLM_PROVIDER` | `openai` | Set to `gemini` to use `GEMINI_API_KEY` / `GEMINI_MODEL` (default `gemini-2.5-flash`) through Google AI Studio's OpenAI-compatible endpoint. |
| `DB_DRIVER` | `sqlite` | `sqlite` uses `data/growth.db` (or `SQLITE_PATH`). `postgres` uses `DATABASE_URL` (Supabase transaction pooler works: no prepared statements, TLS on, pool of `PG_POOL_MAX`=3). |
| `DATASET_PATH`, `PACE_CURVE_PATH` | `seed-data/` | Optional overrides. The app ships its own copies so a deployment can reset and project without the sibling folders. |

Keys are read only on the server and are never logged or sent to the browser.

## Architecture

```
app/
  db/schema.sql       portable DDL (SQLite + Postgres): raw source tables, dedup views v_*, app tables
  db/migrations/      ordered upgrades for databases created by an older schema version
  lib/db.ts           DB adapter: node:sqlite (default) | postgres (DB_DRIVER), `?` placeholders
  lib/schema-version.ts  SCHEMA_VERSION and the migration runner
  lib/seed.ts         one load path for any dataset (workbook or upload), app-table seed, reset
  lib/dataset/*       upload pipeline: parse, map (fast path or model), apply, clean, preview, import
  lib/metrics.ts      THE metrics module: snapshot, funnel, trends, budget, projection, what-changed
  lib/insights.ts     diagnose (rank vs median, bottlenecks), rule-based recommendations, simulator
  lib/repo.ts         writes: campaigns meta, tasks, action items, raw-row edits, settings, chat
  lib/tools.ts        copilot tools (JSON schemas + executors) and the read-only SQL guard
  lib/copilot.ts      tool-calling loop, system prompt, persisted history, confirm-card resolution
  lib/llm.ts          provider adapter (OpenAI / Gemini, OpenAI-compatible wire format)
  app/(pages)         Overview, Funnel, Campaigns, Diagnose & Decide, Tasks, Data
  app/api/*           JSON routes (tasks, campaigns, tables, chat, tools, simulate, settings, reset)
  components/*        Shell (nav + snapshot-date picker), Copilot panel, charts (recharts), editors
```

- **One metrics module.** Every number on every page and in every copilot answer comes from `lib/metrics.ts`, computed on request from the database rows. Nothing is hardcoded. Any write that can change a metric (a data edit, a campaign change, a settings change or a reset) bumps `app_meta.data_version`, and the next request reloads the rows.
- **Driver-agnostic.** The metrics fetch rows with plain `SELECT`s and aggregate in TypeScript, so SQLite and Postgres give identical results. Dialect differences (catalog queries, multi-statement scripts, row-level security, the seed lock) live in `lib/db.ts` and `lib/seed.ts`.
- **Raw data is kept as given.** Import duplicates stay in the raw tables. The metrics dedupe by stable ID (first copy wins), and the `v_*` views apply the same rule for SQL users. Editing or deleting a row on the Data page applies to every copy that shares its stable ID.
- **Global snapshot date.** The `?d=YYYY-MM-DD` parameter sets the snapshot date. It defaults to the last event day of the active dataset, and the timeline covers that dataset's own date range (read from the event table). A date outside the range is clamped into it.

## Bring your own dataset

**Data editor → Upload a dataset** (also linked from Settings) accepts an Excel workbook, one or several CSV files (one per table) or JSON (an array of rows, or an object of arrays keyed by sheet name), up to 4 MB in total.

1. **Read.** Every sheet becomes headers plus rows on the server.
2. **Map.** If the sheet and column names already match the app's tables (like the original workbook) the mapping is built in code, with no model call. Otherwise the model (`lib/llm.ts`) sees only sheet names, headers, the first 8 rows and the distinct values of short text columns, never the whole file. It returns a strict JSON mapping: which sheet feeds each table, which column feeds each field (or a constant), the date order, and value maps for the categories the metrics read (`person_type`, check-in `result`/`verification`/`source`, registration `status`). The reply is validated against the schema and the file; an invalid reply is retried once, then you get a plain error. The model never produces data values.
3. **Apply and clean (code, every row).** Numbers lose ₹, Rs, commas and `(500)` becomes -500; dates are read as ISO, DD/MM/YYYY or MM/DD/YYYY (inferred from values above 12, else the mapping's hint), with or without time, Excel serials, offsets converted to IST. Then: exact duplicates and repeated stable IDs collapse (conflicting copies keep the latest by timestamp), missing IDs are generated from a hash of the row, campaign and owner IDs are linked to names, unknown campaigns get a placeholder, rows pointing at unknown people or registrations are dropped, negative counts are cleared (negative spend stays: credits), rows far outside the data's date range are dropped. Unknown category values fall back safely: an unknown person type is kept out of goals, an unknown check-in result is not an admission. Missing tables are built where possible (event dates from the data range, people from registrations, status history as "confirmed when registered"); missing targets mean goals show as missing.
4. **Preview.** Each table with its source, row count and first 15 rows, one line on what cleaning did, and any reason the file cannot be used (for example the sponsor workbook: no daily spend, no registrations). Nothing changes yet.
5. **Import.** "Import this data" re-reads the stored file on the server (the browser never sends rows), re-applies the mapping, and replaces the whole dataset in one transaction. Unmapped columns are kept as extra `x_<name>` text columns on their table, and unused sheets as `x_<sheet>` tables; the analyst sees both in its schema and can query them.

**Nothing carries over.** An import or reset drops every data table, side table, campaign setting, task, decision, chat message and the change log, resets the decision thresholds to their defaults (they were tuned for the previous data), and starts fresh. The pending upload is deleted after a successful import. "Reset to original data" brings back the provided workbook the same way.

**Where uploads wait.** Between analyse and import the file sits in the `dataset_uploads` table (not on disk), so it works on serverless hosts. Unimported uploads expire after a day.

## Schema and dataset versions

- `db/schema.sql` is the full current schema (version 3) and runs on every import. `app_meta.schema_version` records the version; `db/migrations/NNN_*.sql` upgrade an older database in place on first use (`ensureSeeded`), each in its own transaction. 002 adds `dataset_versions` and join-key indexes; 003 adds `dataset_uploads`. An empty database (local or Postgres) is created and seeded automatically.
- `dataset_versions` keeps one row per import or reset: source file names, kind (`original`, `upload`, `reset`), time, row counts, the mapping with value maps, cleaning counts and schema version. Exactly one row is active and its `data_version` matches `app_meta.data_version`. It stores metadata only, never an old dataset's rows.
- Raw tables have NOT NULL stable IDs, CHECK constraints on the vocabularies the metrics read (`person_type`, check-in `result` and `verification`, registration `status`, non-negative counts and goals) and indexes on the join keys. CHECK and NOT NULL arrive on an older database at its next import or reset, when the tables are recreated.
- On Postgres every table has row-level security switched on with no policies, so Supabase's public REST API cannot read it; the app's own connection owns the tables and is not affected.

## Metric definitions

These follow [`../SPEC.md`](../SPEC.md) exactly ("Canonical metric definitions"). They are verified against the independent Python reference implementation (`../analysis/golden_metrics.json`); see [NOTES.md](NOTES.md).

| Metric | Definition |
|---|---|
| Snapshot D | End of day D, IST. A record counts only if its timestamp ≤ `D 23:59:59`. |
| Dedupe | `activity_id`, `interaction_id`, `history_id`, `registration_id`, check-in `event_id` and `person_id`. |
| People in scope | `person_type = 'external'` only. Internal, staff and test people are excluded from all goal metrics. |
| Identified external | Distinct external people with `first_seen_at` ≤ D. |
| Registered external | Distinct external people with `registered_at` ≤ D. |
| Status as of D | The latest history version per registration with `effective_at` ≤ D. |
| Verified visitors | Distinct external people with an `admitted` + `verified` check-in ≤ D. Walk-ins are included. |
| Show-up rate | Registered people who became verified visitors ÷ registered people. Also reported against people confirmed at event start. |
| Spend | Net ledger amount (credits are negative), deduped, `activity_date` ≤ D. |
| Targets | The latest Targets row with `effective_at` ≤ D: the launch plan from 15 Jan, then the revised plan from 15 Mar. |
| Attribution | By the registration's `campaign_id`. Identified people use `first_campaign_id`. Walk-ins are reported as "Unattributed / walk-in". |
| Anonymous funnel | Impressions, clicks, sessions and starts are event counts, not people. Reach is never summed into unique people. |
| CAC | Spend ÷ attributed verified visitors, and spend ÷ attributed registrations. |

## Feature map (assignment PDF, Part 2)

| PDF requirement | Where |
|---|---|
| 1. Measure: funnel, KPIs, targets vs actuals, conversion, budgets, projections | **Overview** (KPI tiles vs targets in effect on D, projection range vs goal, conversion rates, budget pacing, cumulative people vs goals, spend vs budget); **Funnel** (anonymous funnel and people funnel shown separately, stage rates vs overall, daily/cumulative trend explorer); **Campaigns** (KPI table: spend, CAC per visitor and per registration, show-up, share of goal; projected attendees per campaign = projected registrations × that channel's show-up, plus walk-ins). Before 12 Apr, show-up is labelled "event not held yet" rather than shown as 0%. |
| 2. Diagnose: what works, bottlenecks, drivers of change | **Diagnose & Decide**: ranking vs median CAC and show-up (efficiency index), bottleneck heat table (stage rate ÷ overall rate), "what changed" between any two dates. |
| 3. Decide: prioritise, allocate, scale/change/stop | Rule-based recommendation cards with visible, editable thresholds; budget reallocation simulator using marginal CAC (labelled as an estimate). |
| 4. Manage execution; data changes update analytics | **Campaigns** (status, owner, planned budget, notes, new campaigns); **Tasks** (full task CRUD and an action-item decision log); **Data** (edit or add any raw row, e.g. daily spend, clicks or targets; audit log; reset). All of it persists in the database. |
| 5. AI Growth Analyst & Copilot | Side panel on every page. Tool calling, grounded answers, evidence labels, confirm-gated tasks and campaign changes, persisted history. |

## Copilot design

- **Grounded by construction.** The model can only reach data through tools, and every tool calls the same metrics module the dashboard uses:
  - Measurement: `get_overview`, `get_funnel`, `compare_campaigns`, `get_trend`, `get_targets`, `get_budget`.
  - Diagnosis and decisions: `diagnose`, `get_recommendations`, `simulate_reallocation`, `what_changed`.
  - Management: `list_campaigns`, `list_tasks`.
  - Supporting context: `get_engagement`, `get_data_quality`.
  - Arithmetic: `calculate`, a safe parser with no `eval`, so every derived number is computed rather than guessed.
  - Ad-hoc questions: `query_data`, a read-only `SELECT`.
- **`query_data` guard.**
  - Accepts a single statement that starts with `SELECT` or `WITH`.
  - Rejects DDL, DML, PRAGMA, ATTACH and system catalogs.
  - Allows only the source tables, the deduplicated `v_*` views, `campaigns_meta`, `tasks` and `action_items`. Chat history and settings are not readable.
  - Wraps the query in `LIMIT 200`.
  - Runs it on a read-only SQLite connection (Postgres: a `READ ONLY` transaction).
- **System prompt rules.**
  - Answer only from tool results, never from general knowledge or invented numbers.
  - Answer like a human analyst: one or two sentences with the direct answer and the number that proves it, at most three plain bullets with the reasons, then one next step (with an offer to draft the task or change). About 120 words; no preamble, campaign IDs or nested lists.
  - Facts from the data are stated plainly; anything estimated or assumed gets one explicit "Assumption: …" sentence, so evidence and assumptions stay separate.
  - All arithmetic goes through the `calculate` tool; the formula is shown in one line when the user asks how a number was computed.
  - The snapshot date is used for every tool call (it is shown in the app header, not repeated in each answer).
  - When the data cannot answer (demographics, ticket revenue, sentiment and so on), say so and name the data that would be needed.
  - Resolve follow-ups from the conversation history.
- **Numeric grounding check (code, not just prompt).** After the model writes its final answer, `lib/grounding.ts` extracts every figure (₹ amounts incl. lakh/crore/k forms, %, ratios like 0.84×, grouped integers, decimals) and looks for an equivalent value in this session's tool results (calculate included) and the user's own messages, allowing for display rounding and percent/fraction equivalence. Dates, T-14 style markers, week/step labels, list numbers, years and bare counts up to 10 are ignored.
  - If any figure is unbacked, the model gets one corrective note naming those figures and must verify them with a tool or remove them; the new answer is checked once more. At most one correction round per question.
  - If figures are still unbacked, the answer is shipped unchanged and the panel adds one muted line: "Some figures could not be checked against the data: …" (`meta.ungrounded`).
  - Every chat row records the `data_version` it ran under; only rows from the current version are replayed to the model or count as evidence, so numbers from an earlier dataset cannot vouch for a new answer.
- **Execution is confirmation-gated.** `propose_task` and `propose_campaign_update` only return drafts. The panel shows each draft as a confirm card, and only the user's **Create task** or **Apply change** click (`POST /api/chat/confirm`) creates the task or changes the campaign. The model is then told the card's final state.
- **Persistence.** Every user message, assistant message, tool call and tool result is stored in `chat_messages` and replayed as history (the last 12 user turns). The panel shows an "evidence trail" of the tool calls behind each answer.
- **No key.** The panel shows "Set OPENAI_API_KEY", and the tool layer stays testable at `GET /api/tools` (lists the tools) or `GET /api/tools?name=diagnose&date=2025-04-13` / `POST /api/tools {name, args, date}`.
- **Provider swap.** `lib/llm.ts` exposes one `chat(messages, tools)` interface. Gemini runs through Google's OpenAI-compatible endpoint (`LLM_PROVIDER=gemini`).

## Demo workflow

1. Open **Overview** with the snapshot date at **Event end** (2025-04-13).
2. In the copilot, ask **"Which campaign is underperforming and why?"**
   - Expected: it calls `diagnose` and `get_recommendations`.
   - Creator Partners and Paid Social come out most clearly under-performing: CAC per visitor of ₹349 and ₹274 against a median of ₹97, and 50% show-up against a median of 78%.
   - Each has a bottleneck stage.
3. Follow up with **"What if we move 20% of its budget to the best one?"** It calls `simulate_reallocation` (for example Creator Partners → Student Referrals) and returns visitors lost, visitors gained and the net change, labelled as an estimate with its formula.
4. Ask **"Create a task for the owner to pause it."** A confirm card appears (owner Nisha Rao, priority high). Click **Confirm**.
5. The task appears on **Tasks** with source `copilot`. The Overview's "Execution" card and the open-task count on **Campaigns** update immediately. If the copilot proposes a campaign change instead and you confirm it, the campaign status badge changes everywhere.
6. Every recommendation card on **Diagnose & Decide** has the same insight → action path: **+ Create task** and **Log decision**.
7. Try changed data: on **Data → Daily Marketing**, add a spend row (or edit a target on **Targets**). The KPIs, CAC, recommendations and copilot answers change on the next request.

## Known limitations

- **Copilot untested against a live LLM.** The copilot was exercised end to end with a scripted model (`npm run test:copilot`), not a live OpenAI call, because no key was available while building. The prompt and tool schemas are standard OpenAI tool calling, but the live answer quality still needs checking with a real key.
- **Uploaded datasets.** Mapping quality depends on the model for files that do not match the expected layout; the preview is the check. The pace curve used for projections is a 2025 benchmark, not fitted on uploaded data (per-campaign curves are used only for the provided workbook), and the projection notes say so. Upload limit 4 MB.
- **Pace curve reproduces the 2025 result.** The pace curve (`seed-data/pace_curve.json`, from `../analysis/derived/`) was fitted on the 2025 outcome, so for 2025 dates its mid projection reproduces the actual result by construction. The UI and copilot say so and also show a simple-pace cross-check that uses only data up to D. After the event, "projection" means actuals.
- **Per-campaign projection uses in-sample show-up.** It uses each campaign's pace milestones (`campaign_share_at`, interpolated between T-30, T-14, T-7 and T-0) and each channel's observed 2025 show-up (50–86%) as a prior. That show-up comes from the 2025 outcome, so it is also in-sample, and it is labelled `[Assumption]`.
- **Seeded planned budgets.** Per-campaign planned budgets are not in the source. They are seeded as the latest approved budget split by each campaign's share of net spend: an editable assumption, labelled as such.
- **Simulator is a heuristic.** It assumes recent cost per registration holds at the margin, applies diminishing returns `k = 0.5`, and uses the campaign's show-up rate. It is an estimate, not a causal model. After the event it reads as a counterfactual.
- **Campaign show-up has no walk-ins.** Walk-ins have no campaign, so campaign show-up and CAC exclude them, while total visitors include them.
- **Single-user.** There is no authentication. SQLite is used through a single process.
- **Light theme only.** The UI is tuned for desktop widths.

## Tools used

Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4, recharts, exceljs (xlsx import), Node `node:sqlite`, `postgres` (optional driver), tsx (scripts), and the OpenAI Chat Completions API (tool calling).
