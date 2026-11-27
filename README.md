# CampusFest Growth: RISA Labs Growth APM assignment

Vedant Vikas Shelkar, IIT Madras. 

Challenge A (Attendee Growth) 

[![Open the live app](assets/badge-live-app.svg)](https://risa-apm-growth.vercel.app) [![Read the deck (PDF)](assets/badge-deck.svg)](deck/be23b014_vedantshelkar_attendee_challenge.pdf) [![Talk to AI analyst | Voice](assets/badge-voice.svg)](https://risa-apm-growth.vercel.app)

🌐 **Live app:** [risa-apm-growth.vercel.app](https://risa-apm-growth.vercel.app)<br>
📄 **Deck:** [be23b014_vedantshelkar_attendee_challenge.pdf](deck/be23b014_vedantshelkar_attendee_challenge.pdf)<br>
🎙️ **Voice analyst:** open the [app](https://risa-apm-growth.vercel.app), click Analyze with AI, then Voice (5-minute sessions)

🔒 **Before you test it.** The app is open to anyone with the link, and the AI analyst runs on my personal OpenAI key, which has a $50 usage limit for security purposes, so an open link cannot run up unlimited costs. If that limit is ever reached, the analyst will return an error, but the dashboards, campaigns, tasks and data editor carry on working. The analyst can also be used by voice (Analyze with AI, then Voice); each voice session ends automatically after 5 minutes for the same reason. If the data gets into a strange state while you are testing, Settings → Reset to original data puts the provided dataset back.

Throughout this document, (E) marks something I took from the provided 2025 data and (A) marks an assumption of mine.

---

## 1. Research

I started with the 2025 data rather than with ideas, and it changed the plan more than anything I read. Paid social and creator campaigns took 55.5% of the spend but brought in only 26.8% of the people who registered and attended, at ₹295 per attendee. The other five campaigns managed it for ₹87 (E). So the problem in 2025 was not a lack of reach. Money went to channels whose registrants did not come.

Show-up turned out to belong to the channel. It ran from 50% to 86% across campaigns, and once I knew which campaign someone came from, things like brochure downloads, questions asked, lead time or emails opened added nothing significant. A logistic regression reached an AUC of 0.80, driven mostly by the campaign and by whether the person had confirmed by T-1 (E). That second point mattered a lot. Of the 300 people still unconfirmed the day before the fest, not one turned up, while 26 of the 36 who reconfirmed did (E).

Timing was the other surprise. Almost half of all registrations, 47.5%, arrived in the last 30 days, and they were cheap, at ₹67 each against ₹126 earlier. Yet 79% of the budget had already been spent by mid-March (E).

For the city I chose Delhi NCR. Roughly 7 lakh students live within an hour of a single venue on one metro network, there are venues at every size, and the Delhi Police now has a written SOP for college fests, so permits are predictable. Interestingly, the city hardly changes the base number: the same model gives 7,842 in Delhi, 7,820 in Bengaluru and 7,782 in Mumbai. Where cities differ is the ceiling. Bengaluru's venues would cap unique attendance at about 13,300, below the stretch target.

The audience follows from this. Delhi's 4.5 lakh college students come first, because they are dense, on the metro and easiest to reach through their societies. The host college and its alumni (about 45,000 people) also come first, since they were the cheapest to reach in 2025, showed up most reliably and are the natural starting point for referrals. NCR's satellite colleges (2.5 to 3 lakh students) are a second priority, worth it only through partner colleges that can arrange return buses. Young professionals are a small add-on through pro-night passes, and I deliberately leave out school students, who are minors without the student ID the SOP requires at the gate.

---

## 2. Assumptions

Most of the model rests on the 2025 data. Where it doesn't, these are the calls I made and why.

- Show-up for each channel is its 2025 rate, raised by 5% for reconfirmation and then cut by 15%. Reminder studies, including a Cochrane review, show attendance rising by about 14%, so 5% is deliberately modest. The 15% cut is there because the dataset is synthetic and free events routinely lose 28 to 50% of registrants. (A)
- Each channel costs its 2025 cost per registration plus 20%, as an allowance for Delhi's higher media and operating costs. (A)
- I plan for 120 partner groups bringing about 25 registrations each. My research put the realistic range at 60 to 150 societies of that size, and a 15-society pilot in the first two weeks tests it early. (A)
- I plan for 200 campus ambassadors at 20 registrations each. Benchmarks from Techfest, which runs 2,500 ambassadors, suggested 150 ambassadors at 40 each would be achievable. I preferred more people at half the yield. (A)
- The host college, alumni and search should bring about 1,500 registrations. My research estimate was closer to 3,700, so this is a cautious figure. (A)
- Walk-ins add 6.1% of visitors, the same share as 2025 (125 of 2,050). (E)
- The venue holds 15,000 people a day. Passes are capped at 90% of that under the SOP, and 35% of visitors come on both days, as 725 of 2,050 did in 2025. (E and A)
- The stretch assumes 160 partners at 36 each, 280 ambassadors at 25 each and a ₹6.5L top-up. That money is released only at T-21, and only if registrations are at least 105% of pace and the cost is no more than ₹120 per attendee. (A)

---

## 3. Detailed calculations

The model, in `model/target_model.py`, works channel by channel: registrations multiplied by show-up gives attendees, and walk-ins are added at the end.

| Channel | Registrations | Show-up | Attendees | ₹ per attendee |
|---|---:|---:|---:|---:|
| College and society partnerships | 3,000 | 76% | 2,291 | 108 |
| Campus ambassadors | 4,000 | 67% | 2,678 | 145 |
| Host college, alumni and search | 1,500 | 70% | 1,044 | 97 |
| Referrals | 1,345 | 70% | 943 | 95 |
| Warm paid retargeting | 914 | 45% | 408 | 368 |
| Walk-ins | | | 478 | 0 |
| Total | 10,759 | 68% | 7,842 | 130 |

Spend comes from each channel's registrations multiplied by its 2025 cost per registration and the 1.2 Delhi factor, plus about ₹40,000 for WhatsApp reminders and QR passes. That totals ₹10.2 lakh against an ₹11 lakh budget, or ₹130 per attendee. I round 7,842 to a base target of 8,000. Running the same model with the stretch inputs gives 15,973 attendees for ₹17.3 lakh, which I round to 16,000.

I wanted the base number to survive a few independent checks rather than rest on one spreadsheet:

- A Monte Carlo run of 20,000 trials across every input puts the 10th, 50th and 90th percentiles at 6,383, 7,976 and 9,894.
- 8,000 is about 1.1% of the students within an hour of the venue. Large peer fests draw roughly 1.5 to 3%.
- Dividing the budget by the 2025 cost per visitor of the best five channels allows up to 11,236.
- The venue itself caps unique attendance at 15,000 × 90% × 2 ÷ 1.35, which is 20,000.

The inputs that move the result most are registrations per ambassador (6,203 to 9,481 across its range), the number of ambassadors (6,530 to 9,481) and registrations per partner (6,738 to 9,497). That is why the first weeks of the plan are spent testing exactly those.

For weekly tracking, I use the 2025 pace curve. By T-30 the fest had 52.5% of its final registrations, by T-14 80.1% and by T-7 92.2% (E). Applied to 10,759 registrations, that gives checkpoints of 5,650, 8,620 and 9,920.

---

## 4. Data sources

The provided workbook, `dataset/Attendee_Dataset.xlsx`, is read but never changed. Before using it, `analysis/build_clean.py` deals with the traps it contains: 26 rows that were imported twice are counted once, 60 internal, staff and test people are excluded, only check-ins that were both admitted and verified count as attendance, the four refund entries (−₹6,500) are kept, and every registration's status is read as it stood on the chosen date. A separate Python script, `analysis/reference_metrics.py`, recalculates every metric independently so the app can be checked against it.

The outside facts come from these sources:

- Delhi and its students: [UN city projection (Business Standard)](https://www.business-standard.com/article/news-ians/delhi-will-be-world-s-biggest-city-by-2028-un-118051701052_1.html), [AISHE higher education survey (PIB)](https://pib.gov.in/PressReleasePage.aspx?PRID=1957714), [Delhi Metro ridership](https://www.dailypioneer.com/news/delhi-metro-handles-235-8-crore-passenger-journeys-in-2025)
- Permits and crowd limits: [Delhi Police SOP for college fests](https://www.livelaw.in/high-court/delhi-high-court/delhi-police-prepares-sop-for-ensuring-students-safety-during-college-fests-high-court-closes-suo-motu-pil-255939), [Saarang 2025](https://news.careers360.com/iit-madras-host-saraang-2025-cultural-festival-from-january-9-january-13-80000-participants-expected-take-part), [Mood Indigo's entry restrictions](https://news.careers360.com/iit-bombay-cancels-mood-indigo-pre-registrations-stops-entry-outsiders-crowd-chaos-seedhe-maut-concert-sonu-nigam-vicky-kaushal)
- No-shows and reminders: [PheedLoop](https://pheedloop.com/blog/event-data-lab-report-06), [Eventbrite](https://www.eventbrite.com.au/blog/reduce-no-shows-ds0c/), [Cochrane review of reminders](https://pubmed.ncbi.nlm.nih.gov/24310741/), [WhatsApp Business pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- Digital reach and conversion: [DataReportal India 2025](https://datareportal.com/reports/digital-2025-india), [Unbounce conversion benchmarks](https://unbounce.com/conversion-benchmark-report/)

---

## 5. Prioritisation framework

To rank the ideas I gave each one a simple score: expected attendees, multiplied by how confident I am that the 2025 evidence carries over (between 0.50 and 0.75), divided by its cost in lakh. I was careful not to count the same people twice. Referrals ride on registrations that partners and ambassadors bring in, and the show-up engine is credited only with the extra attendees it creates.

| Rank | Bet | Attendees | Budget | Score | Decision |
|---|---|---:|---:|---:|---|
| 1 | Show-up engine: reconfirm at T-7 and T-3, issue named QR passes, release unclaimed seats | +374 | ₹0.4L | 686 | Double down |
| 2 | College and society partnerships with group passes | 2,291 | ₹2.5L | 647 | Double down |
| 3 | Referral squads, where three registered friends get fast-lane entry | 943 | ₹0.9L | 577 | Double down |
| 4 | Campus ambassadors, paid per verified attendee | 2,678 | ₹3.9L | 414 | Fund for volume |
| 5 | Warm paid retargeting, concentrated in the last 30 days | 408 | ₹1.5L | 136 | Capped, with a kill switch |

The cheapest, best-evidenced bets come first, ambassadors are funded because they bring the most volume, and paid media stays small and easy to switch off. Just as important is what I left out. Creators cost ₹337 per visitor in 2025 with 50% show-up. Nurture emails went to 700 people and not one registered. Cold paid prospecting was the only channel that got less efficient late in the season. And a celebrity pro-night would cost more than the whole marketing budget while concentrating the crowd risk at the gate.

The plan is reviewed every Monday against the 2025 pace curve. If registrations sit below 90% of pace for two Mondays in a row, reserve budget moves to whichever bet has the lowest cost per verified attendee, and the projected cost must stay under ₹150 per attendee. The specific thresholds to scale, change or stop each bet are on slide 3.

---

## 6. Setup instructions

To run the app locally:

```bash
cd app
npm install
cp .env.local.example .env.local   # add OPENAI_API_KEY and OPENAI_MODEL (voice uses OPENAI_REALTIME_MODEL, default gpt-realtime-2.1-mini)
npm run seed                       # loads dataset/Attendee_Dataset.xlsx into a local SQLite database
npm run dev                        # opens on http://localhost:3000
npm test                           # metric, tool, grounding, analyst and dataset tests
```

The hosted version runs on Vercel with a Supabase Postgres database, which you select by setting `DB_DRIVER=postgres` and `DATABASE_URL`. On a fresh database, the first request creates the tables and loads the provided dataset by itself, and every push to `main` redeploys the site. If you want to try the product with different data, open the Data editor and choose Upload a dataset. It accepts Excel, CSV or JSON files up to 4 MB, uses the AI to work out which column is which, cleans the rows in code, and only replaces the data after you have checked the preview.

---

## 7. Tools used

| Tool | What I used it for | Plan |
|---|---|---|
| [Next.js](https://nextjs.org), [Tailwind](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [recharts](https://recharts.org), [TanStack Table](https://tanstack.com/table) | Building the app | Open source |
| [Supabase](https://supabase.com) | The live Postgres database | Free plan |
| [Vercel](https://vercel.com) | Hosting | Hobby (free) |
| [OpenAI API](https://platform.openai.com/docs), gpt-5.6-luna and gpt-realtime-2.1-mini | The AI analyst (chat and voice) and dataset mapping | Pay as you go, with a $50 usage limit for security |
| Python with pandas, scikit-learn and statsmodels | Cleaning the data, the reference metrics and the show-up model | Open source |
| [Claude Code](https://claude.com/claude-code) | A coding and research assistant | Paid |

I reused the shadcn/ui components and their Radix building blocks, restyled in the CampusFest colours, and started from no template. Everything else was written for this project: the target and bet models, the metrics engine, the decision rules, the AI analyst with its tools, and the dataset upload pipeline. To verify the work, I checked the app's numbers against the independent Python implementation on six snapshot dates, and they match exactly. The analyst also has a safeguard written in code: every figure it writes is compared with the data it actually retrieved before the answer is shown.

---

## 8. Known limitations

The 2025 data is synthetic and covers a single season, so carrying its rates over to a new fest is itself an assumption. That is why show-up carries a 15% haircut and the target comes with a range rather than a single promise.

The least certain inputs are the yields from ambassadors and partners, and they are also the ones that move the number most. The plan tests them in the first three weeks, before most of the money is spent.

The AI analyst depends on the $50 API usage limit. Once that is used up it stops answering, though everything else in the app keeps working. Voice sessions are capped at 5 minutes each, and because speech is played as it is generated, the number check can only flag an unverified figure in the transcript rather than stop it being spoken.

Because the pace curve was fitted on the 2025 outcome, projections for 2025 dates reproduce the known result by construction. The app labels the curve as a 2025 benchmark and also shows a simple pace check that uses only data up to the chosen date.

Planned budgets for individual campaigns are not in the dataset, so the app estimates them from each campaign's share of spend and lets you edit them. Finally, uploads are limited to 4 MB and must be attendee-growth data. Anything else is refused with an explanation.
