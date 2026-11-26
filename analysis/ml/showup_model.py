"""(a) Show-up model: will a registered external person become a verified visitor?

    python analysis/ml/showup_model.py

Only information available by end of day T-1 (2025-04-11 IST) is used: registration
campaign, lead time, engagement counts, nurture-email behaviour and status history up
to T-1. Check-ins, post-event interactions and the free-text `detail` column (which
spells out some outcomes) are excluded.

Two set-ups:
  A. all 2,800 external registrants (status at T-1 is a feature);
  B. only registrants confirmed at T-1 (the people a reminder could still move).
Writes analysis/derived/showup_model.json and analysis/ml/showup_results.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from growth_analysis import ENGAGEMENT_TYPES, registrant_frame  # noqa: E402
from reference_metrics import ANALYSIS, CAMPAIGN_IDS, load_data  # noqa: E402

SEED = 42  # all CV splits and the boosting model use this seed
N_SPLITS, N_REPEATS = 5, 5
REMINDER_HEADROOM_CAPTURE = [0.10, 0.20]  # ASSUMPTION: a reminder recovers this share of (1 - p)


def build_features(r: pd.DataFrame) -> pd.DataFrame:
    X = pd.DataFrame(index=r.index)
    for c in CAMPAIGN_IDS[1:]:  # C01 is the reference level
        X[f"campaign_{c}"] = (r.campaign_id == c).astype(int)
    X["lead_days"] = r.lead_days
    X["days_seen_to_reg"] = r.days_seen_to_reg
    X["registered_weekend"] = r.registered_at.dt.day_of_week.isin([5, 6]).astype(int)
    for t in ENGAGEMENT_TYPES:
        X[t] = r[t]
    X["n_status_changes"] = r.n_status_changes
    X["ever_cancelled"] = r.ever_cancelled.astype(int)
    X["ever_waitlisted"] = r.ever_waitlisted.astype(int)
    X["reconfirmed"] = r.reconfirmed.astype(int)
    for s in ["cancelled", "waitlisted", "interested"]:  # confirmed is the reference level
        X[f"status_t1_{s}"] = (r.status_t1 == s).astype(int)
    return X


def models():
    lr = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=5000))
    gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=250,
                                        min_samples_leaf=30, l2_regularization=1.0, random_state=SEED)
    return {"logistic_regression": lr, "gradient_boosting": gb}


def evaluate(X: pd.DataFrame, y: pd.Series) -> dict:
    out = {}
    rskf = RepeatedStratifiedKFold(n_splits=N_SPLITS, n_repeats=N_REPEATS, random_state=SEED)
    skf = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=SEED)
    for name, m in models().items():
        auc = cross_val_score(m, X, y, cv=rskf, scoring="roc_auc")
        oof = cross_val_predict(m, X, y, cv=skf, method="predict_proba")[:, 1]
        frac_pos, mean_pred = calibration_curve(y, oof, n_bins=10, strategy="quantile")
        ece = float(np.mean(np.abs(frac_pos - mean_pred)))
        # permutation importance on held-out folds (AUC drop), averaged
        imps = []
        for tr, te in skf.split(X, y):
            mm = models()[name].fit(X.iloc[tr], y.iloc[tr])
            pi = permutation_importance(mm, X.iloc[te], y.iloc[te], scoring="roc_auc", n_repeats=10, random_state=SEED)
            imps.append(pi.importances_mean)
        imp = pd.Series(np.mean(imps, axis=0), index=X.columns).sort_values(ascending=False)
        out[name] = {
            "cv_auc_mean": round(float(auc.mean()), 4), "cv_auc_sd": round(float(auc.std()), 4),
            "oof_auc": round(float(roc_auc_score(y, oof)), 4),
            "oof_brier": round(float(brier_score_loss(y, oof)), 4),
            "brier_of_base_rate": round(float(brier_score_loss(y, np.full(len(y), y.mean()))), 4),
            "calibration_quantile_bins": [{"mean_predicted": round(float(p), 4), "observed": round(float(o), 4)}
                                          for p, o in zip(mean_pred, frac_pos)],
            "expected_calibration_error": round(ece, 4),
            "permutation_importance_auc_drop": {k: round(float(v), 4) for k, v in imp.head(10).items()},
            "_oof": oof,
        }
    return out


def lr_coefficients(X: pd.DataFrame, y: pd.Series) -> dict:
    m = models()["logistic_regression"].fit(X, y)
    sc, lr = m.named_steps["standardscaler"], m.named_steps["logisticregression"]
    coef_std = pd.Series(lr.coef_[0], index=X.columns)
    return {
        "features": list(X.columns),
        "scaler_mean": [round(float(v), 6) for v in sc.mean_],
        "scaler_scale": [round(float(v), 6) for v in sc.scale_],
        "coef_standardized": [round(float(v), 6) for v in lr.coef_[0]],
        "intercept": round(float(lr.intercept_[0]), 6),
        "odds_ratio_per_sd": {k: round(float(np.exp(v)), 3) for k, v in coef_std.sort_values(key=abs, ascending=False).items()},
    }


def reminder_lift(scored: pd.DataFrame) -> dict:
    """Targeted-reminder scenario on confirmed registrants. The uplift is an ASSUMPTION."""
    s = scored.copy()
    s["decile"] = pd.qcut(s.p.rank(method="first"), 10, labels=False) + 1  # 1 = lowest propensity
    by_dec = s.groupby("decile").agg(n=("p", "size"), mean_p=("p", "mean"), observed=("attended", "mean"))
    low = s[s.decile == 1]
    out = {"deciles": {int(k): {"n": int(v.n), "mean_predicted": round(float(v.mean_p), 4), "observed_show_up": round(float(v.observed), 4)}
                       for k, v in by_dec.iterrows()},
           "lowest_decile_n": int(len(low)),
           "lowest_decile_observed_no_shows": int((~low.attended).sum()),
           "scenarios": []}
    rng = np.random.default_rng(SEED)
    for k in REMINDER_HEADROOM_CAPTURE:
        targeted = float((k * (1 - low.p)).sum())
        rand = np.mean([float((k * (1 - s.sample(len(low), random_state=int(rng.integers(1e9))).p)).sum()) for _ in range(200)])
        out["scenarios"].append({
            "assumption": f"a reminder converts {int(k*100)}% of a person's no-show probability (1-p) into attendance",
            "extra_attendees_lowest_decile": round(targeted, 1),
            "extra_attendees_random_same_size": round(rand, 1),
            "targeting_multiplier": round(targeted / rand, 2),
        })
    return out


def main() -> dict:
    data = load_data()
    r = registrant_frame(data).reset_index(drop=True)
    y_all = r.attended.astype(int)
    X_all = build_features(r)
    # first-touch vs registration campaign mismatch: constant 0 in this data, so not usable
    mismatch = int((r.person_id.map(data.people.set_index("person_id").first_campaign_id) != r.campaign_id).sum())

    res: dict = {"seed": SEED, "cv": f"{N_SPLITS}-fold stratified x {N_REPEATS} repeats",
                 "feature_cutoff": "events strictly before 2025-04-12 00:00 IST (end of T-1)",
                 "first_touch_vs_registration_mismatch_count": mismatch,
                 "excluded": ["check-ins", "interactions on/after event day", "detail free text", "person name"]}

    # A: everyone
    evA = evaluate(X_all, y_all)
    res["A_all_registrants"] = {"n": len(r), "base_rate": round(float(y_all.mean()), 4),
                                **{k: {kk: vv for kk, vv in v.items() if kk != "_oof"} for k, v in evA.items()},
                                "status_t1_rule": r.groupby("status_t1").attended.agg(["size", "mean"]).round(4).to_dict("index")}

    # B: confirmed at T-1 only (status features are constant here and dropped)
    conf = r[r.status_t1 == "confirmed"].reset_index(drop=True)
    yB = conf.attended.astype(int)
    XB = build_features(conf).drop(columns=[c for c in X_all.columns if c.startswith("status_t1_")])
    XB = XB.loc[:, XB.nunique() > 1]
    evB = evaluate(XB, yB)
    coefB = lr_coefficients(XB, yB)
    res["B_confirmed_t1"] = {"n": len(conf), "base_rate": round(float(yB.mean()), 4),
                             **{k: {kk: vv for kk, vv in v.items() if kk != "_oof"} for k, v in evB.items()},
                             "lr_odds_ratio_per_sd": coefB["odds_ratio_per_sd"]}
    scored = conf[["registration_id", "person_id", "campaign_id", "lead_days", "attended"]].copy()
    scored["p"] = evB["logistic_regression"]["_oof"]
    res["B_confirmed_t1"]["reminder_lift"] = reminder_lift(scored)

    # export for the app: LR coefficients (set-up B) + out-of-fold scores for every registrant
    all_scores = r[["registration_id", "person_id", "campaign_id", "status_t1", "lead_days", "attended"]].copy()
    all_scores["p_showup"] = 0.0  # non-confirmed at T-1: observed show-up is 0 of 300
    all_scores.loc[all_scores.status_t1 == "confirmed", "p_showup"] = scored.set_index("registration_id").p.reindex(
        all_scores.loc[all_scores.status_t1 == "confirmed", "registration_id"]).values
    dec = pd.qcut(scored.p.rank(method="first"), 10, labels=False) + 1
    all_scores["decile_confirmed"] = all_scores.registration_id.map(dict(zip(scored.registration_id, dec)))
    export = {
        "description": "Show-up propensity for external registrants. Confirmed at T-1: out-of-fold logistic-regression "
                       "probability. Cancelled/waitlisted/interested at T-1: 0 (0 of 300 attended). MODEL ESTIMATE.",
        "as_of": "2025-04-11 23:59:59 IST (T-1)",
        "model": {"type": "logistic_regression_standardized", **coefB,
                  "scoring": "p = 1/(1+exp(-(intercept + sum(coef_i * (x_i - mean_i)/scale_i))))"},
        "cv_auc": {"A_all_registrants": {k: res["A_all_registrants"][k]["cv_auc_mean"] for k in evA},
                   "B_confirmed_t1": {k: res["B_confirmed_t1"][k]["cv_auc_mean"] for k in evB}},
        "reminder_lift": res["B_confirmed_t1"]["reminder_lift"],
        "scored_registrations": json.loads(all_scores.assign(p_showup=all_scores.p_showup.round(4),
                                                             attended=all_scores.attended.astype(int))
                                           .to_json(orient="records")),
    }
    (ANALYSIS / "derived" / "showup_model.json").write_text(json.dumps(export, indent=1) + "\n", encoding="utf-8")
    (ANALYSIS / "ml" / "showup_results.json").write_text(json.dumps(res, indent=2, default=str) + "\n", encoding="utf-8")
    return res


if __name__ == "__main__":
    print(json.dumps(main(), indent=1, default=str))
