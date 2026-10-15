"""Authentication -- Python owns the login session.

What changed in ticket 02
-------------------------
This used to forward the ``SESSION``/``JSESSIONID`` cookie to Java's
``GET /user/get/login`` on every request and trust the ``LoginUserVO`` that came
back. Java owns that session because Spring Session's Redis payload is
JDK-serialized (``JdkSerializationRedisSerializer`` -- the project never
configures a ``RedisSerializer``), so Python could not read or write it.

Python manages its own sessions now (``web/session.py``), so there is nothing
left to forward to. The *semantics* are deliberately unchanged:

* the caller is re-resolved on every request -- no positive identity cache, so
  logout, expiry, logical delete and role changes take effect immediately, the
  same way ``UserServiceImpl#getLoginUser`` re-reads the row in Java;
* the Redis namespace and the cookie name are disjoint from Spring's, so a
  half-migrated Redis cannot corrupt a live Java session, and a browser still
  holding a Java cookie is simply anonymous here;
* an unreachable session authority is an error (``50000``), never an implicit
  "nobody is signed in".

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
3. The reverse test -- an unrecognised ``userRole`` -- is unauthorized. Java
   only ever wrote ``user``/``admin`` into ``t_user.userRole``, so "not in the
   enum" meant "someone put a bad value in this column". Python has since added
   a third real role, ``doctor``, for the doctor-review domain
   (``review.py#review_doctor``), so ``doctor`` is recognised here too. Had it
   been left out, this step would have rejected every doctor on every
   ``DEFAULT_ROLE`` endpoint -- and, being the step *before* the admin
   comparison, it would have done so with 401 rather than the 40101 the caller
   expected.
"""

import logging

from fastapi import Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from web.config import WebConfig
from web.database import get_db
from web.models.user import User
from web.response import BizError, DateTimeStr, ErrorCode, LongStr
from web.session import SessionRecord, load_session

logger = logging.getLogger(__name__)

#: ``AuthConstant.DEFAULT_ROLE`` -- effectively "any logged-in user".
DEFAULT_ROLE = "user"
#: ``AuthConstant.ADMIN_ROLE``
ADMIN_ROLE = "admin"
#: Not a Java constant. Added by the Python rewrite for the doctor-review
#: domain (``review.py#review_doctor``); see the module docstring.
DOCTOR_ROLE = "doctor"
#: ``UserRole.getEnumByValue`` recognises these values. ``doctor`` is not in
#: ``AuthConstant`` -- it is the Python rewrite's own role for the doctor-review
#: domain, and it has to be known here or :func:`require_role` rejects every
#: doctor on every non-admin endpoint.
_KNOWN_ROLES = frozenset({DEFAULT_ROLE, ADMIN_ROLE, DOCTOR_ROLE})

#: Where Java caches an MCP server's discovered tools (R8): Python invalidates
#: this key after writes so the Agent picks up changes without the 5-minute
#: staleness window.
MCP_TOOLS_CACHE_PREFIX = "mcp:tools:"


class LoginUserVO(BaseModel):
    """``model/vo/user/LoginUserVO.java``.

    All 11 fields are declared because the frontend reads them directly. The
    last three are vestigial: ``gender``/``phone``/``email`` are commented out
    in ``User.java`` and the VO fills them with a constant 0 and two nulls.
    They are kept so the payload is byte-identical.

    Named to match the Java VO rather than the entity on purpose: the OpenAPI
    schema name lands in the generated TypeScript as ``API.LoginUserVO``, and
    ``stores/user.ts``, ``checkAccess.ts`` and the header components all type
    against that name.

    Field types are declared, not inferred from the ORM, and the projection is
    by keyword (:func:`login_user_vo`) so ``user_password`` cannot leak into a
    response even by accident.
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
    phone: str | None = None
    email: str | None = None


#: Backwards-compatible alias. ``LoginUser`` was the working name before the
#: OpenAPI schema had to line up with the Java VO name; both refer to the same
#: model, so ``isinstance`` comparisons in tests keep working.
LoginUser = LoginUserVO


def login_user_vo(user: User) -> LoginUserVO:
    """Project a ``t_user`` row onto the desensitized VO, field by field.

    Written as explicit keyword construction rather than
    ``model_validate(row, from_attributes=True)``: an allow-list cannot leak a
    column that does not exist yet, and ``userPassword`` is exactly the kind of
    column that gets added later.
    """
    return LoginUserVO(
        id=user.id,
        userAccount=user.user_account,
        userName=user.user_name,
        userAvatar=user.user_avatar,
        userProfile=user.user_profile,
        userRole=user.user_role,
        createTime=user.create_time,
        updateTime=user.update_time,
    )


def session_cookie_name(request: Request) -> str:
    """The cookie this service reads.

    A single accessor so tests and the login/logout routes cannot drift onto a
    different name than ``get_login_user`` reads.
    """
    config: WebConfig = request.app.state.config
    return config.session_cookie_name


async def get_login_user(
    request: Request, db: Session = Depends(get_db)
) -> LoginUserVO | None:
    """Resolve the caller, or ``None`` if not signed in.

    Does not raise for the anonymous case: the workflow routes need to tell
    "anonymous" (HTTP 401) apart from "session authority broken" (HTTP 500),
    and returning ``None`` keeps that decision at the call site. A Redis
    failure *does* raise -- see ``web/session.py``.

    The three ways this returns ``None`` are the three ways a login legitimately
    stops being valid: no cookie, a revoked or expired session, and an account
    that was deleted (or is past its logical-delete flag).
    """
    sid = request.cookies.get(session_cookie_name(request))
    if not sid:
        return None

    record: SessionRecord | None = await load_session(request.app.state.redis, config_of(request), sid)
    if record is None:
        return None

    # Re-read the row every request. This is what makes a role change or a
    # logical delete revoke a live session immediately, and it is why the
    # session payload stores only the id.
    user = await run_in_threadpool(
        db.scalar,
        select(User).where(User.id == record.user_id, User.is_delete == 0)
    )
    if user is None:
        return None

    return login_user_vo(user)


def config_of(request: Request) -> WebConfig:
    return request.app.state.config


async def current_user(request: Request, db: Session = Depends(get_db)) -> LoginUserVO:
    """Require any signed-in user, else ``NOT_LOGIN_ERROR`` (40100)."""
    user = await get_login_user(request, db)
    if user is None:
        raise BizError(ErrorCode.NOT_LOGIN_ERROR)
    return user


async def require_role(
    must_role: str, request: Request, db: Session = Depends(get_db)
) -> LoginUserVO:
    """Faithful port of ``AuthInterceptor#authCheck``.

    Bind must_role positionally in route dependencies so FastAPI cannot expose
    a keyword default as a caller-controlled query parameter.
    """
    # Step 1, before any role logic: not signed in is 40100, not 40101.
    user = await current_user(request, db)

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


async def require_admin(request: Request, db: Session = Depends(get_db)) -> LoginUserVO:
    return await require_role(ADMIN_ROLE, request, db)
