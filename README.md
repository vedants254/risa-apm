# CampusFest Growth: RISA Labs Growth APM assignment

Vedant Vikas Shelkar, IIT Madras. Challenge A, Attendee Growth, Delhi NCR.

- **Live app:** https://risa-apm-growth.vercel.app
- **Deck:** [`deck/be23b014_vedantshelkar_attendee_challenge.pdf`](deck/be23b014_vedantshelkar_attendee_challenge.pdf) (editable: [`deck/RISA_Growth_Strategy.pptx`](deck/RISA_Growth_Strategy.pptx))
- **Before you test:** the app is open to anyone with the link, and the AI analyst runs on my own OpenAI key with a **$50 monthly usage limit**. If the limit is reached, the analyst replies with an error while the rest of the app keeps working. Settings → Reset to original data restores the provided dataset at any time.

In 2025, most of the money went to channels whose registrants did not turn up. The plan moves spend to partnerships, ambassadors and referrals, and reconfirms every registrant before the event. That gets to about **8,000 verified attendees on ₹10.2L**, against 2,050 in 2025, with **16,000** as a stretch if the early signals earn a top-up. **E** marks evidence from the provided dataset and **A** marks an assumption.

---

## 1. Research

The 2025 data tells a clear story. Paid social and creators took 55.5% of the spend but produced only 26.8% of registered attendees, at ₹295 per attendee against ₹87 everywhere else (E). Show-up is a property of the channel: it ranges from 50% to 86% by campaign, and once the campaign is known, brochure downloads, questions, lead time and email add nothing significant (logistic regression, AUC 0.80, led by status at T-1 and campaign). Reconfirmation is the strongest lever: none of the 300 registrants still unconfirmed at T-1 came, while 26 of the 36 who reconfirmed did (E). Demand also arrives late. 47.5% of registrations came in the last 30 days at ₹67 each, against ₹126 earlier, yet 79% of the budget was gone by mid-March (E).

I chose **Delhi NCR** because about 7 lakh students live within an hour of one venue on a single metro network, venues exist at every size, and the Delhi Police SOP for college fests makes permits predictable. The city barely changes the base number (7,842 in Delhi, 7,820 in Bengaluru, 7,782 in Mumbai). What differs is the ceiling: Bengaluru's venues cap unique attendance near 13,300, below the stretch.

| Who we target | Size | Priority | Why |
|---|---|---|---|
| Delhi college students | 4.5L | P1 | The biggest pool, one metro ride away; reached through their societies |
| Host college and alumni | 45k | P1 | Cheapest to reach, best 2025 show-up; they seed referrals |
| NCR satellite colleges | 2.5–3L | P2 | Too far to come alone; reached through partner colleges with return buses |
| Young professionals | ~10L | P3 | Not students; pro-night passes only |
| School seniors | 4.9L | Avoid | Under 18, no student ID for the gate |

---

## 2. Assumptions

| Assumption | Value | Reason |
|---|---|---|
| Show-up per channel | 2025 rate × 1.05 × 0.85 | Starts from each channel's 2025 rate (E). The 1.05 is reconfirmation (reminders lift attendance about 1.14× in a Cochrane review; we take less). The 0.85 is a haircut because the data is synthetic and free events lose 28–50% to no-shows |
| Cost per registration | 2025 rate × 1.2 | A planning allowance for Delhi media and operations costs |
| Partnerships | 120 groups × 25 | Research suggests 60–150 society groups of about 25; tested with a 15-society pilot in weeks 1–2 |
| Campus ambassadors | 200 × 20 | Research suggests 150 × 40, from Techfest's 2,500 ambassadors; we plan more ambassadors at half that yield |
| Host college, alumni, search | 1,500 registrations | Research estimated about 3,700; we take 1,500 |
| Walk-ins | 6.1% of visitors | 125 of 2,050 in 2025 (E) |
| Venue | 15,000 a day, 90% pass cap, 35% attend both days | IG Arena size, the Delhi Police SOP cap, and 2025 overlap of 725 of 2,050 (E) |
| Stretch | 160 × 36 partners, 280 × 25 ambassadors, ₹6.5L top-up | Released only at T-21 if registrations are at least 105% of pace and cost is at most ₹120 per attendee |

