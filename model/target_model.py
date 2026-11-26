"""Slide 1 target model: unique verified attendees for a 2-day college fest in Delhi NCR.

Unit economics are calibrated on the CampusFest 2025 dataset (analysis/golden_metrics.json, snapshot 2025-04-13).
Market scale and costs come from the market research summarised in README section 1. Outputs: model/target_model.json, with base, stretch,
Monte Carlo P10/P50/P90, a tornado chart and triangulation.

Funnel per channel: reach -> registrations (people) -> show-up -> verified unique attendees; walk-ins are added on top.
Binding constraints: budget, venue capacity (Delhi Police SOP: passes capped at 90% of capacity), gate throughput.
"""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
G = json.load(open(os.path.join(HERE, '..', 'analysis', 'golden_metrics.json')))['snapshots']['2025-04-13']
bc = G['by_campaign']

# ---- calibration from CampusFest 2025 (facts from the data)
def cpr(c): return bc[c]['spend_inr'] / bc[c]['registered_external']           # cost per registration
def sur(c): return bc[c]['verified_visitors'] / bc[c]['registered_external']    # show-up rate
CAL = {k: dict(cpr=cpr(c), show=sur(c)) for k, c in
       dict(partners='C04', ambassadors='C01', referrals='C05', paid='C02', creators='C03', organic='C06', community='C07').items()}
WALKIN_SHARE = G['verified_walkins'] / G['verified_visitors']                   # 125 / 2050
REF_PER_REG = bc['C05']['registered_external'] / (G['registered_external'] - bc['C05']['registered_external'])  # referral regs per other reg

# ---- Delhi NCR adjustments (assumptions from the market research; see README section 2)
COST_INFLATION = 1.20          # Delhi media and ops cost vs CampusFest's synthetic city
STUDENTS_1HR = 700_000         # AISHE + DU + GGSIPU + Greater Noida (M/L)
DAILY_CAPACITY = 15_000        # campus ground or IG-Arena class
PASS_CAP = 0.90                # Delhi Police SOP
BOTH_DAYS = 0.35               # share of unique attendees who come on both days (assumption)
UNIQUE_CAP = DAILY_CAPACITY * PASS_CAP * 2 / (1 + BOTH_DAYS)   # unique-attendee ceiling ~20k
GATE = 450 * 10 * 6            # people/hour/lane x 10 lanes x 6 peak hours, per day = 27k: not binding

SCEN = {
    # number of units x registrations per unit, show-up lift from the no-show programme, budget
    'base':    dict(partners=(120, 25), ambassadors=(200, 20), paid_budget=150_000, organic_regs=1500,
                    showup_lift=1.05, walkin=WALKIN_SHARE, ref_mult=1.0, budget=1_100_000, realism=0.85),
    'stretch': dict(partners=(160, 36), ambassadors=(280, 25), paid_budget=200_000, organic_regs=2000,
                    showup_lift=1.10, walkin=0.07, ref_mult=1.3, budget=1_750_000, realism=0.92),
}

def run(p, cal=CAL):
    regs, att, cost = {}, {}, {}
    regs['partners'] = p['partners'][0] * p['partners'][1]
    regs['ambassadors'] = p['ambassadors'][0] * p['ambassadors'][1]
    regs['paid'] = p['paid_budget'] / (cal['paid']['cpr'] * COST_INFLATION)
    regs['organic'] = p['organic_regs']
    seed = sum(regs.values())
    regs['referrals'] = seed * REF_PER_REG * p['ref_mult']
    for k in regs:
        base_show = cal[k]['show'] if k in cal else cal['organic']['show']
        att[k] = regs[k] * min(0.92, base_show * p['showup_lift'] * p.get('realism', 1.0))
        cost[k] = p['paid_budget'] if k == 'paid' else regs[k] * cal[k]['cpr'] * COST_INFLATION
    reg_att = sum(att.values())
    total = reg_att / (1 - p['walkin'])
    capped = min(total, UNIQUE_CAP)
    spend = sum(cost.values()) + 40_000 + 0.12 * reg_att   # + no-show programme (WhatsApp/SMS, QR passes)
    return dict(regs={k: round(v) for k, v in regs.items()}, attendees_by_channel={k: round(v) for k, v in att.items()},
                registrations=round(sum(regs.values())), registered_attendees=round(reg_att), walkins=round(total - reg_att),
                unique_attendees_uncapped=round(total), unique_attendees=round(capped), capacity_cap=round(UNIQUE_CAP),
                spend_inr=round(spend), budget_inr=p['budget'], within_budget=spend <= p['budget'],
                cac_per_attendee=round(spend / capped), show_up=round(reg_att / sum(regs.values()), 4))

out = {'calibration': {k: {'cpr_inr': round(v['cpr']), 'show_up': round(v['show'], 4)} for k, v in CAL.items()},
       'walkin_share_2025': round(WALKIN_SHARE, 4), 'referral_regs_per_other_reg_2025': round(REF_PER_REG, 4),
       'constraints': dict(students_1hr=STUDENTS_1HR, daily_capacity=DAILY_CAPACITY, pass_cap=PASS_CAP, both_days=BOTH_DAYS,
                           unique_cap=round(UNIQUE_CAP), gate_per_day=GATE)}
for s, p in SCEN.items():
    out[s] = run(p)

