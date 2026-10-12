"""``/mcp-server`` routes -- all 5 endpoints in ``McpServerController.java``.

Paths are unusual: create and update are on the **collection root** (``POST`` and
``PUT /api/mcp-server``), not under a sub-path.

Cross-service contract
----------------------
Python owns writes to ``t_mcp_server``; the Java Agent keeps **reading** it
(``TextMcpModelInterceptor:43`` and ``McpToolCallbackProvider:30`` both filter
``status = 1``). Same MySQL instance, so there is no replication lag -- but the
two status values below are the contract:

* create writes ``status = 1`` -- otherwise the Agent never sees the new server
* delete writes ``status = 3`` -- a soft delete that every query filters with
  ``ne(status, 3)``. There is no ``isDelete`` column and no ``@TableLogic``.

Deleting a server from Python therefore does **not** immediately invalidate the
Java side: ``MCPManager`` caches a server's discovered tools under
``mcp:tools:{userId}:{code}`` for 5 minutes (finding J-10). This module drops
that key so the Agent picks the change up on its next call.

The one gap
-----------
``GET /mcp-server/{code}?needTools=true`` asks ``MCPManager`` to connect to the
remote server and list its tools. That is MCP client work, and the MCP client is
Agent subsystem code, which stays on Java. Python does not reimplement it --
see :func:`get_mcp_server`. No frontend code calls that parameter
(``frontend/src/api/mcpController.ts`` exports it but nothing imports it), so
the gap is unreachable from the browser; it fails loudly rather than returning
an empty tool list.
"""

