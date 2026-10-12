"""Authentication bridge to the Java session authority.

Why this forwards instead of reading Redis
------------------------------------------
The project sets ``spring.session.store-type: redis`` but has never configured
a ``RedisSerializer`` (``git log --all -S"RedisSerializer"`` returns nothing),
so Spring Session 3.5 falls back to ``JdkSerializationRedisSerializer``. Every
value in ``spring:session:sessions:<sid>`` -- including ``sessionAttr:user_login``
holding a serialized ``com.csust.eyediagnosis.model.entity.User`` -- is opaque
Java serialization. Python cannot decode it.

The reverse direction is worse: writing a session attribute Python-side would
make ``UserServiceImpl.java:165``'s ``(User) userObj`` cast throw
``ClassCastException`` inside Java.

So login/logout/session *ownership* stays in Java, and Python resolves the
caller by forwarding ``SESSION`` (or configured-deployment ``JSESSIONID``) to
``GET /api/user/get/login``. Every request revalidates with Java so logout and
expiry take effect without a second positive identity cache.
Nginx routes those three endpoints to Java directly (Phase 3), so this hop is
only on the Python side of the split.

Role semantics
--------------
:func:`require_role` reproduces ``aop/AuthInterceptor.java:42-64`` including
its ordering, which matters:

1. ``getLoginUser`` runs **before** any role comparison, so an anonymous
   request to an admin endpoint yields ``NOT_LOGIN_ERROR`` (40100), never
   ``NO_AUTH_ERROR`` (40101). The frontend's interceptor
   (``request.ts:38``) redirects to the login page only on 40100 -- a 40101
   would show "no permission" instead of "please sign in".
2. An unrecognised ``mustRole`` string maps to ``None`` in ``UserRole`` and
   falls through with **no check at all** (``AuthInterceptor.java:51-53``).
   Only the literal values ``user`` and ``admin`` exist in the enum, and
   ``AuthConstant.DEFAULT_ROLE = "user"`` therefore means "must be logged in":
   the sole role test is ``mustRole == ADMIN && userRole != ADMIN``.
"""

import logging

from fastapi import Request
from pydantic import BaseModel

from web.response import BizError, DateTimeStr, ErrorCode, LongStr

logger = logging.getLogger(__name__)

#: ``AuthConstant.DEFAULT_ROLE`` -- effectively "any logged-in user".
DEFAULT_ROLE = "user"
#: ``AuthConstant.ADMIN_ROLE``
ADMIN_ROLE = "admin"
#: ``UserRole.getEnumByValue`` recognises exactly these two values.
_KNOWN_ROLES = frozenset({DEFAULT_ROLE, ADMIN_ROLE})

#: Where Java caches an MCP server's discovered tools (R8): Python invalidates
#: this key after writes so the Agent picks up changes without the 5-minute
#: staleness window.
MCP_TOOLS_CACHE_PREFIX = "mcp:tools:"


class LoginUser(BaseModel):
    """``model/vo/user/LoginUserVO.java`` -- forwarded from Java verbatim.

    All 11 fields are declared because the frontend reads them directly. The
    last three are vestigial: ``gender``/``phone``/``email`` are commented out
    in ``User.java`` and the VO fills them with a constant 0 and two nulls.
    They are kept so the forwarded payload is byte-identical.
    """

    id: LongStr
    userAccount: str
    userName: str | None = None
    userAvatar: str | None = None
    userProfile: str | None = None
    userRole: str = DEFAULT_ROLE
    createTime: DateTimeStr | None = None
    updateTime: DateTimeStr | None = None
    gender: int = 0
    phone: None = None
    email: None = None


async def get_login_user(request: Request) -> LoginUser | None:
    """Resolve the caller, or ``None`` if not signed in.

    Does not raise: ``/user/get/login`` itself needs to distinguish "anonymous"
    from "error", and returning ``None`` keeps that decision at the call site.
    """
    # Spring Session defaults to SESSION; retain JSESSIONID for deployments
    # that explicitly use the servlet cookie name. Forward only that cookie.
    cookie_name = "SESSION" if "SESSION" in request.cookies else "JSESSIONID"
    sid = request.cookies.get(cookie_name)
    if not sid:
        return None

    # Java owns logout and session expiry. A positive Python cache would keep
    # a revoked session authorized until its TTL; revalidate every request.
    response = await request.app.state.java_client.get(
        "/user/get/login", headers={"Cookie": f"{cookie_name}={sid}"}
    )
    if response.status_code != 200:
        logger.warning("java login probe returned HTTP %s", response.status_code)
        return None

    body = response.json()
    if body.get("code") != ErrorCode.SUCCESS.value or body.get("data") is None:
        return None

    return LoginUser.model_validate(body["data"])


async def current_user(request: Request) -> LoginUser:
    """Require any signed-in user, else ``NOT_LOGIN_ERROR`` (40100)."""
    user = await get_login_user(request)
    if user is None:
        raise BizError(ErrorCode.NOT_LOGIN_ERROR)
    return user


async def require_role(must_role: str, request: Request) -> LoginUser:
    """Faithful port of ``AuthInterceptor#authCheck``.

    Bind must_role positionally in route dependencies so FastAPI cannot expose
    a keyword default as a caller-controlled query parameter.
    """
    # Step 1, before any role logic: not signed in is 40100, not 40101.
    user = await current_user(request)

    # Step 2: an unknown mustRole disables the check entirely (Java:51-53).
    if must_role not in _KNOWN_ROLES:
        return user

    # Step 3: a userRole outside the enum is unauthorized (Java:57-59).
    if user.userRole not in _KNOWN_ROLES:
        raise BizError(ErrorCode.NO_AUTH_ERROR)

    # Step 4: only admin is actually discriminated (Java:61-63). DEFAULT_ROLE
    # ("user") therefore means "logged in", with no admin/user distinction.
    if must_role == ADMIN_ROLE and user.userRole != ADMIN_ROLE:
        raise BizError(ErrorCode.NO_AUTH_ERROR)

    return user


async def require_admin(request: Request) -> LoginUser:
    return await require_role(ADMIN_ROLE, request)
