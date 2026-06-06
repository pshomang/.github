"""
Run an interactive session with the Canva Design Requester agent.

Usage:
    ANTHROPIC_API_KEY=sk-...  CANVA_AGENT_ID=agt_...  python run_canva_session.py
"""

import os
import anthropic

client = anthropic.Anthropic()

AGENT_ID = os.environ.get("CANVA_AGENT_ID")
if not AGENT_ID:
    raise SystemExit("Set CANVA_AGENT_ID to the agent ID printed by canva_design_requester.py")

def run_session(user_message: str) -> str:
    """Create a single-turn session and return the agent's reply."""
    session = client.beta.sessions.create(
        agent=AGENT_ID,
        betas=["managed-agents-2026-04-01"],
    )

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
    print("Canva Design Requester — type 'quit' to exit\n")
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("quit", "exit"):
            break
        if not user_input:
            continue
        print("\nAgent: ", end="", flush=True)
        reply = run_session(user_input)
        print(reply)
        print()
