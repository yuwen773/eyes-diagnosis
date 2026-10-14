"""End-to-end wire contracts, exercised through HTTP.

The frontend has no tests and the generated API client has none either, so
nothing else in the build would catch a change to the response envelope or to a
field's JSON type. These tests drive the real app through ``TestClient`` with
only the database and the auth dependency swapped out, so they assert what a
browser actually receives -- not what a helper returns.

That distinction is the lesson from finding P-7: three phases of tests exercised
projection *helpers* and all passed while every list endpoint would have
returned ``50000``. Anything asserted here goes through the ASGI stack.

The 14 contracts are the ones enumerated in the migration plan; two of them were
corrected during implementation and the corrected values are what is asserted
(``msg`` is ``"ok"`` not ``""``, and ``severity`` is always ``NOT_ASSESSED``).
"""

import sys
from datetime import datetime
from importlib import import_module
from pathlib import Path

import pytest
import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import create_app  # noqa: E402
from web.auth import LoginUser, current_user, require_role  # noqa: E402
from web.db import Base  # noqa: E402
from web.deps import get_db  # noqa: E402
from web.models.diagnosis import Diagnosis  # noqa: E402
from web.models.knowledge import KnowledgeDocument  # noqa: E402
from web.models.mcp_server import McpServer  # noqa: E402
from web.models.news import News  # noqa: E402
from web.models.user import User  # noqa: E402
from web.response import DATE_FORMAT, ErrorCode  # noqa: E402

STAMP = datetime(2026, 3, 4, 5, 6, 7)

#: What every authenticated request in this file runs as.
ADMIN = LoginUser(
    id=7, userAccount="yuwen", userName="钰玟", userRole="admin",
    userAvatar="https://a.png", userProfile="p",
)

#: Java keeps these because Spring Session owns login/logout/session.
SESSION_PATHS = {"/api/user/login", "/api/user/logout", "/api/user/get/login"}


