"""(c) Pace forecast: from registrations to date at T-x, project final registrations and attendees.

    python analysis/ml/pace_forecast.py

Model (deliberately simple; one season of data):
  share(x)        = share of final external registrations reached by end of day T-x (2025 curve)
  final_regs_hat  = regs_to_date / share(x)
  attendees_hat   = final_regs_hat * show_up_rate * (1 + walkin_ratio)
Interval: campaign-level bootstrap. The 7 campaigns are resampled with replacement (2,000 draws)
and share(x), show_up_rate and the multiplier are recomputed, giving 10th-90th percentile bands.
This captures how much the curve shape and show-up vary across channels; it does NOT capture
year-to-year change, so treat the band as a lower bound on true uncertainty.
Validation: leave-one-campaign-out backtest (project each campaign from the other six).
Writes analysis/derived/pace_curve.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from growth_analysis import EVENT_DAY, registrant_frame  # noqa: E402
from reference_metrics import ANALYSIS, CAMPAIGN_IDS, load_data, snapshot  # noqa: E402

SEED = 42
N_BOOT = 2000
MAX_X = 82  # first registration is 2025-01-20 = T-82


def cum_counts(r: pd.DataFrame) -> pd.DataFrame:
    """Rows: campaign; columns: x = days to event; values: cumulative registrations by end of T-x."""
    reg_day = r.registered_at.dt.normalize()
    x_of = (EVENT_DAY - reg_day).dt.days
    out = {}
    for c in CAMPAIGN_IDS:
        xs = x_of[r.campaign_id == c]
        out[c] = [int((xs >= x).sum()) for x in range(MAX_X + 1)]
    return pd.DataFrame(out, index=range(MAX_X + 1)).T


def main() -> dict:
    data = load_data()
    r = registrant_frame(data)
    C = cum_counts(r)                          # campaign x days
    final = C[0]                               # x = 0 -> all registrations
    att = r.groupby("campaign_id").attended.sum().reindex(CAMPAIGN_IDS)
    s_final = snapshot(data, "2025-04-20")
    walkins = s_final["verified_walkins"]
    reg_att = s_final["verified_visitors_registered"]
    walkin_ratio = walkins / reg_att

    share = C.sum() / final.sum()
    show_up = att.sum() / final.sum()
    mult = show_up * (1 + walkin_ratio) / share

    rng = np.random.default_rng(SEED)
    boot_share, boot_mult = [], []
    for _ in range(N_BOOT):
        idx = rng.integers(0, len(CAMPAIGN_IDS), len(CAMPAIGN_IDS))
        cs = [CAMPAIGN_IDS[i] for i in idx]
        sh = C.loc[cs].sum() / final.loc[cs].sum()
        su = att.loc[cs].sum() / final.loc[cs].sum()
        boot_share.append(sh.values)
        boot_mult.append((su * (1 + walkin_ratio) / sh).values)
    boot_share, boot_mult = np.array(boot_share), np.array(boot_mult)
    sh_lo, sh_hi = np.percentile(boot_share, [10, 90], axis=0)
    m_lo, m_hi = np.percentile(boot_mult, [10, 90], axis=0)

    total_regs = C.sum()
    curve = []
    for x in range(MAX_X + 1):
        curve.append({
            "days_to_event": x, "date": str((EVENT_DAY - pd.Timedelta(days=x)).date()),
            "cum_registrations": int(total_regs[x]),
            "share_of_final": round(float(share[x]), 4),
            "share_p10": round(float(sh_lo[x]), 4), "share_p90": round(float(sh_hi[x]), 4),
            "attendee_multiplier": round(float(mult[x]), 4),
            "attendee_multiplier_p10": round(float(m_lo[x]), 4), "attendee_multiplier_p90": round(float(m_hi[x]), 4),
            "projected_attendees_in_sample": round(float(total_regs[x] * mult[x]), 1),
            "projected_attendees_p10": round(float(total_regs[x] * m_lo[x]), 1),
            "projected_attendees_p90": round(float(total_regs[x] * m_hi[x]), 1),
        })

    # leave-one-campaign-out backtest of final attendees (registered attendees + pro-rata walk-ins)
    bt = {}
    for x in (45, 30, 21, 14, 7, 3):
        errs = []
        for c in CAMPAIGN_IDS:
            others = [o for o in CAMPAIGN_IDS if o != c]
            sh = C.loc[others, x].sum() / final.loc[others].sum()
            su = att.loc[others].sum() / final.loc[others].sum()
            pred_regs = C.loc[c, x] / sh
            pred_att = pred_regs * su
            errs.append({"campaign": c, "pred_regs": pred_regs, "actual_regs": int(final[c]),
                         "pred_att": pred_att, "actual_att": int(att[c])})
        e = pd.DataFrame(errs)
        bt[f"T-{x}"] = {
            "regs_MAPE": round(float((abs(e.pred_regs - e.actual_regs) / e.actual_regs).mean()), 4),
            "attendees_MAPE": round(float((abs(e.pred_att - e.actual_att) / e.actual_att).mean()), 4),
            "worst_attendee_error": round(float((abs(e.pred_att - e.actual_att) / e.actual_att).max()), 4),
        }

    out = {
        "description": "Registration pace curve and projected-outcome multipliers. 'share_of_final' is a FACT from the 2025 data; "
                       "projections and bands are MODEL ESTIMATES (campaign bootstrap, 10th-90th percentile).",
        "how_to_use": "At date D, x = (2025-04-12 - D) in days; regs = external registrations by end of D. "
                      "projected_final_registrations = regs / share_of_final[x]; projected_attendees = regs * attendee_multiplier[x] "
                      "(band: regs * attendee_multiplier_p10/p90). For a future event, apply the same curve on its own T-x.",
        "event_day": "2025-04-12",
        "constants": {"final_registrations": int(final.sum()), "registered_attendees": int(att.sum()),
                      "walkins": walkins, "show_up_rate": round(float(show_up), 4),
                      "walkin_ratio_to_registered_attendees": round(float(walkin_ratio), 4),
                      "final_attendees": walkins + reg_att},
        "milestones": {f"T-{x}": {k: curve[x][k] for k in ["date", "cum_registrations", "share_of_final", "share_p10", "share_p90",
                                                             "projected_attendees_p10", "projected_attendees_p90"]}
                       for x in (60, 45, 30, 21, 14, 7, 3)},
        "backtest_leave_one_campaign_out": bt,
        "campaign_share_at": {c: {f"T-{x}": round(float(C.loc[c, x] / final[c]), 4) for x in (30, 14, 7)} for c in CAMPAIGN_IDS},
        "curve": curve,
    }
    (ANALYSIS / "derived" / "pace_curve.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out


if __name__ == "__main__":
    o = main()
    print(json.dumps({k: v for k, v in o.items() if k != "curve"}, indent=1))