---

## 3. Detailed calculations

For each channel, registrations × show-up = attendees, and walk-ins are added on top (`model/target_model.py`).

| Channel | Registrations | Show-up | Attendees | ₹ / attendee |
|---|---:|---:|---:|---:|
| College and society partnerships | 3,000 | 76% | 2,291 | ₹108 |
| Campus ambassadors | 4,000 | 67% | 2,678 | ₹145 |
| Host college, alumni, search | 1,500 | 70% | 1,044 | ₹97 |
| Referrals | 1,345 | 70% | 943 | ₹95 |
| Warm paid retargeting | 914 | 45% | 408 | ₹368 |
| Walk-ins | – | – | 478 | ₹0 |
| **Total** | **10,759** | **68%** | **7,842** | **₹130** |

Spend is each channel's registrations × its 2025 cost per registration × 1.2, plus about ₹40k for reminders and QR passes, which comes to **₹10.2L** of the ₹11L budget. 7,842 rounds to **8,000**. The same model with the stretch inputs gives 15,973 for ₹17.3L, rounded to **16,000**. The venue caps unique attendance at 15,000 × 90% × 2 ÷ 1.35 = **20,000**.

Four checks point the same way. A Monte Carlo over every input (20,000 runs) gives P10 6,383, P50 7,976 and P90 9,894. 8,000 is 1.1% of the students within an hour, below the 1.5–3% that peer fests reach. Budget divided by the 2025 cost per visitor of the best channels allows 11,236. The venue allows 20,000. The inputs that move the result most are registrations per ambassador (6,203–9,481), the number of ambassadors (6,530–9,481) and registrations per partner (6,738–9,497), which is why slide 3 tests them first.

The weekly pace line uses the 2025 share of final registrations: 52.5% at T-30, 80.1% at T-14 and 92.2% at T-7 (E). On 10,759 registrations that means 5,650, 8,620 and 9,920 respectively.

---

## 4. Data sources

**Provided dataset.** `dataset/Attendee_Dataset.xlsx`, read but never modified. Cleaning (`analysis/build_clean.py`) counts each import copy once (26 rows), excludes 60 internal, staff and test people, counts only admitted and verified check-ins, keeps the four ledger credits (−₹6,500), and reads status as of the snapshot date. `analysis/reference_metrics.py` recomputes every metric independently of the app.

