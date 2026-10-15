"""``/user`` routes -- all 14 endpoints in ``UserController.java``.

The three session endpoints (``POST /login``, ``POST /logout``,
``GET /get/login``) moved here in ticket 02. Python manages the login session
in its own Redis namespace; Nginx no longer routes these paths to Java. The
remaining 11 are unchanged.

``GET /user/get`` is the one place this deviates from Java: the controller
returns the raw entity including ``userPassword``. Nothing in the frontend
calls it, so the desensitized ``UserVO`` is returned instead -- see ruling 11
in ``docs/migration-decisions.md``.
"""

import hashlib
import json
import logging
import random
from datetime import datetime
from functools import partial

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from web.auth import LoginUser, LoginUserVO, get_login_user, login_user_vo, require_role
from web.config import WebConfig
from web.constant import (
    ACCOUNT_ERROR,
    ACCOUNT_IS_SHORT,
    ACCOUNT_MIN_LENGTH,
    ACCOUNT_REPEATED,
    ADMIN_ROLE,
    DEFAULT_ROLE,
    DOUBLE_PASSWORD_NOT_EQUAL,
    FAIL_LOGIN,
    FAIL_REGISTER,
    NO_LOGIN,
    PARAMS_IS_NULL,
    PASSWORD_ERROR,
    PASSWORD_IS_SHORT,
    PASSWORD_MIN_LENGTH,
    REEXAMINE_STATUS_WAITING,
)
from web.db import id_generator
from web.deps import get_db
from web.files import upload_picture
from web.models.diagnosis import Diagnosis
from web.models.user import User
from web.response import BaseResponse, BizError, ErrorCode, LongStr, PageResult
from web.schemas.user import (
    DiagnosisReexamineDTO,
    UserAddDTO,
    UserEditDTO,
    UserLoginDTO,
    UserQueryDTO,
    UserRegisterDTO,
    UserUpdateDTO,
    UserVO,
    is_ascending,
)
from web.security import encode, verify
from web.session import create_session, revoke_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user", tags=["userController"])

#: ``UserController.java:213`` -- ``diagnosis:listUserVOByPage:{md5}``.
#: The ``v2`` segment is new. Java's Hutool-serialized JSON cannot be
#: reproduced byte-for-byte from Pydantic, so without the version bump Python
#: could read a legacy entry whose shape it does not understand. A cache miss
#: is harmless; a misparse is not.
_USER_PAGE_CACHE_PREFIX = "diagnosis:listUserVOByPage:v2"

#: ``UserController.java:232`` -- 5-10 minutes, randomised to avoid a stampede.
_CACHE_TTL_BASE = 300
_CACHE_TTL_JITTER = 300

require_admin = partial(require_role, ADMIN_ROLE)
any_user = partial(require_role, DEFAULT_ROLE)


def _to_vo(user: User) -> UserVO:
    return UserVO.model_validate(user, from_attributes=True)


# ---------------------------------------------------------------------------
# Session cookie
# ---------------------------------------------------------------------------
#
# Every attribute is stated explicitly. The servlet container was setting these
# implicitly before (HttpOnly by default, no SameSite attribute so the browser
# applied Lax), and a session cookie that depends on a framework default is one
# dependency upgrade away from being readable by script.


def _issue_cookie(response: Response, config: WebConfig, sid: str) -> None:
    response.set_cookie(
        key=config.session_cookie_name,
        value=sid,
        max_age=config.session_cookie_max_age,
        path="/",
        httponly=config.session_cookie_httponly,
        samesite=config.session_cookie_samesite,
        secure=config.session_cookie_secure,
    )


def _expire_cookie(response: Response, config: WebConfig) -> None:
    """Overwrite the cookie with an already-expired one.

    Same attributes as :func:`_issue_cookie` on purpose: a browser only replaces
    a cookie when name/domain/path match, so clearing with a *different*
    ``path`` would leave the live cookie in place.
    """
    response.set_cookie(
        key=config.session_cookie_name,
        value="",
        max_age=0,
        path="/",
        httponly=config.session_cookie_httponly,
        samesite=config.session_cookie_samesite,
        secure=config.session_cookie_secure,
    )


