"""
MD files generator.

Renders a per-agent teardown report using the same 8-section structure
as the source trading write-up (Core Parameters, Complexity &
Constraints, Math & Benchmarking, Classification, Deployment
Architecture, Creativity & Realism, Final Judgement) -- but filled with
real numbers computed by `engine.summarize`, not invented ones.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd

from engine import (
    INTERVENTION_OVERHEAD,
    REGIME_FLOOR_PCT,
    REGIME_WINDOW,
    RECOVERY_WINDOW,
    STRAIN_ENTRY_THRESHOLD,
    STRAIN_WINDOW,
)


def _fmt_pct(value: float) -> str:
    return "n/a" if value != value else f"{value * 100:.1f}%"  # NaN check without importing numpy


def _fmt_num(value: float) -> str:
    return "n/a" if value != value else f"{value:.1f}"


def render_teardown(agent_name: str, df: pd.DataFrame, summary: dict, health_col: str = "health_score") -> str:
    last = df.iloc[-1]

    lines = [
        f"# {agent_name} — Agent Command Center Teardown",
        f"_Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}_",
        "",
        "## 1. Core Parameters & Logic",
        (
            f"- Regime baseline window: {REGIME_WINDOW} periods (long-run health trend)\n"
            f"- Recovery baseline window: {RECOVERY_WINDOW} periods (short-run reversion check)\n"
            f"- Strain oscillator window: {STRAIN_WINDOW} periods, RSI(2)-style, fully vectorized "
            f"via pandas/numpy over the health-score series\n"
            f"- Optimize signal: healthy regime (health > {REGIME_WINDOW}-period baseline) AND "
            f"acute strain (strain index < {STRAIN_ENTRY_THRESHOLD})\n"
            f"- Recovery signal: health crosses back above the {RECOVERY_WINDOW}-period baseline"
        ),
        "",
        "## 2. Complexity & Constraints",
        (
            f"- Intervention overhead modeled at {INTERVENTION_OVERHEAD * 100:.1f}% per auto-restart cycle, "
            "to avoid overstating the value of intervening\n"
            "- Full triage attention is allocated to one open incident per agent at a time "
            "(overlapping incidents on the same agent are rare)\n"
            f"- Kill-switch: regime baseline below {REGIME_FLOOR_PCT * 100:.0f}/100 is treated as a "
            "structural breakdown, not a transient dip -- auto-restarts pause and the incident escalates "
            "to a human instead of retry-looping"
        ),
        "",
        "## 3-4. The Math: Calculations & Benchmarking",
        (
            "Computed from the data actually fed into this run (synthetic demo data is labeled as such "
            "in the dashboard) -- not a fabricated backtest table.\n\n"
            "| Metric | Value |\n"
            "|---|---|\n"
            f"| Periods observed | {summary['periods_observed']} |\n"
            f"| Signals fired | {summary['signals_fired']} |\n"
            f"| Incidents detected | {summary['incidents_detected']} |\n"
            f"| Auto-recovery rate | {_fmt_pct(summary['auto_recovery_rate'])} |\n"
            f"| Exposure (time under active intervention) | {_fmt_pct(summary['exposure_pct'])} |\n"
            f"| Avg incident duration (periods) | {_fmt_num(summary['avg_incident_duration_periods'])} |\n"
            f"| Max consecutive kill-switch periods | {summary['max_consecutive_kill_switch_periods']} |\n"
            f"| Current health score | {last[health_col]:.1f} |\n"
            f"| Current regime | {summary['current_regime']} |"
        ),
        "",
        "## 5. Classification",
        (
            "- **Pattern type:** Short-term self-healing loop recovery\n"
            "- **Risk profile:** Low-to-moderate -- the kill-switch removes the retry-storm tail risk that "
            "naive always-restart automation carries\n"
            "- **Condition bias:** Thrives on bursty, spiky load where short-term crater-and-recover is the "
            "dominant failure mode. Fails to add value in flat, idle periods where the regime and recovery "
            "baselines converge and there's nothing acute to react to"
        ),
        "",
        "## 6. App & AI Agent Feasibility (Deployment Architecture)",
        (
            "- **Analytical engine:** `engine.py` runs periodically against Jarvis, Hermes Agent, AI Agency, "
            "and any other registered AI Loop's metrics -- either via a plain OS cron job, or via a Claude "
            "Code Routine whose prompt asks Claude to execute the engine and act on the result "
            "(Routines run inside a Claude Code session, not this standalone process, so that's the "
            "practical seam between the two)\n"
            "- **Automation & triage:** on an optimize signal, the orchestrator can POST a JSON payload to "
            "a generic automation webhook (n8n / Zapier / Make / custom) for downstream routing\n"
            "- **Execution & monitoring:** the webhook target restarts/throttles/pauses the actual agent "
            "process and logs the action to an external ops board, giving a zero-touch operational ledger\n"
            "- **Command Center:** `app.py` is the live dashboard -- per-agent regime/strain charts, "
            "signal history, and the orchestration log across all registered agents\n"
            "- **MD files generator:** this document -- one teardown per agent per run, saved under `reports/`"
        ),
        "",
        "## 7. Creativity and Realism",
        (
            "- **The edge:** the regime+oscillator pattern is well-known but durable because it targets a "
            "recurring behavioral failure mode (retry storms and cascading errors under acute load), not a "
            "market inefficiency that arbitrages away. Creativity headroom: have an agent read the raw log "
            "excerpt behind a triggering incident before approving an auto-restart, and override the action "
            "if the spike traces to a known upstream outage rather than a real bug\n"
            "- **The bottleneck:** health at the current period isn't fully known until the period's logs "
            "have flushed, the same way a day's closing price isn't known until the close. The engine has to "
            "act on the latest *available* reading, which introduces detection lag relative to a perfect "
            "after-the-fact analysis of the same data"
        ),
        "",
        "## 8. Final Judgement",
        (
            f"- **Is it robust?** Based on this run: {summary['incidents_detected']} incident(s) detected, "
            f"{_fmt_pct(summary['auto_recovery_rate'])} auto-recovered without a kill-switch escalation.\n"
            "- **Does the effort pay off?** It trades some raw throughput for a bounded worst case -- the "
            "kill-switch caps how long the system will keep retrying a structurally broken agent instead of "
            "burning compute in a loop.\n"
            "- **Biggest point of failure:** polling-interval gap risk -- an agent can go from healthy to "
            "fully crashed between two polls with no partial signal in between, the direct analog of "
            "overnight gap risk in the source pattern."
        ),
        "",
    ]

    return "\n".join(lines)