@pytest.fixture(scope="module")
def engine():
    """One in-memory SQLite database shared by every connection.

    ``StaticPool`` is required, not cosmetic: a plain ``sqlite://`` engine hands
    each checkout its own private database, so the fixture that seeds rows and
    the session the request handler uses would see different data -- the seed
    would commit successfully and every query would still return nothing.

    ``Base.metadata.create_all`` builds every table the migrated models define,
    so a newly added model cannot silently break this file by being absent.
    """
    engine = create_engine(
        "sqlite://",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine


def _override_auth(app):
    """Replace every ``require_role`` / ``current_user`` dependency with a stub user.

    Walked over the **domain routers**, not ``app.routes``: FastAPI 0.143 wraps
    ``include_router`` results in an ``_IncludedRouter`` and no longer flattens
    them, so ``app.routes`` contains five opaque entries and nothing to inspect.

    The keys are ``functools.partial`` objects -- ``require_admin`` and
    ``any_user`` are built at import time and captured in each endpoint's
    signature, so the *same* object has to be used as the key. Keying by
    ``require_role`` itself, or by name, silently overrides nothing and every
    request 401s.
    """
    from web.app import _DOMAIN_ROUTER_PATHS

    for path in _DOMAIN_ROUTER_PATHS:
        module = import_module(path)
        for route in module.router.routes:
            for dependant in route.dependant.dependencies:
                call = dependant.call
                if getattr(call, "func", call) in (require_role, current_user):
                    app.dependency_overrides[call] = lambda: ADMIN


@pytest.fixture(scope="module")
def client(engine):
    """A real app behind a real ASGI stack, with only the database and auth faked.

    Module-scoped: constructing a ``TestClient`` runs the lifespan, which builds
    the inference engine and logs a warning about missing weights. Doing that
    per test made this file take nearly two minutes -- most of it waiting on a
    connection that is never used. Isolation comes from ``_seed`` emptying the
    tables between tests instead.
    """
    app = create_app()

    session = sessionmaker(bind=engine, future=True)()

    def _db():
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise

    app.dependency_overrides[get_db] = _db
    _override_auth(app)

    with TestClient(app) as test_client:
        yield test_client
    session.close()


@pytest.fixture
def anonymous_client(engine):
    """The same app with the **real** auth dependency, so the 40100 path is
    exercised end to end rather than simulated."""
    app = create_app()
    session = sessionmaker(bind=engine, future=True)()

    def _db():
        yield session

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as test_client:
        yield test_client
    session.close()


@pytest.fixture(autouse=True)
def _seed(engine):
    session = sessionmaker(bind=engine, future=True)()
    for model in (Diagnosis, KnowledgeDocument, McpServer, News, User):
        session.query(model).delete()
    session.commit()
    yield session
    session.close()


def _call(client, method, url, **kwargs):
    """Every response, successful or not, is HTTP 200 with the envelope.

    Asserting the status here means a handler that accidentally raises a bare
    exception (which the catch-all turns into 200 + 50000) is distinguishable
    from one that returns a real error code -- the body says which.

    ``method`` may be an attribute name of ``TestClient`` or, via
    ``client.request``, the HTTP verb itself -- which is how the DELETE-with-a-
    body cases below are issued.
    """
    if method == "request":
        response = client.request(kwargs.pop("verb"), url, **kwargs)
    else:
        response = getattr(client, method)(url, **kwargs)
    assert response.status_code == 200, (response.status_code, response.text[:200])
    return response.json()


# ---------------------------------------------------------------------------
# 1-3. The envelope
# ---------------------------------------------------------------------------
def test_success_envelope_shape_and_code(client, _seed):
    """Contract 1 + 2. Exactly three keys, ``code`` is 0, ``msg`` is **"ok"**.

    ``BaseResponse`` has a two-arg constructor defaulting ``msg`` to ``""``, but
    every controller goes through ``ResultUtils.success()``, which passes
    ``"ok"`` -- the empty-string constructor is dead code
    (docs/migration-decisions.md ruling 8).
    """
    _seed.add(News(
        id=22, title="t", user_id=7, content="c", summary="s", cover_img="u",
        status=1, publish_time=STAMP, edit_time=STAMP,
    ))
    _seed.commit()

    body = _call(client, "get", "/api/news/get/22")
    assert set(body) == {"code", "msg", "data"}
    assert body["code"] == ErrorCode.SUCCESS.value == 0
    assert body["msg"] == "ok"
    assert body["data"] is not None


def test_error_envelope_shape_carries_a_null_data(client, _seed):
    """Contract 1, error branch. ``data`` is present and null, never absent."""
    body = _call(client, "get", "/api/news/get/999")
    assert set(body) == {"code", "msg", "data"}
    assert body["code"] == ErrorCode.NOT_FOUND_ERROR.value
    assert body["data"] is None
    assert body["msg"] == ErrorCode.NOT_FOUND_ERROR.message


def test_unauthenticated_is_http_200_with_code_40100(anonymous_client):
    """Contract 3.

    A real 401 would land in ``request.ts``'s transport-error branch and the
    user would never be redirected to the login page
    (docs/migration-decisions.md ruling 9).
    """
    response = anonymous_client.post("/api/user/list/page/vo", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == ErrorCode.NOT_LOGIN_ERROR.value == 40100
    assert body["msg"] == "未登录"


def test_no_cookie_reports_40100(anonymous_client):
    """Anonymous. ``get_login_user`` returns ``None`` before touching Redis, so
    this path needs no infrastructure.

    The code must be 40100 and never 40101: ``AuthInterceptor`` resolves the
    user *before* comparing roles, so "not signed in" has to win over "no
    permission" -- otherwise the frontend shows "无权限" instead of redirecting
    to the login page (web/auth.py).
    """
    response = anonymous_client.post("/api/user/list/page/vo", json={})
    assert response.status_code == 200
    assert response.json()["code"] == ErrorCode.NOT_LOGIN_ERROR.value == 40100


def test_a_cookie_with_unreachable_java_reports_system_error_not_40100(engine):
    """An unavailable session authority fails closed with the error envelope.

    Use a controlled HTTP failure so running local services cannot change this
    test. Positive login caching was removed by issue 01 to respect logout.
    """
    app = create_app()
    session = sessionmaker(bind=engine, future=True)()

    def _db():
        yield session

    app.dependency_overrides[get_db] = _db
    def unavailable(request):
        raise httpx.ConnectError("controlled Java outage", request=request)

    with TestClient(app, raise_server_exceptions=False) as raw:
        # Lifespan creates the production client; replace only the external
        # transport for this one request.
        import asyncio
        asyncio.run(app.state.java_client.aclose())
        app.state.java_client = httpx.AsyncClient(
            base_url="http://java/api/", transport=httpx.MockTransport(unavailable)
        )
        response = raw.post(
            "/api/user/list/page/vo",
            json={},
            headers={"Cookie": "JSESSIONID=not-a-real-session"},
        )
    session.close()

    assert response.status_code == 200
    assert response.json()["code"] == ErrorCode.SYSTEM_ERROR.value


def test_endpoint_set_matches_java_exactly():
    """The reconciliation, as a permanent assertion.

    Java's controllers and Python's routers are two independent registries, and
    nothing at runtime keeps them aligned. A path migrated in code but never
    counted here is a 404 the moment Nginx loads, and a path served by both is
    ambiguous routing.

    Path *placeholder* names are compared too. They are not part of a URL -- the
    generated client interpolates the value itself -- but ``npm run openapi``
    regenerates the TS signatures from this spec, so a snake_case placeholder
    would rename the generated ``deleteMcpServer(mcpServerCode)`` parameter for
    no benefit.
    """
    import pathlib
    import re

    java = set()
    controllers = pathlib.Path(
        REPO_ROOT / "src/main/java/com/csust/eyediagnosis/controller"
    )
    for path in controllers.glob("*.java"):
        source = path.read_text(encoding="utf-8")
        base = re.search(r'@RequestMapping\("([^"]*)"\)', source)
        base = base.group(1) if base else ""
        for verb, sub in re.findall(
            r'@(Post|Get|Put|Delete)Mapping(?:\(\s*(?:value\s*=\s*)?"([^"]*)"\s*\))?', source
        ):
            java.add((verb.lower(), f"/api{base}{sub}"))

    expected = {(verb, path) for verb, path in java
                if not path.startswith("/api/agent")
                and path not in SESSION_PATHS and path != "/api"}

    served = {(verb, path) for path, operations in create_app().openapi()["paths"].items()
              for verb in operations if verb in {"get", "post", "put", "patch", "delete"}}
    assert expected - served == set(), f"not migrated: {sorted(expected - served)}"
    # Issue 02 adds these independent async endpoints, preserving the exact
    # legacy surface. New endpoints are exercised through HTTP in test_workflow.
    new_workflows = {("post", "/api/diagnosis/workflows"),
                     ("get", "/api/diagnosis/workflows/{workflowId}/events"),
                     ("get", "/api/diagnosis/workflows/{workflowId}"),
                     ("get", "/api/diagnosis/workflows/{workflowId}/image"),
                     ("get", "/api/diagnosis/workflows/{workflowId}/save-confirmation"),
                     ("post", "/api/diagnosis/workflows/{workflowId}/save-confirmation"),
                     ("post", "/api/diagnosis/workflows/{workflowId}/save-confirmations/{confirmationId}/approve"),
                     ("post", "/api/diagnosis/workflows/{workflowId}/save-confirmations/{confirmationId}/reject"),
                     ("get", "/api/reviews/tasks"),
                     ("get", "/api/reviews/tasks/{taskId}"),
                     ("get", "/api/reviews/tasks/{taskId}/image"),
                     ("post", "/api/reviews/tasks/{taskId}/claim"),
                     ("post", "/api/reviews/tasks/{taskId}/submit")}
    chat_contracts = {("post", "/api/agent/chat/stream"), ("get", "/api/agent/sessions"),
        ("get", "/api/agent/history/{thread_id}"), ("get", "/api/agent/history/{session_id}/export"),
        ("delete", "/api/agent/sessions/batch"), ("delete", "/api/agent/sessions/{session_id}"),
        ("put", "/api/agent/sessions/{session_id}/title"), ("put", "/api/agent/sessions/{session_id}/pin"),
        ("post", "/api/agent/sessions/{session_id}/generate-title"),
        ("get", "/api/agent/supplements/{request_id}"),
        ("post", "/api/agent/supplements/{request_id}/reply"),
        ("get", "/api/agent/profile"), ("get", "/api/agent/tool-confirmations"),
        ("post", "/api/agent/tool-confirmations/{confirmation_id}/{action}"),
        ("post", "/api/agent/image/upload"), ("post", "/api/agent/image/upload/delete")}
    evidence_contracts = {("get", "/api/knowledge/admin/catalog"),
        ("post", "/api/knowledge/admin/documents"),
        ("patch", "/api/knowledge/admin/documents/{document_id}"),
        ("post", "/api/knowledge/search")}
    assert served - expected == new_workflows | chat_contracts | evidence_contracts, f"unexpected new surface: {sorted(served - expected)}"


def test_public_endpoints_need_no_session(anonymous_client):
    """The news list and detail carry no ``@AuthCheck`` in Java either --
    anonymous readers must keep working, and routing them through auth would
    lock the public pages."""
    assert anonymous_client.post(
        "/api/news/list/page/vo", json={}
    ).json()["code"] == ErrorCode.SUCCESS.value
    assert anonymous_client.get("/api/news/get/999").json()["code"] == (
        ErrorCode.NOT_FOUND_ERROR.value
    )


def test_malformed_body_is_a_parameter_error_not_a_system_error(client, _seed):
    """The one deliberate deviation (ruling 10).

    Java's catch-all reports a binding failure as ``50000``/``系统错误`` -- a
    client mistake reported as a server fault. Python maps it to ``40000``,
    which is what the Java *service* layer intends everywhere else.
    """
    body = _call(client, "post", "/api/news/list/page/vo", json={"current": "not-a-number"})
    assert body["code"] == ErrorCode.PARAMS_ERROR.value == 40000


def test_unrouted_path_is_a_real_404_not_an_envelope(client, _seed):
    """Spring's ``BasicErrorController`` answers an unmapped path with its own
    body and a real 4xx, not the envelope. Preserved, because the frontend
    treats that as a transport failure -- which is what a missing route is."""
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 4-5. Serialisation types
# ---------------------------------------------------------------------------
def test_ids_are_strings_everywhere(client, _seed):
    """Contract 4. ``JsonConfig`` registers ``ToStringSerializer`` for both
    ``Long.class`` and ``long.class``, so **every** 64-bit field is a JSON
    string. The frontend compensates with ``Number(...)`` at each call site."""
    _seed.add(User(
        id=9007199254740993, user_account="a", user_password="x", user_name="n", user_role="admin",
        create_time=STAMP, edit_time=STAMP, update_time=STAMP, is_delete=0,
    ))
    _seed.add(News(
        id=22, title="t", user_id=11, content="c", summary="s", cover_img="u",
        status=1, publish_time=STAMP, edit_time=STAMP,
    ))
    _seed.commit()

    news = _call(client, "get", "/api/news/get/22")["data"]
    assert news["id"] == "22" and isinstance(news["id"], str)

    users = _call(client, "post", "/api/user/list/page/vo", json={})["data"]
    assert isinstance(users["total"], str)
    assert isinstance(users["records"][0]["id"], str)
    assert users["records"][0]["id"] == "9007199254740993"


def test_dates_are_formatted_strings_everywhere(client, _seed):
    """Contract 5. ``"yyyy-MM-dd HH:mm:ss"`` for both ``java.util.Date``
    (``Diagnosis.createTime``) and ``LocalDateTime``
    (``KnowledgeDocument.createTime``) -- ``JsonConfig`` registers the formatter
    for both types, so the two look identical on the wire."""
    import re

    _seed.add(KnowledgeDocument(
        id=44, user_id=7, title="t", file_name="a.pdf", file_url="k",
        file_size=1, file_type="pdf", content_hash="ab" * 32, chunk_count=0,
        status=1, create_time=STAMP, update_time=STAMP, is_delete=0,
    ))
    _seed.commit()

    page = _call(client, "post", "/api/knowledge/list/page", json={})["data"]
    stamp = page["records"][0]["createTime"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", stamp), stamp
    assert stamp == "2026-03-04 05:06:07"


def test_legacy_java_date_is_utc_while_localdatetime_keeps_database_time(client, _seed):
    """JDBC reads DATETIME as Asia/Shanghai; Jackson Date defaults to UTC.

    Worked example: 2026-03-04 05:06:07 database time is the preceding
    2026-03-03 21:06:07 UTC. LocalDateTime (knowledge) has no instant conversion.
    """
    _seed.add(User(
        id=11, user_account="date", user_password="x", user_name="n", user_role="user",
        create_time=STAMP, edit_time=STAMP, update_time=STAMP, is_delete=0,
    ))
    _seed.add(_diagnosis_row())
    _seed.add(News(
        id=22, title="t", user_id=11, content="c", cover_img="u", status=1,
        publish_time=STAMP, edit_time=STAMP,
    ))
    _seed.commit()
    for url in ("/api/user/get/vo?id=11", "/api/diagnosis/get/33", "/api/news/get/22"):
        data = _call(client, "get", url)["data"]
        field = "publishTime" if "news" in url else "createTime"
        assert data[field] == "2026-03-03 21:06:07", url


# ---------------------------------------------------------------------------
# 6-7. Pagination
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "url,payload",
    [
        ("/api/user/list/page/vo", {}),
        ("/api/diagnosis/list/page/vo", {}),
        ("/api/news/list/page/vo", {}),
        ("/api/knowledge/list/page", {}),
    ],
)
def test_pagination_envelope_has_all_five_fields(client, _seed, url, payload):
    """Contract 6. MyBatis Plus's ``IPage`` exposes exactly these, and the
    frontend reads ``records``/``total``/``current``/``size``. All four numeric
    members are ``long`` in Java, so all four are strings."""
    page = _call(client, "post", url, json=payload)["data"]
    assert set(page) >= {"records", "total", "size", "current", "pages"}
    assert isinstance(page["records"], list)
    for key in ("total", "size", "current", "pages"):
        assert isinstance(page[key], str), key


def test_pagination_uses_pagesize_except_for_mcp_server(client, _seed):
    """Contract 7.

    Every domain takes ``pageSize`` except mcp-server, which takes ``size``.
    A client sharing one helper across domains gets its parameter silently
    ignored (FastAPI and Spring both drop unknown query params) and paginates by
    the default 10 -- no error, wrong page.
    """
    for url in (
        "/api/user/list/page/vo",
        "/api/diagnosis/list/page/vo",
        "/api/news/list/page/vo",
        "/api/knowledge/list/page",
    ):
        page = _call(client, "post", url, json={"pageSize": 3})["data"]
        assert page["size"] == "3", url

    mcp = _call(client, "get", "/api/mcp-server", params={"size": 3})["data"]
    assert mcp["size"] == "3"
    # ...and `pageSize` is not a parameter mcp-server understands.
    ignored = _call(client, "get", "/api/mcp-server", params={"pageSize": 3})["data"]
    assert ignored["size"] == "10"


# ---------------------------------------------------------------------------
# 8-9. Roles and logical delete
# ---------------------------------------------------------------------------
def test_user_role_is_admin_or_user(client, _seed):
    """Contract 8. A third value would fall outside ``UserRole``'s enum and
    ``AuthInterceptor`` would reject that user from every route."""
    _seed.add(User(
        id=11, user_account="a", user_password="x", user_name="n", user_role="admin",
        create_time=STAMP, edit_time=STAMP, update_time=STAMP, is_delete=0,
    ))
    _seed.commit()
    record = _call(client, "post", "/api/user/list/page/vo", json={})["data"]["records"][0]
    assert record["userRole"] in {"admin", "user"}


def test_logically_deleted_rows_disappear_from_reads(client, _seed):
    """Contract 9. ``@TableLogic`` turns ``removeById`` into
    ``UPDATE ... SET isDelete = 1``; the row stays for the Agent tables'
    foreign keys but every query filters it.

    Contrast news (finding J-6): ``t_news`` has no ``isDelete`` at all, so its
    delete is physical.
    """
    _seed.add(News(
        id=22, title="t", user_id=7, content="c", summary="s", cover_img="u",
        status=1, publish_time=STAMP, edit_time=STAMP,
    ))
    _seed.commit()
    assert _call(client, "get", "/api/news/get/22")["code"] == 0

    assert _call(client, "post", "/api/news/delete/22")["data"] is True
    assert _call(client, "get", "/api/news/get/22")["code"] == ErrorCode.NOT_FOUND_ERROR.value


# ---------------------------------------------------------------------------
# 10-12. Diagnosis result fields
# ---------------------------------------------------------------------------
def _diagnosis_row(**overrides) -> Diagnosis:
    defaults = dict(
        id=33, url="https://img.jpg", user_id=7, result="青光眼", probability=88.5,
        confidence=88.5, recommendations="建议一\n建议二", details="详情",
        severity="NOT_ASSESSED", reexamine_status=1, create_time=STAMP, is_delete=0,
        ai_rejected=0, human_review_status="AI_ONLY",
        model_version="efficientnet-b4@1.0.0", preprocess_version="v1",
        inference_policy_version="p", calibration_status="NOT_CALIBRATED",
        quality_score=90, ood_status="NOT_EVALUATED",
    )
    defaults.update(overrides)
    return Diagnosis(**defaults)


def test_severity_is_not_assessed_never_chinese(client, _seed):
    """Contract 10, **corrected**.

    The plan listed this as ``低``/``中``/``高``. ``DiagnosisServiceImpl:445``
    hardcodes ``"NOT_ASSESSED"`` and nothing infers a severity from the
    probability, so the Chinese branch in ``DiagnosisReportDetail.vue`` is dead
    code (ruling 14). Asserting the real value keeps anyone from "restoring" a
    severity the backend never sends.
    """
    _seed.add(_diagnosis_row())
    _seed.commit()
    data = _call(client, "get", "/api/diagnosis/get/33")["data"]
    assert data["severity"] == "NOT_ASSESSED"
    assert data["severity"] not in {"低", "中", "高"}


def test_human_review_status_is_one_of_five(client, _seed):
    """Contract 11."""
    valid = {"PENDING_AI", "AI_ONLY", "AWAITING_REVIEW", "REVIEWED", "OVERRIDDEN"}
    for status in sorted(valid):
        _seed.query(Diagnosis).delete()
        _seed.add(_diagnosis_row(human_review_status=status))
        _seed.commit()
        data = _call(client, "get", "/api/diagnosis/get/33")["data"]
        assert data["humanReviewStatus"] in valid, status


def test_requires_review_is_derived_from_the_status_not_stored(client, _seed):
    """``objToVo`` computes it as ``"AWAITING_REVIEW".equals(...)``. There is no
    column for it, so a client that trusts one over the other sees them
    disagree."""
    _seed.add(_diagnosis_row(human_review_status="AWAITING_REVIEW"))
    _seed.commit()
    assert _call(client, "get", "/api/diagnosis/get/33")["data"]["requiresReview"] is True

    _seed.query(Diagnosis).delete()
    _seed.add(_diagnosis_row(human_review_status="REVIEWED"))
    _seed.commit()
    assert _call(client, "get", "/api/diagnosis/get/33")["data"]["requiresReview"] is False


def test_recommendations_is_a_newline_joined_string_not_an_array(client, _seed):
    """Contract 12. The column is ``VARCHAR(512)`` and the frontend splits on
    ``\\n``. A JSON array here renders as ``[object Object]``."""
    _seed.add(_diagnosis_row(recommendations="第一条\n第二条"))
    _seed.commit()
    data = _call(client, "get", "/api/diagnosis/get/33")["data"]
    assert isinstance(data["recommendations"], str)
    assert data["recommendations"].startswith("[") is False
    assert data["recommendations"].split("\n") == ["第一条", "第二条"]


def test_a_rejected_diagnosis_hides_its_conclusion_over_http(client, _seed):
    """The clinically important one, asserted through the wire rather than
    through ``objToVo``: a rejected upload must not reach a patient with a
    label attached."""
    _seed.add(_diagnosis_row(ai_rejected=1, abstain_reason="LOW_CONFIDENCE"))
    _seed.commit()
    data = _call(client, "get", "/api/diagnosis/get/33")["data"]
    for field in ("result", "probability", "confidence", "recommendations",
                  "details", "severity", "otherDisease"):
        assert data[field] is None, field
    assert data["aiRejected"] is True
    assert data["abstainReason"] == "LOW_CONFIDENCE"


# ---------------------------------------------------------------------------
# 13-14. Multipart field names and DELETE bodies
# ---------------------------------------------------------------------------
def test_multipart_field_names_differ_by_domain():
    """Contract 13.

    ``knowledge`` takes ``files`` (plural, an array); every other upload takes
    ``file`` (singular). Getting it wrong binds nothing -- FastAPI raises a
    validation error here, which is the good outcome; a backend that made the
    field optional would accept the request and store nothing.
    """
    spec = create_app().openapi()

    def _multipart_props(path, method):
        content = spec["paths"][path][method].get("requestBody", {}).get("content", {})
        schema = content.get("multipart/form-data", {}).get("schema", {})
        ref = schema.get("$ref", "")
        name = ref.rsplit("/", 1)[-1]
        return set(spec["components"]["schemas"][name]["properties"])

    assert "files" in _multipart_props("/api/knowledge/upload", "post")
    assert "file" in _multipart_props("/api/diagnosis/diagnosis", "post")
    assert "file" in _multipart_props("/api/diagnosis/upload", "post")
    assert "file" in _multipart_props("/api/news/uploadAttachment", "post")
    assert "file" in _multipart_props("/api/news/uploadCover", "post")
    assert "file" in _multipart_props("/api/user/upload/avatar", "post")


def test_knowledge_delete_accepts_a_body(client, _seed):
    """Contract 14.

    ``DELETE`` with a JSON body is legal but unusual, and some proxies drop it.
    The Nginx config in ``deploy/nginx.conf`` forwards it; this asserts the app
    side reads it."""
    _seed.add(KnowledgeDocument(
        id=44, user_id=7, title="t", file_name="a.pdf", file_url="k",
        file_size=1, file_type="pdf", content_hash="ab" * 32, chunk_count=0,
        status=1, create_time=STAMP, update_time=STAMP, is_delete=0,
    ))
    _seed.commit()

    assert _call(client, "request", "/api/knowledge/delete", verb="DELETE",
                 json={"id": 44})["data"] is True
    assert _call(client, "post", "/api/knowledge/list/page", json={})["data"]["total"] == "0"


def test_knowledge_delete_without_an_id_is_a_parameter_error(client, _seed):
    body = _call(client, "request", "/api/knowledge/delete", verb="DELETE", json={})
    assert body["code"] == ErrorCode.PARAMS_ERROR.value


# ---------------------------------------------------------------------------
# Cross-cutting: the two things that bit us
# ---------------------------------------------------------------------------
def test_every_list_endpoint_returns_data_rather_than_50000(client, _seed):
    """Finding P-7, as a single regression net.

    camelCase VO fields could not be resolved from snake_case ORM attributes,
    so ``model_validate`` raised and every list endpoint answered
    ``50000``/``系统错误``. Testing the projection helpers missed it entirely
    because they build VOs by keyword. This asserts the boundary.
    """
    _seed.add(News(
        id=22, title="t", user_id=7, content="c", summary="s", cover_img="u",
        status=1, publish_time=STAMP, edit_time=STAMP,
    ))
    _seed.commit()

    for url in (
        "/api/user/list/page/vo",
        "/api/diagnosis/list/page/vo",
        "/api/news/list/page/vo",
        "/api/knowledge/list/page",
    ):
        body = _call(client, "post", url, json={})
        assert body["code"] == 0, (url, body["msg"])
        assert isinstance(body["data"]["records"], list)


def test_vo_field_names_stay_camel_case_over_http(client, _seed):
    """The other half of P-7: the SQLAlchemy aliases must not leak. A shared
    ``alias_generator`` producing snake_case would fix the projection and break
    every field name the frontend reads."""
    _seed.add(User(
        id=11, user_account="a", user_password="x", user_name="n", user_role="admin",
        user_avatar="https://a.png", user_profile="p",
        create_time=STAMP, edit_time=STAMP, update_time=STAMP, is_delete=0,
    ))
    _seed.commit()
    record = _call(client, "post", "/api/user/list/page/vo", json={})["data"]["records"][0]
    assert {"userAccount", "userName", "userAvatar", "userRole", "createTime"} <= set(record)
    assert not {"user_account", "user_name", "create_time"} & set(record)
    assert "userPassword" not in record


def test_cached_java_dates_match_the_first_http_response(client, _seed, monkeypatch):
    class MemoryRedis:
        def __init__(self):
            self.values = {}

        async def get(self, key):
            return self.values.get(key)

        async def setex(self, key, ttl, value):
            self.values[key] = value

    redis = MemoryRedis()
    monkeypatch.setattr(client.app.state, "redis", redis)
    _seed.add(_diagnosis_row())
    _seed.commit()
    url = "/api/diagnosis/list/page/vo/cache"
    first = _call(client, "post", url, json={})
    assert redis.values, "first response must populate the external cache"
    second = _call(client, "post", url, json={})
    assert second == first
