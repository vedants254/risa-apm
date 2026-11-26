"""Reference implementation of the CampusFest 2025 attendee-growth metrics (SPEC.md).

This module is the single Python source of truth for every number the deck,
dashboard and copilot report. The TypeScript metrics module (`app/lib/metrics.ts`)
is tested against `analysis/golden_metrics.json`, which this module writes.

Usage
-----
    from reference_metrics import load_data, snapshot
    data = load_data()                       # raw xlsx -> deduped, typed tables
    m = snapshot(data, "2025-04-13")         # all metrics as of end of day IST
    m_c02 = snapshot(data, "2025-04-13", campaign_id="C02")

    python analysis/reference_metrics.py     # writes golden_metrics.json

Conventions (see metric_definitions.md for the evidence behind each one)
------------------------------------------------------------------------
* Source timestamps are naive in the xlsx and are read as Asia/Kolkata wall time.
  Snapshot D means "record timestamp <= D 23:59:59.999999 IST", implemented as
  `ts < D + 1 day 00:00`.
* Import copies (same stable ID) count once. Duplicated IDs are verified to be
  byte-identical copies before they are dropped; a conflicting copy raises.
* Only person_type == "external" counts towards any goal metric.
* A verified visit is a check-in with result == "admitted" AND
  verification == "verified".
* Rounding: INR to integers, rates to 4 decimals, both "half up towards +inf"
  on the IEEE double value, i.e. identical to JavaScript
  `Math.round(x)` and `Math.round(x * 1e4) / 1e4`.
"""
from __future__ import annotations

import json
import math
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "dataset" / "Attendee_Dataset.xlsx"
ANALYSIS = ROOT / "analysis"

EVENT_START = pd.Timestamp("2025-04-12 10:00:00")  # IST, from the Event tab
GOLDEN_DATES = ["2025-02-15", "2025-03-14", "2025-03-15", "2025-04-11", "2025-04-13", "2025-04-20"]
STATUSES = ["interested", "confirmed", "cancelled", "waitlisted"]
CAMPAIGN_IDS = ["C01", "C02", "C03", "C04", "C05", "C06", "C07"]

# xlsx tab -> canonical table name (matches the *.csv names in the Field guide)
SHEETS = {
    "Event": "event",
    "Targets": "targets",
    "Campaigns": "campaigns",
    "Daily Marketing": "campaign_daily",
    "People": "people",
    "Interest and Engagement": "lead_interactions",
    "Registrations": "registrations",
    "Registration History": "registration_history",
    "Check-ins": "checkins",
}
# Stable ID per table. Repeated IDs are import copies and count once.
STABLE_IDS = {
    "targets": "target_version",
    "campaigns": "campaign_id",
    "campaign_daily": "activity_id",
    "people": "person_id",
    "lead_interactions": "interaction_id",
    "registrations": "registration_id",
    "registration_history": "history_id",
    "checkins": "event_id",
}
DATETIME_COLS = {
    "event": ["history_start", "history_end", "event_starts_at", "event_ends_at"],
    "targets": ["effective_at"],
    "campaigns": ["created_at", "planned_start_at", "planned_end_at"],
    "campaign_daily": ["activity_date"],
    "people": ["first_seen_at"],
    "lead_interactions": ["occurred_at"],
    "registrations": ["registered_at"],
    "registration_history": ["effective_at"],
    "checkins": ["occurred_at"],
}
INT_COLS = {
    "targets": ["identified_external_people_goal", "registration_goal",
                "unique_external_visitors_goal", "marketing_budget_inr"],
    "campaign_daily": ["impressions", "clicks", "reported_reach", "landing_page_sessions",
                       "registration_starts", "marketing_spend_inr"],
}


