"""Historical mixed-deployment routing against frozen and Python registries.

No Java source tree is read. The new Python Compose proxy is separately checked
through the real address-change and browser delivery smoke.
"""

from web.tests.frozen_contract import CONTRACT

import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import API_PREFIX, create_app  # noqa: E402

NGINX_CONF = REPO_ROOT / "deploy" / "nginx.conf"
SNIPPET = REPO_ROOT / "deploy" / "snippets" / "eye-proxy-headers.conf"

#: The three paths Python took over in ticket 02. They used to be pinned to
#: Java with ``=`` locations, because Spring Session's Redis payload is
#: JDK-serialized and Python could not read it. Python now keeps its own
#: session namespace, so these ride the ``/api/`` catch-all like every other
#: migrated path.
SESSION_PATHS = {"/api/user/login", "/api/user/logout", "/api/user/get/login"}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def _blocks(conf: str) -> list[tuple[str, str, str]]:
    """``(kind, pattern, body)`` for every location block.

    A hand-rolled scanner rather than a regex: location bodies contain nested
    braces (the ``/assets/`` block), and a non-greedy regex would stop at the
    first ``}``.
    """
    blocks = []
    for match in re.finditer(r"location\s+(=|\^~)?\s*([^\s{]+)\s*\{", conf):
        modifier, pattern = match.group(1) or "", match.group(2)
        depth = 1
        index = match.end()
        while index < len(conf) and depth:
            if conf[index] == "{":
                depth += 1
            elif conf[index] == "}":
                depth -= 1
            index += 1
        blocks.append((modifier, pattern, conf[match.end():index]))
    return blocks


@pytest.fixture(scope="module")
def conf() -> str:
    return NGINX_CONF.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def blocks(conf):
    return _blocks(conf)


def _upstream(body: str) -> str | None:
    match = re.search(r"proxy_pass\s+http://(\w+)", body)
    return match.group(1) if match else None


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------
def test_the_snippet_is_included_by_every_proxy_block(blocks):
    """A location that skips the shared headers loses `Host`, which Spring
    Session uses to derive the cookie domain. The session cookie then stops
    being accepted and every authenticated request 401s."""
    proxying = [(mod, pat, body) for mod, pat, body in blocks if _upstream(body)]
    assert proxying, "no proxy locations found -- did the parser break?"
    for _mod, pattern, body in proxying:
        assert "eye-proxy-headers.conf" in body, pattern


def test_only_the_two_expected_upstreams_are_used(blocks):
    targets = {_upstream(body) for _m, _p, body in blocks if _upstream(body)}
    assert targets <= {"eye_java", "eye_python"}


def test_snippet_sets_the_headers_spring_session_needs():
    text = SNIPPET.read_text(encoding="utf-8")
    assert "proxy_set_header Host              $http_host;" in text
    assert "proxy_set_header X-Forwarded-Proto $scheme;" in text


# ---------------------------------------------------------------------------
# The routing table itself
# ---------------------------------------------------------------------------
def test_no_location_pins_a_session_path_to_java(blocks):
    """The regression guard for ticket 02.

    While Java owned the session these three were ``=`` exact matches above the
    catch-all, because ``/api/user/loginSomething`` had to keep going to Java's
    controller. Python owns them now, so any surviving ``location = ...`` block
    pointing at ``eye_java`` is a leftover: it would shadow the ``/api/``
    catch-all and hand the login to a backend that is no longer authoritative
    for it -- the browser would get a ``SESSION`` cookie back while every other
    endpoint answers from Python's ``EYE_SESSION`` namespace.
    """
    to_java = {
        pattern for modifier, pattern, body in blocks
        if modifier == "=" and _upstream(body) == "eye_java"
    }
    assert SESSION_PATHS & to_java == set(), SESSION_PATHS & to_java
    assert _route("/api/user/login", blocks) == "eye_python"


