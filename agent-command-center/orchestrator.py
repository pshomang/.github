"""
Agent orchestration state machine + automation hook.

Analog of "n8n routes an execution payload to a brokerage API and
simultaneously logs the trade to a Monday.com board": here, a detected
signal is (a) reflected into an in-process agent registry the Command
Center dashboard reads, and (b) optionally POSTed to a generic
automation webhook (n8n, Zapier, Make, a custom endpoint -- anything
that accepts JSON) so a real orchestration action can be taken outside
this process.

Note: Claude Routines (scheduled triggers) run inside a Claude Code
session, not inside this standalone Streamlit process, so they aren't
wired up here as a Python call. See README.md for how to schedule this
engine's periodic run via a Routine vs. a plain OS cron job.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd
import requests


@dataclass
class AgentState:
    name: str
    regime: str = "unknown"
    open_incident: bool = False
    incident_log: list[dict] = field(default_factory=list)


class Orchestrator:
    def __init__(self) -> None:
        self.agents: dict[str, AgentState] = {}

    def register(self, name: str) -> AgentState:
        self.agents.setdefault(name, AgentState(name=name))
        return self.agents[name]

    def update_from_analysis(self, name: str, df: pd.DataFrame) -> AgentState:
        state = self.register(name)
        last = df.iloc[-1]
        timestamp = str(df.index[-1])

        if bool(last["kill_switch"]):
            state.regime = "kill-switch"
        elif bool(last["optimize_signal"]):
            state.regime = "acute-strain"
            if not state.open_incident:
                state.open_incident = True
                state.incident_log.append({"opened_at": timestamp, "status": "open"})
        elif bool(last["recovery_signal"]) and state.open_incident:
            state.open_incident = False
            state.regime = "healthy"
            if state.incident_log:
                state.incident_log[-1]["status"] = "recovered"
                state.incident_log[-1]["closed_at"] = timestamp
        else:
            state.regime = "acute-strain" if state.open_incident else "healthy"

        return state

    def send_webhook(self, webhook_url: str, name: str, payload: dict, timeout: float = 5.0) -> tuple[bool, str]:
        try:
            resp = requests.post(webhook_url, json={"agent": name, **payload}, timeout=timeout)
            resp.raise_for_status()
            return True, f"Delivered ({resp.status_code})"
        except requests.RequestException as exc:
            return False, str(exc)
