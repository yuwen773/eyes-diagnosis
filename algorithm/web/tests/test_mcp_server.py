"""MCP-server domain tests (Phase 2.5).

The security-relevant half is :mod:`web.mcp_config`, and it gets the most
attention here: ``deployConfig`` is user input that decides where the server
opens an outbound connection, so the policy checks are the whole boundary.

The other theme is the pagination parameter. This is the only domain that takes
``size``; everywhere else it is ``pageSize``. Nothing fails loudly when a client
gets it wrong -- the extra parameter is ignored, the default of 10 applies, and
the caller quietly paginates wrong.
"""

from web.tests.frozen_contract import CONTRACT

import re
import sys
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import API_PREFIX, create_app  # noqa: E402
from web.auth import MCP_TOOLS_CACHE_PREFIX, current_user  # noqa: E402
from web.config import WebConfig  # noqa: E402
from web.mcp_config import (  # noqa: E402
    DeployConfigError,
    assert_connection_allowed,
    extract_host,
    extract_name_from_config,
    extract_url,
    normalize_origin,
    normalize_origins,
    parse_deploy_config,
    resolve_install_type,
)
from web.models.mcp_server import McpServer  # noqa: E402
from web.response import BizError, ErrorCode  # noqa: E402
from web.routers.mcp_server import (  # noqa: E402
    MCP_CODE_LENGTH,
    _find,
    _require,
    _to_detail,
    _validate,
    new_mcp_server_code,
    router,
)
from web.schemas.mcp_server import (  # noqa: E402
    ALLOWED_INSTALL_TYPES,
    DEFAULT_INSTALL_TYPE,
    STATUS_ACTIVE,
    STATUS_DELETED,
    McpServerDetail,
)


