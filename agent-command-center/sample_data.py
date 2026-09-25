"""Synthetic demo metrics generator.

Stands in for `yf.download(...)` from the original trading pattern:
self-contained, no external API dependency, so the Command Center runs
out of the box. Swap for real log ingestion (CSV/DB/webhook) for
production use -- every value here is synthetic and labeled as such
wherever the UI surfaces it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

AGENT_PROFILES = {
    "Jarvis": {"base_health": 92, "volatility": 4, "incident_rate": 0.03},
    "Hermes Agent": {"base_health": 88, "volatility": 6, "incident_rate": 0.05},
    "AI Agency": {"base_health": 85, "volatility": 7, "incident_rate": 0.06},
    "AI Loops": {"base_health": 90, "volatility": 5, "incident_rate": 0.04},
}


def generate_agent_metrics(
    agent_name: str, periods: int = 720, freq: str = "h", seed: int | None = None
) -> pd.DataFrame:
    """Hourly synthetic health_score series (0-100) with occasional acute
    incidents, for a named agent/loop. Defaults to 30 days of hourly data."""
    profile = AGENT_PROFILES.get(agent_name, {"base_health": 90, "volatility": 5, "incident_rate": 0.04})
    rng = np.random.default_rng(seed)
    idx = pd.date_range(end=pd.Timestamp.now().floor(freq), periods=periods, freq=freq)

    base = profile["base_health"]
    reversion_strength = 0.08  # pulls health back toward baseline instead of pure random-walking away

    health = np.full(periods, base, dtype=float)
    for i in range(1, periods):
        noise = rng.normal(0, profile["volatility"] * 0.15)
        pull = reversion_strength * (base - health[i - 1])
        health[i] = health[i - 1] + pull + noise
        if rng.random() < profile["incident_rate"]:
            health[i] -= rng.uniform(15, 40)
        health[i] = float(np.clip(health[i], 0, 100))

    return pd.DataFrame({"health_score": health}, index=idx)
