"""Unified response envelope and error codes.

Mirrors three Java classes that together define the wire contract every
frontend call depends on:

* ``common/BaseResponse.java``  -- the ``{code, msg, data}`` envelope
* ``exception/ErrorCode.java``  -- the 11 business codes
* ``exception/GlobalExceptionHandler.java`` -- the error-to-envelope mapping

Three contract facts drive this module, and all three are easy to get wrong:

1. **Success ``msg`` is ``"ok"``, not ``""``.** ``BaseResponse`` has a 2-arg
   constructor that defaults ``msg`` to ``""``, but all 50 controller call
   sites go through ``ResultUtils.success()``, which explicitly passes
   ``"ok"`` (``ResultUtils.java:22``). The 2-arg constructor is dead code.

2. **Every error is HTTP 200.** No handler in the Java codebase carries
   ``@ResponseStatus``, so ``GlobalExceptionHandler`` returns a
   ``BaseResponse`` that serializes with the default 200 status. The frontend
   branches on ``res.data.code`` (``request.ts:38``), never on the HTTP
   status. ``business_error`` in ``middleware.py`` depends on this.

3. **``long`` fields serialize as strings.** ``JsonConfig.java:36-38``
   registers ``ToStringSerializer`` for both ``Long.class`` and ``Long.TYPE``
   (``long.class``). Every 64-bit field is therefore a JSON *string*, which
   includes all four numeric members of MyBatis Plus's ``IPage`` -- its
   ``getTotal``/``getSize``/``getCurrent``/``getPages`` all return ``long``.
   The frontend compensates with ``Number(...)`` at every call site.
"""

from datetime import date, datetime, timedelta, timezone
from enum import IntEnum
import re
from typing import Annotated, Generic, TypeVar

from pydantic import AliasGenerator, BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer

T = TypeVar("T")

#: ``spring.jackson.date-format`` / ``JsonConfig.DATE_TIME_FORMATTER``.
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class ErrorCode(IntEnum):
    """Exact values from ``exception/ErrorCode.java:15-26``.

    The numeric values and Chinese messages are part of the contract: the
    frontend surfaces ``msg`` verbatim in toast notifications.
    """

    _message: str

    SUCCESS = 0, "ok"
    PARAMS_ERROR = 40000, "请求参数错误"
    NOT_LOGIN_ERROR = 40100, "未登录"
    NO_AUTH_ERROR = 40101, "无权限"
    NOT_FOUND_ERROR = 40400, "请求数据不存在"
    FORBIDDEN_ERROR = 40300, "禁止访问"
    SYSTEM_ERROR = 50000, "系统内部异常"
    OPERATION_ERROR = 50001, "操作失败"
    DIAGNOSIS_REJECTED_QUALITY = 40010, "图片质量不合格"
    DIAGNOSIS_REJECTED_OOD = 40011, "图像分布外"
    DIAGNOSIS_NEEDS_REVIEW = 40012, "诊断结果需人工复核"

    def __new__(cls, code: int, message: str) -> "ErrorCode":
        obj = int.__new__(cls, code)
        obj._value_ = code
        obj._message = message
        return obj

    @property
    def message(self) -> str:
        return self._message


class BizError(Exception):
    """Business exception, equivalent to ``exception/BusinessException.java``.

    Raised anywhere in a route and converted to a ``{code, msg, data: null}``
    body with HTTP 200 by the handler in ``middleware.py``.
    """

    def __init__(self, error_code: ErrorCode, message: str | None = None):
        self.error_code = error_code
        self.code = error_code.value
        self.message = message if message is not None else error_code.message
        super().__init__(self.message)


# --- Contract serializers -----------------------------------------------------
#
# Annotated aliases rather than a model-level encoder. ``json_encoders`` is
# deprecated in Pydantic v2 and a blanket ``int -> str`` would also stringify
# genuine small ints (``code``, enums, HTTP-ish fields) that Java leaves as
# numbers. Java's rule is type-based -- only ``long``/``Long`` -- so these
# aliases must be applied per field.

#: ``long`` / ``Long`` -> JSON string. ``when_used="json"`` keeps the Python
#: attribute an ``int`` so arithmetic and comparisons inside the app still work;
#: only the wire format is a string.
LongStr = Annotated[int, PlainSerializer(str, return_type=str, when_used="json")]

#: ``LocalDateTime`` or dates already received from Java's wire response.
DateTimeStr = Annotated[
    datetime,
    PlainSerializer(lambda d: d.strftime(DATE_FORMAT), return_type=str, when_used="json"),
]