**External sources.**
- City and students: [UN projection via Business Standard](https://www.business-standard.com/article/news-ians/delhi-will-be-world-s-biggest-city-by-2028-un-118051701052_1.html), [AISHE (PIB)](https://pib.gov.in/PressReleasePage.aspx?PRID=1957714), [Delhi Metro ridership](https://www.dailypioneer.com/news/delhi-metro-handles-235-8-crore-passenger-journeys-in-2025)
- Permits and crowds: [Delhi Police SOP for college fests](https://www.livelaw.in/high-court/delhi-high-court/delhi-police-prepares-sop-for-ensuring-students-safety-during-college-fests-high-court-closes-suo-motu-pil-255939), [Saarang 2025](https://news.careers360.com/iit-madras-host-saraang-2025-cultural-festival-from-january-9-january-13-80000-participants-expected-take-part), [Mood Indigo entry limits](https://news.careers360.com/iit-bombay-cancels-mood-indigo-pre-registrations-stops-entry-outsiders-crowd-chaos-seedhe-maut-concert-sonu-nigam-vicky-kaushal)
- Show-up and reminders: [PheedLoop no-show data](https://pheedloop.com/blog/event-data-lab-report-06), [Eventbrite](https://www.eventbrite.com.au/blog/reduce-no-shows-ds0c/), [Cochrane review](https://pubmed.ncbi.nlm.nih.gov/24310741/), [WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- Digital reach and conversion: [DataReportal India 2025](https://datareportal.com/reports/digital-2025-india), [Unbounce benchmarks](https://unbounce.com/conversion-benchmark-report/)

---

## 5. Prioritisation framework

Each bet is scored as **expected attendees × confidence ÷ cost in ₹ lakh**. Confidence (0.50–0.75) reflects how directly the 2025 evidence carries over. Overlap is counted once: referrals ride on partner and ambassador registrations, and the show-up engine counts only its increment.

| # | Bet | Attendees | Budget | Score | Call |
|---|---|---:|---:|---:|---|
| 1 | Show-up engine: reconfirm at T-7 and T-3, named QR pass, release unclaimed seats | +374 | ₹0.4L | 686 | Double down |
| 2 | College and society partnerships with group passes | 2,291 | ₹2.5L | 647 | Double down |
| 3 | Referral squads: three registered friends get fast-lane entry | 943 | ₹0.9L | 577 | Double down |
| 4 | Campus ambassadors, paid per verified attendee | 2,678 | ₹3.9L | 414 | Fund for volume |
| 5 | Warm paid retargeting, mostly in the last 30 days | 408 | ₹1.5L | 136 | Capped, kill switch |

I would not fund creators (₹337 per visitor, 50% show-up), nurture email to unregistered leads (700 sent, none registered), cold paid prospecting (it got less efficient late in the season), or a celebrity pro-night (the fee exceeds the budget and concentrates crowd risk).

Decisions are reviewed every Monday against the 2025 pace curve. Two Mondays below 90% of pace moves reserve budget to the bet with the lowest cost per verified attendee, and projected cost must stay under ₹150 per attendee. Slide 3 lists the scale, change and stop thresholds for each bet.

---

## 6. Setup instructions

```bash
cd app
npm install
cp .env.local.example .env.local   # add OPENAI_API_KEY and OPENAI_MODEL
npm run seed                       # loads dataset/Attendee_Dataset.xlsx into a local SQLite database
npm run dev                        # http://localhost:3000
npm test                           # metric, tool, grounding, analyst and dataset tests
```

The live app runs on Vercel with Supabase Postgres (set `DB_DRIVER=postgres` and `DATABASE_URL`). An empty database creates its tables and loads the provided dataset on the first request. Every push to `main` deploys automatically. To test with other data, use Data editor → Upload a dataset (.xlsx, CSV or JSON up to 4 MB): the AI maps the columns, code cleans the rows, and nothing changes until you confirm the preview.

---

## 7. Tools used

| Tool | Used for | Plan |
|---|---|---|
| [Next.js](https://nextjs.org), [Tailwind](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [recharts](https://recharts.org), [TanStack Table](https://tanstack.com/table) | The app | Open source |
| [Supabase](https://supabase.com) (Postgres) | Live database | Free plan |
| [Vercel](https://vercel.com) | Hosting | Hobby (free) |
| [OpenAI API](https://platform.openai.com/docs), gpt-5.6-luna | The AI analyst and dataset mapping | Pay as you go, $50 monthly limit |
| Python (pandas, scikit-learn, statsmodels) | Cleaning, reference metrics, show-up model | Open source |
| [Claude Code](https://claude.com/claude-code) | Coding and research assistant | Paid |

**Reused:** shadcn/ui components and Radix primitives, restyled to the CampusFest colours; no app template. **Written for this project:** the target and bets model, the metrics engine, the decision rules, the AI analyst and its tools, and the dataset upload pipeline. **Verified:** the app's metrics match the independent Python implementation exactly on six snapshot dates, and every number the analyst writes is checked in code against the data it pulled before the answer is shown.

---

## 8. Known limitations

- **One synthetic season.** Carrying 2025 rates to a new fest is an assumption, which is why show-up carries a 0.85 haircut and the target is given as a range.
- **Ambassador and partner yields** are the least certain inputs and move the number most. Slide 3 tests them in weeks 1–3, before most of the money is spent.
- **The AI analyst depends on the API limit.** It stops answering once the $50 monthly cap is reached; dashboards, tasks and uploads are unaffected.
- **The 2025 pace curve is a benchmark.** For 2025 dates the projection reproduces the known result, so the app also shows a simple pace check that uses only data up to the chosen date.
- **Planned budgets per campaign** are not in the dataset. The app seeds them from each campaign's share of spend and lets you edit them.
- **Uploads** are limited to 4 MB and must be attendee-growth data. Other files are refused with a reason.
