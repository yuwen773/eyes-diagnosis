"""Owner-scoped MCP access. Only operator-approved read-only tools can execute."""

import asyncio
import base64
import hashlib
import json
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta

import httpx
from jsonschema import Draft202012Validator
from mcp import ClientSession, types
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from referencing import Registry
from sqlalchemy import select
from sqlalchemy.orm import Session

from web.config import WebConfig
from web.chat.models import ChatAttachment
from web.mcp_image import ImageAnalysis
from web.mcp_config import assert_connection_allowed, extract_url, normalize_origins, parse_deploy_config
from web.models.mcp_server import McpServer
from web.response import BizError, ErrorCode

MCP_TIMEOUT_SECONDS = 10


class ToolError(RuntimeError):
    pass


def tool_failure(exc: Exception, default: str | None) -> Exception:
    pending = [exc]
    while pending:
        error = pending.pop()
        if isinstance(error, ToolError):
            return error
        if isinstance(error, (TimeoutError, httpx.TimeoutException)):
            return ToolError("MCP_TIMEOUT")
        if isinstance(error, ExceptionGroup):
            pending.extend(error.exceptions)
    return ToolError(default) if default is not None else exc


@dataclass(frozen=True)
class Server:
    code: str
    url: str
    transport: str
    config: str


def select_servers(db: Session, user_id: int, selected: list[str] | None,
                   disabled: bool | None, config: WebConfig) -> list[Server]:
    query = select(McpServer).where(McpServer.user_id == user_id, McpServer.status == 1)
    if selected:
        query = query.where(McpServer.mcp_server_code.in_(selected))
    elif disabled:
        return []
    rows = list(db.scalars(query.order_by(McpServer.id)))
    if selected and {r.mcp_server_code for r in rows} != set(selected):
        raise BizError(ErrorCode.NO_AUTH_ERROR, "无权使用该 MCP 服务或服务未启用")
    if len(rows) > 8:
        raise BizError(ErrorCode.PARAMS_ERROR, "每轮最多选择 8 个 MCP 服务")
    result = []
    for row in rows:
        url = extract_url(parse_deploy_config(row.deploy_config))
        assert_connection_allowed(row.install_type, url, normalize_origins(config.mcp_allowed_origins))
        assert url is not None and row.install_type is not None
        result.append(Server(row.mcp_server_code, url, row.install_type.upper(), row.deploy_config))
    return result


