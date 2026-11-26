# CampusFest Growth: RISA Labs Growth APM assignment

**Vedant Vikas Shelkar, IIT Madras. Challenge A: Attendee Growth, Delhi NCR**

| Deliverable | Where |
|---|---|
| Three-slide strategy | [`deck/be23b014_vedantshelkar_attendee_challenge.pdf`](deck/be23b014_vedantshelkar_attendee_challenge.pdf), editable [`deck/RISA_Growth_Strategy.pptx`](deck/RISA_Growth_Strategy.pptx) |
| Working product: dashboard, campaign and task manager, AI analyst | **Live: https://risa-apm-growth.vercel.app**, code in [`app/`](app/) |
| This README | Research, assumptions, detailed calculations, data sources, prioritisation framework, setup, tools, limitations |

I chose Challenge A. In one line: in 2025 most of the money went to channels whose registrants did not turn up, so the plan moves spend to partnerships, ambassadors and referrals and reconfirms every registrant. That gets to about 8,000 verified attendees on ₹10.2L, against 2,050 in 2025, with 16,000 as a stretch if the early signals earn a top-up.

Every figure below comes from code in this repository, so it can be rerun. **E** marks evidence from the provided 2025 dataset and **A** marks an assumption; section 2 gives the reason for each one.

| Folder | Contents |
|---|---|
| `model/` | `target_model.py` and `bets.py`, the target, Monte Carlo and bet scoring (write `.json` files the deck and README read) |
| `analysis/` | Cleaning, data-quality counts, reference metrics in Python, the 2025 report, the show-up model |
| `app/` | The Growth Center (Next.js), its tests and the dataset upload pipeline |
| `deck/` | The deck builder (HTML to PDF, plus the editable PPTX builder) |

---

## 1. Research

### 1.1 What the 2025 data says
- Spend went to the wrong channels. Paid social and creators took 55.5% of spend for 26.8% of registered attendees, at ₹295 per attendee, against ₹87 for the other five campaigns (E).
- Show-up is a property of the channel. It ranges from 50% to 86% by campaign. Once the campaign is held fixed, brochure downloads, questions, lead time and email have no significant effect (E).
- Unconfirmed registrants do not come. None of the 300 registrants still unconfirmed at T-1 attended; 26 of the 36 who reconfirmed did (E).
- Demand came late; spend came early. 47.5% of registrations arrived in the last 30 days, at ₹67 per registration against ₹126 earlier, yet 79% of the launch budget was spent by 14 March (E).
- Peer channels register late. Partnerships and referrals had only 25–27% of their final registrations by T-30 (E).
- Show-up model: logistic regression, cross-validated AUC 0.799; the top drivers are status at T-1 and the campaign (`analysis/ml/`).

### 1.2 City choice: Delhi NCR
- About 7 lakh students live within an hour of one venue on one metro network; venues exist at every size from 7k to 60k; the Delhi Police SOP for college fests makes permits predictable.
- The city barely changes the base number. The same model gives 7,842 in Delhi, 7,820 in Bengaluru and 7,782 in Mumbai; only spend differs. The difference is the ceiling: Bengaluru's venues cap unique attendance near 13,300, below the stretch.

### 1.3 Who we target
| Segment | Size | Priority | Why |
|---|---|---|---|
| Delhi college students | 4.5L | P1 | The biggest pool, one metro ride away; reached through their societies |
| Host college and alumni | 45k | P1 | Cheapest to reach and the best 2025 show-up; they seed referrals |
| NCR satellite colleges | 2.5–3L | P2 | Too far to come alone; reached through partner colleges with return buses |
| Young professionals | ~10L | P3 | Not students; pro-night passes only |
| School seniors | 4.9L | Avoid | Under 18, no student ID for the gate |

### 1.4 Benchmarks used
Peer fest footfall (Mood Indigo, Saarang, Rendezvous), registration-to-attendance and no-show rates for free events (PheedLoop, Eventbrite), WhatsApp reminder and pricing data for India, Meta and landing-page conversion benchmarks, and the Cochrane review of reminders (SMS reminders raise attendance by a factor of about 1.14). Links are in section 4.2.