SSE_CONFIG = (
    '{"mcpServers": {"eye-kb": {"name": "eye-kb", "type": "sse",'
    ' "url": "https://mcp.example.com/sse"}}}'
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", future=True)
    McpServer.__table__.create(engine)
    session = sessionmaker(bind=engine, future=True)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _row(**overrides) -> McpServer:
    defaults = dict(
        id=1, mcp_server_code="a" * 32, user_id=7, name="eye-kb",
        description="d", deploy_config=SSE_CONFIG, status=STATUS_ACTIVE,
        install_type="SSE", host="https://mcp.example.com",
        create_time=datetime(2026, 1, 1), update_time=datetime(2026, 1, 1),
    )
    defaults.update(overrides)
    return McpServer(**defaults)


# ---------------------------------------------------------------------------
# Structural: endpoint parity
# ---------------------------------------------------------------------------
def test_all_five_endpoints_are_present():
    """Create and update live on the collection root -- ``POST /mcp-server`` and
    ``PUT /mcp-server`` -- not under a sub-path. A router that added ``/create``
    would 404 for every call."""
    spec = create_app().openapi()
    paths = {p[len(API_PREFIX):]: set(v) for p, v in spec["paths"].items()
             if p.startswith(f"{API_PREFIX}/mcp-server")}
    assert paths == {
        "/mcp-server": {"get", "post", "put"},
        "/mcp-server/{mcpServerCode}": {"get", "delete"},
    }


def test_java_declares_the_same_five():
    expected = {(v, p) for v, p in CONTRACT["routes"] if p.startswith("/api/mcp-server")}
    actual = {(v, p) for p, ops in create_app().openapi()["paths"].items() if p.startswith("/api/mcp-server") for v in ops}
    assert actual == expected


def test_every_route_requires_a_signed_in_user():
    for route in router.routes:
        found = [
            d for d in route.dependant.dependencies
            if getattr(getattr(d.call, "func", d.call), "__name__", "") == "current_user"
        ]
        assert found, route.path


def test_pagination_uses_size_not_page_size():
    """The one domain that takes ``size``. Every other domain takes
    ``pageSize``; a shared client helper using the wrong name gets silently
    ignored and paginates by the default 10."""
    route = next(
        r for r in router.routes if r.path == "/mcp-server" and "GET" in r.methods
    )
    params = {p.name for p in route.dependant.query_params}
    assert params == {"name", "current", "size"}
    assert "pageSize" not in params

    assert next(p for p in route.dependant.query_params if p.name == "size").default == 10
    assert next(p for p in route.dependant.query_params if p.name == "current").default == 1


def test_need_tools_defaults_to_false():
    route = next(
        r for r in router.routes
        if r.path.endswith("{mcpServerCode}") and "GET" in r.methods
    )
    query = next(p for p in route.dependant.query_params if p.name == "needTools")
    assert query.default is False


# ---------------------------------------------------------------------------
# deployConfig parsing
# ---------------------------------------------------------------------------
def test_valid_config_parses():
    assert parse_deploy_config(SSE_CONFIG)["mcpServers"]["eye-kb"]["type"] == "sse"


def test_missing_config_is_rejected():
    for blank in (None, "", "   "):
        with pytest.raises(DeployConfigError, match="required"):
            parse_deploy_config(blank)


def test_malformed_json_is_rejected():
    with pytest.raises(DeployConfigError, match="not valid JSON"):
        parse_deploy_config("{not json")


def test_json_array_is_rejected_as_a_type_error_not_a_syntax_error():
    """Java casts to ``ObjectNode``; an array parses fine and then throws
    ``ClassCastException``, which is *not* a ``JsonProcessingException`` -- so it
    escapes to the catch-all as ``50000``/``系统错误`` instead of the intended
    parameter error. Naming the actual type is strictly more useful."""
    with pytest.raises(DeployConfigError, match="must be a JSON object"):
        parse_deploy_config("[]")
    with pytest.raises(DeployConfigError, match="must be a JSON object"):
        parse_deploy_config("42")


# ---------------------------------------------------------------------------
# Name derivation
# ---------------------------------------------------------------------------
def test_name_prefers_the_inner_name_field():
    config = {"mcpServers": {"key-name": {"name": "display-name"}}}
    assert extract_name_from_config(config) == "display-name"


def test_name_falls_back_to_the_mcp_servers_key():
    config = {"mcpServers": {"key-name": {"url": "https://x"}}}
    assert extract_name_from_config(config) == "key-name"


def test_name_falls_back_to_the_top_level_name():
    assert extract_name_from_config({"name": "top"}) == "top"


def test_name_is_empty_when_nothing_is_usable():
    assert extract_name_from_config({}) == ""
    assert extract_name_from_config({"mcpServers": {}}) == ""
    assert extract_name_from_config({"mcpServers": {"  ": {"name": "  "}}}) == ""
    assert extract_name_from_config({"name": "   "}) == ""


def test_name_uses_the_first_server_in_insertion_order_not_sorted_order():
    """``fields().next()`` walks **insertion** order, and ``json.loads``
    preserves it. Sorting the keys would pick a different server's name for a
    multi-server config, and that name is what the Agent shows the user."""
    config = {
        "mcpServers": {
            "zzz": {"name": "first-inserted"},
            "aaa": {"name": "last-alphabetically"},
        }
    }
    assert extract_name_from_config(config) == "first-inserted"


def test_validate_checks_config_before_name():
    """Java validates ``deployConfig`` first, so a request missing both reports
    the config error."""
    with pytest.raises(DeployConfigError):
        _validate(None, None)


def test_validate_requires_a_name_only_when_the_config_yields_none():
    with pytest.raises(BizError, match="name is required"):
        _validate("{}", None)
    # A name in the body is enough.
    assert _validate("{}", "given") == {}
    # As is one derived from the config.
    assert _validate(SSE_CONFIG, None)["mcpServers"]


# ---------------------------------------------------------------------------
# url / host extraction
# ---------------------------------------------------------------------------
def test_extract_url_takes_the_first_server():
    assert extract_url(parse_deploy_config(SSE_CONFIG)) == "https://mcp.example.com/sse"
    assert extract_url({}) is None
    assert extract_url({"mcpServers": {}}) is None


def test_non_string_url_is_treated_as_absent():
    """Java's ``(String)`` cast throws ``ClassCastException``, caught by the
    surrounding ``catch (Exception)`` -> null."""
    assert extract_url({"mcpServers": {"a": {"url": 123}}}) is None


def test_host_includes_an_explicit_port():
    config = {"mcpServers": {"a": {"url": "https://mcp.example.com:8443/sse"}}}
    assert extract_host(config) == "https://mcp.example.com:8443"


def test_host_omits_a_default_port():
    """``URL.getPort()`` returns -1 for the scheme's default, so no port is
    appended. ``https://a:443/x`` and ``https://a/x`` differ."""
    assert extract_host({"mcpServers": {"a": {"url": "https://a/x"}}}) == "https://a"
    assert extract_host({"mcpServers": {"a": {"url": "https://a:443/x"}}}) == "https://a:443"


def test_stdio_server_has_no_host():
    """There is nothing to connect to -- the process runs locally."""
    assert extract_host({"mcpServers": {"a": {"type": "stdio", "url": "https://a"}}}) == ""


def test_stdio_type_check_is_case_insensitive():
    assert extract_host({"mcpServers": {"a": {"type": "STDIO", "url": "https://a"}}}) == ""


def test_unparseable_config_yields_an_empty_host_not_an_error():
    """Java catches everything and returns ``""``. The policy check that follows
    is what actually gates the connection."""
    assert extract_host({}) == ""
    assert extract_host({"mcpServers": {"a": {}}}) == ""
    assert extract_host({"mcpServers": {"a": {"url": "not a url"}}}) == ""


# ---------------------------------------------------------------------------
# Connection policy -- the security boundary
# ---------------------------------------------------------------------------
ALLOWED = ["https://mcp.example.com"]


def test_stdio_is_refused():
    """The important one. A stdio MCP server is launched as a local subprocess
    with a command line taken from user input -- remote code execution."""
    with pytest.raises(BizError) as excinfo:
        assert_connection_allowed("STDIO", "https://mcp.example.com/sse", ALLOWED)
    assert excinfo.value.code == ErrorCode.NO_AUTH_ERROR.value
    assert "STDIO" in excinfo.value.message


def test_stdio_is_refused_case_insensitively():
    for value in ("stdio", "Stdio", "sTdIo"):
        with pytest.raises(BizError, match="STDIO"):
            assert_connection_allowed(value, "https://mcp.example.com", ALLOWED)


def test_padded_stdio_falls_through_to_the_unsupported_type_branch():
    with pytest.raises(BizError) as error:
        assert_connection_allowed(" stdio ", "https://mcp.example.com", ALLOWED)
    assert error.value.message == "不支持的 MCP 安装类型"


def test_unknown_install_type_is_refused():
    for value in ("HTTP", "WEBSOCKET", "", None):
        with pytest.raises(BizError) as excinfo:
            assert_connection_allowed(value, "https://mcp.example.com", ALLOWED)
        assert excinfo.value.code == ErrorCode.PARAMS_ERROR.value


def test_both_remote_transports_are_accepted():
    for value in ALLOWED_INSTALL_TYPES:
        assert_connection_allowed(value, "https://mcp.example.com/sse", ALLOWED)


def test_http_is_refused():
    """Only HTTPS. A plaintext remote MCP would put tool arguments -- which can
    include patient data -- on the wire in the clear."""
    with pytest.raises(BizError, match="HTTPS"):
        assert_connection_allowed("SSE", "http://mcp.example.com/sse", ALLOWED)


def test_userinfo_in_the_url_is_refused():
    """``https://user:pass@host`` -- the credentials would be logged and sent."""
    with pytest.raises(BizError, match="HTTPS"):
        assert_connection_allowed("SSE", "https://u:p@mcp.example.com/sse", ALLOWED)


def test_fragment_in_the_url_is_refused():
    with pytest.raises(BizError, match="HTTPS"):
        assert_connection_allowed("SSE", "https://mcp.example.com/sse#frag", ALLOWED)


def test_missing_url_is_a_parameter_error():
    with pytest.raises(BizError) as excinfo:
        assert_connection_allowed("SSE", None, ALLOWED)
    assert excinfo.value.code == ErrorCode.PARAMS_ERROR.value


def test_origin_not_in_the_allow_list_is_refused():
    with pytest.raises(BizError) as excinfo:
        assert_connection_allowed("SSE", "https://evil.example.com/sse", ALLOWED)
    assert excinfo.value.code == ErrorCode.NO_AUTH_ERROR.value


def test_empty_allow_list_refuses_everything():
    """The default. ``mcp.remote.allowed-origins`` is ``${...:}`` in Java and
    ``""`` here, so creating a remote MCP server fails out of the box. That is
    fail-closed, not a misconfiguration."""
    assert WebConfig().mcp_allowed_origins == ""
    assert normalize_origins("") == []
    with pytest.raises(BizError):
        assert_connection_allowed("SSE", "https://mcp.example.com/sse", [])


def test_allow_list_entry_with_a_path_matches_the_whole_origin():
    """``URI.create(scheme + "://" + authority)`` discards the path, so a
    configured ``https://a/path`` authorises any path on that origin."""
    assert normalize_origin("https://mcp.example.com/some/path") == "https://mcp.example.com"
    allowed = normalize_origins("https://mcp.example.com/some/path")
    assert_connection_allowed("SSE", "https://mcp.example.com/other/sse", allowed)


def test_allow_list_parses_multiple_entries_and_ignores_junk():
    assert normalize_origins("https://a, https://b:8443 ,, junk") == [
        "https://a", "https://b:8443"
    ]


def test_allow_list_path_on_the_target_is_irrelevant():
    allowed = normalize_origins("https://mcp.example.com")
    assert_connection_allowed("SSE", "https://mcp.example.com/deep/path", allowed)


def test_policy_source_matches_java():
    for transport, url, origins, message in [
        ("STDIO", None, [], "用户配置禁止使用 STDIO MCP"),
        ("HTTP", None, [], "不支持的 MCP 安装类型"),
        ("SSE", "http://bad", [], "MCP URL 必须是白名单内的 HTTPS 地址"),
        ("SSE", "https://bad", [], "MCP remote 地址未获授权")]:
        with pytest.raises(BizError) as error:
            assert_connection_allowed(transport, url, origins)
        assert error.value.message == message


def test_default_install_type_matches_java():
    assert DEFAULT_INSTALL_TYPE == CONTRACT["mcp"]["defaultInstallType"]
    for value in (None, "", "   "):
        assert resolve_install_type(value) == "SSE"
    assert resolve_install_type("STREAMABLE_HTTP") == "STREAMABLE_HTTP"


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------
def test_server_code_is_32_hex_chars():
    """``IdGenerator.idStr`` -- a dashes-stripped UUID. It is the public handle,
    so the frontend round-trips it as an opaque string."""
    code = new_mcp_server_code()
    assert len(code) == MCP_CODE_LENGTH == 32
    assert re.fullmatch(r"[0-9a-f]{32}", code)


def test_codes_are_unique():
    assert len({new_mcp_server_code() for _ in range(200)}) == 200


def test_lookup_is_scoped_to_the_owner(db):
    """A code is a random 32-char string, but ownership is still enforced --
    and a wrong owner gets ``50000``, not ``40400`` (finding J-18)."""
    db.add(_row(user_id=7))
    db.flush()

    assert _find(db, "a" * 32, 7) is not None
    assert _find(db, "a" * 32, 8) is None
    with pytest.raises(BizError) as excinfo:
        _require(db, "a" * 32, 8)
    assert excinfo.value.code == ErrorCode.SYSTEM_ERROR.value


def test_lookup_excludes_soft_deleted_rows(db):
    """``ne(status, 3)`` -- every read path filters it."""
    db.add(_row(status=STATUS_DELETED))
    db.flush()
    assert _find(db, "a" * 32, 7) is None


def test_status_values_match_the_java_writes():
    assert (STATUS_ACTIVE, STATUS_DELETED) == (CONTRACT["mcp"]["activeStatus"], CONTRACT["mcp"]["deletedStatus"])


def test_agent_filters_on_status_one():
    assert STATUS_ACTIVE == 1


def test_detail_exposes_the_code_not_the_primary_key():
    """``id`` is never on the wire; ``mcpServerCode`` is the handle."""
    dumped = _to_detail(_row()).model_dump(mode="json")
    assert set(dumped) == {
        "mcpServerCode", "name", "description", "deployConfig",
        "status", "installType", "host", "tools",
    }
    assert "id" not in dumped
    assert dumped["mcpServerCode"] == "a" * 32


def test_deploy_config_is_returned_verbatim(db):
    """It is a JSON **string**, not an object. Parsing it server-side would
    change the response shape -- the frontend parses it itself."""
    detail = _to_detail(_row())
    assert isinstance(detail.deployConfig, str)
    assert detail.deployConfig == SSE_CONFIG


def test_status_is_a_number_on_the_wire():
    assert isinstance(_to_detail(_row()).model_dump(mode="json")["status"], int)


# ---------------------------------------------------------------------------
# Cache invalidation
# ---------------------------------------------------------------------------
def test_tool_cache_prefix_matches_the_java_constant():
    assert MCP_TOOLS_CACHE_PREFIX == CONTRACT["mcp"]["toolsCachePrefix"]


# ---------------------------------------------------------------------------
# The GraphQL-shaped gap: needTools
# ---------------------------------------------------------------------------
def test_need_tools_fails_loudly_rather_than_returning_an_empty_list():
    """``needTools=true`` requires an MCP client, which is Agent subsystem code
    and stays on Java. Returning ``tools: []`` would read as "this server
    exposes no tools" -- indistinguishable from a working empty server."""
    source = (ALGORITHM_ROOT / "web" / "routers" / "mcp_server.py").read_text(encoding="utf-8")
    assert "MCPManager" in source
    assert "raise BizError(" in source.split("if needTools:")[1].split("return BaseResponse")[0]


def test_no_frontend_code_calls_need_tools():
    """Which is why the gap is acceptable: the generated client exports
    ``getMcpServer`` and nothing imports it."""
    callers = [
        path
        for path in (REPO_ROOT / "frontend" / "src").rglob("*.vue")
        if "getMcpServer" in path.read_text(encoding="utf-8", errors="ignore")
    ]
    assert callers == [], callers
