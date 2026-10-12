"""``/user`` routes -- 11 of the 14 endpoints in ``UserController.java``.

Not implemented here, by design: ``POST /user/login``, ``POST /user/logout``
and ``GET /user/get/login`` stay on Java. Java owns the session -- Spring
Session's Redis payload is JDK-serialized and unreadable from Python (see
``web/auth.py``) -- and Nginx routes those three paths to it (Phase 3). Every
endpoint below resolves the caller by forwarding the ``JSESSIONID`` cookie.

``GET /user/get`` is the one place this deviates from Java: the controller
returns the raw entity including ``userPassword``. Nothing in the frontend
calls it, so the desensitized ``UserVO`` is returned instead -- see ruling 11
in ``docs/migration-decisions.md``.
"""

import hashlib
import json
import random
from datetime import datetime
from functools import partial

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from web.auth import LoginUser, require_role
from web.constant import (
    ACCOUNT_IS_SHORT,
    ACCOUNT_MIN_LENGTH,
    ACCOUNT_REPEATED,
    ADMIN_ROLE,
    DEFAULT_ROLE,
    DOUBLE_PASSWORD_NOT_EQUAL,
    FAIL_REGISTER,
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
from web.response import BaseResponse, BizError, ErrorCode, PageResult
from web.schemas.user import (
    DiagnosisReexamineDTO,
    UserAddDTO,
    UserEditDTO,
    UserQueryDTO,
    UserRegisterDTO,
    UserUpdateDTO,
    UserVO,
    is_ascending,
)
from web.security import encode

router = APIRouter(prefix="/user", tags=["user"])

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
# POST /user/register -- public
# ---------------------------------------------------------------------------
@router.post("/register", summary="用户注册")
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
@router.post("/add", summary="新增用户")
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


@router.get("/get", summary="根据id查询用户")
def get_user(
    id: int = Query(...),
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """Deviation: Java returns the entity *with* ``userPassword``. Unused by
    the frontend and leaky, so the desensitized view is returned instead."""
    return BaseResponse.success(_to_vo(_load_user(db, id)))


@router.get("/get/vo", summary="根据id查询脱敏用户")
def get_user_vo(
    id: int = Query(...),
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    return BaseResponse.success(_to_vo(_load_user(db, id)))


# ---------------------------------------------------------------------------
# POST /user/update -- admin
# ---------------------------------------------------------------------------
@router.post("/update", summary="更新用户信息")
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


@router.post("/list/page/vo", summary="获取分页用户列表")
def list_user_vo(
    body: UserQueryDTO,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    return BaseResponse.success(_query_page(db, body))


@router.post("/list/page/vo/cache", summary="获取分页用户列表（缓存版本）")
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
@router.post("/delete/{id}", summary="删除用户")
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
@router.post("/update/userCenter", summary="用户中心更新")
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
@router.post("/upload/avatar", summary="用户头像上传")
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
@router.post("/diagnosis/reexamine", summary="用户申请复诊上传")
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