---

## 2. Assumptions
| Assumption | Value | Why | Type |
|---|---|---|---|
| Show-up per channel | 2025 channel rate × 1.05 × 0.85 | Starts from what each channel achieved in 2025 | E × A |
| Reconfirmation lift | 1.05 | Reconfirmed registrants attended at 72% vs 0% for unconfirmed (E); reminder literature supports about 1.14, we take less | A |
| Real-world haircut | 0.85 | The dataset is synthetic and free events lose 28–50% to no-shows | A |
| Cost per registration in Delhi | 2025 rate × 1.2 | A planning allowance for Delhi media and operations costs over the dataset's synthetic city; the city comparison uses 1.25 for Bengaluru and 1.35 for Mumbai | A |
| Partnerships | 120 partners × 25 registrations, about 300 students reached each | The research range is 60–150 society groups of about 25 (group norms of 5–10+, no published uplift data). 120 sits inside it; the Monte Carlo spans 80–180 × 15–40, and a 15-society pilot in weeks 1–2 tests it | A |
| Campus ambassadors | 200 × 20 registrations, about 250 reached each | Research suggested 150 × 40, from Techfest's 2,500 ambassadors for 1.75L footfall (about 70 each at most). The plan uses more ambassadors at half that yield: 4,000 registrations instead of 6,000. Ambassadors were also the largest 2025 source (E) | A |
| Host college, alumni and search | 1,500 registrations from about 60k reached | Research estimated 2,500 from the host college (50% of 5,000) and 1,200 from alumni (3% of 40,000). The plan takes 1,500; the Monte Carlo spans 800–2,500 | A |
| Referrals | 2025 ratio of referral to other registrations, 4 invites each | Same ratio as 2025 (E) | E |
| Paid retargeting | ₹1.5L at a ₹120 CPM, frequency 4 | Warm audiences only; 70% of it in the last 30 days, when 2025 cost was lowest (E) | A |
| Walk-ins | 6.1% of visitors | 125 of 2,050 in 2025 (E) | E |
| Show-up programme cost | About ₹40k | WhatsApp utility messages at ₹0.115 each (Meta India rate card), SMS fallback and named QR passes | A |
| Venue | 15,000 a day, passes capped at 90%, 2 days, 35% attend both | IG Arena holds about 15k; the 90% cap is the Delhi Police SOP; 725 of 2,050 visitors came on both days in 2025 (35%) (E) | E + A |
| Bet confidence | 0.50–0.75 | How directly the 2025 evidence carries over (section 5) | A |
| Stretch | 160 partners × 36, 280 ambassadors × 25, +10% reconfirmation, ₹6.5L top-up | Released only at T-21 if registrations are at least 105% of pace and cost at most ₹120 per attendee | A |
| Planned budget per campaign (app) | Latest budget × each campaign's share of spend | Not in the dataset; labelled as an assumption and editable | A |

---

## 3. Detailed calculations

### 3.1 The target
The base case is **8,000 verified unique external attendees** and the stretch is **16,000**, for a two-day fest in early February. "Verified attendee" uses the dataset's own definition: a distinct external person with at least one check-in that is both admitted and verified. Registering is not enough.

The base case is built channel by channel in `model/target_model.py`: registrations × show-up = attendees, with walk-ins added at 6.1% of visitors.

| Channel | Reach | Registrations | Show-up | Attendees | ₹ per attendee | 2025 ₹ per registration (E) |
|---|---:|---:|---:|---:|---:|---:|
| College and society partnerships | 36,000 | 3,000 | 76% | 2,291 | ₹108 | ₹69 |
| Campus ambassadors | 50,000 | 4,000 | 67% | 2,678 | ₹145 | ₹81 |
| Host college, alumni, search | 60,000 | 1,500 | 70% | 1,044 | ₹97 | ₹56 |
| Referrals | 5,380 | 1,345 | 70% | 943 | ₹95 | ₹56 |
| Warm paid retargeting | 312,500 | 914 | 45% | 408 | ₹368 | ₹137 |
| Walk-ins | – | – | – | 478 | ₹0 | 125 of 2,050 |
| **Total** | **463,880** | **10,759** | **68%** | **7,842** | **₹130** | |

