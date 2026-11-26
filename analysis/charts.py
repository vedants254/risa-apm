"""Charts for report.md, drawn from the same functions and JSON as the report.

    python analysis/charts.py      (run growth_analysis.py and ml/*.py first)

PNG, 1600 px wide (16 in x 100 dpi), light surface, one hue per series, no dual axes.
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from growth_analysis import funnel, registrant_frame, spend_vs_budget  # noqa: E402
from reference_metrics import ANALYSIS, CAMPAIGN_IDS, load_data  # noqa: E402

OUT = ANALYSIS / "charts"
DER = ANALYSIS / "derived"
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3de"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
NEUTRAL = "#b9b8b1"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "font.size": 13, "axes.titlesize": 16, "axes.titleweight": "bold",
    "axes.titlelocation": "left", "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "legend.frameon": False,
})


def save(fig, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / name, dpi=100)
    plt.close(fig)


def fmt(n: float) -> str:
    return f"{n:,.0f}"


def chart_funnel(f, names) -> None:
    a = f.loc["ALL"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7.5), gridspec_kw={"width_ratios": [1, 1]})
    anon = [("Impressions", a.impressions), ("Clicks", a.clicks), ("Landing-page sessions", a.landing_page_sessions),
            ("Registration starts", a.registration_starts)]
    ppl = [("Identified external people", a.identified_external), ("Registered", a.registered_external),
           ("Confirmed at T-1", a.confirmed_t1), ("Attended (registered)", a.attended_registered)]
    for ax, rows, title, color in [(ax1, anon, "Anonymous events (counts, not people)", NEUTRAL),
                                   (ax2, ppl, "Identified external people", BLUE)]:
        labels = [r[0] for r in rows][::-1]
        vals = [r[1] for r in rows][::-1]
        y = np.arange(len(rows))
        ax.barh(y, vals, color=color, height=0.62)
        ax.set_yticks(y, labels)
        ax.set_xscale("log" if ax is ax1 else "linear")
        ax.grid(axis="y", visible=False)
        ax.set_title(title)
        for i, v in enumerate(vals):
            prev = vals[i + 1] if i + 1 < len(vals) else None
            conv = f"   {v / prev:.1%} of previous" if prev else ""
            ax.text(v, i, f"  {fmt(v)}{conv}", va="center", color=INK, fontsize=12)
        ax.set_xlim(right=max(vals) * (30 if ax is ax1 else 1.75))
    ax1.set_xlabel("events, log scale")
    ax2.set_xlabel("people")
    ax2.text(0.98, 0.02, f"+ {int(a.walkins)} verified walk-ins (no registration)\n= {int(a.attended_registered + a.walkins):,} verified external visitors",
             color=INK2, fontsize=12, ha="right", va="bottom", transform=ax2.transAxes)
    fig.suptitle("CampusFest 2025 attendee funnel (final, 20 Apr 2025)", x=0.01, ha="left", fontsize=19, fontweight="bold")
    fig.tight_layout(rect=(0, 0.03, 1, 0.95))
    save(fig, "funnel.png")


def chart_cac(f, names) -> None:
    c = f.drop(index="ALL")
    fig, axes = plt.subplots(1, 2, figsize=(16, 7))
    for ax, col, title, overall in [(axes[0], "cac_per_attendee", "Spend per registered attendee (INR)", f.loc["ALL", "spend_inr"] / f.loc["ALL", "attended_registered"]),
                                    (axes[1], "cac_per_registration", "Spend per registration (INR)", f.loc["ALL", "cac_per_registration"])]:
        s = c[col].sort_values()
        y = np.arange(len(s))
        ax.barh(y, s.values, color=BLUE, height=0.62)
        ax.set_yticks(y, [names[i] for i in s.index])
        ax.grid(axis="y", visible=False)
        for i, v in enumerate(s.values):
            ax.text(v, i, f"  {v:,.0f}", va="center", fontsize=12)
        ax.axvline(overall, color=INK2, linestyle="--", linewidth=1.2)
        ax.text(overall, -0.85, f" all campaigns {overall:,.0f}", color=INK2, fontsize=11, va="center")
        ax.set_ylim(-1.2, len(s) - 0.5)
        ax.set_title(title)
        ax.set_xlim(right=s.max() * 1.2)
    fig.suptitle("CAC by registration campaign (spend net of credits, 20 Apr 2025)", x=0.01, ha="left", fontsize=19, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    save(fig, "cac_by_campaign.png")


def chart_pace() -> None:
    pc = json.loads((DER / "pace_curve.json").read_text())
    cur = pc["curve"]
    x = np.array([p["days_to_event"] for p in cur])
    regs = np.array([p["cum_registrations"] for p in cur])
    sh = np.array([p["share_of_final"] for p in cur])
    lo = np.array([p["share_p10"] for p in cur])
    hi = np.array([p["share_p90"] for p in cur])
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7))
    ax1.plot(x, regs, color=BLUE, linewidth=2.2)
    for goal, lab in [(2800, "launch goal 2,800"), (3200, "revised goal 3,200 (from 15 Mar)")]:
        ax1.axhline(goal, color=INK2, linestyle="--", linewidth=1)
        ax1.text(82, goal + 40, lab, color=INK2, fontsize=11)
    ax1.axvline(28, color=GRID, linewidth=1.5)
    ax1.text(28, 300, "  plan revised\n  (T-28)", color=INK2, fontsize=11)
    ax1.set_title("Cumulative external registrations")
    ax1.set_ylim(0, 3500)
    ax2.fill_between(x, lo, hi, color=BLUE, alpha=0.15, linewidth=0, label="10th-90th pct across campaigns (bootstrap)")
    ax2.plot(x, sh, color=BLUE, linewidth=2.2, label="share of final registrations")
    for t in (30, 14, 7):
        ax2.plot([t], [sh[t]], "o", color=BLUE, markersize=9, markeredgecolor=SURFACE, markeredgewidth=2)
        ax2.annotate(f"T-{t}: {sh[t]:.0%}", (t, sh[t]), textcoords="offset points", xytext=(-10, 12), ha="right", fontsize=12)
    ax2.set_title("Share of final registrations reached")
    ax2.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0))
    ax2.legend(loc="upper left")
    for ax in (ax1, ax2):
        ax.set_xlim(84, 0)
        ax.set_xlabel("days before the event (12 Apr 2025)")
    fig.suptitle("Registration pace: 47% of registrations arrived in the last 30 days", x=0.01, ha="left", fontsize=19, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    save(fig, "pace_curve.png")


def chart_lead(rn) -> None:
    a = rn["show_up"]["by_lead_bucket"]
    c = rn["show_up"]["by_lead_bucket_confirmed_only"]
    labels = list(a.keys())
    xx = np.arange(len(labels))
    w = 0.38
    fig, ax = plt.subplots(figsize=(16, 7))
    b1 = ax.bar(xx - w / 2 - 0.01, [a[k]["show_up_rate"] for k in labels], w, color=BLUE, label="all external registrants")
    b2 = ax.bar(xx + w / 2 + 0.01, [c[k]["show_up_rate"] for k in labels], w, color=ORANGE, label="confirmed at T-1 only")
    for bars, src in [(b1, a), (b2, c)]:
        for bar, k in zip(bars, labels):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01, f"{src[k]['show_up_rate']:.0%}\nn={src[k]['registered']}",
                    ha="center", fontsize=11, color=INK)
    ax.set_xticks(xx, labels)
    ax.set_xlabel("registration lead time (days before 12 Apr)")
    ax.set_ylim(0, 1.05)
    ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0))
    ax.grid(axis="x", visible=False)
    ax.legend(loc="upper right", ncol=2)
    ax.set_title("Show-up rate by registration lead time (verified admission)", fontsize=19)
    fig.tight_layout()
    save(fig, "showup_by_lead_time.png")


def chart_engagement(rn) -> None:
    e = rn["engagement"]["confirmed_t1"]
    keys = ["brochure_download", "event_question_submitted", "nurture_email_sent", "nurture_email_opened",
            "nurture_email_clicked", "opted_out"]
    lab = ["Brochure download", "Question submitted", "Nurture email sent", "Nurture email opened",
           "Nurture email clicked", "Opted out of nurture"]
    y = np.arange(len(keys))[::-1]
    fig, ax = plt.subplots(figsize=(16, 7))
    for yi, k in zip(y, keys):
        wv, wo = e[k]["with_show_up"], e[k]["without_show_up"]
        ax.plot([wo, wv], [yi, yi], color=GRID, linewidth=3, zorder=1)
        ax.scatter([wo], [yi], s=130, color=NEUTRAL, zorder=2, edgecolor=SURFACE, linewidth=2)
        ax.scatter([wv], [yi], s=130, color=BLUE, zorder=3, edgecolor=SURFACE, linewidth=2)
        ax.text(max(wv, wo) + 0.012, yi, f"{wv:.1%} with (n={e[k]['with_n']})  vs  {wo:.1%} without   ({(wv - wo) * 100:+.1f} pp)",
                va="center", fontsize=12)
    ax.scatter([], [], s=130, color=BLUE, label="did it")
    ax.scatter([], [], s=130, color=NEUTRAL, label="did not")
    ax.set_yticks(y, lab)
    ax.set_xlim(0.65, 1.0)
    ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0))
    ax.grid(axis="y", visible=False)
    ax.legend(loc="lower right", ncol=2)
    ax.set_xlabel("show-up rate among registrants confirmed at T-1 (n=2,500)")
    adj = rn["adjusted_effects"]
    ax.set_title("Engagement vs show-up (raw). Within the same campaign the brochure gap shrinks to "
                 f"{adj['brochure_gap_weighted_pp']:+.1f} pp (p={adj['logit_confirmed_t1']['brochure']['p_value']:.2f})", fontsize=16)
    fig.tight_layout()
    save(fig, "engagement_vs_showup.png")


def chart_spend_budget(data) -> None:
    sb = spend_vs_budget(data)
    fig, ax = plt.subplots(figsize=(16, 6.5))
    ax.plot(sb.index, sb.cum_spend_inr, color=BLUE, linewidth=2.2, label="cumulative net spend")
    ax.step(sb.index, sb.budget_inr, where="post", color=INK2, linestyle="--", linewidth=1.3, label="approved budget (target version)")
    for d, lab in [("2025-03-14", "14 Mar: 79% of launch budget used,\n54% of launch registration goal"),
                   ("2025-04-11", "T-1: 276,500 (92% of 300,000)")]:
        v = sb.loc[d, "cum_spend_inr"]
        ax.plot([np.datetime64(d)], [v], "o", color=BLUE, markersize=8)
        ax.annotate(lab, (np.datetime64(d), v), textcoords="offset points", xytext=(-12, 14), ha="right", fontsize=11)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v / 1000:,.0f}k"))
    ax.set_ylabel("INR")
    ax.legend(loc="upper left")
    ax.set_title("Marketing spend vs approved budget (net of credits)", fontsize=19)
    fig.tight_layout()
    save(fig, "spend_vs_budget.png")


def chart_channel_efficiency(names) -> None:
    cr = json.loads((DER / "channel_response.json").read_text())["per_campaign"]
    order = sorted(CAMPAIGN_IDS, key=lambda c: cr[c]["late"]["registrations_per_1k_inr"])
    y = np.arange(len(order))
    h = 0.38
    fig, ax = plt.subplots(figsize=(16, 7))
    e = [cr[c]["early"]["registrations_per_1k_inr"] for c in order]
    l = [cr[c]["late"]["registrations_per_1k_inr"] for c in order]
    ax.barh(y + h / 2 + 0.01, e, h, color=NEUTRAL, label="20 Jan - 14 Mar")
    ax.barh(y - h / 2 - 0.01, l, h, color=BLUE, label="15 Mar - 11 Apr")
    for i, (a, b) in enumerate(zip(e, l)):
        ax.text(a, i + h / 2, f"  {a:.1f}", va="center", fontsize=11, color=INK2)
        ax.text(b, i - h / 2, f"  {b:.1f}  ({b / a:.1f}x)", va="center", fontsize=11)
    ax.set_yticks(y, [names[c] for c in order])
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("registrations per INR 1,000 of spend in the window")
    ax.legend(loc="lower right")
    ax.set_title("Spend efficiency early vs late: Paid Social is the only channel that got worse", fontsize=18)
    fig.tight_layout()
    save(fig, "channel_efficiency.png")


if __name__ == "__main__":
    data = load_data()
    names = dict(zip(data.campaigns.campaign_id, data.campaigns.campaign_name))
    rn = json.loads((DER / "report_numbers.json").read_text())
    f = funnel(data)
    chart_funnel(f, names)
    chart_cac(f, names)
    chart_pace()
    chart_lead(rn)
    chart_engagement(rn)
    chart_spend_budget(data)
    chart_channel_efficiency(names)
    print("charts written to", OUT)
