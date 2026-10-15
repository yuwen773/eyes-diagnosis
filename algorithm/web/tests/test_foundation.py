"""Contract tests for the Phase 1 foundation.

These lock the behaviours the frontend depends on but cannot detect on its own
-- the ones that fail *silently*. Each test names the Java source it mirrors so
a future reader can check intent without reading this file's history.

The frontend has essentially no automated coverage of the API surface, so this
file is the regression net for the whole rewrite.
"""

import sys
from datetime import datetime
from functools import partial
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.app import API_PREFIX, create_app  # noqa: E402
from web.auth import ADMIN_ROLE, DEFAULT_ROLE, LoginUser, require_role  # noqa: E402
from web.config import WebConfig  # noqa: E402
from web.db import MP_TWEPOCH, Base, SnowflakeIdGenerator  # noqa: E402
from web.deps import get_db  # noqa: E402
from web.response import (  # noqa: E402
    BaseResponse,
    BizError,
    DateTimeStr,
    ErrorCode,
    LongStr,
    PageResult,
)
from web.tests.session_fixtures import Identity, install_sessions  # noqa: E402

#: FastAPI dependencies bind the role via partial; `require_role` keeps the
#: required role outside the request's query parameters.
_require_any = partial(require_role, DEFAULT_ROLE)
_require_admin = partial(require_role, ADMIN_ROLE)

# --- expected ErrorCode values, transcribed from exception/ErrorCode.java:15-26 ---
EXPECTED_ERROR_CODES = {
    "SUCCESS": (0, "ok"),
    "PARAMS_ERROR": (40000, "请求参数错误"),
    "NOT_LOGIN_ERROR": (40100, "未登录"),
    "NO_AUTH_ERROR": (40101, "无权限"),
    "NOT_FOUND_ERROR": (40400, "请求数据不存在"),
    "FORBIDDEN_ERROR": (40300, "禁止访问"),
    "SYSTEM_ERROR": (50000, "系统内部异常"),
    "OPERATION_ERROR": (50001, "操作失败"),
    "DIAGNOSIS_REJECTED_QUALITY": (40010, "图片质量不合格"),
    "DIAGNOSIS_REJECTED_OOD": (40011, "图像分布外"),
    "DIAGNOSIS_NEEDS_REVIEW": (40012, "诊断结果需人工复核"),
}


# --------------------------------------------------------------------------
# Contract 1 & 2: envelope shape and success code
# --------------------------------------------------------------------------
def test_error_codes_match_java():
    """All 11 codes and their Chinese messages are part of the contract --
    the frontend renders `msg` verbatim in toasts."""
    assert len(ErrorCode) == 11
    for name, (code, message) in EXPECTED_ERROR_CODES.items():
        assert ErrorCode[name].value == code
        assert ErrorCode[name].message == message


def test_success_envelope_shape():
    """BaseResponse.java + ResultUtils.success(): exactly code/msg/data, msg is
    "ok" -- NOT the empty string the unused 2-arg constructor would produce."""
    body = BaseResponse.success({"a": 1}).model_dump(mode="json")
    assert set(body) == {"code", "msg", "data"}
    assert body["code"] == 0
    assert body["msg"] == "ok"
    assert body["data"] == {"a": 1}


# --------------------------------------------------------------------------
# Contract 3: every handled error is HTTP 200
# --------------------------------------------------------------------------
def _client_with(router: APIRouter) -> TestClient:
    app = create_app(WebConfig())
    app.include_router(router, prefix=API_PREFIX)
    # The lifespan would try to reach MySQL/Redis/Java; these tests exercise
    # the envelope layer only, so skip startup entirely.
    return TestClient(app, raise_server_exceptions=False)


def test_biz_error_is_http_200_with_code():
    """GlobalExceptionHandler has no @ResponseStatus anywhere, so Spring
    serializes errors with status 200. request.ts:38 branches on data.code
    inside the *success* handler -- an HTTP 4xx would skip the login redirect."""
    router = APIRouter()

    @router.get("/boom")
    async def boom():
        raise BizError(ErrorCode.NOT_FOUND_ERROR)

    response = _client_with(router).get("/api/boom")
    assert response.status_code == 200
    assert response.json() == {"code": 40400, "msg": "请求数据不存在", "data": None}


def test_unhandled_exception_is_http_200_system_error():
    """GlobalExceptionHandler.java:37 passes the literal "系统错误", which is
    NOT ErrorCode.SYSTEM_ERROR's own message ("系统内部异常")."""
    router = APIRouter()

    @router.get("/kaboom")
    async def kaboom():
        raise RuntimeError("something deep broke")

    response = _client_with(router).get("/api/kaboom")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 50000
    assert body["msg"] == "系统错误"