import logging
import uuid
from datetime import datetime
from functools import partial

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from web.auth import MCP_TOOLS_CACHE_PREFIX, LoginUser, current_user
from web.deps import get_config, get_db
from web.mcp_config import (
    DeployConfigError,
    assert_connection_allowed,
    extract_host,
    extract_name_from_config,
    extract_url,
    normalize_origins,
    parse_deploy_config,
    resolve_install_type,
)
from web.models.mcp_server import McpServer
from web.response import BaseResponse, BizError, ErrorCode, PageResult
from web.schemas.mcp_server import (
    STATUS_ACTIVE,
    STATUS_DELETED,
    McpServerDetail,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp-server", tags=["mcp-server"])

#: ``IdGenerator.idStr`` -- ``UUID.randomUUID().toString().replace("-", "")``,
#: a 32-char lowercase hex string. Reproduced with ``uuid4().hex``.
MCP_CODE_LENGTH = 32

#: ``McpServerServiceImpl.getByCodeAndUser`` returns ``null`` when nothing
#: matches, and every caller dereferences it without a null check -- so a
#: missing or unowned server is an NPE, surfaced by the catch-all as
#: ``50000``/``系统错误`` rather than a 404. Reproduced (finding J-18); the
#: message is deliberately unhelpful so nobody mistakes it for a Java-only bug.
SERVER_LOOKUP_FAILED = "系统错误"

require_user = partial(current_user)


def new_mcp_server_code() -> str:
    """``IdGenerator.idStr()``."""
    return uuid.uuid4().hex


def _to_detail(row: McpServer) -> McpServerDetail:
    """``McpServerServiceImpl.convertToDetail`` (:187-198).

    Eight fields, all copied. ``id`` (the AUTO_INCREMENT primary key) is never
    exposed -- ``mcpServerCode`` is the public handle.
    """
    return McpServerDetail(
        mcpServerCode=row.mcp_server_code,
        name=row.name,
        description=row.description,
        deployConfig=row.deploy_config,
        status=row.status,
        installType=row.install_type,
        host=row.host,
    )


def _find(db: Session, code: str, user_id: int) -> McpServer | None:
    """``getByCodeAndUser`` -- scoped to the owner and to non-deleted rows."""
    return db.execute(
        select(McpServer)
        .where(McpServer.mcp_server_code == code)
        .where(McpServer.user_id == user_id)
        .where(McpServer.status != STATUS_DELETED)
    ).scalars().first()


def _require(db: Session, code: str, user_id: int) -> McpServer:
    """Java dereferences the result of ``getByCodeAndUser`` without checking, so
    a miss is a ``NullPointerException`` -> ``50000``/``系统错误``.

    Reproduced rather than turned into ``40400``: the frontend cannot tell the
    two apart today, and "fixing" it here alone would make the two stacks
    disagree. Recorded as finding J-18.
    """
    row = _find(db, code, user_id)
    if row is None:
        raise BizError(ErrorCode.SYSTEM_ERROR, SERVER_LOOKUP_FAILED)
    return row


def _validate(deploy_config: str | None, name: str | None) -> dict:
    """``McpServerController.validateCreateParams`` (:82-102).

    Order is observable: ``deployConfig`` is validated **before** ``name``, so a
    request missing both reports the config error. ``name`` is derived from the
    config when absent rather than rejected.
    """
    config = parse_deploy_config(deploy_config)
    if name and name.strip():
        return config
    derived = extract_name_from_config(config)
    if not derived.strip():
        raise BizError(ErrorCode.PARAMS_ERROR, "name is required")
    return config


# ---------------------------------------------------------------------------
# POST /mcp-server
# ---------------------------------------------------------------------------
@router.post("", summary="新增 MCP 服务器")
def create_mcp_server(
    body: McpServerDetail,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``McpServerServiceImpl.createMcp``.

    Returns the generated ``mcpServerCode`` as a string.

    The policy check runs before the insert, so a rejected config leaves no
    row -- ``assertUserConfigAllowed`` is at :44, ``insert`` at :51.
    """
    config = _validate(body.deployConfig, body.name)
    name = body.name if body.name and body.name.strip() else extract_name_from_config(config)

    install_type = resolve_install_type(body.installType)
    assert_connection_allowed(install_type, extract_url(config), normalize_origins(get_config().mcp_allowed_origins))

    now = datetime.now()
    row = McpServer(
        mcp_server_code=new_mcp_server_code(),
        user_id=int(user.id),
        name=name,
        description=body.description,
        deploy_config=body.deployConfig,
        host=extract_host(config),
        status=STATUS_ACTIVE,
        install_type=install_type,
        create_time=now,
        update_time=now,
    )
    db.add(row)
    db.flush()
    return BaseResponse.success(row.mcp_server_code)


# ---------------------------------------------------------------------------
# PUT /mcp-server
# ---------------------------------------------------------------------------
@router.put("", summary="修改 MCP 服务器")
async def update_mcp_server(
    request: Request,
    body: McpServerDetail,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``McpServerServiceImpl.updateMcp``.

    ``status`` is **not** touched: an update cannot resurrect a deleted server,
    because the lookup already excludes ``status = 3``.
    """
    config = _validate(body.deployConfig, body.name)
    if not body.mcpServerCode or not body.mcpServerCode.strip():
        raise BizError(ErrorCode.PARAMS_ERROR, "mcpServerCode is required")

    row = _require(db, body.mcpServerCode, int(user.id))

    install_type = resolve_install_type(body.installType)
    assert_connection_allowed(install_type, extract_url(config), normalize_origins(get_config().mcp_allowed_origins))

    name = body.name if body.name and body.name.strip() else extract_name_from_config(config)
    row.name = name
    row.description = body.description
    row.deploy_config = body.deployConfig
    row.host = extract_host(config)
    row.install_type = install_type
    row.update_time = datetime.now()
    db.flush()

    await _invalidate_tool_cache(request, row)
    return BaseResponse.success(True)


async def _invalidate_tool_cache(request, row: McpServer) -> None:
    """Drop ``MCPManager``'s cached tool list for this server.

    Finding J-10: the Agent caches a server's discovered tools for 5 minutes and
    has no hook for external writes. Deleting the key here turns a 5-minute
    stale window into none -- except that a key the Agent has not written yet
    simply does not exist, so this is best-effort by construction.
    """
    try:
        key = f"{MCP_TOOLS_CACHE_PREFIX}{row.user_id}:{row.mcp_server_code}"
        await request.app.state.redis.delete(key)
    except Exception:  # noqa: BLE001 - cache hygiene must not fail the request
        logger.warning("could not invalidate mcp tool cache", exc_info=True)


# ---------------------------------------------------------------------------
# DELETE /mcp-server/{code}
# ---------------------------------------------------------------------------
@router.delete("/{mcpServerCode}", summary="删除 MCP 服务器")
async def delete_mcp_server(
    request: Request,
    mcpServerCode: str,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``McpServerServiceImpl.deleteMcp`` -- a **soft** delete via ``status=3``.

    No ``isDelete`` column exists on this table, so the row survives; every
    query filters ``ne(status, 3)`` and the Agent filters ``status = 1``.

    The path placeholder is camelCase to match Java's
    ``@DeleteMapping("/{mcpServerCode}")``. Placeholder names are not part of a
    URL, so this is cosmetic -- but ``npm run openapi`` regenerates the TS
    client from this spec, and a snake_case placeholder would rename the
    generated ``deleteMcpServer`` parameter for no benefit.
    """
    row = _require(db, mcpServerCode, int(user.id))
    row.status = STATUS_DELETED
    db.flush()

    await _invalidate_tool_cache(request, row)
    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# GET /mcp-server/{code}
# ---------------------------------------------------------------------------
@router.get("/{mcpServerCode}", summary="获取 MCP 服务器详情")
def get_mcp_server(
    mcpServerCode: str,
    needTools: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``McpServerServiceImpl.getMcp``.

    ``needTools=true`` is the one branch Python cannot serve: it asks
    ``MCPManager`` to open a connection to the remote server and enumerate its
    tools. That is MCP client code, and the MCP client is Agent subsystem --
    which stays on Java by the migration's terms.

    Rather than reimplementing an MCP client in Python (duplicating Agent
    functionality, for stdio/SSE/Streamable-HTTP) or returning an empty list
    that reads as "this server has no tools", it fails loudly. No frontend code
    reaches this: ``frontend/src/api/mcpController.ts`` exports
    ``getMcpServer`` and nothing imports it.

    If a caller ever needs it, the fix belongs in Java -- expose tool listing as
    its own endpoint that this router can proxy to, rather than moving the MCP
    client.
    """
    row = _require(db, mcp_server_code, int(user.id))
    detail = _to_detail(row)
    if needTools:
        raise BizError(
            ErrorCode.SYSTEM_ERROR,
            "工具列表由 Java Agent 的 MCPManager 提供，Python 侧不实现 MCP 客户端",
        )
    return BaseResponse.success(detail)


# ---------------------------------------------------------------------------
# GET /mcp-server  -- note: `size`, not `pageSize`
# ---------------------------------------------------------------------------
@router.get("", summary="分页查询 MCP 服务器")
def list_mcp_servers(
    name: str | None = Query(default=None),
    current: int = Query(default=1),
    size: int = Query(default=10),
    db: Session = Depends(get_db),
    user: LoginUser = Depends(require_user),
):
    """``McpServerServiceImpl.listMcpServers``.

    The page-size parameter is ``size``, not ``pageSize`` -- every other domain
    in this project uses ``pageSize``. Getting it wrong is a silent 400 on every
    call from a client that shares a helper with the other domains.

    Soft-deleted servers are excluded, newest first.
    """
    stmt = select(McpServer).where(
        McpServer.user_id == int(user.id),
        McpServer.status != STATUS_DELETED,
    )
    if name and name.strip():
        stmt = stmt.where(McpServer.name.like(f"%{name}%"))
    stmt = stmt.order_by(McpServer.create_time.desc())

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.limit(size).offset((current - 1) * size)).scalars().all()
    return BaseResponse.success(
        PageResult.of([_to_detail(row) for row in rows], total, size, current)
    )