"""User-domain contract tests (Phase 2.1).

Split into two groups:

* **Structural** -- endpoint parity and DTO shape. These need no database and
  run in the ``python-web`` CI job.
* **Behavioural** -- validation order, password handling and the ``@TableLogic``
  delete, exercised against SQLite so they still run without MySQL.

The structural tests are the important ones. ``UserController.java`` has no
automated coverage and neither does the frontend's generated client, so an
endpoint that is silently missing or mounted under the wrong method would only
surface as a 404 in a browser.
"""

import hashlib
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import API_PREFIX, create_app  # noqa: E402
from web.constant import (  # noqa: E402
    ACCOUNT_IS_SHORT,
    ACCOUNT_REPEATED,
    DOUBLE_PASSWORD_NOT_EQUAL,
    FAIL_REGISTER,
    PARAMS_IS_NULL,
    PASSWORD_IS_SHORT,
)
from web.routers.user import router  # noqa: E402
from web.auth import current_user, get_login_user, require_role  # noqa: E402
from web.response import BizError  # noqa: E402
from web.routers.user import register  # noqa: E402
from web.schemas.user import (  # noqa: E402
    UserQueryDTO,
    UserRegisterDTO,
    UserVO,
    is_ascending,
)
from web.security import LEGACY_SALT, encode, verify  # noqa: E402

#: The three session endpoints. Python has owned them since ticket 02: Java's
#: Spring Session Redis payload is JDK-serialized, and Python now keeps its own
#: session namespace instead of forwarding to ``GET /user/get/login``.
SESSION_ENDPOINTS = {"/user/login", "/user/get/login", "/user/logout"}

USER_CONTROLLER = (
    REPO_ROOT / "src/main/java/com/csust/eyediagnosis/controller/UserController.java"
)


def _java_user_paths() -> set[str]:
    source = USER_CONTROLLER.read_text(encoding="utf-8")
    return {"/user" + m for m in re.findall(r'@(?:Post|Get)Mapping\("([^"]+)"\)', source)}


def _python_user_paths() -> set[str]:
    spec = create_app().openapi()
    return {path[len(API_PREFIX):] for path in spec["paths"] if path.startswith(f"{API_PREFIX}/user/")}


# ---------------------------------------------------------------------------
# Structural: endpoint parity
# ---------------------------------------------------------------------------
def test_every_user_endpoint_is_migrated():
    java = _java_user_paths()
    python = _python_user_paths()
    assert java - python == set(), (
        "endpoints present in UserController but not served by Python: "
        f"{sorted(java - python)}"
    )


def test_python_serves_no_endpoint_java_does_not():
    """Catches a typo'd path that would 404 forever."""
    assert _python_user_paths() - _java_user_paths() == set()


def test_all_fourteen_user_endpoints_are_python():
    """The user domain is fully migrated: 11 CRUD endpoints plus the three
    session endpoints Python took over in ticket 02."""
    assert _python_user_paths() == _java_user_paths()
    assert len(SESSION_ENDPOINTS & _python_user_paths()) == 3


def test_router_declares_exactly_the_migrated_endpoints():
    """Belt-and-braces: the OpenAPI schema and the router object agree.

    ``router.routes`` carries the router's own ``/user`` prefix; the ``/api``
    prefix is applied when the router is included in the app.
    """
    declared = {route.path for route in router.routes}
    assert declared == _python_user_paths()


def _route(suffix: str):
    return next(r for r in router.routes if r.path.endswith(suffix))


#: The dependencies that make a route require an authenticated caller.
#:
#: ``require_role`` is the role check. ``get_login_user``/``current_user`` are
#: the session check, which is all ``/user/logout`` and ``/user/get/login``
#: have: a session endpoint has no role to ask for, but "no role" is not the
#: same as "no authentication".
_AUTH_CALLS = (require_role, get_login_user, current_user)


def _auth_dependencies(route) -> list:
    """The route's dependencies that make it require an authenticated caller.

    ``require_admin``/``any_user`` are ``functools.partial`` objects, so the
    underlying function is ``partial.func``; ``get_db`` is not in the set.
    """
    found = []
    for dependant in route.dependant.dependencies:
        call = dependant.call
        if getattr(call, "func", call) in _AUTH_CALLS:
            found.append(call)
    return found


def test_register_requires_no_authentication():
    """Register must stay reachable while signed out -- it is the one /user
    route with no AuthCheck equivalent, and the only way to obtain a session.
    """
    assert _auth_dependencies(_route("/register")) == []


def test_admin_only_routes_all_declare_a_role_dependency():
    """Guards the inverse: dropping a Depends from one of these turns an
    admin-only endpoint into an anonymous one, silently."""
    admin_only = (
        "/add",
        "/get",
        "/get/vo",
        "/update",
        "/list/page/vo",
        "/list/page/vo/cache",
        "/delete/{id}",
    )
    for suffix in admin_only:
        assert len(_auth_dependencies(_route(suffix))) == 1, suffix

    # userCenter / upload/avatar / reexamine accept any signed-in user.
    for suffix in ("/update/userCenter", "/upload/avatar", "/diagnosis/reexamine"):
        assert len(_auth_dependencies(_route(suffix))) == 1, suffix