def test_a_stray_user_path_under_a_session_prefix_would_reach_python(blocks):
    """The other half of why the exact matches were removed.

    With ``location = /api/user/login`` gone, ``/api/user/loginSomething`` is
    just an unmigrated path that falls through to ``/api/`` -- it 404s from
    Python instead of silently reaching Java. A shadow rule would have made
    that invisible.
    """
    assert _route("/api/user/loginSomething", blocks) == "eye_python"


def test_agent_prefix_routes_to_python(blocks):
    agent = [
        body for _m, pattern, body in blocks
        if pattern == "/api/agent/" and _upstream(body) == "eye_python"
    ]
    assert agent, "session chat must reach Python after V17"


def test_sse_location_is_longer_than_the_agent_prefix(blocks):
    """Nginx picks the longest prefix match, so the SSE block only wins if its
    pattern is strictly longer than ``/api/agent/``. Equal-length or shorter and
    the stream silently loses ``proxy_buffering off``."""
    patterns = [p for _m, p, _b in blocks if p.startswith("/api/agent/")]
    assert "/api/agent/chat/stream" in patterns
    assert len("/api/agent/chat/stream") > len("/api/agent/")


def test_sse_disables_buffering(blocks):
    """The hard requirement. Buffered, a token stream is flushed as one response
    when the model finishes -- the chat appears to hang, then dumps everything
    at once."""
    body = next(
        b for _m, p, b in blocks if p == "/api/agent/chat/stream"
    )
    assert "proxy_buffering off;" in body
    assert "proxy_cache off;" in body
    assert "proxy_set_header Connection \"\";" in SNIPPET.read_text(encoding="utf-8")
    # The default 60s read timeout would cut an answer off mid-sentence.
    assert "proxy_read_timeout 3600s;" in body


def test_everything_else_under_api_goes_to_python(blocks):
    root = [
        (pattern, _upstream(body)) for _m, pattern, body in blocks
        if pattern == "/api/" and _upstream(body)
    ]
    assert root == [("/api/", "eye_python")]


def test_body_size_limit_matches_spring(conf):
    assert "client_max_body_size 10m;" in conf
    assert CONTRACT["config"]["maxUploadBytes"] == 10 * 1024 * 1024


def test_the_listener_port_is_the_one_java_used(conf):
    """8081, so the frontend's baseURL and the hardcoded value in
    ``useAgentStream.ts`` keep working with no change."""
    assert "listen 8081;" in conf
    assert "server 127.0.0.1:8082;" in conf   # separate from the Nginx listener
    assert "server 127.0.0.1:8080;" in conf   # the Python upstream


def test_delete_bodies_are_not_buffered_away(conf):
    """``DELETE /api/knowledge/delete`` carries ``{"id": ...}``.

    nginx forwards request bodies for every method as long as nothing disables
    it, so the assertion is the absence of the directives that would:
    ``proxy_pass_request_body off`` drops it, and a ``proxy_set_body`` rewrite
    would replace it.
    """
    assert "proxy_pass_request_body off" not in conf
    assert "proxy_set_body" not in conf


# ---------------------------------------------------------------------------
# Config vs. the real registries -- the three-way match
# ---------------------------------------------------------------------------
def _python_paths() -> set[str]:
    spec = create_app().openapi()
    return set(spec["paths"])


def _java_paths():
    return {p for _, p in CONTRACT["routes"]}


def test_no_python_route_falls_outside_the_routed_prefixes():
    """A Python route that Nginx does not route to Python is unreachable.

    Every Python router is mounted under ``/api`` and the catch-all is
    ``location /api/``, so this asserts the mount prefix has not drifted.
    """
    unrouted = {p for p in _python_paths() if not p.startswith(f"{API_PREFIX}/")}
    assert unrouted == set(), unrouted