- Registrations are 2.3% of reach; overall show-up is 68%, close to the 68.75% seen in 2025.
- Spend = Σ registrations × 2025 cost per registration × 1.2, plus ₹40k for the show-up programme = **₹10.2L** of the ₹11L budget, so 7,842 attendees cost ₹130 each. 7,842 is rounded to **8,000**.
- Stretch: the same model with the stretch inputs gives **15,973** for ₹17.3L, rounded to **16,000**.
- Venue ceiling: 15,000 × 90% × 2 ÷ 1.35 = **20,000** unique attendees.

### 3.2 Why believe it: four independent checks on the base
| Check | Result |
|---|---|
| Bottom-up channel model | 7,842 |
| Monte Carlo over every input (20,000 runs, triangular ranges) | P10 6,383, P50 7,976, P90 9,894; 54% of runs reach the base |
| Share of the about 7 lakh students within an hour | 1.1%, below the 1.5–3% implied by peer fests' discounted footfall |
| Budget bound: ₹11L ÷ ₹104, the 2025 cost per visitor of the five efficient channels × 1.2 | 11,236 |
| Venue ceiling | 20,000 |

The inputs that move the number most, each taken from low to high with the rest at base: registrations per ambassador 6,203–9,481; number of ambassadors 6,530–9,481; registrations per partner 6,738–9,497.

### 3.3 How the bets add up
6,320 attendees from the four channel bets + 1,044 from the host college and search + 478 walk-ins = **7,842**. The show-up engine's +374 is already inside the channel show-up rates, so it is not added again.

### 3.4 Checkpoint thresholds
The pace line is the 2025 share of final registrations: 52.5% at T-30, 80.1% at T-14 and 92.2% at T-7 (E). On the base plan of 10,759 registrations that gives **5,650 at T-30, 8,620 at T-14 and 9,920 at T-7**. In 2025 the pace model forecast final registrations within 9.9% at T-14 and 4.0% at T-7.

---

## 4. Data sources

### 4.1 Provided dataset
`dataset/Attendee_Dataset.xlsx` (Challenge A), read but never modified. `analysis/build_clean.py` writes the cleaned tables and counts 31 data-quality issues (`analysis/derived/data_quality_counts.json`). The rules that change headline numbers:
- 26 import-copy rows are counted once (daily marketing, status history, check-ins).
- 60 internal, staff and test people are excluded, with their 40 registrations and 40 check-ins (otherwise visitors read 2,090 instead of 2,050).
- Only admitted and verified check-ins count; 80 denied or pending rows are excluded, and each person is counted once.
- 4 negative spend rows (ledger credits, −₹6,500) are kept.
- Registration status is the latest version as of the snapshot date, so later changes never leak into earlier dates.
- Timestamps have no time zone in the file and are read as IST.

Metric definitions are in `SPEC.md`; `analysis/reference_metrics.py` implements them independently of the app.