class McpTools:
    def __init__(self, bind, user_id: int, servers: list[Server], config: WebConfig, *, session_id: str, transport=None):
        self.bind, self.user_id, self.servers, self.config = bind, user_id, servers, config
        self.transport = transport
        self.session_id = session_id
        self.tools: list[dict] = []
        self.calls: dict[str, tuple] = {}
        self.used = False

    def revalidate(self, server: Server) -> None:
        # Fresh database identity/state and policy on every discovery and call.
        try:
            with Session(bind=self.bind) as db:
                current = select_servers(db, self.user_id, [server.code], False, self.config)
        except BizError:
            raise ToolError("MCP_ACCESS_REVOKED") from None
        if current != [server]:
            raise ToolError("MCP_ACCESS_REVOKED")

    @asynccontextmanager
    async def connect(self):
        ready = False
        try:
            async with self._connect() as access:
                ready = True
                yield access
        except Exception as exc:
            raise tool_failure(exc, None if ready else "MCP_DISCOVERY_FAILED") from None

    @asynccontextmanager
    async def _connect(self):
        async with AsyncExitStack() as stack:
            try:
                async with asyncio.timeout(MCP_TIMEOUT_SECONDS):
                    for server in self.servers:
                        self.revalidate(server)

                        async def guard(request, target=server):
                            # SSE's endpoint event is also an outbound request; check it.
                            self.revalidate(target)
                            assert_connection_allowed(target.transport, str(request.url),
                                normalize_origins(self.config.mcp_allowed_origins))
                            if request.url.copy_with(path="/", query=None) != httpx.URL(target.url).copy_with(path="/", query=None):
                                raise ToolError("MCP_CONNECTION_DENIED")

                        client = httpx.AsyncClient(
                            transport=self.transport, follow_redirects=False, timeout=MCP_TIMEOUT_SECONDS,
                            event_hooks={"request": [guard]})
                        if server.transport == "SSE":
                            # The SDK owns this context, not the application's Java/model clients.
                            def factory(headers: dict[str, str] | None = None,
                                        timeout: httpx.Timeout | None = None,
                                        auth: httpx.Auth | None = None) -> httpx.AsyncClient:
                                return client
                            connection = sse_client(server.url, httpx_client_factory=factory)
                        else:
                            await stack.enter_async_context(client)
                            connection = streamable_http_client(server.url, http_client=client)
                        streams = await stack.enter_async_context(connection)
                        session = await stack.enter_async_context(ClientSession(streams[0], streams[1],
                            read_timeout_seconds=timedelta(seconds=MCP_TIMEOUT_SECONDS)))
                        await session.initialize()
                        listing = await session.list_tools()
                        if listing.nextCursor or len(listing.tools) > 32:
                            raise ToolError("MCP_DISCOVERY_BUDGET_EXCEEDED")
                        approved = {item.strip() for item in self.config.mcp_readonly_tools.split(",")}
                        writes = {item.strip() for item in self.config.mcp_profile_tools.split(",")}
                        for tool in listing.tools:
                            registered_write = (tool.name == "update_my_profile" and f"{server.code}/{tool.name}" in writes)
                            if not registered_write and (tool.name == "update_my_profile" or f"{server.code}/{tool.name}" not in approved or
                                    (tool.annotations is not None and tool.annotations.readOnlyHint is False)):
                                continue
                            for schema in (tool.inputSchema, tool.outputSchema):
                                if schema is not None:
                                    Draft202012Validator.check_schema(schema)
                                    if len(json.dumps(schema)) > 8192:
                                        raise ToolError("MCP_SCHEMA_TOO_LARGE")
                            alias = "mcp_" + hashlib.sha256(f"{server.code}/{tool.name}".encode()).hexdigest()[:32]
                            if alias in self.calls:
                                raise ToolError("MCP_DUPLICATE_TOOL")
                            self.calls[alias] = (server, session, tool)
                            self.tools.append({"type": "function", "function": {"name": alias,
                                "description": (tool.description or tool.name)[:512], "parameters": tool.inputSchema}})
            except TimeoutError:
                raise ToolError("MCP_TIMEOUT") from None
            except Exception as exc:
                raise tool_failure(exc, "MCP_DISCOVERY_FAILED") from None
            yield self

    def is_write(self, name: str) -> bool:
        if name not in self.calls:
            return False
        server, _, tool = self.calls[name]
        return tool.name == "update_my_profile" and f"{server.code}/{tool.name}" in {
            item.strip() for item in self.config.mcp_profile_tools.split(",")}

    def write_source(self, name: str) -> dict:
        if not self.is_write(name):
            raise ToolError("MCP_TOOL_DENIED")
        server, _, tool = self.calls[name]
        self.revalidate(server)
        return {"kind": "mcp", "alias": name, "serverCode": server.code, "name": tool.name,
            "version": hashlib.sha256((json.dumps(vars(server), sort_keys=True) + json.dumps(tool.model_dump(mode="json"),
                sort_keys=True)).encode()).hexdigest()}

    def validate_write(self, name: str, raw: str) -> dict:
        source = self.write_source(name)
        try:
            Draft202012Validator(self.calls[name][2].inputSchema, registry=Registry()).validate(json.loads(raw))
        except Exception:
            raise ToolError("MCP_ARGUMENTS_INVALID") from None
        return source

    async def call(self, name: str, raw: str) -> str:
        if self.used:
            raise ToolError("MCP_CALL_BUDGET_EXCEEDED")
        self.used = True
        if name not in self.calls:
            raise ToolError("MCP_TOOL_DENIED")
        # A registered business tool never falls back to the read-only path,
        # including when write permission is revoked after discovery.
        if self.calls[name][2].name == "update_my_profile":
            raise ToolError("MCP_CONFIRMATION_REQUIRED")
        server, session, tool = self.calls[name]
        try:
            self.revalidate(server)
            if f"{server.code}/{tool.name}" not in {item.strip() for item in self.config.mcp_readonly_tools.split(",")}:
                raise ToolError("MCP_TOOL_DENIED")
            arguments = json.loads(raw)
            if not isinstance(arguments, dict) or any(k in arguments for k in (
                    "userId", "workflowId", "patientVisible", "publication", "confirmed", "approval")):
                raise ToolError("MCP_ARGUMENTS_INVALID")
            # jsonschema's legacy default can fetch arbitrary $ref URLs via urllib.
            Draft202012Validator(tool.inputSchema, registry=Registry()).validate(arguments)
            image_digest = None
            if tool.name == "eye_disease_diagnosis":
                with Session(bind=self.bind) as db:
                    image = db.scalar(select(ChatAttachment.image_bytes).where(
                        ChatAttachment.user_id == self.user_id, ChatAttachment.session_id == self.session_id,
                        ChatAttachment.url == arguments.get("image_input"), ChatAttachment.is_delete == 0,
                        ChatAttachment.message_id.is_not(None)))
                if not image or len(image) > 2 * 1024 * 1024 or set(arguments) != {"image_input"}:
                    raise ToolError("MCP_IMAGE_ACCESS_DENIED")
                image_digest = hashlib.sha256(image).hexdigest()
                arguments = {"image_input": base64.b64encode(image).decode()}
            async with asyncio.timeout(MCP_TIMEOUT_SECONDS):
                # The SDK's call_tool also resolves output-schema URLs by default.
                # Use its public protocol seam and validate both schemas without I/O.
                result = await session.send_request(types.ClientRequest(types.CallToolRequest(
                    params=types.CallToolRequestParams(name=tool.name, arguments=arguments))), types.CallToolResult)
            if result.isError:
                raise ToolError("MCP_TOOL_FAILED")
            if tool.outputSchema is not None:
                if result.structuredContent is None:
                    raise ToolError("MCP_RESULT_INVALID")
                Draft202012Validator(tool.outputSchema, registry=Registry()).validate(result.structuredContent)
            if not result.content or any(c.type != "text" for c in result.content):
                raise ToolError("MCP_RESULT_INVALID")
            content = "\n".join(c.text for c in result.content)
            if not content.strip() or len(content) > 16000:
                raise ToolError("MCP_RESULT_INVALID")
            self.revalidate(server)
            if image_digest is not None:
                analysis = ImageAnalysis.model_validate_json(content)
                if (analysis.inputDigest != image_digest or
                        (self.config.model_weights_sha256 and analysis.modelFingerprint != self.config.model_weights_sha256) or
                        (analysis.modelVersion, analysis.preprocessVersion, analysis.policyVersion) != (
                            self.config.model_version, self.config.preprocess_version, self.config.inference_policy_version)):
                    raise ToolError("MCP_IMAGE_SOURCE_MISMATCH")
                return "图像分析尚未发布；请通过受控诊断流程查看结果。\n" + analysis.model_dump_json()
            return "外部只读工具结果（不是本次诊断或发布依据）：\n" + content
        except TimeoutError:
            raise ToolError("MCP_TIMEOUT") from None
        except ToolError:
            raise
        except Exception as exc:
            raise tool_failure(exc, "MCP_TOOL_FAILED") from None