def test_validation_error_maps_to_params_error():
    """Documented deviation: Spring reports a binding failure through its
    catch-all as 50000 "系统错误"; Python reports the accurate 40000. See
    web/middleware.py and docs/migration-decisions.md."""
    router = APIRouter()

    @router.get("/needy")
    async def needy(required: int):
        return required  # pragma: no cover

    response = _client_with(router).get("/api/needy")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == ErrorCode.PARAMS_ERROR.value
    assert body["data"] is None


def test_unrouted_path_is_404_like_spring():
    """Spring's BasicErrorController answers unrouted paths with a real 4xx,
    not the BaseResponse envelope."""
    assert _client_with(APIRouter()).get("/api/does-not-exist").status_code == 404


# --------------------------------------------------------------------------
# Contract 4 & 5: long ids and dates are strings
# --------------------------------------------------------------------------
def test_long_fields_serialize_as_strings():
    """JsonConfig.java:36-38 registers ToStringSerializer for Long and long, so
    every 64-bit field is a JSON string. Snowflake ids exceed 2^53, so emitting
    them as JSON numbers would silently corrupt them in the browser."""
    from pydantic import BaseModel

    class Row(BaseModel):
        id: LongStr
        user_id: LongStr
        create_time: DateTimeStr
        small_int: int

    body = json_of(
        BaseResponse.success(
            Row(
                id=1754000000000000001,
                user_id=7,
                create_time=datetime(2025, 1, 2, 3, 4, 5),
                small_int=42,
            )
        )
    )
    assert body["data"]["id"] == "1754000000000000001"
    assert body["data"]["user_id"] == "7"
    assert body["data"]["create_time"] == "2025-01-02 03:04:05"
    # int (not long) stays a number -- the rule is type-based, not blanket.
    assert body["data"]["small_int"] == 42
    assert isinstance(body["data"]["small_int"], int)
    assert isinstance(body["code"], int)


def json_of(model) -> dict:
    import json

    return json.loads(model.model_dump_json())


# --------------------------------------------------------------------------
# Contract 6 & 7: page envelope
# --------------------------------------------------------------------------
def test_page_numerics_are_strings():
    """IPage's getTotal/getSize/getCurrent/getPages all return `long`, so all
    four are strings on the wire. The frontend's `Number(res.data.data.total)`
    calls exist precisely because of this."""
    import json

    page = PageResult.of([], total=12, size=10, current=1)
    body = json.loads(page.model_dump_json())
    assert body["total"] == "12"
    assert body["size"] == "10"
    assert body["current"] == "1"
    assert body["pages"] == "2"
    assert set(body) >= {"records", "total", "size", "current", "pages"}


def test_page_pages_computation_is_ceil_and_zero_safe():
    assert PageResult.of([], total=10, size=10, current=1).pages == 1
    assert PageResult.of([], total=11, size=10, current=1).pages == 2
    assert PageResult.of([], total=0, size=10, current=1).pages == 0
    # IPage.getPages() returns 0 rather than dividing by zero.
    assert PageResult.of([], total=10, size=0, current=1).pages == 0


# --------------------------------------------------------------------------
# Auth semantics (aop/AuthInterceptor.java)
# --------------------------------------------------------------------------
def _app_for_auth(role: str | None) -> TestClient:
    """Client signed in as a ``t_user`` row carrying ``role`` (``None`` = anonymous).

    The role reaches the guard through a real row and a real session rather
    than through a stubbed probe, because that is how it reaches the guard now.
    ``superuser`` below is the case that matters: ``require_role`` has to reject
    a role it does not know, and that decision is only meaningful if the role
    arrives as data rather than as a parameter a stub could intercept.
    """
    app = create_app(WebConfig())
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)

    def database():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = database

    if role is None:
        sessions = install_sessions(app, engine, who={})
    else:
        identity = Identity(1754000000000000001, "u", role)
        sessions = install_sessions(app, engine, who={"caller": identity})

    router = APIRouter()

    @router.get("/any")
    async def any_user(user: LoginUser = Depends(_require_any)):
        return BaseResponse.success({"id": user.id})

    @router.get("/admin")
    async def admin_only(user: LoginUser = Depends(_require_admin)):
        return BaseResponse.success({"id": user.id})

    app.include_router(router, prefix=API_PREFIX)
    client = TestClient(app, raise_server_exceptions=False)
    if role is not None:
        sessions.authenticate(client, "caller")
    return client


def test_anonymous_gets_40100_not_40101():
    """AuthInterceptor resolves the login user *before* comparing roles, so an
    anonymous call yields NOT_LOGIN_ERROR. request.ts only redirects to the
    login page on 40100; 40101 would show "no permission" instead."""
    for path in ("/api/any", "/api/admin"):
        body = _app_for_auth(None).get(path).json()
        assert body["code"] == ErrorCode.NOT_LOGIN_ERROR.value, path


def test_regular_user_is_rejected_from_admin_route():
    body = _app_for_auth("user").get("/api/admin").json()
    assert body["code"] == ErrorCode.NO_AUTH_ERROR.value


def test_regular_user_allowed_on_default_role_route():
    body = _app_for_auth("user").get("/api/any").json()
    assert body["code"] == 0


