"""Explicit business consent; legacy direct profile APIs retain their contracts."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from web.auth import LoginUser
from web.chat import tool_writes as writes
from web.chat.mcp import McpTools, select_servers
from web.chat.session import owner
from web.deps import get_db, login_user
from web.models.mcp_server import McpServer
from web.response import BaseResponse

router = APIRouter(prefix="/agent", tags=["tool-confirmation"])


@router.get("/profile")
def profile(db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    row = writes.profile(db, user)
    return BaseResponse.success({"userProfile": row.user_profile})


@router.get("/tool-confirmations")
def confirmations(sessionId: str, db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    owner(db, sessionId, user.id)
    rows = db.scalars(select(writes.ToolConfirmation).where(writes.ToolConfirmation.session_id == sessionId,
        writes.ToolConfirmation.owner_user_id == user.id).order_by(writes.ToolConfirmation.created_at,
        writes.ToolConfirmation.confirmation_id).with_for_update())
    return BaseResponse.success([writes.view(db, row) for row in rows])


@router.post("/tool-confirmations/{confirmation_id}/{action}")
async def decision(confirmation_id: str, action: str, body: writes.ToolDecision, request: Request,
                   db: Session = Depends(get_db), user: LoginUser = Depends(login_user)):
    if action not in {"approve", "reject"}:
        raise HTTPException(404, "操作不存在")
    row = writes.owned_confirmation(db, confirmation_id, user)
    source = json.loads(row.content)["source"]
    # A committed receipt is independent of subsequent tool availability.
    if action == "approve" and row.status == "PENDING" and source["kind"] == "mcp":
        db.commit()  # Do not hold SQL locks while discovering an external tool.
        try:
            servers = select_servers(db, user.id, [source["serverCode"]], False, request.app.state.config)
            db.commit()
            access = McpTools(db.get_bind(), user.id, servers, request.app.state.config,
                session_id=row.session_id, transport=getattr(request.app.state, "mcp_transport", None))
            async with access.connect():
                source = access.write_source(source["alias"])
        except Exception:
            # No external tool is invoked. Unavailable or changed tools fail closed.
            source = {"kind": "unavailable"}
        row = writes.owned_confirmation(db, confirmation_id, user)
        if source["kind"] == "mcp":
            # Lock deployment ownership/config through the business commit too.
            current = db.scalar(select(McpServer).where(McpServer.mcp_server_code == source["serverCode"])
                .with_for_update().execution_options(populate_existing=True))
            expected = servers[0]
            if (current is None or current.user_id != user.id or current.status != 1
                    or current.deploy_config != expected.config or (current.install_type or "").upper() != expected.transport
                    or not access.is_write(source["alias"])):
                source = {"kind": "unavailable"}
    elif source["kind"] == "internal":
        source = {"kind": "internal", "name": "propose_profile_update", "version": writes.ADAPTER_VERSION}
    return BaseResponse.success(writes.decide(db, row, user, body, action == "approve", source))
