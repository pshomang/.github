"""
Run an interactive session with the YouTube Research Agent.

Usage:
    ANTHROPIC_API_KEY=sk-...  YOUTUBE_AGENT_ID=agt_...  python run_youtube_session.py
"""

import os
import anthropic

client = anthropic.Anthropic()

AGENT_ID = os.environ.get("YOUTUBE_AGENT_ID")
if not AGENT_ID:
    raise SystemExit(
        "Set YOUTUBE_AGENT_ID to the agent ID printed by youtube_research_agent.py"
    )

ENVIRONMENT_ID = os.environ.get("YOUTUBE_ENVIRONMENT_ID")


def run_session(user_message: str) -> str:
    """Send one message and return the agent reply."""
    session_params = {
        "agent": AGENT_ID,
        "betas": ["managed-agents-2026-04-01"],
    }
    if ENVIRONMENT_ID:
        session_params["environment_id"] = ENVIRONMENT_ID

    session = client.beta.sessions.create(**session_params)

    with client.beta.sessions.events.stream(
        session.id,
        betas=["managed-agents-2026-04-01"],
    ) as stream:
        client.beta.sessions.events.send(
            session.id,
            events=[{
                "type": "user.message",
                "content": [{"type": "text", "text": user_message}],
            }],
            betas=["managed-agents-2026-04-01"],
        )

        reply_parts = []
        for event in stream:
            if event.type == "agent.message":
                for block in event.content:
                    if block.type == "text":
                        reply_parts.append(block.text)
            elif event.type == "session.status_terminated":
                break
            elif event.type == "session.status_idle":
                if event.stop_reason.type != "requires_action":
                    break

    return "".join(reply_parts)


if __name__ == "__main__":
    print("YouTube Research Agent — type 'quit' to exit")
    print("Share a video idea or topic to get started.\n")

    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("quit", "exit", "q"):
            break
        if not user_input:
            continue
        print("\nAgent: ", end="", flush=True)
        reply = run_session(user_input)
        print(reply)
        print()
