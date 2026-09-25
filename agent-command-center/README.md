# 🛰️ Agent Command Center

Regime-baseline + fast-strain-oscillator monitoring for AI agents and
loops (Jarvis, Hermes Agent, AI Agency, and any other registered AI
Loop) — ported from a Connors RSI(2) mean-reversion trading pattern.

## Where this came from

The source concept was a stock-trading backtest: a slow 200-day moving
average filters for an uptrend "regime," and a fast, hyper-reactive
2-period RSI hunts for the exact moments price craters hard inside that
uptrend — the "buy the dip" signal. This app keeps that vectorized
pandas/numpy shape but retargets it entirely: instead of SPY price data,
it watches an agent's **health score** over time, and instead of a buy
signal it fires an **optimize signal** — "this agent is fine long-term,
but just took an acute short-term hit worth auto-intervening on."

### Bugs fixed from the original snippet

- The original built `avg_gain`/`avg_loss` from `pd.Series(np.where(...))`,
  which drops the source `DatetimeIndex` in favor of a fresh
  `RangeIndex`. Assigning that back onto `data['RSI_2']` aligns by index
  label, not position — with mismatched indices, the entire RSI column
  silently becomes `NaN`. Every intermediate series in `engine.py` stays
  indexed like the input frame.
- `rs = avg_gain / avg_loss` divides by zero on flat runs (`0/0 -> NaN`)
  and on all-improvement runs (`avg_loss == 0 -> inf`). Both are handled
  explicitly now instead of leaking into the signal columns.
- Added a `flatten_columns` guard for MultiIndex columns, the same
  footgun as `yfinance` returning `('Close', 'SPY')`-style tuples when a
  metrics feed comes from a multi-source pull.

## What it actually does

| File | Role |
|---|---|
| `engine.py` | Vectorized regime baseline, strain oscillator, and signal generation over a `health_score` series. No fabricated backtest numbers — `summarize()` computes real stats from whatever data is fed in. |
| `sample_data.py` | Synthetic demo metrics for Jarvis / Hermes Agent / AI Agency / AI Loops, clearly labeled as synthetic wherever it's used, so the app runs out of the box. |
| `orchestrator.py` | In-process agent registry/state machine + a generic webhook sender for automation (n8n, Zapier, Make, or a custom endpoint). |
| `report_generator.py` | **MD files generator** — renders a per-agent teardown in the same 8-section structure as the source write-up, filled with real computed numbers. |
| `app.py` | **Command Center** — the Streamlit dashboard tying it all together: per-agent charts, live signals, orchestration log, report generation, and webhook push. |

## Signal logic

- **Regime baseline** (200-period rolling mean of `health_score`): the
  long-run trend. Above it = healthy regime.
- **Recovery baseline** (5-period rolling mean): short-run trend used to
  declare an incident resolved.
- **Strain index** (RSI(2)-style oscillator on `health_score`): fast and
  jagged on purpose — it's built to catch the moment health craters,
  not to smooth it out.
- **Optimize signal**: healthy regime AND strain index < 10 — an acute,
  short-term hit inside an otherwise fine agent, worth auto-intervening on.
- **Recovery signal**: health crosses back above the recovery baseline —
  close the incident.
- **Kill-switch**: regime baseline drops below 50/100 — a structural
  breakdown, not a blip. Auto-restarts pause and it escalates to a human
  instead of retry-looping.

## Deployment architecture

- **Analytical engine**: run `engine.py` periodically against real agent
  metrics. Two practical options:
  - A plain OS **cron job** that runs the script and calls the webhook directly.
  - A **Claude Code Routine** (`create_trigger`) whose prompt asks Claude to
    run the engine and act on the results — Routines fire into a Claude
    Code session, not into this standalone Streamlit process, so that's
    the actual seam between "Claude Routines" and this codebase.
- **Automation & triage**: on an optimize signal, `Orchestrator.send_webhook`
  POSTs a JSON payload to whatever automation tool you point it at (n8n,
  Zapier, Make, a custom endpoint) for downstream routing — restart the
  process, throttle the loop, page someone, log to an ops board.
- **Command Center**: `app.py` is the live view — per-agent regime/strain
  charts, active signals, and a cross-agent orchestration log.
- **MD files generator**: `report_generator.py` — one teardown report per
  agent per run, saved to `reports/`.

## Setup

```bash
cd agent-command-center
pip install -r requirements.txt
streamlit run app.py
```

Runs immediately against synthetic demo data. Switch **Data source** to
"Upload CSV" in the sidebar to point it at a real metrics feed — a CSV
with a timestamp index and a `health_score` column (0-100, higher =
healthier).

## Honesty note

The source article's performance table (win rate, CAGR, drawdown) came
from a real backtest against two decades of real SPY price data. There's
no equivalent real dataset for Jarvis/Hermes/AI Agency here, so this app
does not print invented numbers dressed up as validated results — every
metric in the dashboard and the generated MD reports is computed live
from whatever data (synthetic demo or your real CSV) is actually loaded.