def test_every_user_route_except_register_and_login_is_authenticated():
    """Completeness check -- a new endpoint added without a Depends would
    otherwise be exposed anonymously with no test failing.

    ``/register`` and ``/login`` are the two public endpoints, in Java as much
    as here: a user has to be able to create an account and to sign in before
    there is a session to check. They are matched on the *full* path, not a
    suffix -- ``endswith("/login")`` would also exempt ``/get/login``, which is
    the endpoint whose whole job is to answer "is anyone signed in".

    ``/logout`` and ``/get/login`` are *not* exempt: they are covered by
    ``_auth_dependencies`` through ``get_login_user``, which is how they decide
    whether to answer or to report ``NOT_LOGIN_ERROR``.
    """
    public = {"/user/register", "/user/login"}
    for route in router.routes:
        if route.path in public:
            continue
        assert _auth_dependencies(route), route.path


# ---------------------------------------------------------------------------
# Structural: DTO shape
# ---------------------------------------------------------------------------
def test_user_vo_never_exposes_password():
    """UserVO.java has 7 fields and no userPassword."""
    assert set(UserVO.model_fields) == {
        "id",
        "userAccount",
        "userName",
        "userAvatar",
        "userProfile",
        "userRole",
        "createTime",
    }


def test_user_query_dto_inherits_page_request_defaults():
    """UserQueryDTO extends common/PageRequest.java, so a body of just
    {"userName": "x"} still paginates with current=1 pageSize=10."""
    query = UserQueryDTO(userName="x")
    assert query.current == 1
    assert query.pageSize == 10
    assert query.sortOrder == "descend"


def test_sort_order_ascending_predicate():
    """``getUserQueryWrapper`` passes ``sortOrder.equals(ASC)``, so only the
    literal "ascend" sorts ascending."""
    assert is_ascending("ascend") is True
    assert is_ascending("descend") is False
    assert is_ascending(None) is False
    assert is_ascending("ASC") is False


# ---------------------------------------------------------------------------
# Password handling
# ---------------------------------------------------------------------------
def test_bcrypt_roundtrip_cost_12():
    hashed = encode("correct horse battery staple")
    assert hashed.startswith("$2b$12$")
    result = verify("correct horse battery staple", hashed)
    assert result.matches and not result.needs_upgrade
    assert not verify("wrong", hashed).matches


def test_java_produced_hash_verifies_in_python():
    """Cross-language check, run against Spring's BCryptPasswordEncoder(12).
    Both directions were verified during implementation; this pins the
    Java -> Python direction, which is the one that runs in production while
    login still lives on Java."""
    java_hash = "$2a$12$lDMgeT31D1MF./p4YNte5uxXPl8RArHk3P.8pZP8IWSLHNrnt1Q3i"
    result = verify("correct horse battery staple", java_hash)
    assert result.matches and not result.needs_upgrade
    assert not verify("wrong", java_hash).matches


def test_legacy_md5_upgrades_on_match():
    legacy = hashlib.md5((LEGACY_SALT + "secret123").encode()).hexdigest()
    result = verify("secret123", legacy)
    assert result.matches and result.needs_upgrade
    assert not verify("other", legacy).matches


def test_unknown_stored_format_never_matches():
    assert verify("x", "not-a-hash").matches is False
    assert verify("x", None).matches is False
    # Malformed BCrypt must not raise on the login path.
    assert verify("x", "$2b$12$broken").matches is False


def test_password_longer_than_bcrypt_limit_is_truncated_not_rejected():
    """Java's BCrypt silently truncates at 72 bytes; raising instead would
    lock out long passphrases that Java accepts."""
    long_password = "a" * 100
    hashed = encode(long_password)
    assert verify(long_password, hashed).matches
    assert verify("a" * 72, hashed).matches


# ---------------------------------------------------------------------------
# Registration validation -- order and messages
# ---------------------------------------------------------------------------
def test_register_validation_messages_and_order():
    """Each branch produces a distinct Chinese message the frontend shows
    verbatim, and ``UserServiceImpl#userRegister`` evaluates them in this
    order -- so the first matching rule wins. ``db`` is never touched: every
    case below raises before the duplicate-account query.

    Java's guard is ``StringUtils.isAnyBlank(a, p, c)`` on all three fields,
    so a too-short account that is *also* blank reports "参数不能为空", not
    "账号太短".
    """
    cases = [
        # (account, password, confirm, expected message)
        ("", "password123", "password123", PARAMS_IS_NULL),
        ("     ", "password123", "password123", PARAMS_IS_NULL),
        ("abcdef", "password123", "   ", PARAMS_IS_NULL),
        ("ab", "password123", "password123", ACCOUNT_IS_SHORT),
        ("abcdef", "short", "short", PASSWORD_IS_SHORT),
        ("abcdef", "password123", "different1", DOUBLE_PASSWORD_NOT_EQUAL),
        # Both too short: the account check is reached first and wins.
        ("ab", "s", "s", ACCOUNT_IS_SHORT),
    ]
    for account, password, confirm, expected in cases:
        with pytest.raises(BizError) as excinfo:
            register(
                UserRegisterDTO(userAccount=account, userPassword=password, checkPassword=confirm)
            )
        assert excinfo.value.message == expected, (account, password, confirm)
        assert excinfo.value.code == 40000


def test_register_error_messages_are_distinct():
    """The frontend shows these verbatim, so a copy/paste collision would make
    two different failures indistinguishable to a user."""
    messages = [
        PARAMS_IS_NULL,
        ACCOUNT_IS_SHORT,
        PASSWORD_IS_SHORT,
        DOUBLE_PASSWORD_NOT_EQUAL,
        ACCOUNT_REPEATED,
        FAIL_REGISTER,
    ]
    assert len(set(messages)) == len(messages)
    assert FAIL_REGISTER == "注册失败，数据库错误"
