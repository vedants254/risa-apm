"""(b) Channel response: spend -> registrations / attendees per campaign, marginal CAC.

    python analysis/ml/channel_response.py

Views (most to least assumption-heavy; see "reliability" in the output):
  1. Per-campaign cumulative power curve  cum_regs = k * cum_spend^beta  (log-log OLS on weekly
     points). beta < 1 means diminishing returns; marginal CAC = average CAC / beta.
     Benchmarked against a time-only curve  cum_regs = k * weeks^gamma  to show how much of the
     fit is just "time passing" (spend and time are both monotonic, so they are confounded).
  2. Pooled weekly panel: regs_ct ~ log1p(spend in the trailing 14 days) + campaign FE + week FE.
     Week FE absorb the shared run-up to the event; the coefficient is identified only from
     differences in posting timing between campaigns in the same week.
  3. Period comparison: spend and registrations before vs after the 15 Mar plan revision.
Spend is a ledger posting (whole INR, on the posting date), posted in lumps roughly every
10 days, so it is a poor proxy for when media actually ran. Writes analysis/derived/channel_response.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from growth_analysis import registrant_frame  # noqa: E402
from reference_metrics import ANALYSIS, CAMPAIGN_IDS, load_data  # noqa: E402

WEEK_START = pd.Timestamp("2025-01-20")  # Monday of the first registration week


def weekly(data) -> pd.DataFrame:
    r = registrant_frame(data)
    dm = data.campaign_daily[data.campaign_daily.activity_date <= "2025-04-11"].copy()  # pre-event spend only
    dm["week"] = ((dm.activity_date - WEEK_START).dt.days // 7).clip(lower=0)
    r["week"] = (r.registered_at.dt.normalize() - WEEK_START).dt.days // 7
    weeks = range(0, int(max(dm.week.max(), r.week.max())) + 1)
    idx = pd.MultiIndex.from_product([CAMPAIGN_IDS, weeks], names=["campaign_id", "week"])
    s = dm.groupby(["campaign_id", "week"]).agg(spend=("marketing_spend_inr", "sum"), clicks=("clicks", "sum"))
    g = r.groupby(["campaign_id", "week"]).agg(regs=("registration_id", "count"), attendees=("attended", "sum"))
    w = s.reindex(idx, fill_value=0).join(g.reindex(idx, fill_value=0)).reset_index()
    w["spend_trailing_14d"] = w.groupby("campaign_id").spend.transform(lambda x: x.rolling(2, min_periods=1).sum())
    w["cum_spend"] = w.groupby("campaign_id").spend.cumsum()
    w["cum_regs"] = w.groupby("campaign_id").regs.cumsum()
    w["cum_att"] = w.groupby("campaign_id").attendees.cumsum()
    return w


def power_fit(x: np.ndarray, y: np.ndarray) -> dict:
    m = (x > 0) & (y > 0)
    lx, ly = np.log(x[m]), np.log(y[m])
    res = smf.ols("ly ~ lx", data=pd.DataFrame({"lx": lx, "ly": ly})).fit()
    lo, hi = res.conf_int().loc["lx"]
    return {"exponent": round(float(res.params["lx"]), 3), "ci95": [round(float(lo), 3), round(float(hi), 3)],
            "r2": round(float(res.rsquared), 3), "n_points": int(m.sum())}


def main() -> dict:
    data = load_data()
    w = weekly(data)
    r = registrant_frame(data)
    dm = data.campaign_daily[data.campaign_daily.activity_date <= "2025-04-11"]
    periods = {"early_2025-01-20..2025-03-14": ("2025-01-20", "2025-03-14"),
               "late_2025-03-15..2025-04-11": ("2025-03-15", "2025-04-11")}

    def window(a: str, b: str, c: str | None = None) -> dict:
        sp = dm[(dm.activity_date >= a) & (dm.activity_date <= b)]
        rr = r[(r.registered_at >= a) & (r.registered_at < pd.Timestamp(b) + pd.Timedelta(days=1))]
        if c:
            sp, rr = sp[sp.campaign_id == c], rr[rr.campaign_id == c]
        S, R, A = int(sp.marketing_spend_inr.sum()), len(rr), int(rr.attended.sum())
        return {"spend_inr": S, "registrations": R, "registered_attendees": A,
                "cac_per_registration_inr": round(S / R) if R else None,
                "cac_per_attendee_inr": round(S / A) if A else None,
                "registrations_per_1k_inr": round(1000 * R / S, 2) if S > 0 else None}

    per = {}
    for c in CAMPAIGN_IDS:
        d = w[(w.campaign_id == c) & (w.cum_spend > 0)]
        S, R, A = float(d.cum_spend.iloc[-1]), float(d.cum_regs.iloc[-1]), float(d.cum_att.iloc[-1])
        f_reg = power_fit(d.cum_spend.values, d.cum_regs.values)
        f_time = power_fit((d.week.values - d.week.values.min() + 1).astype(float), d.cum_regs.values)
        early, late = (window(*periods[k], c) for k in periods)
        per[c] = {
            "pre_event_spend_inr": int(S), "registrations": int(R), "registered_attendees": int(A),
            "avg_cac_per_registration_inr": round(S / R), "avg_cac_per_attendee_inr": round(S / A),
            "early": early, "late": late,
            # marginal proxy: cost of the last 4 weeks' registrations at the last 4 weeks' spend level
            "marginal_cac_per_registration_inr_late_window": late["cac_per_registration_inr"],
            "marginal_cac_per_attendee_inr_late_window": late["cac_per_attendee_inr"],
            "efficiency_change_late_vs_early": (round(late["registrations_per_1k_inr"] / early["registrations_per_1k_inr"], 2)
                                                if early["registrations_per_1k_inr"] and late["registrations_per_1k_inr"] else None),
            "cumulative_power_fit": {"regs_vs_cum_spend": f_reg, "regs_vs_weeks_only": f_time,
                                     "identified": bool(f_reg["exponent"] < 1 and f_reg["r2"] > f_time["r2"] + 0.01)},
            "spend_postings": int((data.campaign_daily[(data.campaign_daily.campaign_id == c)].marketing_spend_inr != 0).sum()),
        }

    # pooled weekly panel, only weeks after each campaign's first spend (launch weeks would otherwise drive the fit)
    first_wk = w[w.spend > 0].groupby("campaign_id").week.min()
    p = w[w.week >= w.campaign_id.map(first_wk)].copy()
    p["log_spend14"] = np.log1p(p.spend_trailing_14d)
    p["log_regs"] = np.log1p(p.regs)
    m1 = smf.ols("log_regs ~ log_spend14 + C(campaign_id) + C(week)", data=p).fit(cov_type="HC1")
    m0 = smf.ols("log_regs ~ log_spend14 + C(campaign_id)", data=p).fit(cov_type="HC1")
    panel = {name: {"elasticity": round(float(m.params["log_spend14"]), 4),
                    "ci95": [round(float(v), 4) for v in m.conf_int().loc["log_spend14"]],
                    "p_value": round(float(m.pvalues["log_spend14"]), 4), "n": int(m.nobs)}
             for name, m in [("with_week_fe", m1), ("without_week_fe", m0)]}

    # cross-campaign (7 points): do bigger budgets buy proportionally more registrations?
    cs = pd.DataFrame({c: {"S": per[c]["pre_event_spend_inr"], "R": per[c]["registrations"], "A": per[c]["registered_attendees"]}
                       for c in CAMPAIGN_IDS}).T.astype(float)
    cross = {"regs_vs_spend": power_fit(cs.S.values, cs.R.values), "attendees_vs_spend": power_fit(cs.S.values, cs.A.values)}

    per_cmp = {k: window(*v) for k, v in periods.items()}
    for k, v in per_cmp.items():
        a, b = periods[k]
        v["days"] = (pd.Timestamp(b) - pd.Timestamp(a)).days + 1
        v["registrations_per_day"] = round(v["registrations"] / v["days"], 1)
        v["spend_per_day"] = round(v["spend_inr"] / v["days"])

    out = {
        "description": "Spend -> registrations/attendees response per campaign. All curves are MODEL ESTIMATES on one "
                       "season of weekly data (12 weeks, 3-9 spend postings per campaign). Treat marginal CAC as directional.",
        "per_campaign": per,
        "pooled_panel_weekly": panel,
        "cross_campaign_fit": cross,
        "period_comparison": per_cmp,
        "reliability": {
            "spend_and_time_confounded": "cumulative spend and cumulative registrations both rise with time; the time-only curve fits "
                                         "as well as the spend curve and exponents come out > 1, so per-campaign response curves are "
                                         "not identified. The late-window CAC is used as the marginal-cost proxy instead.",
            "lumpy_ledger_spend": "spend is posted on 56 dates (3-9 per campaign), not daily, so weekly spend timing is noisy.",
            "no_variation_experiments": "no campaign was paused or scaled independently; there is no holdout.",
        },
        "weekly": json.loads(w.to_json(orient="records")),
    }
    (ANALYSIS / "derived" / "channel_response.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out


if __name__ == "__main__":
    o = main()
    print(json.dumps({k: v for k, v in o.items() if k != "weekly"}, indent=1))
