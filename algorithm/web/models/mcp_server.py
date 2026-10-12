"""``t_mcp_server`` -- MCP server registry (Phase 2.5).

Mirrors ``model/entity/McpServer.java``, including the V6 rename that made the
persisted column ``name`` (it was ``mcpServerName`` in the legacy schema).

Dual-writer caveat
------------------
Java keeps **reading** this table (``TextMcpModelInterceptor``,
``McpToolCallbackProvider``, ``MCPManager``) to resolve which MCP servers a
user's agent may call, while Python owns writes. Same MySQL instance, so
there is no replication lag -- but Python's writes must never be batched into a
transaction the Agent reads through, and both sides must not write concurrently.

``create_time``/``update_time`` are filled by a MyBatis Plus
``MetaObjectHandler`` in Java (``FieldFill.INSERT`` / ``INSERT_UPDATE``).
Python fills them explicitly instead.

``deploy_config`` is a JSON **string**, not a JSON object. The Java service
stores it verbatim and the frontend parses it client-side
(``McpServicePanel.vue``); unwrapping it in the backend would change the
response shape.
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from web.db import Base


class McpServer(Base):
    __tablename__ = "t_mcp_server"

    id: Mapped[int] = mapped_column("id", BigInteger, primary_key=True, autoincrement=True)
    mcp_server_code: Mapped[str] = mapped_column("mcpServerCode", String(128), nullable=False)
    user_id: Mapped[int] = mapped_column("userId", BigInteger, nullable=False)
    name: Mapped[str] = mapped_column("name", String(255), nullable=False)
    #: Added by V8__add_mcp_server_description.
    description: Mapped[str | None] = mapped_column("description", String(512))
    #: Raw JSON string -- do not parse or re-serialize.
    deploy_config: Mapped[str] = mapped_column("deployConfig", String(2048), nullable=False)
    status: Mapped[int] = mapped_column("status", Integer, nullable=False, default=0)
    install_type: Mapped[str | None] = mapped_column("installType", String(32))
    host: Mapped[str | None] = mapped_column("host", String(512))

    create_time: Mapped[datetime | None] = mapped_column("createTime", DateTime)
    update_time: Mapped[datetime | None] = mapped_column("updateTime", DateTime)
