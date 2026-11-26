# RISA Growth APM: shared spec (Challenge A, attendee growth)

Everyone (the analysis, app and deck workstreams) uses these definitions, so the deck, the dashboard and the chatbot always report the same number.

## Source
`dataset/Attendee_Dataset.xlsx`. It has 11 tabs: Read me, Field guide, Event, Targets, Campaigns, Daily Marketing, People, Interest and Engagement, Registrations, Registration History and Check-ins. All the data is synthetic. Event: CampusFest 2025, 12–13 Apr 2025, data 15 Jan–20 Apr 2025, IST. Keep the original file unchanged.

## Canonical metric definitions
These are a draft for the analysis agent to confirm. Any change is made in `analysis/reference_metrics.py` and the app together, with the reason.

**Snapshot date D**
- D means the end of day D in Asia/Kolkata. A record counts only if its timestamp is ≤ D 23:59:59 IST.
- No later outcome may appear in an earlier snapshot.

**Dedupe**
- Repeated rows that share a stable ID are import copies and count once. The IDs are `activity_id`, `interaction_id`, `history_id`, `registration_id` and the check-in `event_id`.
- Different admission attempts by the same person are separate records, but the person counts once.

**People in scope**
- Only `person_type == 'external'` counts. Internal, staff and test people are excluded from every goal metric.

**Identified external people (cumulative)**
- Distinct external `person_id` whose `first_seen_at` ≤ D.

**Registered external people**
- Distinct external `person_id` with `registered_at` ≤ D. A new registration or a new status version is not a new person.

**Registration status as of D**
- For each `registration_id`, take the latest history version whose `effective_at` ≤ D. The statuses are interested, confirmed, cancelled and waitlisted.

**Verified unique external visitors (attendees)**
- Distinct external `person_id` with at least one check-in that has `result == 'admitted'` and `verification == 'verified'`, occurring at or before D.
- This includes walk-ins who have no registration.
- Pending, denied and unverified check-ins do not count.

**Show-up rate**
- Registered external people who became verified visitors ÷ registered external people. Also report the same ratio against people who were confirmed as of the event start.

**Marketing spend to date**
- Sum of `marketing_spend_inr`, deduped by `activity_id`, where `activity_date` ≤ D.
- Values can be negative: ledger credits and adjustments.

**Targets as of D**
- The latest Targets row with `effective_at` ≤ D. There are two versions: the launch plan from 15 Jan and the revised plan from 15 Mar.

**Attribution**
- Default: the registration's `campaign_id` (the recorded acquisition source).
- Alternative: `people.first_campaign_id` (first touch).
- Walk-ins and event-access people have no campaign; report them as "Unattributed / walk-in".

**Anonymous funnel**
- Impressions, clicks, reach, landing-page sessions and registration starts are event counts, not people.
- Never add reach across days and present it as unique people.

**CAC**
- Per campaign: spend ÷ attributed attendees, and spend ÷ attributed registrations.
- Organic channels can have small spend.

## App contract (Growth Center)
- **Stack, built locally first:**
  - Next.js (App Router, TypeScript) in `app/`.
  - SQLite through Node's built-in `node:sqlite`; Node is v26.
  - OpenAI API for the copilot, using `OPENAI_API_KEY` and `OPENAI_MODEL` from `.env.local`.
  - A provider adapter, so Gemini can be swapped in.
- **Data:** a seed script imports the xlsx into SQLite. The raw tables are kept, plus app tables for campaigns_meta (budget, status, owner and so on), tasks, actions and notes.
- **Live metrics:** every metric is computed live from the DB by one metrics module, `lib/metrics.ts`. Nothing is hardcoded, and edits to the data change the analytics.
- **Golden test:** the metrics module must reproduce `analysis/golden_metrics.json` exactly. The analysis agent writes that file using a Python reference implementation.
- **Grounded copilot:**
  - It answers only through tools that call the metrics module, plus a guarded read-only SQL tool for unfamiliar questions.
  - It shows its numbers, labels evidence vs assumption, and says when the data cannot answer.
  - It creates tasks or changes campaigns only after the user confirms.