def test_admin_allowed_on_both_routes():
    client = _app_for_auth("admin")
    assert client.get("/api/any").json()["code"] == 0
    assert client.get("/api/admin").json()["code"] == 0


def test_unknown_user_role_is_unauthorized():
    """AuthInterceptor.java:57-59: a userRole outside the UserRole enum is
    rejected before any admin comparison."""
    body = _app_for_auth("superuser").get("/api/any").json()
    assert body["code"] == ErrorCode.NO_AUTH_ERROR.value


def test_login_user_preserves_all_11_vo_fields():
    """LoginUserVO has 11 fields; gender/phone/email are vestigial constants
    because the matching entity fields are commented out."""
    assert len(LoginUser.model_fields) == 11
    defaults = LoginUser(id=1, userAccount="u")
    assert defaults.gender == 0
    assert defaults.phone is None
    assert defaults.email is None


# --------------------------------------------------------------------------
# Snowflake / primary keys
# --------------------------------------------------------------------------
def test_snowflake_matches_mp_layout():
    """Reproduces com.baomidou.mybatisplus.core.toolkit.Sequence so IDs are the
    same 19-digit magnitude as the Java ones already in the table."""
    import time

    generator = SnowflakeIdGenerator(worker_id=1, datacenter_id=1)
    ids = [generator.next_id() for _ in range(2000)]
    assert len(set(ids)) == len(ids)
    assert ids == sorted(ids)
    assert len(str(ids[0])) == 19

    sample = SnowflakeIdGenerator(worker_id=1, datacenter_id=1).next_id()
    assert abs((sample >> 22) + MP_TWEPOCH - int(time.time() * 1000)) < 1000
    assert (sample & 0xFFF) in (1, 2)  # MP starts a new ms at 1 or 2
    assert ((sample >> 12) & 0x1F) == 1
    assert ((sample >> 17) & 0x1F) == 1


@pytest.mark.parametrize("kwargs", [{"worker_id": 32}, {"worker_id": -1}, {"datacenter_id": 32}])
def test_snowflake_rejects_out_of_range_ids(kwargs):
    with pytest.raises(ValueError):
        SnowflakeIdGenerator(**kwargs)


# --------------------------------------------------------------------------
# ORM / schema mapping
# --------------------------------------------------------------------------
def test_orm_column_names_are_camel_case():
    """application.yml sets map-underscore-to-camel-case: false, so MyBatis
    Plus maps userAccount -> userAccount literally. snake_case columns would
    break every read against existing rows."""
    from web.db import Base
    import web.models  # noqa: F401  (registers the metadata)

    offenders = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if "_" in column.name
    ]
    assert offenders == []


def test_orm_maps_only_migrating_domains():
    """Legacy domains plus durable workflow and inference epochs are mapped here.

    ``t_inference_cache`` belongs to the *diagnosis* domain despite its earlier
    misfiling as an Agent table -- it is written only by
    ``DiagnosisServiceImpl``. See ruling 12 in docs/migration-decisions.md.
    """
    from web.db import Base
    import web.models  # noqa: F401

    assert set(Base.metadata.tables) == {
        "t_user",
        "t_diagnosis",
        "t_inference_cache",
        "t_inference_envelope",
        "t_explanation_snapshot",
        "t_diagnosis_save_confirmation",
        "t_saved_workflow_diagnosis",
        "t_human_review_task",
        "t_news",
        "t_paragraph",
        "t_attachment",
        "t_knowledge_document",
        "t_mcp_server",
        "t_diagnosis_workflow",
        "t_diagnosis_workflow_event",
        "t_workflow_job",
        "t_workflow_upload_input",
        "t_python_graph_checkpoint",
        "t_python_graph_write",
        "t_agent_session",
        "t_agent_message",
        "t_upload_task",
        "t_python_chat_run",
        "t_python_chat_attachment",
        "t_python_chat_audit",
        "t_python_chat_workflow",
        "t_python_chat_supplement",
        "t_agent_tool_confirmation",
    }


def test_unmigrated_legacy_chat_tables_are_not_mapped():
    """Issue 05 migrates Agent history and reads old uploads, not the unused chat domain."""
    from web.db import Base
    import web.models  # noqa: F401

    agent_tables = {
        "t_chat_session",
        "t_chat_history",
    }
    assert agent_tables.isdisjoint(Base.metadata.tables)


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
def test_config_rejects_wildcard_cors():
    """CorsConfigTest.configDoesNotUseWildcard: allow_credentials=True cannot
    be combined with a wildcard origin."""
    with pytest.raises(ValueError):
        WebConfig(cors_allowed_origins=["*"])


def test_config_redacts_secrets_in_repr():
    """Startup logs the config; COS credentials must not appear."""
    config = WebConfig(cos_secret_id="AKID-secret", cos_secret_key="do-not-log")
    assert "do-not-log" not in repr(config)
    assert "AKID-secret" not in repr(config)
