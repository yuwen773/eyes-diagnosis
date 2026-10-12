"""User-domain DTOs and VOs.

Field names are camelCase because they are serialized straight to the
frontend, which reads them by their Java names. Every ``Long`` uses
``response.LongStr`` so ids travel as strings (see ``web/response.py``).
"""

from pydantic import BaseModel, ConfigDict

from web.constant import ASC, DESC
from web.response import JavaDateTimeStr, EntityVO, LongStr


class UserRegisterDTO(BaseModel):
    """``model/dto/user/UserRegisterDTO.java``."""

    model_config = ConfigDict(extra="ignore")

    userAccount: str
    userPassword: str
    checkPassword: str


class UserAddDTO(BaseModel):
    """``UserAddDTO.java`` -- admin-created user.

    ``userPassword`` is required by ``UserController.java:115-118`` even though
    the Java field itself is nullable.
    """

    model_config = ConfigDict(extra="ignore")

    userName: str | None = None
    userAccount: str
    userAvatar: str | None = None
    userProfile: str | None = None
    userRole: str | None = None
    userPassword: str | None = None


class UserUpdateDTO(BaseModel):
    """``UserUpdateDTO.java`` -- admin edit. ``id`` is required."""

    model_config = ConfigDict(extra="ignore")

    id: LongStr
    userName: str | None = None
    userAvatar: str | None = None
    userProfile: str | None = None
    userRole: str | None = None


class UserEditDTO(BaseModel):
    """``UserEditDTO.java`` -- self-service profile edit.

    Deliberately has no ``id``: ``UserServiceImpl#updateOwnProfile`` always
    writes to the session user's id and ignores any client-supplied one.
    """

    model_config = ConfigDict(extra="ignore")

    userName: str | None = None
    userAvatar: str | None = None
    userProfile: str | None = None


class UserQueryDTO(BaseModel):
    """``UserQueryDTO.java`` -- ``extends common/PageRequest.java``.

    The Java DTO extends ``PageRequest``, so it inherits ``current`` (1),
    ``pageSize`` (10), ``sortField`` and ``sortOrder`` ("descend"). Those
    defaults are reproduced here because a request body omitting them still
    gets them server-side in Java -- the frontend relies on that when posting
    ``{userName: "x"}`` and nothing else.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None
    userName: str | None = None
    userAccount: str | None = None
    userProfile: str | None = None
    #: Accepted but ignored -- ``getUserQueryWrapper`` has the userRole
    #: predicate commented out (``UserServiceImpl.java:254``).
    userRole: str | None = None

    current: int = 1
    pageSize: int = 10
    sortField: str | None = None
    sortOrder: str = DESC


class UserVO(EntityVO):
    """``model/vo/user/UserVO.java`` -- the desensitized view (7 fields).

    No ``userPassword``, no ``isDelete``.
    """

    id: LongStr
    userAccount: str
    userName: str | None = None
    userAvatar: str | None = None
    userProfile: str | None = None
    userRole: str
    createTime: JavaDateTimeStr | None = None


class DiagnosisReexamineDTO(BaseModel):
    """``model/dto/diagnosis/DiagnosisReexamineDTO.java``."""

    model_config = ConfigDict(extra="ignore")

    id: LongStr


def is_ascending(sort_order: str | None) -> bool:
    """MyBatis Plus ``orderBy(condition, isAsc, columns)`` predicate.

    ``UserServiceImpl.java:258`` passes ``sortOrder.equals(ASC)``, so any value
    other than the literal ``"ascend"`` -- including ``"descend"`` -- sorts
    descending.
    """
    return sort_order == ASC