# --------------------------------------------------------------------------- rounding
def round_half_up(x: float | None, ndigits: int = 0) -> float | int | None:
    """Round like JavaScript Math.round on x * 10**ndigits (ties go towards +inf)."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    scale = 10 ** ndigits
    y = x * scale
    r = math.floor(y)
    if y - r >= 0.5:
        r += 1
    return int(r) if ndigits == 0 else r / scale


def inr(x: float | None) -> int | None:
    return round_half_up(x, 0)


def rate(x: float | None) -> float | None:
    return round_half_up(x, 4)


def safe_div(num: float, den: float) -> float | None:
    return None if den == 0 else num / den


# --------------------------------------------------------------------------- loading
@dataclass
class Data:
    """Deduped, typed tables plus the dedupe log used by data_quality.md."""

    tables: dict[str, pd.DataFrame]
    dedupe_log: dict[str, dict[str, int]]

    def __getattr__(self, name: str) -> pd.DataFrame:  # data.people, data.checkins, ...
        try:
            return self.tables[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def load_raw(path: Path = DATASET) -> dict[str, pd.DataFrame]:
    """Read every data tab exactly as stored (the file is never modified)."""
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found at {path}")
    # openpyxl parsing takes over a minute; cache the raw frames keyed on file size + mtime
    stat = path.stat()
    cache = ANALYSIS / ".cache" / f"raw_{stat.st_size}_{int(stat.st_mtime)}.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    out = {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for sheet, name in SHEETS.items():
            out[name] = pd.read_excel(path, sheet_name=sheet)
    cache.parent.mkdir(parents=True, exist_ok=True)
    pd.to_pickle(out, cache)
    return out


def _dedupe(df: pd.DataFrame, key: str, table: str) -> tuple[pd.DataFrame, int]:
    dup_key = df.duplicated(key, keep=False)
    if dup_key.any():
        copies = df[dup_key]
        # every repeated ID must be an exact copy; otherwise the "import copy" rule is unsafe
        n_distinct = copies.astype(str).drop_duplicates().groupby(key).size()
        conflicting = n_distinct[n_distinct > 1]
        if len(conflicting):
            raise ValueError(f"{table}: IDs repeated with different content: {list(conflicting.index)[:10]}")
    removed = int(df.duplicated(key).sum())
    return df.drop_duplicates(key, keep="first").reset_index(drop=True), removed


def clean(raw: dict[str, pd.DataFrame]) -> Data:
    tables: dict[str, pd.DataFrame] = {}
    log: dict[str, dict[str, int]] = {}
    for name, df in raw.items():
        df = df.copy()
        for c in df.columns:
            if df[c].dtype == object or str(df[c].dtype).startswith(("str", "string")):
                df[c] = df[c].astype("string").str.strip()
        for c in DATETIME_COLS.get(name, []):
            df[c] = pd.to_datetime(df[c])
        for c in INT_COLS.get(name, []):
            df[c] = df[c].astype("int64")
        rows_in = len(df)
        removed = 0
        if name in STABLE_IDS:
            df, removed = _dedupe(df, STABLE_IDS[name], name)
        tables[name] = df
        log[name] = {"rows_raw": rows_in, "duplicate_rows_removed": removed, "rows_clean": len(df)}
    return Data(tables=tables, dedupe_log=log)


def load_data(path: Path = DATASET) -> Data:
    return clean(load_raw(path))


# --------------------------------------------------------------------------- helpers
def end_of_day(d: str | pd.Timestamp) -> pd.Timestamp:
    """Exclusive upper bound: records with ts < this are 'at or before D 23:59:59 IST'."""
    return pd.Timestamp(d).normalize() + pd.Timedelta(days=1)


def external_ids(data: Data) -> set[str]:
    p = data.people
    return set(p.loc[p.person_type == "external", "person_id"])


def status_as_of(data: Data, cutoff_exclusive: pd.Timestamp) -> pd.DataFrame:
    """Latest registration-history version per registration_id with effective_at < cutoff."""
    h = data.registration_history
    h = h[h.effective_at < cutoff_exclusive].sort_values(["registration_id", "effective_at", "history_id"])
    return h.groupby("registration_id", as_index=False).tail(1)[["registration_id", "person_id", "campaign_id", "status", "effective_at"]]


def verified_checkins(data: Data, cutoff_exclusive: pd.Timestamp) -> pd.DataFrame:
    c = data.checkins
    ok = (c.result == "admitted") & (c.verification == "verified") & (c.occurred_at < cutoff_exclusive)
    return c[ok & c.person_id.isin(external_ids(data))]


# --------------------------------------------------------------------------- metrics
def snapshot(data: Data, d: str, campaign_id: str | None = None) -> dict[str, Any]:
    """All SPEC metrics as of end of day `d` (IST), optionally filtered to one campaign.

    With a campaign filter: identified people use first-touch (people.first_campaign_id);
    registrations, statuses and visitors use the registration's campaign_id; anonymous
    funnel and spend use campaign_daily.campaign_id; walk-ins are 0 by definition.
    """
    cut = end_of_day(d)
    ext = external_ids(data)

    people = data.people[(data.people.person_type == "external") & (data.people.first_seen_at < cut)]
    regs = data.registrations[data.registrations.person_id.isin(ext) & (data.registrations.registered_at < cut)]
    daily = data.campaign_daily[data.campaign_daily.activity_date < cut]
    if campaign_id is not None:
        people = people[people.first_campaign_id == campaign_id]
        regs = regs[regs.campaign_id == campaign_id]
        daily = daily[daily.campaign_id == campaign_id]

    st = status_as_of(data, cut)
    st = st[st.registration_id.isin(regs.registration_id)]
    status_counts = {s: int((st.status == s).sum()) for s in STATUSES}

    vis = verified_checkins(data, cut)
    registered_people = set(regs.person_id)
    all_registered_ext = set(
        data.registrations.loc[data.registrations.person_id.isin(ext) & (data.registrations.registered_at < cut), "person_id"])
    if campaign_id is None:
        visitors = set(vis.person_id)
        walkins = visitors - all_registered_ext
    else:
        visitors = set(vis.person_id) & registered_people
        walkins = set()
    visitors_registered = visitors & registered_people

    # confirmed as of event start (or as of D if D is earlier), for the second show-up ratio
    st_event = status_as_of(data, min(cut, EVENT_START))
    confirmed_people = set(st_event.loc[st_event.status == "confirmed", "person_id"]) & registered_people

    spend = int(daily.marketing_spend_inr.sum())
    targets = data.targets[data.targets.effective_at < cut].sort_values("effective_at")
    tgt = None
    if len(targets):
        t = targets.iloc[-1]
        tgt = {
            "version": str(t.target_version),
            "identified_external_people_goal": int(t.identified_external_people_goal),
            "registration_goal": int(t.registration_goal),
            "unique_external_visitors_goal": int(t.unique_external_visitors_goal),
            "marketing_budget_inr": int(t.marketing_budget_inr),
        }

    n_reg = len(registered_people)
    return {
        "identified_external": int(people.person_id.nunique()),
        "registered_external": n_reg,
        "status_counts": status_counts,
        "verified_visitors": len(visitors),
        "verified_visitors_registered": len(visitors_registered),
        "verified_walkins": len(walkins),
        "marketing_spend_inr": spend,
        "impressions": int(daily.impressions.sum()),
        "clicks": int(daily.clicks.sum()),
        "landing_page_sessions": int(daily.landing_page_sessions.sum()),
        "registration_starts": int(daily.registration_starts.sum()),
        "targets": tgt,
        # derived ratios (same rules as by_campaign)
        "show_up_rate": rate(safe_div(len(visitors_registered), n_reg)),
        "confirmed_at_event_start": len(confirmed_people),
        "show_up_rate_vs_confirmed": rate(safe_div(len(visitors_registered & confirmed_people), len(confirmed_people))),
        "cac_per_visitor_inr": inr(safe_div(spend, len(visitors))),
        "cac_per_registration_inr": inr(safe_div(spend, n_reg)),
    }


def campaign_block(data: Data, d: str, campaign_id: str) -> dict[str, Any]:
    s = snapshot(data, d, campaign_id)
    return {
        "spend_inr": s["marketing_spend_inr"],
        "impressions": s["impressions"],
        "clicks": s["clicks"],
        "landing_page_sessions": s["landing_page_sessions"],
        "registration_starts": s["registration_starts"],
        "identified_external": s["identified_external"],
        "registered_external": s["registered_external"],
        "verified_visitors": s["verified_visitors"],
        "cac_per_visitor_inr": s["cac_per_visitor_inr"],
        "cac_per_registration_inr": s["cac_per_registration_inr"],
        "show_up_rate": s["show_up_rate"],
    }


GOLDEN_TOTAL_KEYS = [
    "identified_external", "registered_external", "status_counts", "verified_visitors",
    "verified_visitors_registered", "verified_walkins", "marketing_spend_inr", "impressions",
    "clicks", "landing_page_sessions", "registration_starts", "targets",
]
GOLDEN_DERIVED_KEYS = [
    "show_up_rate", "confirmed_at_event_start", "show_up_rate_vs_confirmed",
    "cac_per_visitor_inr", "cac_per_registration_inr",
]


def golden(data: Data, dates: list[str] = GOLDEN_DATES) -> dict[str, Any]:
    snaps = {}
    for d in dates:
        s = snapshot(data, d)
        block = {k: s[k] for k in GOLDEN_TOTAL_KEYS}
        block["derived"] = {k: s[k] for k in GOLDEN_DERIVED_KEYS}
        block["by_campaign"] = {c: campaign_block(data, d, c) for c in CAMPAIGN_IDS}
        snaps[d] = block
    return {
        "meta": {
            "source": "dataset/Attendee_Dataset.xlsx",
            "generator": "analysis/reference_metrics.py",
            "definitions": "analysis/metric_definitions.md",
            "timezone": "Asia/Kolkata; source timestamps are naive IST wall time",
            "snapshot_rule": "record counts if timestamp < (D + 1 day) 00:00 IST",
            "event_starts_at": "2025-04-12T10:00:00+05:30",
            "rounding": "INR: Math.round(x); rates: Math.round(x*1e4)/1e4; null when the denominator is 0",
            "attribution": "identified_external by people.first_campaign_id; registrations, statuses and visitors by registrations.campaign_id",
            "dedupe_rows_removed": {k: v["duplicate_rows_removed"] for k, v in data.dedupe_log.items()},
        },
        "snapshots": snaps,
    }


def _self_check(data: Data, g: dict[str, Any]) -> None:
    """Invariants that must hold for every snapshot."""
    for d, s in g["snapshots"].items():
        bc = s["by_campaign"]
        assert sum(s["status_counts"].values()) == s["registered_external"], d
        assert s["verified_visitors"] == s["verified_visitors_registered"] + s["verified_walkins"], d
        assert sum(v["spend_inr"] for v in bc.values()) == s["marketing_spend_inr"], d
        assert sum(v["registered_external"] for v in bc.values()) == s["registered_external"], d
        assert sum(v["verified_visitors"] for v in bc.values()) == s["verified_visitors_registered"], d
        for k in ["impressions", "clicks", "landing_page_sessions", "registration_starts"]:
            assert sum(v[k] for v in bc.values()) == s[k], (d, k)
        # first-touch identified + unattributed (walk-ins) = total identified
        assert sum(v["identified_external"] for v in bc.values()) <= s["identified_external"], d


if __name__ == "__main__":
    data = load_data()
    g = golden(data)
    _self_check(data, g)
    out = ANALYSIS / "golden_metrics.json"
    out.write_text(json.dumps(g, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    for d, s in g["snapshots"].items():
        print(d, {k: s[k] for k in ["identified_external", "registered_external", "verified_visitors",
                                    "verified_walkins", "marketing_spend_inr"]}, s["status_counts"], s["targets"]["version"])
