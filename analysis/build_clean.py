"""Write deduped, typed CSVs to analysis/clean/ and the data-quality counts behind data_quality.md.

    python analysis/build_clean.py

Outputs
  analysis/clean/<table>.csv          one file per source tab, import copies removed, ISO timestamps (+05:30)
  analysis/clean/person_outcomes.csv  one row per person: scope, campaign, registration, status at T-1, visit
  analysis/derived/data_quality_counts.json
"""
from __future__ import annotations

import json

import pandas as pd

from reference_metrics import (ANALYSIS, DATETIME_COLS, EVENT_START, Data, end_of_day, load_data,
                               load_raw, status_as_of)

CLEAN = ANALYSIS / "clean"
DERIVED = ANALYSIS / "derived"
T_MINUS_1 = end_of_day("2025-04-11")  # last pre-event snapshot (exclusive bound)


def write_clean_csvs(data: Data) -> None:
    CLEAN.mkdir(parents=True, exist_ok=True)
    for name, df in data.tables.items():
        out = df.copy()
        for c in DATETIME_COLS.get(name, []):
            if name == "campaign_daily" or (name == "event" and c.startswith("history_")):
                out[c] = out[c].dt.strftime("%Y-%m-%d")
            else:
                out[c] = out[c].dt.strftime("%Y-%m-%dT%H:%M:%S+05:30")
        out.to_csv(CLEAN / f"{name}.csv", index=False)


def person_outcomes(data: Data) -> pd.DataFrame:
    p = data.people[["person_id", "person_type", "first_seen_at", "first_touch_source", "first_campaign_id"]].copy()
    r = data.registrations[["person_id", "registration_id", "registered_at", "campaign_id"]].rename(
        columns={"campaign_id": "registration_campaign_id"})
    p = p.merge(r, on="person_id", how="left")
    st = status_as_of(data, T_MINUS_1).set_index("registration_id").status
    p["status_at_t_minus_1"] = p.registration_id.map(st)
    c = data.checkins
    ok = c[(c.result == "admitted") & (c.verification == "verified")]
    first = ok.groupby("person_id").occurred_at.min()
    p["verified_visit"] = p.person_id.isin(ok.person_id)
    p["first_verified_at"] = p.person_id.map(first)
    p["walk_in"] = p.verified_visit & p.registration_id.isna()
    p["lead_time_days"] = (EVENT_START.normalize() - p.registered_at.dt.normalize()).dt.days
    for col in ["first_seen_at", "registered_at", "first_verified_at"]:
        p[col] = p[col].dt.strftime("%Y-%m-%dT%H:%M:%S+05:30")
    return p


