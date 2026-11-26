"""Slide 2: five ranked bets, scored as expected verified attendees x confidence / cost (per INR 1 lakh).
Contributions come from the base scenario in target_model.json. Overlap is handled explicitly: referrals ride on the
seed registrations from bets 1 and 3, and the show-up engine is measured as an increment over a no-programme run."""
import json, os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('tm', os.path.join(HERE, 'target_model.py'))
tm = importlib.util.module_from_spec(spec); spec.loader.exec_module(tm)
tm.COST_INFLATION, tm.DAILY_CAPACITY = 1.20, 15_000
tm.UNIQUE_CAP = tm.DAILY_CAPACITY * tm.PASS_CAP * 2 / (1 + tm.BOTH_DAYS)
base = tm.run(tm.SCEN['base'])
no_prog = tm.run(dict(tm.SCEN['base'], showup_lift=1.0))
cal, infl = tm.CAL, tm.COST_INFLATION

def cost(ch): return round(base['regs'][ch] * cal[ch]['cpr'] * infl)
prog_inc = base['registered_attendees'] - no_prog['registered_attendees']
# walk-ins scale with registered attendees, so the programme's increment includes its walk-in share
prog_inc_total = base['unique_attendees'] - no_prog['unique_attendees']

bets = [
    dict(name='College & society partnerships (group passes)', key='partners', attendees=base['attendees_by_channel']['partners'],
         cost=cost('partners'), conf=0.70, evidence='CampusFest College Partnerships: ₹69/reg, 85.6% show-up, best of 7'),
    dict(name='Show-up engine: reconfirm at T-7/T-3, named QR pass, waitlist release', key='showup',
         attendees=prog_inc_total, cost=40_000 + round(0.12 * base['registered_attendees']), conf=0.75,
         evidence='0 of 300 unconfirmed-at-T-1 attended; 26 of 36 reconfirmed did; Cochrane reminder RR 1.14'),
    dict(name='Campus ambassadors, paid per verified attendee', key='ambassadors', attendees=base['attendees_by_channel']['ambassadors'],
         cost=cost('ambassadors'), conf=0.60, evidence='CampusFest Ambassadors: ₹81/reg, 75% show-up; Techfest ~70 footfall/ambassador ceiling'),
    dict(name='Referral unlocks (squad of 3 gets fast-lane entry)', key='referrals', attendees=base['attendees_by_channel']['referrals'],
         cost=cost('referrals'), conf=0.55, evidence='CampusFest Referrals: lowest CAC (₹56/reg, ₹69/visitor), 78.6% show-up'),
    dict(name='Demand-paced paid retargeting (70% of paid in last 30 days, warm audiences only)', key='paid',
         attendees=base['attendees_by_channel']['paid'], cost=tm.SCEN['base']['paid_budget'], conf=0.50,
         evidence='47.5% of regs came in last 30 days at ₹67 vs ₹126/reg; cold Paid Social was 50% show-up, ₹274/visitor'),
]
for b in bets:
    b['cost_per_attendee'] = round(b['cost'] / b['attendees'])
    b['ev_per_lakh'] = round(b['attendees'] * b['conf'] / (b['cost'] / 100_000))
rejected = [
    dict(name='Creator / influencer partnerships', why='Worst channel: ₹174/reg, 50% show-up, ₹337 per visitor (2.5x the average)'),
    dict(name='Nurture email blasts to unregistered leads', why='700 leads emailed, 75% opened, 0 registrations; no show-up effect (77.2% vs 77.0%)'),
    dict(name='Cold paid-social prospecting', why='Only channel that got less efficient late (0.67x); 50% show-up'),
]
out = dict(base_total=base['unique_attendees'], base_spend=base['spend_inr'], organic_baseline=base['attendees_by_channel']['organic'],
           walkins=base['walkins'], showup_increment=prog_inc_total, bets=bets, rejected=rejected)
json.dump(out, open(os.path.join(HERE, 'bets.json'), 'w', encoding='utf8'), indent=1, ensure_ascii=False)
for b in sorted(bets, key=lambda b: -b['ev_per_lakh']):
    print(f"{b['ev_per_lakh']:>6}  {b['attendees']:>5} att  ₹{b['cost']:>8,}  ₹{b['cost_per_attendee']}/att  conf {b['conf']}  {b['name']}")
print('organic baseline', out['organic_baseline'], 'walk-ins', out['walkins'], 'total', out['base_total'], 'spend', out['base_spend'])
