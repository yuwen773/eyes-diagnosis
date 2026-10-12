"""``deployConfig`` parsing and the remote-connection policy.

Two Java classes ported here, both security-relevant:

* ``McpServerController.extractNameFromConfig`` -- derive a name from the config
* ``agent/policy/McpConnectionPolicy``          -- what a user is allowed to point at

Why the policy is reproduced exactly
-----------------------------------
``deployConfig`` is user input that decides **where the server will open an
outbound connection**. The checks are the whole security boundary:

1. ``STDIO`` is refused outright. A stdio MCP server is launched as a local
   subprocess with a command line taken from user input -- that is remote code
   execution, and it is why the check exists.
2. Only ``SSE`` and ``STREAMABLE_HTTP`` are accepted.
3. The URL must be ``https``, with no userinfo and no fragment.
4. The origin must appear in ``mcp.remote.allowed-origins``.

An empty allow-list -- which is the **default**, since the property is
``${mcp.remote.allowed-origins:}`` -- therefore rejects every remote server.
That is intentional fail-closed behaviour, not a misconfiguration, and it means
creating an MCP server fails out of the box on a stock deployment.
"""

import json
import logging
from urllib.parse import urlsplit

from web.constant import ADMIN_ROLE, DEFAULT_ROLE  # noqa: F401  (re-export)
from web.response import BizError, ErrorCode
from web.schemas.mcp_server import (
    ALLOWED_INSTALL_TYPES,
    DEFAULT_INSTALL_TYPE,
    INSTALL_TYPE_STDIO,
)

logger = logging.getLogger(__name__)


class DeployConfigError(ValueError):
    """``deployConfig`` is missing or is not a JSON object."""


def parse_deploy_config(raw: str | None) -> dict:
    """Parse ``deployConfig`` into a mapping.

    Java does ``(ObjectNode) objectMapper.readTree(...)`` inside a
    ``try { } catch (JsonProcessingException)``. Two gaps, both reproduced:

    * an **array** or a scalar parses fine but fails the cast, and
      ``ClassCastException`` is not a ``JsonProcessingException`` -- so it
      escapes to the catch-all and surfaces as ``50000``/``系统错误`` rather
      than the intended ``40000``/"deployConfig is not valid JSON"
    * a **missing** ``deployConfig`` throws NPE on ``readTree(null)`` -- but the
      controller's ``hasText`` check runs first, so that one is covered

    Here both become :class:`DeployConfigError`, which the router turns into a
    parameter error. Strictly more accurate; recorded as a deviation.
    """
    if not raw or not raw.strip():
        raise DeployConfigError("deployConfig is required")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DeployConfigError("deployConfig is not valid JSON") from exc
    if not isinstance(parsed, dict):
        # The ClassCastException case. Naming the actual type makes the message
        # actionable -- "[]" is valid JSON and the caller has no other clue.
        raise DeployConfigError(
            f"deployConfig must be a JSON object, got {type(parsed).__name__}"
        )
    return parsed


def _first_server(config: dict) -> tuple[str, dict] | None:
    """The first entry of ``mcpServers``, as ``(key, value)``.

    Java takes ``mcpServers.values().iterator().next()``. ``json.loads``
    preserves insertion order in CPython, so "first" matches Jackson's for
    object-typed maps -- which is what ``ObjectNode.fields()`` walks.
    """
    servers = config.get("mcpServers")
    if not isinstance(servers, dict) or not servers:
        return None
    key = next(iter(servers))
    value = servers[key]
    return key, value if isinstance(value, dict) else {}


def extract_name_from_config(config: dict) -> str:
    """``McpServerController.extractNameFromConfig``.

    Preference order, exactly as Java:

    1. ``mcpServers[first].name`` -- if textual and not blank
    2. the ``mcpServers`` key itself -- if not blank
    3. the config's own top-level ``name``
    4. ``""`` -- the caller turns this into "name is required"

    The order matters when a client omits ``name``: the derived value ends up in
    ``t_mcp_server.name`` and is what the Agent shows the user, so silently
    preferring a different source would mislabel their server.
    """
    first = _first_server(config)
    if first is not None:
        key, server = first
        name = server.get("name")
        if isinstance(name, str) and name.strip():
            return name
        if key.strip():
            return key

    name = config.get("name")
    if isinstance(name, str) and name.strip():
        return name
    return ""


def extract_url(config: dict) -> str | None:
    """``McpServerServiceImpl.extractUrl`` -- the first server's ``url``.

    Java casts ``(String) firstServer.get("url")``: a non-string url throws
    ``ClassCastException``, which is caught by the surrounding
    ``catch (Exception)`` and returns null. So a non-string url is treated as
    absent here rather than raising.
    """
    first = _first_server(config)
    if first is None:
        return None
    url = first[1].get("url")
    return url if isinstance(url, str) else None


