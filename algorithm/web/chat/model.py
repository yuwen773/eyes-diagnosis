"""Bounded DashScope compatible SSE adapter, injected at the HTTP transport seam."""

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx

from web.config import WebConfig
from web.chat.history import HISTORY_TOOL
from web.chat.mcp import ToolError


async def stream_reply(client: httpx.AsyncClient, config: WebConfig,
                       messages: list[dict], *, history_tool: Callable[[str], Awaitable[str]] | None = None,
                       tools: list[dict] | None = None,
                       invoke_tool: Callable[[str, str], Awaitable[str]] | None = None) -> AsyncIterator:
    if not config.dashscope_api_key:
        raise RuntimeError("CHAT_MODEL_UNAVAILABLE")
    base = config.dashscope_base_url.rstrip("/")
    # Existing embedding configurations accept compatible-mode with or without /v1.
    if not base.endswith("/v1"):
        base += "/v1"
    completed = False
    tool_name = tool_arguments = tool_id = ""
    tool_seen = text_seen = False
    payload: dict[str, Any] = {"model": config.chat_model, "messages": messages, "stream": True, "max_tokens": 2048}
    if history_tool is not None:
        payload["tools"] = [HISTORY_TOOL]
    if tools:
        payload.setdefault("tools", []).extend(tools)
    async with client.stream("POST", base + "/chat/completions", headers={
        "Authorization": f"Bearer {config.dashscope_api_key}",
    }, json=payload, timeout=60) as response:
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
                delta = choice.get("delta", {})
                for call in delta.get("tool_calls") or []:
                    if tools and call.get("index") != 0:
                        raise ToolError("MCP_CALL_BUDGET_EXCEEDED")
                    if ((history_tool is None and invoke_tool is None) or call.get("index") != 0 or text_seen or
                            call.get("type", "function") != "function"):
                        raise RuntimeError("CHAT_TOOL_INVALID")
                    tool_seen = True
                    tool_id += call.get("id") or ""
                    function = call.get("function", {})
                    tool_name += function.get("name") or ""
                    tool_arguments += function.get("arguments") or ""
                    if len(tool_arguments) > 4096 or len(tool_name) > 128 or len(tool_id) > 128:
                        raise RuntimeError("CHAT_TOOL_TOO_LARGE")
                content = delta.get("content")
                if content:
                    if tool_seen:
                        raise RuntimeError("CHAT_TOOL_INVALID")
                    text_seen = True
                    yield content
                reason = choice.get("finish_reason")
                if reason is not None:
                    if reason == "tool_calls" and tool_seen and tool_id and tool_name == HISTORY_TOOL["function"]["name"]:
                        assert history_tool is not None
                        # A single read-only tool, rendered by the server: no model-generated records.
                        yield await history_tool(tool_arguments)
                    elif reason == "tool_calls" and tool_seen and tool_id and invoke_tool is not None:
                        if tool_name not in {t["function"]["name"] for t in tools or []}:
                            raise ToolError("MCP_TOOL_DENIED")
                        yield {"tool": tool_name, "status": "STARTED"}
                        result = await invoke_tool(tool_name, tool_arguments)
                        yield {"tool": tool_name, "status": "SUCCEEDED"}
                        yield result
                    elif reason != "stop" or tool_seen:
                        raise RuntimeError("CHAT_MODEL_INCOMPLETE")
                    completed = True
            if completed:
                break
    if not completed:
        raise RuntimeError("CHAT_MODEL_INCOMPLETE")