# ---------------------------------------------------------------------------
# POST /user/login -- public
# ---------------------------------------------------------------------------
@router.post("/login", summary="用户登录", operation_id="userLogin", response_model=BaseResponse[LoginUserVO])
async def user_login(
    request: Request,
    response: Response,
    body: UserLoginDTO,
    db: Session = Depends(get_db),
):
    """``UserServiceImpl#userLogin``.

    The validation order and the Chinese messages are copied exactly, because
    the frontend surfaces ``msg`` verbatim in a toast:

    ``PARAMS_IS_NULL`` -> ``ACCOUNT_ERROR`` -> ``PASSWORD_ERROR`` ->
    ``FAIL_LOGIN``.

    ``FAIL_LOGIN`` is deliberately used for both "no such account" and "wrong
    password", so the response cannot be used to enumerate accounts.

    The lookup is restricted to ``is_delete = 0`` because MyBatis Plus appends
    that predicate automatically for a ``@TableLogic`` field, so a
    logically-deleted account cannot log in under Java either.
    """
    config: WebConfig = request.app.state.config

    if body.userAccount is None or body.userPassword is None or not body.userAccount.strip() or not body.userPassword.strip():
        raise BizError(ErrorCode.PARAMS_ERROR, PARAMS_IS_NULL)
    if len(body.userAccount) < ACCOUNT_MIN_LENGTH:
        raise BizError(ErrorCode.PARAMS_ERROR, ACCOUNT_ERROR)
    if len(body.userPassword) < PASSWORD_MIN_LENGTH:
        raise BizError(ErrorCode.PARAMS_ERROR, PASSWORD_ERROR)

    user = db.execute(
        select(User).where(User.user_account == body.userAccount, User.is_delete == 0)
    ).scalar_one_or_none()
    if user is None:
        logger.info("user login failed: account does not match a row")
        raise BizError(ErrorCode.PARAMS_ERROR, FAIL_LOGIN)

    verification = verify(body.userPassword, user.user_password)
    if not verification.matches:
        logger.info("user login failed: account does not match userPassword")
        raise BizError(ErrorCode.PARAMS_ERROR, FAIL_LOGIN)

    if verification.needs_upgrade:
        # Legacy MD5 row: re-hash now, so the MD5 population drains one login
        # at a time exactly as in Java (UserServiceImpl.java:139-145).
        user.user_password = encode(body.userPassword)
        # A successful TCP response must acknowledge the completed upgrade;
        # dependency cleanup may commit only after that response is sent.
        db.commit()

    # Session rotation. Java reuses the servlet session id across logins, which
    # leaves a pre-login id valid for whoever captured it; every login here
    # mints a fresh id and revokes the one that arrived with the request, so a
    # stolen or replayed cookie is worth at most the login that preceded it.
    sid = await create_session(request.app.state.redis, config, user.id)
    await revoke_session(
        request.app.state.redis, config, request.cookies.get(config.session_cookie_name)
    )
    _issue_cookie(response, config, sid)

    logger.info("user login succeeded")
    return BaseResponse.success(login_user_vo(user))


# ---------------------------------------------------------------------------
# POST /user/logout
# ---------------------------------------------------------------------------
@router.post("/logout", summary="用户登出", operation_id="userLogout", response_model=BaseResponse[bool])
async def user_logout(
    request: Request,
    response: Response,
    user: LoginUserVO | None = Depends(get_login_user),
):
    """``UserServiceImpl#userLogout``.

    Not idempotent, on purpose: logging out without a session is an error in
    Java (``NOT_LOGIN_ERROR`` + ``NO_LOGIN``) and some frontend flow depends on
    being told the difference between "you were signed in" and "you were not".
    Making it idempotent would be a compatible-but-different contract, so the
    Java behaviour is kept until a ticket says otherwise.

    The caller is taken as a dependency rather than by calling
    ``get_login_user(request)`` inline: the latter leaves its own ``db``
    parameter unresolved, which fails the row lookup and reports 500 -- "you
    could not log out" -- to every user who *was* signed in.
    """
    config: WebConfig = request.app.state.config
    if user is None:
        raise BizError(ErrorCode.NOT_LOGIN_ERROR, NO_LOGIN)

    await revoke_session(request.app.state.redis, config, request.cookies.get(config.session_cookie_name))
    _expire_cookie(response, config)
    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# GET /user/get/login