def _java_date_string(value: datetime) -> str:
    # The existing JDBC URL interprets DATETIME as Asia/Shanghai (+08:00),
    # while Jackson's java.util.Date output uses its default UTC timezone.
    # LocalDateTime has no instant conversion and uses DateTimeStr instead.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone(timedelta(hours=8)))
    return value.astimezone(timezone.utc).strftime(DATE_FORMAT)


def _java_date_input(value: object) -> object:
    # Cached JSON already contains Java's UTC wire representation. Database
    # datetime objects remain naive Shanghai values until serialization.
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    return value


JavaDateTimeStr = Annotated[
    datetime,
    BeforeValidator(_java_date_input),
    PlainSerializer(_java_date_string, return_type=str, when_used="json"),
]

#: Same, for columns declared ``DATE`` rather than ``DATETIME``. Java renders
#: these via ``SimpleDateFormat("yyyy-MM-dd")`` on a ``java.sql.Date``.
DateStr = Annotated[
    date,
    PlainSerializer(lambda d: d.strftime("%Y-%m-%d"), return_type=str, when_used="json"),
]


class BaseResponse(BaseModel, Generic[T]):
    """Envelope for every non-streaming response.

    Field order matches the Java class so serialized JSON is byte-comparable
    in diffs.
    """

    code: int = ErrorCode.SUCCESS.value
    msg: str = ErrorCode.SUCCESS.message
    data: T | None = None

    @classmethod
    def success(cls, data: T | None = None) -> "BaseResponse[T]":
        """``ResultUtils.success(data)`` -- note ``msg`` is ``"ok"``."""
        return cls(code=ErrorCode.SUCCESS.value, msg=ErrorCode.SUCCESS.message, data=data)

    @classmethod
    def error(
        cls,
        error_code: ErrorCode | int,
        message: str | None = None,
    ) -> "BaseResponse[None]":
        if isinstance(error_code, ErrorCode):
            code = error_code.value
            msg = message if message is not None else error_code.message
        else:
            code = error_code
            msg = message if message is not None else ErrorCode.SYSTEM_ERROR.message
        return BaseResponse[None](code=code, msg=msg, data=None)


#: camelCase wire name -> snake_case ORM attribute.
def _snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


class EntityVO(BaseModel):
    """Base for VOs projected straight off an ORM row.

    VOs are camelCase because that is what the frontend reads; ORM attributes
    are snake_case because that is Python. ``model_validate(row,
    from_attributes=True)`` would look for ``userAccount`` on the entity and
    raise ``Field required`` -- a 500 on every list endpoint, in every domain.

    The two aliases differ on purpose:

    * **validation** alias -> snake_case, so it resolves the ORM attribute
    * **serialization** alias -> the field name unchanged, so the wire format
      stays camelCase

    ``populate_by_name`` keeps keyword construction working, which every
    projection helper does (``DiagnosisManageVO(id=..., url=...)``).

    This bit four domains at once and no test caught it, because the tests
    exercised the projection *helpers* -- which build VOs by keyword -- rather
    than handing a real ORM row to ``model_validate``. See P-7 in
    ``docs/rewrite-findings.md``.
    """

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=AliasGenerator(
            validation_alias=_snake_case,
            serialization_alias=str,
        ),
    )


class PageResult(BaseModel, Generic[T]):
    """MyBatis Plus ``IPage`` JSON shape, as consumed by the frontend.

    All four numeric members are ``long`` in Java, so all four are strings on
    the wire (see contract fact 3). The frontend reads ``records``/``total``
    (plus ``current``/``size`` echoed back into the next request's query
    params) -- ``pages`` is emitted for completeness.

    Java's ``IPage`` also serializes ``orders``/``searchCount``/
    ``optimizeCountSql``/``maxLimit``/``countId``; nothing in the frontend
    reads them, so they are omitted rather than emitted as misleading nulls.
    """

    records: list[T] = Field(default_factory=list)
    total: LongStr = 0
    size: LongStr = 0
    current: LongStr = 0
    pages: LongStr = 0

    @classmethod
    def of(
        cls,
        records: list[T],
        total: int,
        size: int,
        current: int,
    ) -> "PageResult[T]":
        """Build from MyBatis Plus semantics: pages = ceil(total / size).

        Mirrors ``IPage#getPages()``, which returns 0 for ``size == 0`` rather
        than dividing by zero.
        """
        return cls(
            records=records,
            total=total,
            size=size,
            current=current,
            pages=(total + size - 1) // size if size else 0,
        )