# ---- Monte Carlo: each input drawn around base with stated uncertainty (triangular low/mode/high)
rng = np.random.default_rng(7)
N = 20_000
def tri(lo, mode, hi): return rng.triangular(lo, mode, hi, N)
draws = dict(pn=tri(80, 120, 180), pr=tri(15, 25, 40), real=tri(0.72, 0.85, 0.95), an=tri(120, 200, 300), ar=tri(10, 20, 30),
             org=tri(800, 1500, 2500), lift=tri(0.98, 1.05, 1.12), ref=tri(0.7, 1.0, 1.4), wi=tri(0.04, WALKIN_SHARE, 0.09),
             showshock=tri(0.85, 1.0, 1.05))   # Delhi show-up vs CampusFest calibration
res = np.empty(N)
for i in range(N):
    cal = {k: dict(cpr=v['cpr'], show=v['show'] * draws['showshock'][i]) for k, v in CAL.items()}
    p = dict(partners=(draws['pn'][i], draws['pr'][i]), ambassadors=(draws['an'][i], draws['ar'][i]), paid_budget=150_000,
             organic_regs=draws['org'][i], showup_lift=draws['lift'][i], walkin=draws['wi'][i], ref_mult=draws['ref'][i], budget=1_100_000, realism=draws['real'][i])
    res[i] = run(p, cal)['unique_attendees']
out['monte_carlo'] = {f'P{q}': int(np.percentile(res, q)) for q in (10, 25, 50, 75, 90)}
out['monte_carlo']['prob_ge_base'] = round(float((res >= out['base']['unique_attendees']).mean()), 3)
out['monte_carlo']['prob_ge_stretch'] = round(float((res >= out['stretch']['unique_attendees']).mean()), 3)

# ---- tornado: swing each driver low/high, others at base
base_p = SCEN['base']
def with_(**kw):
    p = dict(base_p); p.update(kw); return run(p)['unique_attendees']
tor = {
    'Partner colleges (80 / 180)': (with_(partners=(80, 25)), with_(partners=(180, 25))),
    'Real-world show-up haircut (0.72 / 0.95)': (with_(realism=0.72), with_(realism=0.95)),
    'Regs per partner (15 / 40)': (with_(partners=(120, 15)), with_(partners=(120, 40))),
    'Ambassadors (120 / 300)': (with_(ambassadors=(120, 20)), with_(ambassadors=(300, 20))),
    'Regs per ambassador (10 / 30)': (with_(ambassadors=(200, 10)), with_(ambassadors=(200, 30))),
    'No-show programme lift (0.98 / 1.12)': (with_(showup_lift=0.98), with_(showup_lift=1.12)),
    'Referral multiplier (0.7 / 1.4)': (with_(ref_mult=0.7), with_(ref_mult=1.4)),
    'Organic regs (800 / 2,500)': (with_(organic_regs=800), with_(organic_regs=2500)),
}
out['tornado'] = {k: {'low': v[0], 'high': v[1], 'swing': v[1] - v[0]} for k, v in sorted(tor.items(), key=lambda kv: -(kv[1][1] - kv[1][0]))}

# ---- triangulation (independent checks on the base)
b = out['base']['unique_attendees']
out['triangulation'] = {
    'bottom_up_channels': b,
    'penetration_of_1hr_students': {'implied_share': round(b / STUDENTS_1HR, 4), 'peer_range': '1.5-3% (single DU college fest ~30k cumulative; Rendezvous 1.6L claimed /2.5)'},
    'budget_over_blended_cac': {'budget': 1_100_000, 'blended_cac_2025_reallocated': round(sum(bc[c]['spend_inr'] for c in ('C01', 'C04', 'C05', 'C06', 'C07')) / sum(bc[c]['verified_visitors'] for c in ('C01', 'C04', 'C05', 'C06', 'C07')) * COST_INFLATION),
                                'implied_attendees': round(1_100_000 / (sum(bc[c]['spend_inr'] for c in ('C01', 'C04', 'C05', 'C06', 'C07')) / sum(bc[c]['verified_visitors'] for c in ('C01', 'C04', 'C05', 'C06', 'C07')) * COST_INFLATION) / (1 - WALKIN_SHARE))},
    'capacity_ceiling': round(UNIQUE_CAP),
}
json.dump(out, open(os.path.join(HERE, 'target_model.json'), 'w'), indent=1)
print(json.dumps({k: out[k] for k in ('calibration', 'base', 'stretch', 'monte_carlo', 'tornado', 'triangulation')}, indent=1))

# ---- city robustness: same plan, city-specific cost inflation and venue capacity (assumptions)
import importlib
CITIES = {'Delhi NCR': (1.20, 15_000), 'Bengaluru': (1.25, 10_000), 'Mumbai': (1.35, 12_000)}
rob = {}
for city, (infl, cap) in CITIES.items():
    COST_INFLATION, DAILY_CAPACITY = infl, cap
    UNIQUE_CAP = DAILY_CAPACITY * PASS_CAP * 2 / (1 + BOTH_DAYS)
    r = run(SCEN['base'])
    rob[city] = dict(cost_inflation=infl, daily_capacity=cap, unique_attendees=r['unique_attendees'], capacity_cap=r['capacity_cap'], spend_inr=r['spend_inr'])
out['city_robustness'] = rob
json.dump(out, open(os.path.join(HERE, 'target_model.json'), 'w'), indent=1)
print(json.dumps(rob, indent=1))
