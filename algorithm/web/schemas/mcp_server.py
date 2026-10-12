"""MCP-server DTOs.

Wire shape (``McpServerDetail``): every field is a plain Java type, so only
``status`` needs a type note -- it is an ``Integer`` and serialises as a
**number**. ``id`` is never exposed; ``mcpServerCode`` is the public handle
instead, so nothing here is a ``Long``.

``deployConfig`` is a JSON **string**, stored verbatim and returned unparsed.
The frontend parses it itself (``McpServicePanel.vue``), so unwrapping it
server-side would change the response shape.
"""

from pydantic import BaseModel, ConfigDict

from web.schemas.knowledge import DeleteRequest  # noqa: F401  (re-export convenience)


class McpServerDetail(BaseModel):
    """``model/dto/mcp/McpServerDetail.java`` -- 8 fields.

    Also the request body for create (``POST``) and update (``PUT``), which is
    why every field except the handle is optional: Java's
    ``validateCreateParams`` enforces the real constraints and reads
    ``deployConfig`` first, before ``name``.
    """

    model_config = ConfigDict(extra="ignore")

    #: Public handle. A 32-char hex UUID without dashes (``IdGenerator.idStr``),
    #: **not** the AUTO_INCREMENT ``id``. Required on update only.
    mcpServerCode: str | None = None
    name: str | None = None
    description: str | None = None
    #: Raw JSON string. Must parse as a JSON **object** -- Java casts it to
    #: ``ObjectNode``, and an array or scalar throws ``ClassCastException``
    #: rather than the intended parameter error. See :mod:`web.mcp_config`.
    deployConfig: str | None = None
    #: 1 active / 3 deleted. Java's Agent reads ``status = 1``; nothing else
    #: is ever written.
    status: int | None = None
    #: "SSE" or "STREAMABLE_HTTP". Defaults to "SSE". "STDIO" is rejected --
    #: a user-supplied config must not be able to launch a local process.
    installType: str | None = None
    #: Derived server-side from the first entry of ``mcpServers``. Read-only
    #: in practice: the client sends it and the backend overwrites it.
    host: str | None = None
    #: Populated only when ``needTools=true``. See the module docstring of
    #: ``web.routers.mcp_server`` -- Python does not speak MCP.
    tools: list | None = None


#: ``McpConnectionPolicy:33`` -- the two remote transports that are allowed.
INSTALL_TYPE_SSE = "SSE"
INSTALL_TYPE_STREAMABLE_HTTP = "STREAMABLE_HTTP"
INSTALL_TYPE_STDIO = "STDIO"
ALLOWED_INSTALL_TYPES = (INSTALL_TYPE_SSE, INSTALL_TYPE_STREAMABLE_HTTP)

#: ``McpServerServiceImpl:42`` -- what ``installType`` becomes when the client
#: omits it.
DEFAULT_INSTALL_TYPE = INSTALL_TYPE_SSE

#: ``status`` values. Only these two are ever written, so it is effectively
#: "active" plus "deleted".
STATUS_ACTIVE = 1
STATUS_DELETED = 3