"""Bounded DashScope compatible SSE adapter, injected at the HTTP transport seam."""

import json
from collections.abc import AsyncIterator

import httpx

from web.config import WebConfig


async def stream_reply(client: httpx.AsyncClient, config: WebConfig,
                       messages: list[dict]) -> AsyncIterator[str]:
    if not config.dashscope_api_key:
        raise RuntimeError("CHAT_MODEL_UNAVAILABLE")
    base = config.dashscope_base_url.rstrip("/")
    # Existing embedding configurations accept compatible-mode with or without /v1.
    if not base.endswith("/v1"):
        base += "/v1"
    completed = False
    async with client.stream("POST", base + "/chat/completions", headers={
        "Authorization": f"Bearer {config.dashscope_api_key}",
    }, json={"model": config.chat_model, "messages": messages, "stream": True,
             "max_tokens": 2048}, timeout=60) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if "error" in event:
                raise RuntimeError("CHAT_MODEL_FAILED")
            for choice in event.get("choices", []):
                reason = choice.get("finish_reason")
                if reason is not None:
                    if reason != "stop":
                        raise RuntimeError("CHAT_MODEL_INCOMPLETE")
                    completed = True
                delta = choice.get("delta", {}).get("content")
                if delta:
                    yield delta
    if not completed:
        raise RuntimeError("CHAT_MODEL_INCOMPLETE")