### 4.2 External sources
| Fact | Source |
|---|---|
| Delhi as the largest urban agglomeration | [Business Standard, UN projection](https://www.business-standard.com/article/news-ians/delhi-will-be-world-s-biggest-city-by-2028-un-118051701052_1.html) |
| Higher-education enrolment (AISHE) | [PIB release](https://pib.gov.in/PressReleasePage.aspx?PRID=1957714) |
| Delhi Metro ridership | [The Pioneer, 2025](https://www.dailypioneer.com/news/delhi-metro-handles-235-8-crore-passenger-journeys-in-2025) |
| Delhi Police SOP for college fests | [LiveLaw](https://www.livelaw.in/high-court/delhi-high-court/delhi-police-prepares-sop-for-ensuring-students-safety-during-college-fests-high-court-closes-suo-motu-pil-255939) |
| Peer fest footfall and crowd limits | [Saarang 2025 (Careers360)](https://news.careers360.com/iit-madras-host-saraang-2025-cultural-festival-from-january-9-january-13-80000-participants-expected-take-part), [Mood Indigo entry limits (Careers360)](https://news.careers360.com/iit-bombay-cancels-mood-indigo-pre-registrations-stops-entry-outsiders-crowd-chaos-seedhe-maut-concert-sonu-nigam-vicky-kaushal), [Rendezvous, IIT Delhi](https://rdv-iitd.org) |
| Internet and social use in India | [DataReportal 2025](https://datareportal.com/reports/digital-2025-india) |
| No-show rates for free events | [PheedLoop event data report](https://pheedloop.com/blog/event-data-lab-report-06), [Eventbrite](https://www.eventbrite.com.au/blog/reduce-no-shows-ds0c/) |
| Reminders and attendance | [Cochrane review (PubMed)](https://pubmed.ncbi.nlm.nih.gov/24310741/) |
| WhatsApp Business pricing and engagement in India | [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing), [CampaignHQ benchmarks](https://blog.campaignhq.co/email-whatsapp-marketing-benchmarks-india/) |
| Landing-page conversion for events | [Unbounce benchmark report](https://unbounce.com/conversion-benchmark-report/) |

---

## 5. Prioritisation framework

**Score = expected attendees × confidence ÷ cost in ₹ lakh.**
- Confidence (0.50–0.75) is how directly the 2025 evidence carries over. A channel whose rate comes straight from the data scores higher.
- Overlap is stated, not double-counted. Referrals ride on registrations from partners and ambassadors, and the show-up engine is counted as its increment.

| # | Bet | Attendees | Budget | ₹ / attendee | Confidence | Score | Call |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Show-up engine: reconfirm at T-7 and T-3, named QR pass, waitlist release at T-2 | +374 | ₹0.4L | ₹109 | 0.75 | 686 | Double down |
| 2 | College and society partnerships with group passes and return buses | 2,291 | ₹2.5L | ₹108 | 0.70 | 647 | Double down |
| 3 | Referral squads: three registered friends get fast-lane entry | 943 | ₹0.9L | ₹95 | 0.55 | 577 | Double down |
| 4 | Campus ambassadors, paid per verified attendee | 2,678 | ₹3.9L | ₹145 | 0.60 | 414 | Fund for volume |
| 5 | Warm paid retargeting, 70% in the last 30 days | 408 | ₹1.5L | ₹368 | 0.50 | 136 | Capped, kill switch |

What I would not fund, and the 2025 evidence for each: creators (₹337 per visitor, 50% show-up); nurture email to unregistered leads (700 sent, 75% opened, 0 registered); cold paid prospecting (the only channel that got less efficient late, 0.67×, with 50% show-up); a celebrity pro-night as the hook (the fee would exceed the budget and concentrates crowd risk at the gate).

Decisions happen every Monday against the 2025 pace curve. Two Mondays below 90% of the pace line moves reserve budget to the bet with the lowest ₹ per verified attendee, and projected cost must stay at most ₹150 per attendee (plan ₹130). Per-bet scale, change and stop thresholds are on slide 3; peer channels are judged on commitments, not volume, in weeks 1–4 because they register late.

---

## 6. The Growth Center (working product)

**Live:** https://risa-apm-growth.vercel.app

- **Measure:** a countdown timeline drives every view as of a snapshot date. The funnel shows anonymous counts separately from people. Targets are compared with actuals using the plan in effect on that date. Per campaign: spend, cost per registration and per verified visitor, show-up, projected outcome.
- **Diagnose:** stage-by-stage bottlenecks against the overall rate, and what changed between two dates.
- **Decide:** scale, change or stop per campaign with editable thresholds, and a budget reallocation simulator (an estimate, using marginal cost per visitor).
- **Manage:** campaigns, owners, tasks, deadlines and action items; a raw-data editor where every change recomputes every metric. Settings holds Reset to original data, the dataset details, the model and the thresholds.
- **Any dataset:** Data editor, then Upload a dataset (.xlsx, CSV or JSON, up to 4 MB). Files in the provided layout map without a model call. Otherwise the model proposes a column and value mapping from the headers, distinct values and a few sample rows; code applies it to every row and cleans it automatically (duplicates, ₹ amounts, DD/MM dates, IDs, orphan rows, unknown categories, test and staff records). You confirm one preview before it replaces the data. Each import is versioned, extra columns stay queryable, and nothing from the previous dataset carries over.

**The AI analyst** (the Analyze with AI button, or the robot icon at the top right)
- Answers only through tools that call the same metrics module as the dashboard, plus a guarded read-only SQL tool for unfamiliar questions.
- Answers like an analyst: the direct answer with the number that proves it, at most three short reasons, one next step. Anything estimated gets one plain "Assumption: …" sentence.
- Numbers are checked, not trusted. All arithmetic goes through a calculator tool, and after every answer code checks each figure against the tool results, allowing for rounding, ₹ lakh, % and ×. An unbacked figure sends the model back once to verify or drop it; anything still unbacked is flagged under the answer.
- Says plainly when the data cannot answer (for example demographics or ticket revenue) and what data would be needed.
- Follow-ups work (history persists, scoped to the active dataset).
- Drafts tasks and campaign changes only as confirmation cards; nothing changes until you click Create task or Apply change.
- **Demo workflow:** "Which campaign is underperforming and why?", then "What if we move 20% of its budget to the best one?", then "Create a task for the owner to pause it". After you confirm the card, the task shows on the Tasks page.

---

## 7. Setup instructions

### Local
```bash
cd app
npm install
cp .env.local.example .env.local   # set OPENAI_API_KEY and OPENAI_MODEL (tested with gpt-5.6-luna)
npm run seed                       # imports dataset/Attendee_Dataset.xlsx into SQLite
npm run dev                        # http://localhost:3000
npm test                           # golden metrics, tools, grounding, copilot, dataset upload
```
Reasoning models such as gpt-5.x reject a custom `temperature` and, on `/chat/completions`, accept function tools only with `reasoning_effort: "none"`. `lib/llm.ts` sends neither unless configured (`OPENAI_TEMPERATURE`, `OPENAI_REASONING_EFFORT`), and if the API rejects one it learns the fix from the error and retries once.

### Deployment (how the live app runs)
- Hosting: Vercel, project root `app/`, connected to this repository, so every push to `main` deploys to production; `app/vercel.json` pins the Next.js preset and the Mumbai region (bom1).
- Database: Supabase Postgres 17 (ap-south-1) through the transaction pooler (`DB_DRIVER=postgres`, `DATABASE_URL`, port 6543). The Data API is off and row-level security is on for every table, so only the app's server can reach the data. Schema versions are applied as migrations (`app/db/migrations/`), and every import is recorded in `dataset_versions`.
- The first request on an empty database creates the tables and seeds `app/seed-data/Attendee_Dataset.xlsx` (about 9 seconds once).
- Secrets live only in Vercel's encrypted environment and a local `.env` that git and `.vercelignore` exclude.
- Access is open with a spending cap: anyone with the link can use the app and the analyst, so the OpenAI account has a $50 monthly usage limit. Reset to original data restores the provided dataset at any time.

### Rebuilding the deck
```bash
cd deck
python build_deck.py && bash render.sh <preview-folder>   # HTML to PDF (Edge headless)
../.venv/Scripts/python.exe build_pptx_editable.py         # editable PPTX
```

---

## 8. How it was verified
- Golden test: `analysis/reference_metrics.py` is an independent Python implementation of every metric; `app/scripts/test-golden.ts` checks that the app matches it exactly on 6 snapshot dates (15 Feb, 14 Mar, 15 Mar, 11 Apr, 13 Apr, 20 Apr 2025).
- Tool tests (42): include live recomputation; adding a ₹10,000 spend row moves total spend by exactly ₹10,000, and deleting it restores the total.
- Grounding tests: rounding, ₹ lakh, %, × and invented figures; a scripted model that invents a number is corrected once.
- Copilot tests: follow-ups, "data can't answer", no task created before confirmation, a card can't be confirmed twice.
- Dataset tests (47): a messy copy of the data (renamed columns, DD/MM dates, different wording, duplicates) reproduces the original metrics; the Sponsor dataset is refused; switching datasets leaves nothing behind; migrations run on a fresh and an older database.
- Live checks on the deployed app: Home at 29 Mar shows 2,243 registrations (70.1% of goal) and ₹2,40,100 spend; the analyst answered from the Supabase data; Reset, then uploading `Attendee_Dataset.xlsx` (26 duplicates removed, 60 non-external people excluded) gave the same numbers, including 2,800 registrations and 2,050 verified visitors on 20 Apr.

---

## 9. Tools used
| Tool | Use | Plan |
|---|---|---|
| [Next.js 16](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) (Radix), [recharts](https://recharts.org) | App and user interface | Open source |
| [TanStack Table](https://tanstack.com/table), Motion, NumberFlow, cmdk, Sonner, lucide, Plus Jakarta Sans, IBM Plex Mono | Tables, motion, animated figures, command palette, toasts, icons, type | Open source |
| Node `node:sqlite` | Local development database | Built in |
| [Supabase](https://supabase.com) Postgres 17, [postgres.js](https://github.com/porsager/postgres) | Live database (Mumbai) | Free plan |
| [Vercel](https://vercel.com) | Hosting the live app | Hobby (free) |
| [ExcelJS](https://github.com/exceljs/exceljs) | Reading the workbook and uploaded .xlsx files | Open source |
| [OpenAI API](https://platform.openai.com/docs), gpt-5.6-luna with function calling | The analyst, and the column and value mapping for uploads (behind an adapter, so Gemini can be swapped in) | Pay as you go, own key, $50 monthly limit |
| Python: pandas, scikit-learn, statsmodels, matplotlib, PyMuPDF, python-pptx | Cleaning, reference metrics, ML, charts, deck export | Open source |
| Microsoft Edge (headless) | Deck HTML to PDF | Free |
| [Claude Code](https://claude.com/claude-code) (Anthropic) | Pair-programming and research assistant | Paid |

**Reused, modified and verified**
- **Reused:** shadcn/ui components (copied into `app/components/ui/` by its CLI), Radix primitives, TanStack Table, recharts through the shadcn chart wrapper, lucide icons, Google Fonts. No app template was used.
- **Modified:** the shadcn components were restyled to the CampusFest palette (violet #4F1FA4, orange #FC8E02) with pill buttons and badges and quieter tables; the sidebar, data table (header sorting, server-side sort), stat blocks and popovers were extended for this app.
- **Written for this project:** the target and bets model, the cleaning and reference metrics, the metrics engine, decision rules and projection, the analyst loop, tools and grounding check, the dataset upload pipeline (parse, map, clean, import, versioning) and the deck builders.
- **Verified:** section 8. AI-assisted code was accepted only after the tests above passed and every headline number matched the independent Python implementation.

---

## 10. Known limitations
- The 2025 data is synthetic and covers one season, so carrying its rates to a new fest is an assumption. That is the reason for the 0.85 haircut and the Monte Carlo ranges.
- Ambassador and partner yields are the least certain inputs, and they move the number most. Slide 3 tests them in weeks 1–3, before most of the money is spent.
- Per-campaign planned budgets are not in the dataset. The app seeds them from each campaign's share of spend, labels them as an assumption and lets you edit them.
- The pace curve and channel show-up rates are fitted on 2025 outcomes, so for 2025 dates the app's mid projection reproduces the actual result. The app labels the curve as a 2025 benchmark and shows a simple-pace cross-check that uses only data up to the snapshot date.
- Uploads are capped at 4 MB (Vercel's request limit) and must be attendee-growth data; a file without daily spend and registrations or check-ins is refused with the reason. People are matched by ID only, because names repeat.
- The analyst's wording depends on the model. Grounding, the confirmation gate and the "data can't answer" rule are enforced in code and tested with a scripted model, but a public link means anyone can spend the capped OpenAI budget.
