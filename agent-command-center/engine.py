"""
Agent Command Center — Analytics Engine

Ported from a Connors RSI(2) mean-reversion trading-backtest pattern.
The vectorized shape is reused as-is: a slow "regime" baseline gates a
fast, hyper-reactive oscillator that hunts for the exact moments worth
intervening on. The domain is swapped from SPY price data to agent
operational health (Jarvis, Hermes Agent, AI Agency, and any other
registered AI Loop), and "buy the dip" becomes "auto-intervene on an
acute, transient strain spike inside an otherwise healthy agent."

Bugs fixed from the snippet this was ported from:
  - `pd.Series(np.where(...))` drops the source DatetimeIndex and gets a
    fresh RangeIndex. Assigning that back onto a DataFrame column aligns
    on index labels, not position, so the whole RSI column silently
    became NaN. Every intermediate Series here stays indexed like the
    input frame (built with `.clip()` on the original Series, not
    `np.where` + a bare `pd.Series`).
  - `rs = avg_gain / avg_loss` divides by zero on flat runs (both 0 ->
    NaN) and on all-gain runs (avg_loss == 0 -> inf). Both cases are
    now handled explicitly instead of leaking NaN/inf into signals.
  - `flatten_columns` guards against MultiIndex columns, which is the
    other common footgun when a caller wires this up to a multi-source
    metrics feed (the trading equivalent: yfinance returning
    ('Close', 'SPY')-style tuples instead of 'Close').
"""

from __future__ import annotations

import numpy as np
import pandas as pd

REGIME_WINDOW = 200            # long-run health baseline (SMA_200 analog)
RECOVERY_WINDOW = 5            # short-run recovery baseline (SMA_5 analog)
STRAIN_WINDOW = 2              # fast oscillator window (RSI(2) analog)
STRAIN_ENTRY_THRESHOLD = 10    # acute short-term crater, RSI(2) < 10 analog
REGIME_FLOOR_PCT = 0.5         # hard kill-switch floor on the long-run baseline
INTERVENTION_OVERHEAD = 0.001  # fixed cost per auto-intervention (0.1% round-trip analog)


def flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    return df


def compute_strain_index(series: pd.Series, window: int = STRAIN_WINDOW) -> pd.Series:
    """Fast, RSI(2)-style oscillator on a 0-100 health series. Low values
    mean the series just cratered hard over the last `window` periods."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)

    avg_gain = gain.rolling(window=window).mean()
    avg_loss = loss.rolling(window=window).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    strain = 100 - (100 / (1 + rs))
    strain = strain.where(avg_loss != 0, 100.0)                    # no losses at all -> maximally strong
    strain = strain.where(~((avg_gain == 0) & (avg_loss == 0)), 50.0)  # perfectly flat -> neutral
    return strain


def analyze(metrics: pd.DataFrame, health_col: str = "health_score") -> pd.DataFrame:
    """`metrics` must be indexed by timestamp with a `health_col` in
    [0, 100], higher = healthier. Adds regime/strain/signal columns.
    Fully vectorized -- no row-by-row iteration over the metrics."""
    df = flatten_columns(metrics).copy()

    df["regime_baseline"] = df[health_col].rolling(REGIME_WINDOW, min_periods=20).mean()
    df["recovery_baseline"] = df[health_col].rolling(RECOVERY_WINDOW, min_periods=1).mean()
    df["strain_index"] = compute_strain_index(df[health_col])

    healthy_regime = df[health_col] > df["regime_baseline"]
    acute_strain = df["strain_index"] < STRAIN_ENTRY_THRESHOLD

    # Optimize_Signal analog: healthy long-run trend + acute short-term crater
    df["optimize_signal"] = (healthy_regime & acute_strain).fillna(False)
    # Recovery_Signal analog: short-term reversion complete
    df["recovery_signal"] = (df[health_col] > df["recovery_baseline"]).fillna(False)
    # Regime filter analog: structural breakdown -> pause auto-restarts, escalate to human
    df["kill_switch"] = (df["regime_baseline"] < REGIME_FLOOR_PCT * 100).fillna(False)

    return df


def _incident_spans(df: pd.DataFrame) -> list[dict]:
    spans: list[dict] = []
    in_incident = False
    start_idx = None
    for i, (opt, rec) in enumerate(zip(df["optimize_signal"], df["recovery_signal"])):
        if not in_incident and opt:
            in_incident = True
            start_idx = i
        elif in_incident and rec:
            spans.append({"start": start_idx, "end": i, "duration": i - start_idx, "recovered": True})
            in_incident = False
    if in_incident:
        spans.append({"start": start_idx, "end": len(df) - 1, "duration": len(df) - 1 - start_idx, "recovered": False})
    return spans


def _max_consecutive(bool_series: pd.Series) -> int:
    max_run = run = 0
    for v in bool_series:
        run = run + 1 if v else 0
        max_run = max(max_run, run)
    return max_run


def summarize(df: pd.DataFrame, health_col: str = "health_score") -> dict:
    """Real descriptive stats computed from whatever data was passed in --
    deliberately not a fabricated performance table. Feed it real agent
    logs to get real numbers; the bundled sample data is synthetic and
    labeled as such wherever it's surfaced."""
    total = len(df)
    incidents = _incident_spans(df)
    recovered = [s for s in incidents if s["recovered"]]

    last = df.iloc[-1] if total else None
    current_regime = "unknown"
    if last is not None:
        if bool(last["kill_switch"]):
            current_regime = "kill-switch"
        elif last[health_col] > last["regime_baseline"]:
            current_regime = "healthy"
        else:
            current_regime = "degraded"

    return {
        "periods_observed": total,
        "signals_fired": int(df["optimize_signal"].sum()) if total else 0,
        "incidents_detected": len(incidents),
        "auto_recovery_rate": (len(recovered) / len(incidents)) if incidents else float("nan"),
        "exposure_pct": (sum(s["duration"] for s in incidents) / total) if total else float("nan"),
        "avg_incident_duration_periods": (
            float(np.mean([s["duration"] for s in incidents])) if incidents else float("nan")
        ),
        "max_consecutive_kill_switch_periods": _max_consecutive(df["kill_switch"]) if total else 0,
        "current_regime": current_regime,
    }