def quality_counts(data: Data) -> dict:
    raw = load_raw()
    t = data.tables
    pe, rg, rh, ck, li, dm = (t["people"], t["registrations"], t["registration_history"], t["checkins"],
                              t["lead_interactions"], t["campaign_daily"])
    ptype = pe.set_index("person_id").person_type
    q: dict = {"dedupe": data.dedupe_log}

    # exact-copy check on the raw rows
    q["raw_exact_duplicate_rows"] = {k: int(v.duplicated().sum()) for k, v in raw.items()}

    q["people_by_type"] = pe.person_type.value_counts().to_dict()
    q["people_by_type_and_source"] = {f"{a}|{b}": int(n) for (a, b), n in pe.groupby(["person_type", "first_touch_source"]).size().items()}
    q["non_external_people"] = int((pe.person_type != "external").sum())
    rg_t = rg.person_id.map(ptype)
    q["registrations_by_person_type"] = rg_t.value_counts().to_dict()
    q["non_external_registrations_by_campaign"] = rg[rg_t != "external"].campaign_id.value_counts().to_dict()

    ck_t = ck.person_id.map(ptype)
    ok = (ck.result == "admitted") & (ck.verification == "verified")
    q["checkin_rows_by_result_verification"] = {f"{a}|{b}": int(n) for (a, b), n in ck.groupby(["result", "verification"]).size().items()}
    q["checkin_rows_not_verified_admission"] = int((~ok).sum())
    q["checkin_people_all_ids"] = int(ck.person_id.nunique())
    q["verified_people_by_type"] = ck[ok].groupby(ck_t[ok]).person_id.nunique().to_dict()
    bad = ck[~ok]
    vp = set(ck[ok].person_id)
    q["denied_rows"] = int((ck.result == "denied").sum())
    q["denied_people_later_verified"] = int(bad[bad.result == "denied"].person_id.isin(vp).sum())
    q["pending_unverified_rows"] = int((ck.result == "pending").sum())
    q["pending_people_later_verified"] = int(bad[bad.result == "pending"].person_id.isin(vp).sum())
    q["external_people_with_only_unverified_denied_pending"] = int(len(set(bad.person_id) - vp))
    q["denied_timestamps"] = sorted(bad[bad.result == "denied"].occurred_at.astype(str).unique().tolist())
    q["pending_timestamps"] = sorted(bad[bad.result == "pending"].occurred_at.astype(str).unique().tolist())
    ev = ck[ok & (ck_t == "external")]
    q["external_verified_events"] = int(len(ev))
    q["external_verified_people"] = int(ev.person_id.nunique())
    q["verified_events_per_person"] = ev.groupby("person_id").size().value_counts().sort_index().to_dict()
    q["verified_days_per_person"] = ev.groupby("person_id").occurred_at.apply(lambda s: s.dt.date.nunique()).value_counts().to_dict()
    src = ev.groupby("person_id").source.agg(lambda s: "+".join(sorted(set(s))))
    q["verified_source_mix_per_person"] = src.value_counts().to_dict()
    q["walkin_checkin_rows_no_registration"] = int(ev.registration_id.isna().sum())
    m = ck.dropna(subset=["registration_id"]).merge(rg[["registration_id", "person_id", "campaign_id"]], on="registration_id", suffixes=("", "_rg"))
    q["checkin_registration_person_mismatch"] = int((m.person_id != m.person_id_rg).sum())
    q["checkin_registration_campaign_mismatch"] = int((m.campaign_id != m.campaign_id_rg).sum())

    neg = dm[dm.marketing_spend_inr < 0]
    q["negative_spend_rows"] = neg[["activity_id", "activity_date", "campaign_id", "platform", "marketing_spend_inr"]].astype(str).to_dict("records")
    q["negative_spend_total_inr"] = int(neg.marketing_spend_inr.sum())
    q["daily_rows_zero_spend"] = int((dm.marketing_spend_inr == 0).sum())
    q["daily_rows_positive_spend"] = int((dm.marketing_spend_inr > 0).sum())
    q["daily_rows"] = int(len(dm))
    q["spend_total_inr"] = int(dm.marketing_spend_inr.sum())
    q["spend_through_2025_04_11_inr"] = int(dm[dm.activity_date <= "2025-04-11"].marketing_spend_inr.sum())
    q["reported_reach_sum_not_unique"] = int(dm.reported_reach.sum())
    q["daily_platform_counts"] = dm.platform.value_counts().to_dict()
    cmp = t["campaigns"].set_index("campaign_id")
    first_day = dm[dm.platform != "marketing ledger adjustment"].groupby("campaign_id").activity_date.agg(["min", "max"])
    q["daily_coverage_vs_plan"] = {c: {"first_activity": str(first_day.loc[c, "min"].date()), "last_activity": str(first_day.loc[c, "max"].date()),
                                       "planned_start": str(cmp.loc[c, "planned_start_at"].date()), "planned_end": str(cmp.loc[c, "planned_end_at"].date())}
                                   for c in first_day.index}

    seq = rh.sort_values(["registration_id", "effective_at"]).groupby("registration_id").status.agg(">".join)
    q["status_sequences"] = seq.value_counts().to_dict()
    q["history_ties_same_timestamp"] = int(rh.duplicated(["registration_id", "effective_at"]).sum())
    h0 = rh.groupby("registration_id").effective_at.min()
    q["first_history_not_at_registered_at"] = int((rg.set_index("registration_id").registered_at != h0).sum())
    q["history_after_event_start"] = int((rh.effective_at >= EVENT_START).sum())

    li_t = li.person_id.map(ptype)
    q["interactions_by_person_type"] = li_t.value_counts().to_dict()
    q["interactions_after_event_start"] = int((li.occurred_at >= EVENT_START).sum())
    lr = li.merge(rg[["person_id", "registered_at"]], on="person_id", how="left")
    q["interactions_after_registration_by_type"] = lr[lr.occurred_at > lr.registered_at].event_type.value_counts().to_dict()
    q["identified_registration_starts"] = int((li.event_type == "registration_start").sum())
    q["identified_registration_starts_without_registration"] = int(((li.event_type == "registration_start") & ~li.person_id.isin(rg.person_id)).sum())
    q["anonymous_registration_starts"] = int(dm.registration_starts.sum())
    q["detail_text_encodes_outcome_rows"] = int(li.detail.str.contains("no completed registration|No registration completion|without a recorded registration", case=False).sum())
    pr = rg.merge(pe[["person_id", "first_campaign_id", "first_seen_at"]], on="person_id")
    q["first_touch_ne_registration_campaign"] = int((pr.first_campaign_id != pr.campaign_id).sum())
    q["first_seen_after_registered"] = int((pr.first_seen_at > pr.registered_at).sum())
    q["people_never_registered_external"] = int(((pe.person_type == "external") & ~pe.person_id.isin(rg.person_id)).sum())
    q["person_name_unique_vs_ids"] = [int(pe.person_name.nunique()), int(pe.person_id.nunique())]
    q["registered_at_hours"] = rg.registered_at.dt.hour.value_counts().to_dict()
    q["first_seen_at_hours"] = pe.first_seen_at.dt.hour.value_counts().to_dict()
    return q


if __name__ == "__main__":
    data = load_data()
    write_clean_csvs(data)
    person_outcomes(data).to_csv(CLEAN / "person_outcomes.csv", index=False)
    DERIVED.mkdir(parents=True, exist_ok=True)
    q = quality_counts(data)
    (DERIVED / "data_quality_counts.json").write_text(json.dumps(q, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(q, indent=1, default=str))
