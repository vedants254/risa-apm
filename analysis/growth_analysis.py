"""Growth analysis behind analysis/report.md. Every number in the report comes from here.

    python analysis/growth_analysis.py

Writes analysis/derived/report_numbers.json and prints the tables used in report.md.
Charts are drawn by analysis/charts.py from the same functions.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from reference_metrics import (ANALYSIS, CAMPAIGN_IDS, EVENT_START, Data, end_of_day, load_data,
                               rate, snapshot, status_as_of)

DERIVED = ANALYSIS / "derived"
EVENT_DAY = EVENT_START.normalize()          # T-0 = 2025-04-12
T_MINUS_1 = end_of_day("2025-04-11")
FINAL = "2025-04-20"
LEAD_BUCKETS = [(0, 3, "0-3 d"), (4, 7, "4-7 d"), (8, 14, "8-14 d"), (15, 30, "15-30 d"),
                (31, 45, "31-45 d"), (46, 60, "46-60 d"), (61, 200, "61+ d")]
ENGAGEMENT_TYPES = ["brochure_download", "event_question_submitted", "nurture_email_sent",
                    "nurture_email_opened", "nurture_email_clicked", "opted_out"]


def campaign_names(data: Data) -> dict[str, str]:
    return dict(zip(data.campaigns.campaign_id, data.campaigns.campaign_name))


def registrant_frame(data: Data) -> pd.DataFrame:
    """One row per external registration with pre-event features and the outcome."""
    ext = set(data.people.loc[data.people.person_type == "external", "person_id"])
    r = data.registrations[data.registrations.person_id.isin(ext)].copy()
    st = status_as_of(data, T_MINUS_1).set_index("registration_id").status
    r["status_t1"] = r.registration_id.map(st)
    h = data.registration_history[data.registration_history.effective_at < T_MINUS_1]
    seq = h.sort_values(["registration_id", "effective_at"]).groupby("registration_id").status.agg(list)
    r["n_status_changes"] = r.registration_id.map(seq.apply(len) - 1)
    r["ever_cancelled"] = r.registration_id.map(seq.apply(lambda s: "cancelled" in s))
    r["ever_waitlisted"] = r.registration_id.map(seq.apply(lambda s: "waitlisted" in s))
    r["reconfirmed"] = r.registration_id.map(seq.apply(lambda s: "cancelled" in s and s[-1] == "confirmed"))
    c = data.checkins
    vis = set(c.loc[(c.result == "admitted") & (c.verification == "verified"), "person_id"])
    r["attended"] = r.person_id.isin(vis)
    r["lead_days"] = (EVENT_DAY - r.registered_at.dt.normalize()).dt.days
    r["lead_bucket"] = pd.cut(r.lead_days, [b[0] - 0.5 for b in LEAD_BUCKETS] + [LEAD_BUCKETS[-1][1] + 0.5],
                              labels=[b[2] for b in LEAD_BUCKETS])
    r["weekday"] = r.registered_at.dt.day_name()
    li = data.lead_interactions[data.lead_interactions.occurred_at < T_MINUS_1]
    cnt = li.pivot_table(index="person_id", columns="event_type", values="interaction_id", aggfunc="count", fill_value=0)
    for t in ENGAGEMENT_TYPES:
        r[t] = r.person_id.map(cnt[t] if t in cnt else pd.Series(dtype=float)).fillna(0).astype(int)
    fs = data.people.set_index("person_id").first_seen_at
    r["days_seen_to_reg"] = (r.registered_at - r.person_id.map(fs)).dt.days
    return r


def funnel(data: Data) -> pd.DataFrame:
    s = snapshot(data, FINAL)
    rows = []
    r = registrant_frame(data)
    for c in CAMPAIGN_IDS + [None]:
        sc = snapshot(data, FINAL, c) if c else s
        rc = r if c is None else r[r.campaign_id == c]
        rows.append({
            "campaign_id": c or "ALL",
            "impressions": sc["impressions"], "clicks": sc["clicks"],
            "landing_page_sessions": sc["landing_page_sessions"], "registration_starts": sc["registration_starts"],
            "identified_external": sc["identified_external"], "registered_external": sc["registered_external"],
            "confirmed_t1": int((rc.status_t1 == "confirmed").sum()),
            "attended_registered": sc["verified_visitors_registered"],
            "walkins": sc["verified_walkins"],
            "spend_inr": sc["marketing_spend_inr"],
        })
    f = pd.DataFrame(rows).set_index("campaign_id")
    f["ctr"] = f.clicks / f.impressions
    f["click_to_session"] = f.landing_page_sessions / f.clicks
    f["session_to_start"] = f.registration_starts / f.landing_page_sessions
    f["identified_to_registered"] = f.registered_external / f.identified_external
    f["registered_to_confirmed"] = f.confirmed_t1 / f.registered_external
    f["confirmed_to_attended"] = f.attended_registered / f.confirmed_t1
    f["show_up_rate"] = f.attended_registered / f.registered_external
    f["cac_per_registration"] = f.spend_inr / f.registered_external
    f["cac_per_attendee"] = f.spend_inr / f.attended_registered
    f["cac_per_identified"] = f.spend_inr / f.identified_external
    f["spend_share"] = f.spend_inr / f.loc["ALL", "spend_inr"]
    f["attendee_share"] = f.attended_registered / f.loc["ALL", "attended_registered"]
    return f


def spend_vs_budget(data: Data) -> pd.DataFrame:
    days = pd.date_range("2025-01-15", "2025-04-20", freq="D")
    dm = data.campaign_daily.groupby("activity_date").marketing_spend_inr.sum()
    cum = dm.reindex(days, fill_value=0).cumsum()
    t = data.targets.sort_values("effective_at")
    budget = [int(t[t.effective_at < d + pd.Timedelta(days=1)].iloc[-1].marketing_budget_inr) for d in days]
    out = pd.DataFrame({"cum_spend_inr": cum.values, "budget_inr": budget}, index=days)
    out["utilisation"] = out.cum_spend_inr / out.budget_inr
    return out


def pace(data: Data) -> pd.DataFrame:
    r = registrant_frame(data)
    final = len(r)
    xs = np.arange(0, 83)
    rows = []
    for x in xs:
        cut = EVENT_DAY - pd.Timedelta(days=int(x)) + pd.Timedelta(days=1)  # end of day T-x
        sub = r[r.registered_at < cut]
        row = {"days_to_event": int(x), "date": str((EVENT_DAY - pd.Timedelta(days=int(x))).date()),
               "cum_registrations": len(sub), "share_of_final": len(sub) / final,
               "cum_confirmed_now": int((status_as_of(data, cut).pipe(lambda s: s[s.registration_id.isin(sub.registration_id)]).status == "confirmed").sum())}
        for c in CAMPAIGN_IDS:
            rc = r[r.campaign_id == c]
            row[f"share_{c}"] = (rc.registered_at < cut).sum() / len(rc)
        rows.append(row)
    return pd.DataFrame(rows)


def show_up_tables(r: pd.DataFrame) -> dict:
    conf = r[r.status_t1 == "confirmed"]
    def tab(df, by):
        g = df.groupby(by, observed=True).attended.agg(["count", "sum", "mean"])
        return {str(k): {"registered": int(v["count"]), "attended": int(v["sum"]), "show_up_rate": rate(v["mean"])} for k, v in g.iterrows()}
    return {
        "by_campaign": tab(r, "campaign_id"),
        "by_campaign_confirmed_only": tab(conf, "campaign_id"),
        "by_lead_bucket": tab(r, "lead_bucket"),
        "by_lead_bucket_confirmed_only": tab(conf, "lead_bucket"),
        "by_status_t1": tab(r, "status_t1"),
        "by_registration_weekday": tab(r, "weekday"),
        "by_reg_weekday_confirmed_only": tab(conf, "weekday"),
    }


def churn(r: pd.DataFrame) -> dict:
    n = len(r)
    out = {
        "registrations": n,
        "status_t1": r.status_t1.value_counts().to_dict(),
        "ever_cancelled": int(r.ever_cancelled.sum()),
        "reconfirmed_after_cancel": int(r.reconfirmed.sum()),
        "reconfirmed_attended": int(r[r.reconfirmed].attended.sum()),
        "reconfirmed_show_up": rate(r[r.reconfirmed].attended.mean()),
        "never_cancelled_confirmed_show_up": rate(r[(r.status_t1 == "confirmed") & ~r.ever_cancelled].attended.mean()),
        "waitlisted_ever": int(r.ever_waitlisted.sum()),
        "waitlisted_then_confirmed": int((r.ever_waitlisted & (r.status_t1 == "confirmed")).sum()),
        "lost_to_cancel_waitlist_interested": int((r.status_t1 != "confirmed").sum()),
        "lost_share": rate((r.status_t1 != "confirmed").mean()),
    }
    by_c = r.groupby("campaign_id").agg(cancelled=("status_t1", lambda s: (s == "cancelled").mean()),
                                        waitlisted=("status_t1", lambda s: (s == "waitlisted").mean()),
                                        interested=("status_t1", lambda s: (s == "interested").mean()),
                                        ever_cancelled=("ever_cancelled", "mean"))
    out["by_campaign"] = {c: {k: rate(v) for k, v in row.items()} for c, row in by_c.iterrows()}
    # what-if: if the 36 reconfirmed had stayed cancelled
    out["attendees_from_reconfirmation"] = int(r[r.reconfirmed].attended.sum())
    return out


def walkins(data: Data) -> dict:
    c = data.checkins
    pt = data.people.set_index("person_id").person_type
    ok = c[(c.result == "admitted") & (c.verification == "verified") & (c.person_id.map(pt) == "external")]
    regd = set(data.registrations.person_id)
    w = ok[~ok.person_id.isin(regd)]
    first = w.groupby("person_id").occurred_at.min()
    allfirst = ok.groupby("person_id").occurred_at.min()
    return {
        "walkin_visitors": int(w.person_id.nunique()),
        "share_of_visitors": rate(w.person_id.nunique() / ok.person_id.nunique()),
        "walkin_first_day": {str(k): int(v) for k, v in first.dt.date.value_counts().sort_index().items()},
        "all_visitors_first_day": {str(k): int(v) for k, v in allfirst.dt.date.value_counts().sort_index().items()},
        "walkin_source": w.source.value_counts().to_dict(),
        "walkin_first_hour": {int(k): int(v) for k, v in first.dt.hour.value_counts().sort_index().items()},
    }


def engagement_vs_show_up(r: pd.DataFrame) -> dict:
    out = {}
    for base_name, base in [("all_registrants", r), ("confirmed_t1", r[r.status_t1 == "confirmed"])]:
        d = {}
        for t in ENGAGEMENT_TYPES:
            has = base[t] > 0
            d[t] = {"with_n": int(has.sum()), "with_show_up": rate(base[has].attended.mean()) if has.any() else None,
                    "without_n": int((~has).sum()), "without_show_up": rate(base[~has].attended.mean())}
        # email funnel among those sent
        sent = base[base.nurture_email_sent > 0]
        d["email_sent_opened_rate"] = rate((sent.nurture_email_opened > 0).mean())
        d["email_sent_clicked_rate"] = rate((sent.nurture_email_clicked > 0).mean())
        out[base_name] = d
    return out


def adjusted_effects(r: pd.DataFrame) -> dict:
    """Do engagement and lead time still predict show-up once registration campaign is held fixed?

    Logit on registrants confirmed at T-1: attended ~ campaign FE + brochure + question + lead_days.
    Also the within-campaign brochure gap, weighted by campaign size.
    """
    import statsmodels.formula.api as smf

    c = r[r.status_t1 == "confirmed"].copy()
    c["att"] = c.attended.astype(int)
    c["brochure"] = (c.brochure_download > 0).astype(int)
    c["question"] = (c.event_question_submitted > 0).astype(int)
    c["email_opened"] = (c.nurture_email_opened > 0).astype(int)
    m = smf.logit("att ~ C(campaign_id) + brochure + question + email_opened + lead_days", data=c).fit(disp=0)
    coefs = {k: {"coef": round(float(m.params[k]), 4), "p_value": round(float(m.pvalues[k]), 4),
                 "odds_ratio": round(float(np.exp(m.params[k])), 3)} for k in m.params.index}
    gaps = []
    for cid, g in c.groupby("campaign_id"):
        a, b = g[g.brochure == 1].att.mean(), g[g.brochure == 0].att.mean()
        gaps.append({"campaign_id": cid, "n": len(g), "brochure_rate": round(float(g.brochure.mean()), 4),
                     "show_up_with": round(float(a), 4), "show_up_without": round(float(b), 4), "gap_pp": round(float((a - b) * 100), 1)})
    gdf = pd.DataFrame(gaps)
    return {"logit_confirmed_t1": coefs, "n": int(m.nobs),
            "brochure_within_campaign": gaps,
            "brochure_gap_weighted_pp": round(float((gdf.gap_pp * gdf.n).sum() / gdf.n.sum()), 1),
            "median_lead_days_by_campaign": {k: float(v) for k, v in c.groupby("campaign_id").lead_days.median().items()}}


def headline_derivations(f: pd.DataFrame, r: pd.DataFrame, data: Data) -> dict:
    """Small derived numbers quoted in report.md (facts unless the key says 'scenario')."""
    hi = f.loc[["C02", "C03"]]
    rest = f.loc[["C01", "C04", "C05", "C06", "C07"]]
    conf_rate = r[r.status_t1 == "confirmed"].attended.mean()
    lost = int((r.status_t1 != "confirmed").sum())
    rev = data.targets.sort_values("effective_at").iloc[-1]
    s = snapshot(data, FINAL)
    reg_gap = int(rev.registration_goal - s["registered_external"])
    return {
        "c02_c03_spend_share": rate(hi.spend_inr.sum() / f.loc["ALL", "spend_inr"]),
        "c02_c03_registered_attendee_share": rate(hi.attended_registered.sum() / f.loc["ALL", "attended_registered"]),
        "c02_c03_cac_per_attendee": round(hi.spend_inr.sum() / hi.attended_registered.sum()),
        "other_five_cac_per_attendee": round(rest.spend_inr.sum() / rest.attended_registered.sum()),
        "non_confirmed_at_t1": lost,
        "scenario_attendees_if_non_confirmed_had_confirmed_show_up": round(lost * conf_rate),
        "registration_gap_vs_revised_goal": reg_gap,
        "registered_attendees_missing_at_observed_show_up": round(reg_gap * s["show_up_rate"]),
        "visitor_gap_vs_revised_goal": int(rev.unique_external_visitors_goal - s["verified_visitors"]),
        "unused_budget_inr": int(rev.marketing_budget_inr - s["marketing_spend_inr"]),
        "overall_cac_per_registered_attendee": round(s["marketing_spend_inr"] / s["verified_visitors_registered"]),
        "overall_cac_per_visitor_incl_walkins": s["cac_per_visitor_inr"],
        "overall_cac_per_registration": s["cac_per_registration_inr"],
    }


def weekday_effects(data: Data, r: pd.DataFrame) -> dict:
    regs = r.groupby(r.registered_at.dt.normalize()).size()
    days = pd.date_range(r.registered_at.min().normalize(), "2025-04-10")
    regs = regs.reindex(days, fill_value=0)
    df = pd.DataFrame({"n": regs.values, "wd": days.day_name(), "t": np.arange(len(days))})
    # detrend with a 7-day centred mean so the weekday index is not just the growth trend
    df["trend"] = df.n.rolling(7, center=True, min_periods=4).mean()
    df["idx"] = df.n / df.trend
    wd = df.groupby("wd").agg(mean_regs=("n", "mean"), index_vs_trend=("idx", "mean"))
    order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    wd = wd.reindex(order)
    c = data.checkins
    ok = c[(c.result == "admitted") & (c.verification == "verified")]
    hours = ok.groupby([ok.occurred_at.dt.date.astype(str), ok.occurred_at.dt.hour]).size()
    return {
        "registrations_by_weekday": {k: {"mean_per_day": round(v.mean_regs, 1), "index_vs_7d_trend": round(v.index_vs_trend, 3)} for k, v in wd.iterrows()},
        "registered_at_clock_time": "all registrations are stamped 10:00, so time-of-day is not observable",
        "checkin_events_by_day_hour": {f"{d} {h:02d}h": int(n) for (d, h), n in hours.items()},
    }


def targets_vs_actuals(data: Data) -> dict:
    out = {}
    for d in ["2025-03-14", "2025-03-15", "2025-04-11", "2025-04-13", "2025-04-20"]:
        s = snapshot(data, d)
        t = s["targets"]
        out[d] = {
            "version": t["version"],
            "identified": [s["identified_external"], t["identified_external_people_goal"], rate(s["identified_external"] / t["identified_external_people_goal"])],
            "registered": [s["registered_external"], t["registration_goal"], rate(s["registered_external"] / t["registration_goal"])],
            "visitors": [s["verified_visitors"], t["unique_external_visitors_goal"], rate(s["verified_visitors"] / t["unique_external_visitors_goal"])],
            "spend": [s["marketing_spend_inr"], t["marketing_budget_inr"], rate(s["marketing_spend_inr"] / t["marketing_budget_inr"])],
        }
    # final actuals against BOTH plans
    s = snapshot(data, FINAL)
    for _, t in data.targets.iterrows():
        out[f"final_vs_{t.target_version}"] = {
            "identified": rate(s["identified_external"] / t.identified_external_people_goal),
            "registered": rate(s["registered_external"] / t.registration_goal),
            "visitors": rate(s["verified_visitors"] / t.unique_external_visitors_goal),
            "spend": rate(s["marketing_spend_inr"] / t.marketing_budget_inr),
            "implied_reg_to_visitor_ratio_in_plan": rate(t.unique_external_visitors_goal / t.registration_goal),
        }
    return out


def weekly_campaign(data: Data) -> pd.DataFrame:
    """Weekly spend, registrations and attendees per campaign (by registration week)."""
    r = registrant_frame(data)
    dm = data.campaign_daily.copy()
    dm["week"] = dm.activity_date.dt.to_period("W-SUN").dt.start_time
    r["week"] = r.registered_at.dt.to_period("W-SUN").dt.start_time
    s = dm.groupby(["campaign_id", "week"]).agg(spend=("marketing_spend_inr", "sum"), clicks=("clicks", "sum"),
                                                 sessions=("landing_page_sessions", "sum"))
    g = r.groupby(["campaign_id", "week"]).agg(regs=("registration_id", "count"), attendees=("attended", "sum"))
    return s.join(g, how="outer").fillna(0).reset_index()


def main() -> dict:
    data = load_data()
    names = campaign_names(data)
    r = registrant_frame(data)
    f = funnel(data)
    sb = spend_vs_budget(data)
    p = pace(data)
    out: dict = {"campaign_names": names}
    out["funnel"] = json.loads(f.round(4).to_json(orient="index"))
    out["spend_vs_budget"] = {str(d.date()): {"cum_spend_inr": int(v.cum_spend_inr), "budget_inr": int(v.budget_inr),
                                              "utilisation": rate(v.utilisation)}
                              for d, v in sb.iterrows() if d.day in (1, 15) or str(d.date()) in ("2025-03-14", "2025-04-11", "2025-04-13", "2025-04-20")}
    out["show_up"] = show_up_tables(r)
    out["churn"] = churn(r)
    out["walkins"] = walkins(data)
    out["pace_milestones"] = {f"T-{x}": {"date": p.loc[x, "date"], "cum_registrations": int(p.loc[x, "cum_registrations"]),
                                         "share_of_final": rate(p.loc[x, "share_of_final"]),
                                         **{c: rate(p.loc[x, f"share_{c}"]) for c in CAMPAIGN_IDS}}
                              for x in (60, 45, 30, 28, 14, 7, 2)}
    out["engagement"] = engagement_vs_show_up(r)
    out["adjusted_effects"] = adjusted_effects(r)
    out["headline"] = headline_derivations(f, r, data)
    out["weekday"] = weekday_effects(data, r)
    out["targets"] = targets_vs_actuals(data)
    # identified-not-registered by first-touch campaign
    ext = data.people[data.people.person_type == "external"]
    nr = ext[~ext.person_id.isin(data.registrations.person_id)]
    out["identified_not_registered_by_campaign"] = nr.first_campaign_id.fillna("walk_in").value_counts().to_dict()
    # last-two-weeks spend efficiency (registrations registered in each window)
    wk = weekly_campaign(data)
    out["weekly_campaign"] = json.loads(wk.assign(week=wk.week.astype(str)).to_json(orient="records"))
    DERIVED.mkdir(parents=True, exist_ok=True)
    (DERIVED / "report_numbers.json").write_text(json.dumps(out, indent=2, default=str) + "\n", encoding="utf-8")
    p.to_csv(DERIVED / "pace_table.csv", index=False)
    return out


if __name__ == "__main__":
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    o = main()
    data = load_data()
    print(funnel(data).round(4).T.to_string())
    for k in ["headline", "adjusted_effects", "show_up", "churn", "walkins", "pace_milestones", "engagement", "weekday", "targets", "identified_not_registered_by_campaign"]:
        print("=====", k)
        print(json.dumps(o[k], indent=1, default=str))
    print("===== spend_vs_budget")
    print(json.dumps(o["spend_vs_budget"], indent=1))
