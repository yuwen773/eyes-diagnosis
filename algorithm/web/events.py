"""SSE framing shared by chat commands and read-only recovery snapshots."""

import json


def sse(data: object, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return prefix + "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"
