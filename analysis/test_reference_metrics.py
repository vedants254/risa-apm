"""Regression checks for the reference metrics. Runs with pytest or plain python:

    python analysis/test_reference_metrics.py
"""
from __future__ import annotations

import json

from reference_metrics import ANALYSIS, golden, load_data, round_half_up, snapshot

DATA = load_data()


def test_rounding_matches_javascript_math_round() -> None:
    assert round_half_up(2.5) == 3 and round_half_up(-2.5) == -2 and round_half_up(0.49999999999999994) == 0
    assert round_half_up(1925 / 2800, 4) == 0.6875 and round_half_up(274000 / 2050) == 134
    assert round_half_up(None) is None


def test_golden_file_is_reproducible() -> None:
    on_disk = json.loads((ANALYSIS / "golden_metrics.json").read_text(encoding="utf-8"))
    assert json.loads(json.dumps(golden(DATA))) == on_disk


def test_known_final_values() -> None:
    s = snapshot(DATA, "2025-04-20")
    assert (s["identified_external"], s["registered_external"], s["verified_visitors"], s["verified_walkins"]) == (3625, 2800, 2050, 125)
    assert s["marketing_spend_inr"] == 274000 and snapshot(DATA, "2025-04-13")["marketing_spend_inr"] == 276500
    assert s["status_counts"] == {"interested": 29, "confirmed": 2500, "cancelled": 183, "waitlisted": 88}


def test_target_version_switches_on_15_march() -> None:
    assert snapshot(DATA, "2025-03-14")["targets"]["version"] == "Attendee launch plan"
    assert snapshot(DATA, "2025-03-15")["targets"]["version"] == "Attendee revised plan"


def test_no_future_leakage() -> None:
    s = snapshot(DATA, "2025-04-11")
    assert s["verified_visitors"] == 0 and s["identified_external"] == 3500  # walk-ins are first seen on event days
    assert snapshot(DATA, "2025-01-19")["registered_external"] == 0


def test_dedupe_counts() -> None:
    removed = {k: v["duplicate_rows_removed"] for k, v in DATA.dedupe_log.items() if v["duplicate_rows_removed"]}
    assert removed == {"campaign_daily": 2, "registration_history": 4, "checkins": 20}


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
