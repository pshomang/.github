"""
Agent Command Center

Monitors Jarvis, Hermes Agent, AI Agency, and any other registered AI
Loop with a regime-baseline + fast-strain-oscillator pattern (ported
from a Connors RSI(2) mean-reversion trading concept), auto-generates
Markdown teardown reports per agent, and optionally pushes detected
signals to an automation webhook (n8n / Zapier / Make / custom).
"""

from pathlib import Path

import pandas as pd
import streamlit as st

from engine import analyze, summarize
from orchestrator import Orchestrator
from report_generator import render_teardown
from sample_data import AGENT_PROFILES, generate_agent_metrics

REPORTS_DIR = Path("reports")

st.set_page_config(page_title="Agent Command Center", page_icon="🛰️", layout="wide")

if "orchestrator" not in st.session_state:
    st.session_state.orchestrator = Orchestrator()

st.title("🛰️ Agent Command Center")
st.caption(
    "Regime + strain-oscillator monitoring for Jarvis, Hermes Agent, AI Agency, and any other "
    "registered AI Loop — ported from a Connors RSI(2) mean-reversion pattern."
)

with st.sidebar:
    st.header("⚙️ Settings")
    data_source = st.radio("Data source", ["Synthetic demo data", "Upload CSV"])
    webhook_url = st.text_input("Automation webhook URL (n8n / Zapier / Make / custom)")
    st.caption(
        "Claude Routines run inside a Claude Code session, not this process. Schedule this "
        "engine's periodic run either via a Routine whose prompt asks Claude to run it and act "
        "on the result, or via a plain OS cron job that calls `engine.py` and hits the webhook "
        "above directly."
    )

agent_names = list(AGENT_PROFILES.keys())
tabs = st.tabs(agent_names + ["📋 Orchestration Log"])

for tab, name in zip(tabs[:-1], agent_names):
    with tab:
        if data_source == "Synthetic demo data":
            metrics = generate_agent_metrics(name, seed=abs(hash(name)) % (2**32))
            st.caption("⚠️ Synthetic demo data — swap in real metrics via CSV upload for production use.")
        else:
            uploaded = st.file_uploader(
                f"Upload metrics CSV for {name} (timestamp index + `health_score` column, 0-100)",
                type=["csv"],
                key=f"upload_{name}",
            )
            if not uploaded:
                st.info("Upload a CSV to analyze this agent.")
                continue
            metrics = pd.read_csv(uploaded, index_col=0, parse_dates=True)

        df = analyze(metrics)
        summary = summarize(df)
        state = st.session_state.orchestrator.update_from_analysis(name, df)

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Current regime", state.regime)
        col2.metric(
            "Auto-recovery rate",
            f"{summary['auto_recovery_rate'] * 100:.0f}%" if summary["incidents_detected"] else "n/a",
        )
        col3.metric("Exposure (time under intervention)", f"{summary['exposure_pct'] * 100:.1f}%")
        col4.metric("Incidents detected", summary["incidents_detected"])

        st.line_chart(df[["health_score", "regime_baseline", "recovery_baseline"]])
        st.line_chart(df[["strain_index"]])

        if bool(df["optimize_signal"].iloc[-1]):
            st.warning(f"🟠 Optimize signal active for {name} — acute short-term strain inside a healthy regime.")
        if bool(df["kill_switch"].iloc[-1]):
            st.error(f"🔴 Kill-switch engaged for {name} — structural regime breakdown, auto-restarts paused.")

        c1, c2 = st.columns(2)
        with c1:
            if st.button(f"📝 Generate MD teardown", key=f"md_{name}"):
                REPORTS_DIR.mkdir(exist_ok=True)
                content = render_teardown(name, df, summary)
                path = REPORTS_DIR / f"{name.lower().replace(' ', '_')}_teardown.md"
                path.write_text(content)
                st.success(f"Saved {path}")
                st.download_button("Download report", content, file_name=path.name, key=f"dl_{name}")
        with c2:
            if st.button("📡 Push signal to automation webhook", key=f"hook_{name}", disabled=not webhook_url):
                ok, msg = st.session_state.orchestrator.send_webhook(
                    webhook_url, name, {"regime": state.regime, "summary": summary}
                )
                (st.success if ok else st.error)(msg)

with tabs[-1]:
    st.subheader("Orchestration log")
    if not st.session_state.orchestrator.agents:
        st.info("No agents analyzed yet — open a tab above to run the engine.")
    for name, state in st.session_state.orchestrator.agents.items():
        st.write(f"**{name}** — regime: `{state.regime}`, open incident: {state.open_incident}")
        if state.incident_log:
            st.table(pd.DataFrame(state.incident_log))