# ---------------------------------------------------------------------------
@router.get("/get/login", summary="获取登录用户", operation_id="getLoginUser", response_model=BaseResponse[LoginUserVO])
async def get_login(
    request: Request,
    user: LoginUserVO | None = Depends(get_login_user),
):
    """``UserServiceImpl#getLoginUser`` + ``getLoginUserVO``.

    Anonymous -> ``NOT_LOGIN_ERROR``, same as Java. The frontend's
    ``stores/user.ts`` treats "not 0, or no data" as signed out and its router
    guard redirects to the login page, so the behaviour is unchanged.
    """
    if user is None:
        raise BizError(ErrorCode.NOT_LOGIN_ERROR)
    return BaseResponse.success(user)


# ---------------------------------------------------------------------------
# POST /user/register -- public
# ---------------------------------------------------------------------------
@router.post("/register", summary="用户注册", operation_id="userRegister", response_model=BaseResponse[LongStr])
def register(body: UserRegisterDTO, db: Session = Depends(get_db)):
    """``UserServiceImpl#userRegister``.

    Validation order is copied exactly; each branch throws a different Chinese
    message and the frontend surfaces it verbatim.
    """
    if not body.userAccount.strip() or not body.userPassword.strip() or not body.checkPassword.strip():
        raise BizError(ErrorCode.PARAMS_ERROR, PARAMS_IS_NULL)
    if len(body.userAccount) < ACCOUNT_MIN_LENGTH:
        raise BizError(ErrorCode.PARAMS_ERROR, ACCOUNT_IS_SHORT)
    if len(body.userPassword) < PASSWORD_MIN_LENGTH or len(body.checkPassword) < PASSWORD_MIN_LENGTH:
        raise BizError(ErrorCode.PARAMS_ERROR, PASSWORD_IS_SHORT)
    if body.userPassword != body.checkPassword:
        raise BizError(ErrorCode.PARAMS_ERROR, DOUBLE_PASSWORD_NOT_EQUAL)

    existing = db.execute(
        select(func.count()).select_from(User).where(User.user_account == body.userAccount)
    ).scalar_one()
    if existing > 0:
        raise BizError(ErrorCode.PARAMS_ERROR, ACCOUNT_REPEATED)

    now = datetime.now()
    user = User(
        id=id_generator.next_id(),
        user_account=body.userAccount,
        user_password=encode(body.userPassword),
        user_name="无名",
        user_role="user",
        create_time=now,
        edit_time=now,
        update_time=now,
        is_delete=0,
    )
    db.add(user)
    try:
        db.flush()
    except Exception:
        db.rollback()
        raise BizError(ErrorCode.SYSTEM_ERROR, FAIL_REGISTER) from None

    # `long` in Java -> string on the wire.
    return BaseResponse.success(user.id)