def extract_host(config: dict) -> str:
    """``McpServerServiceImpl.extractHost`` -- ``scheme://host[:port]``.

    Returns ``""`` for a stdio server (there is no host to talk to) and for
    anything unparseable. Java wraps the whole body in ``catch (Exception)``
    and returns ``""``, so a malformed url silently yields an empty host --
    reproduced, because the policy check that follows is what actually gates the
    connection.

    Note the port is included only when explicit, matching ``URL.getPort()``
    returning -1 for the default port of the scheme. So ``https://a:443/x``
    yields ``https://a:443`` but ``https://a/x`` yields ``https://a``.
    """
    try:
        first = _first_server(config)
        if first is None:
            return ""
        server = first[1]
        if (server.get("type") or "").lower() == "stdio":
            return ""
        url = server.get("url")
        if not isinstance(url, str) or not url:
            return ""
        parts = urlsplit(url)
        if not parts.scheme or not parts.hostname:
            return ""
        host = f"{parts.scheme}://{parts.hostname}"
        try:
            port = parts.port
        except ValueError:  # invalid port
            return ""
        if port is not None:
            host += f":{port}"
        return host
    except Exception:  # noqa: BLE001 - mirrors the Java catch-all
        return ""


# --- connection policy -------------------------------------------------------
def normalize_origin(value: str) -> str | None:
    """``scheme://authority`` -- what the allow-list compares against.

    Java builds ``URI.create(uri.getScheme() + "://" + uri.getAuthority())``, so
    a configured allow-list entry of ``https://a.example.com/some/path`` is
    normalised to ``https://a.example.com`` and matches that origin's any path.
    Returns ``None`` for something unparseable, which Java would have thrown on
    at bean-construction time -- i.e. the whole app fails to start. Skipping
    instead of crashing is a deliberate softening: one bad allow-list entry
    should not stop the other three domains from serving.
    """
    value = value.strip()
    if not value:
        return None
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def normalize_origins(raw: str | None) -> list[str]:
    """Parse ``mcp.remote.allowed-origins`` (comma separated)."""
    if not raw:
        return []
    origins = []
    for entry in raw.split(","):
        origin = normalize_origin(entry)
        if origin is None:
            logger.warning("ignoring unparseable mcp.remote.allowed-origins entry: %r", entry)
            continue
        origins.append(origin)
    return origins


def assert_connection_allowed(install_type: str | None, url: str | None, allowed: list[str]) -> None:
    """``McpConnectionPolicy.assertUserConfigAllowed``.

    Raises :class:`~web.response.BizError` with Java's exact codes and messages.
    The order is load-bearing -- it is what makes an empty allow-list fail
    closed rather than open.

    Note ``url`` of ``None`` lands in the "非法" branch: Java's ``URI.create(null)``
    throws ``NullPointerException``, which *is* a ``RuntimeException`` and is
    caught by the surrounding catch, producing the same message.
    """
    normalized = (install_type or "").upper()

    if normalized == "STDIO":
        # The important one: a stdio MCP server is a local subprocess launched
        # with a command line built from user input.
        raise BizError(ErrorCode.NO_AUTH_ERROR, "用户配置禁止使用 STDIO MCP")

    if normalized not in ALLOWED_INSTALL_TYPES:
        raise BizError(ErrorCode.PARAMS_ERROR, "不支持的 MCP 安装类型")

    try:
        parts = urlsplit(url) if url else None
    except ValueError:
        parts = None
    if parts is None or not parts.scheme:
        raise BizError(ErrorCode.PARAMS_ERROR, "MCP URL 非法")

    if (
        parts.scheme.lower() != "https"
        or not parts.hostname
        or parts.username is not None
        or "@" in (parts.netloc or "")
        or parts.fragment
    ):
        raise BizError(ErrorCode.PARAMS_ERROR, "MCP URL 必须是白名单内的 HTTPS 地址")

    origin = f"{parts.scheme.lower()}://{parts.netloc}"
    if origin not in allowed:
        raise BizError(ErrorCode.NO_AUTH_ERROR, "MCP remote 地址未获授权")


def resolve_install_type(install_type: str | None) -> str:
    """``StringUtils.hasText(installType) ? installType : "SSE"``.

    Whitespace-only counts as absent -- ``hasText`` checks for non-whitespace
    content, unlike ``isNotBlank``'s sibling ``hasText`` in Spring's older API.
    """
    if install_type and install_type.strip():
        return install_type
    return DEFAULT_INSTALL_TYPE