def test_python_serves_all_three_session_paths(blocks):
    """The inverse of the old shadowing test.

    When Java owned the session, a Python route on one of these paths was a bug:
    which backend answered would depend on Nginx's match rules rather than on
    the code. Now Python is the owner, so the same path on both sides is the
    expected state -- but only because ``nginx.conf`` agrees, which is what the
    routing assertion here checks. Both halves are asserted together on purpose:
    "Python has the route" and "the route reaches Python" can drift apart, and
    either drift is a login page that silently stops working.
    """
    assert _python_paths() & SESSION_PATHS == SESSION_PATHS
    for path in SESSION_PATHS:
        assert _route(path, blocks) == "eye_python", path


def test_python_agent_routes_reach_python(blocks):
    paths = {p for p in _python_paths() if p.startswith("/api/agent/")}
    assert paths
    assert all(_route(p, blocks) == "eye_python" for p in paths)


def test_every_non_agent_java_route_is_covered_by_its_intended_backend(blocks):
    """The completeness check.

    For each Java controller mapping outside ``/api/agent/``, decide from the
    config which backend Nginx would pick, and assert it is the one that is
    supposed to own it. Since ticket 02 that is Python for *all* of them,
    including the session paths -- Java's own ``UserController`` still declares
    them, because ticket 08 is what removes Java, so their presence in
    ``_java_paths()`` is expected and is not evidence they should route there.

    This is what catches "domain migrated but the location still points at
    Java".
    """
    java = _java_paths()
    assert java, "no Java mappings parsed -- did the parser break?"

    misrouted = {}
    for path in sorted(java - {"/api"}):
        if path.startswith("/api/agent/"):
            continue
        target = _route(path, blocks)
        if target != "eye_python":
            misrouted[path] = (target, "eye_python")
    assert misrouted == {}, misrouted


def _route(path: str, blocks) -> str | None:
    """Which upstream nginx would pick, following its match order:

    1. ``=`` exact
    2. longest prefix
    """
    for modifier, pattern, body in blocks:
        if modifier == "=" and pattern == path:
            return _upstream(body)
    best, best_len = None, -1
    for modifier, pattern, body in blocks:
        if modifier == "=":
            continue
        if pattern.endswith("/") and path.startswith(pattern) and len(pattern) > best_len:
            best, best_len = _upstream(body), len(pattern)
    return best


def test_the_route_resolver_agrees_with_nginx_on_the_known_cases(blocks):
    """Guards the helper above. If ``_route`` were wrong, the completeness test
    would pass against a wrong config."""
    assert _route("/api/user/login", blocks) == "eye_python"
    assert _route("/api/user/logout", blocks) == "eye_python"
    assert _route("/api/user/get/login", blocks) == "eye_python"
    assert _route("/api/agent/chat/stream", blocks) == "eye_python"
    assert _route("/api/agent/sessions", blocks) == "eye_python"
    # The prefix match is on "/api/user/" + something, not on "/api/user".
    assert _route("/api/user/list/page/vo", blocks) == "eye_python"
    assert _route("/api/diagnosis/diagnosis", blocks) == "eye_python"
    assert _route("/api/knowledge/delete", blocks) == "eye_python"
    assert _route("/api/mcp-server", blocks) == "eye_python"


def test_no_user_path_is_routed_to_java_at_all(blocks):
    """The three session paths used to be the only Java-routed ``/api/user/*``
    entries, distinguished by ``=`` exact matches sitting above the catch-all.
    With those gone, every user path resolves the same way -- which is what
    makes the next migrated domain safe to add.

    ``/api/user/diagnosis/reexamine`` is here because it is the Python route
    most easily mistaken for one of the old exact matches: it lives under the
    same ``/api/user/`` prefix.
    """
    user_paths = {p for p in _java_paths() if p.startswith("/api/user/")}
    assert user_paths, "no /user mappings parsed -- did the parser break?"
    for path in sorted(user_paths):
        assert _route(path, blocks) == "eye_python", path