# ---------------------------------------------------------------------------
# POST /user/add -- admin
# ---------------------------------------------------------------------------
@router.post("/add", summary="新增用户", operation_id="userAdd", response_model=BaseResponse[LongStr])
def add_user(
    body: UserAddDTO,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """``UserController#userAdd``.

    The controller requires an explicit initial password rather than falling
    back to a default (``UserController.java:115-118``), and writes the
    BCrypt hash separately from the bean copy.
    """
    if not body.userPassword or not body.userPassword.strip():
        raise BizError(ErrorCode.PARAMS_ERROR, "必须提供初始密码")

    now = datetime.now()
    user = User(
        id=id_generator.next_id(),
        user_account=body.userAccount,
        user_password=encode(body.userPassword),
        user_name=body.userName,
        user_avatar=body.userAvatar,
        user_profile=body.userProfile,
        user_role=body.userRole or "user",
        create_time=now,
        edit_time=now,
        update_time=now,
        is_delete=0,
    )
    db.add(user)
    db.flush()
    return BaseResponse.success(user.id)


# ---------------------------------------------------------------------------
# GET /user/get and /user/get/vo -- admin
# ---------------------------------------------------------------------------
def _load_user(db: Session, user_id: int) -> User:
    """``getUserById`` + the null check, shared by both read endpoints."""
    if user_id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    user = db.get(User, user_id)
    if user is None:
        raise BizError(ErrorCode.NOT_FOUND_ERROR)
    return user


@router.get("/get", summary="根据id查询用户", operation_id="getUserById", response_model=BaseResponse[UserVO])
def get_user(
    id: int = Query(...),
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """Deviation: Java returns the entity *with* ``userPassword``. Unused by
    the frontend and leaky, so the desensitized view is returned instead."""
    return BaseResponse.success(_to_vo(_load_user(db, id)))


@router.get("/get/vo", summary="根据id查询脱敏用户", operation_id="getUserVOById", response_model=BaseResponse[UserVO])
def get_user_vo(
    id: int = Query(...),
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    return BaseResponse.success(_to_vo(_load_user(db, id)))


# ---------------------------------------------------------------------------
# POST /user/update -- admin
# ---------------------------------------------------------------------------
@router.post("/update", summary="更新用户信息", operation_id="updateUser", response_model=BaseResponse[bool])
def update_user(
    body: UserUpdateDTO,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """``UserController#updateUser``.

    ``updateTime`` is set explicitly: in Java it relies on the column's
    ``ON UPDATE CURRENT_TIMESTAMP``, which SQLAlchemy does not trigger for a
    plain ORM UPDATE.
    """
    user = db.get(User, int(body.id))
    if user is None:
        raise BizError(ErrorCode.OPERATION_ERROR)

    if body.userName is not None:
        user.user_name = body.userName
    if body.userAvatar is not None:
        user.user_avatar = body.userAvatar
    if body.userProfile is not None:
        user.user_profile = body.userProfile
    if body.userRole is not None:
        user.user_role = body.userRole
    user.update_time = datetime.now()

    db.flush()
    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# POST /user/list/page/vo and /cache -- admin
# ---------------------------------------------------------------------------
def _user_query(query: UserQueryDTO):
    """``UserServiceImpl#getUserQueryWrapper``.

    ``userRole`` is accepted but never filtered -- Java has that predicate
    commented out at line 254.

    ``orderBy`` is applied only when ``sortField`` is non-empty: MyBatis Plus
    evaluates ``isNotEmpty(sortField)`` as the *condition*, so a blank
    sortField silently drops the ORDER BY entirely rather than erroring.

    ``sortField`` is a **column** name in Java -- ``orderBy`` interpolates it
    straight into SQL -- so the client sends camelCase ``createTime``, not the
    Python attribute ``create_time``. An earlier draft looked it up with
    ``getattr``, which never matched and silently dropped every sort.
    """
    stmt = select(User).where(User.is_delete == 0)
    if query.id is not None:
        stmt = stmt.where(User.id == int(query.id))
    if query.userAccount and query.userAccount.strip():
        stmt = stmt.where(User.user_account.like(f"%{query.userAccount}%"))
    if query.userName and query.userName.strip():
        stmt = stmt.where(User.user_name.like(f"%{query.userName}%"))
    if query.userProfile and query.userProfile.strip():
        stmt = stmt.where(User.user_profile.like(f"%{query.userProfile}%"))

    if query.sortField and query.sortField.strip():
        column = User.__table__.columns.get(query.sortField)
        if column is not None:
            stmt = stmt.order_by(column.asc() if is_ascending(query.sortOrder) else column.desc())
    return stmt


def _query_page(db: Session, query: UserQueryDTO) -> PageResult[UserVO]:
    total = db.execute(
        select(func.count()).select_from(_user_query(query).subquery())
    ).scalar_one()
    rows = db.execute(
        _user_query(query).limit(query.pageSize).offset((query.current - 1) * query.pageSize)
    ).scalars().all()
    return PageResult.of([_to_vo(u) for u in rows], total, query.pageSize, query.current)


@router.post("/list/page/vo", summary="获取分页用户列表", operation_id="listUserVoByPage", response_model=BaseResponse[PageResult[UserVO]])
def list_user_vo(
    body: UserQueryDTO,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    return BaseResponse.success(_query_page(db, body))


@router.post("/list/page/vo/cache", summary="获取分页用户列表（缓存版本）", operation_id="listUserVoByPageWithCache", response_model=BaseResponse[PageResult[UserVO]])
async def list_user_vo_cached(
    request: Request,
    body: UserQueryDTO,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """Redis-cached variant, mirroring ``listUserVOByPageWithCache``.

    The key is an MD5 of the request body, as in Java, and the TTL is
    ``300 + random(0, 300)`` seconds to spread expirations.
    """
    payload = body.model_dump(mode="json")
    digest = hashlib.md5(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    key = f"{_USER_PAGE_CACHE_PREFIX}:{digest}"

    redis = request.app.state.redis
    cached = await redis.get(key)
    if cached:
        return BaseResponse.success(PageResult[UserVO].model_validate_json(cached))

    page = _query_page(db, body)
    await redis.setex(key, _CACHE_TTL_BASE + random.randint(0, _CACHE_TTL_JITTER), page.model_dump_json())
    return BaseResponse.success(page)


# ---------------------------------------------------------------------------
# POST /user/delete/{id} -- admin
# ---------------------------------------------------------------------------
@router.post("/delete/{id}", summary="删除用户", operation_id="deleteUser", response_model=BaseResponse[bool])
def delete_user(
    id: int,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """Logical delete.

    ``removeById`` on a ``@TableLogic`` field issues ``UPDATE t_user SET
    isDelete=1`` rather than a DELETE, so the row stays for the Agent tables'
    foreign keys while disappearing from every query.
    """
    if id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    user = db.get(User, id)
    if user is None:
        return BaseResponse.success(False)
    user.is_delete = 1
    db.flush()
    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# POST /user/update/userCenter -- any signed-in user
# ---------------------------------------------------------------------------
@router.post("/update/userCenter", summary="用户中心更新", operation_id="editUserCenter", response_model=BaseResponse[bool])
async def update_user_center(
    request: Request,
    body: UserEditDTO,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``UserServiceImpl#updateOwnProfile`` -- always targets the session user.

    Java is queried on every subsequent request, including after profile edits.
    """
    target = db.get(User, int(user.id))
    if target is None:
        raise BizError(ErrorCode.OPERATION_ERROR)

    target.user_name = body.userName
    target.user_avatar = body.userAvatar
    target.user_profile = body.userProfile
    target.update_time = datetime.now()
    db.flush()

    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# POST /user/upload/avatar -- any signed-in user
# ---------------------------------------------------------------------------
@router.post("/upload/avatar", summary="用户头像上传", operation_id="uploadAvatarPicture", response_model=BaseResponse[UserVO])
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    userName: str | None = Form(default=None),
    userAvatar: str | None = Form(default=None),
    userProfile: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``UserServiceImpl#uploadUserAvatar``.

    Multipart field is ``file`` (singular). The COS prefix is
    ``public/{userId}``, matching ``String.format("public/%s", loginUser.getId())``.
    """
    data = await file.read()
    detail = await upload_picture(data, file.filename, prefix=f"public/{user.id}")

    target = db.get(User, int(user.id))
    if target is None:
        raise BizError(ErrorCode.OPERATION_ERROR)
    target.user_avatar = detail.url
    target.update_time = datetime.now()
    db.flush()

    return BaseResponse.success(_to_vo(target))


# ---------------------------------------------------------------------------
# POST /user/diagnosis/reexamine -- any signed-in user
# ---------------------------------------------------------------------------
@router.post("/diagnosis/reexamine", summary="用户申请复诊上传", operation_id="reexamineDiagnosis", response_model=BaseResponse[bool])
def reexamine_diagnosis(
    body: DiagnosisReexamineDTO,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``UserServiceImpl#reexamineDiagnosis``.

    Ownership is enforced: a user may only flag their own diagnosis, otherwise
    ``NO_AUTH_ERROR``.
    """
    diagnosis_id = int(body.id)
    if diagnosis_id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)

    diagnosis = db.get(Diagnosis, diagnosis_id)
    if diagnosis is None:
        raise BizError(ErrorCode.NOT_FOUND_ERROR)
    if diagnosis.user_id != int(user.id):
        raise BizError(ErrorCode.NO_AUTH_ERROR)

    diagnosis.reexamine_status = REEXAMINE_STATUS_WAITING
    db.flush()
    return BaseResponse.success(True)
