"""Diagnosis-domain DTOs and VOs.

Serialisation contract, all of it load-bearing:

* ``id`` is ``Long`` in Java -> **string** on the wire (``response.LongStr``).
* ``reexamineStatus`` is a primitive ``int`` (``DiagnosisManageVO.java:56``), not
  a ``Long``. Primitive ``int``/``Integer`` is *not* covered by the
  ``ToStringSerializer`` registered for ``Long.class``/``long.class``, so it
  stays a JSON **number**. Using ``LongStr`` here would be a silent wire change.
* ``confidence``/``probability``/``calibratedProbability``/``oodScore`` are
  ``Double`` -> numbers. ``oodScore``'s Python attribute is ``float | None``
  because a NULL column means "not assessed", which is not the same as 0.0.
* ``createTime`` is ``java.util.Date`` -> ``"yyyy-MM-dd HH:mm:ss"``.

Two views exist over one row, and they desensitise differently:

* :class:`DiagnosisManageVO` -- the list/history view.
* :class:`DiagnosisResultVO` -- the single-record detail view.

Both run the same ``clearAiConclusion`` guard on read: when ``aiRejected`` is
true the AI's label, probability and advice are stripped so a rejected upload
cannot be read as a diagnosis. :class:`DiagnosisManageVO` clears fewer fields
than :class:`DiagnosisResultVO` -- it keeps ``details``, ``probability`` and
``recommendations`` -- which is Java's behaviour, not an oversight to fix here.
"""

from pydantic import BaseModel, ConfigDict

from web.constant import ASC, DESC, STATUS_COMPLETED
from web.response import JavaDateTimeStr, EntityVO, LongStr


class Disease(BaseModel):
    """``model/vo/diagnosis/Disease.java`` -- 2 fields.

    ``name`` is the **English** model label (``normal``, ``amd``, ...) because
    it comes straight from the proto's ``top_predictions``. The Chinese label
    the patient sees is ``DiagnosisResultVO.result``, not this.
    """

    name: str
    #: 0-100, same percent scale as ``probability`` -- see ``web/inference.py``.
    probability: float


class DiagnosisQueryDTO(BaseModel):
    """``DiagnosisQueryDTO.java`` -- ``extends common/PageRequest.java``.

    ``current``/``pageSize``/``sortOrder`` defaults are reproduced because a
    request body may omit them and Java still applies them server-side.

    ``userId`` is accepted but **always overwritten** by the controller with the
    session user's id before the query runs. It is kept so that a client posting
    someone else's id is silently ignored rather than 400ing.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None
    #: Disease name. Filtered with ``LIKE`` against the *Chinese* label column.
    result: str | None = None
    #: Accepted and ignored -- ``getDiagnosisQueryWrapper`` never reads it.
    diagnosisTime: str | None = None
    #: Accepted and ignored, same as in the user domain.
    userRole: str | None = None
    userId: LongStr | None = None

    current: int = 1
    pageSize: int = 10
    sortField: str | None = None
    sortOrder: str = DESC


class DiagnosisUploadDTO(BaseModel):
    """``DiagnosisUploadDTO.java`` -- a single ``id``, and **it is ignored**.

    ``uploadDiagnosisPicture`` builds a fresh ``Diagnosis`` with no id and calls
    ``saveOrUpdate``; MyBatis Plus inserts when the id is null, so the DTO's
    ``id`` never reaches the database. The frontend posts it anyway. Declared
    for shape parity only.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None


class DiagnosisResultDTO(BaseModel):
    """``DiagnosisResultDTO.java`` -- human review write, admin only.

    Deliberately contains no AI fields. ``recordHumanReview`` copies only
    ``human*`` onto the row, so a client cannot overwrite ``result``/
    ``probability``/``details``/``aiRejected`` through this endpoint.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr
    humanResult: str | None = None
    humanSeverity: str | None = None
    humanRecommendations: str | None = None
    humanReviewNote: str | None = None


class DiagnosisManageVO(EntityVO):
    """``model/vo/diagnosis/DiagnosisManageVO.java`` -- 11 fields.

    Built from ``objToVo`` plus ``getDiagnosisManageVO``, which enriches each
    row with the owner's ``userName`` via
    ``selectUserNameAndUserAvatarByUserId``.

    ``status`` is not a column: ``DiagnosisManageVO.java:66`` initialises it to
    ``COMPLETED`` at field-declaration time, so every row reports "已完成"
    regardless of ``reexamineStatus``.
    """

    id: LongStr
    url: str
    #: Enriched from ``t_user``; ``None`` if the owner row is gone.
    username: str | None = None
    result: str | None = None
    confidence: float | None = None
    severity: str | None = None
    #: Primitive ``int`` -> JSON number, unlike ``id``.
    reexamineStatus: int = 1
    createTime: JavaDateTimeStr | None = None
    status: str = STATUS_COMPLETED
    aiRejected: bool | None = None
    abstainReason: str | None = None
    requiresReview: bool = False


class DiagnosisResultVO(EntityVO):
    """``model/vo/diagnosis/DiagnosisResultVO.java`` -- 26 fields.

    This is the payload the patient-facing result page renders, so every field
    here is user-visible. ``disclaimer`` is declared because the frontend reads
    it, but Java never sets it -- it is always ``null``, and the disclaimer text
    the UI shows is hardcoded in the Vue component.
    """

    id: LongStr | None = None
    url: str | None = None
    #: Chinese label, e.g. "青光眼" -- from ``DiagnosisCategoryEnum``.
    result: str | None = None
    #: 0-100 percent, not 0-1.
    probability: float | None = None
    #: Identical to ``probability`` in every Java code path.
    confidence: float | None = None
    #: Newline-separated Chinese advice, not a JSON array.
    recommendations: str | None = None
    details: str | None = None
    #: Always ``"NOT_ASSESSED"`` (ruling 14). The 低/中/高 branch in the
    #: frontend is dead code.
    severity: str | None = None
    createTime: JavaDateTimeStr | None = None
    otherDisease: list[Disease] | None = None

    aiRejected: bool | None = None
    abstainReason: str | None = None
    modelVersion: str | None = None
    weightSha256: str | None = None
    humanReviewStatus: str | None = None
    humanResult: str | None = None
    humanSeverity: str | None = None
    humanRecommendations: str | None = None
    humanReviewNote: str | None = None
    disclaimer: str | None = None
    requiresReview: bool | None = None
    qualityScore: int | None = None
    qualityReasons: str | None = None
    preprocessVersion: str | None = None
    inferencePolicyVersion: str | None = None
    calibrationStatus: str | None = None
    #: Present only when ``calibrationStatus == "CALIBRATED"``.
    calibratedProbability: float | None = None
    oodStatus: str | None = None
    oodScore: float | None = None


def requires_review(human_review_status: str | None) -> bool:
    """``"AWAITING_REVIEW".equals(humanReviewStatus)``.

    Reproduced as a function rather than inlined because both VOs compute it the
    same way and the string compare is case-sensitive on purpose -- the column
    is written only by this service, so a lowercase value means corruption.
    """
    return human_review_status == "AWAITING_REVIEW"


def is_ascending(sort_order: str | None) -> bool:
    """MyBatis Plus ``orderBy(condition, isAsc, columns)`` predicate.

    Java calls ``sortOrder.equals(ASC)``, which NPEs on an explicit
    ``"sortOrder": null`` in the request body. Python treats ``None`` as
    descending -- the same outcome as the ``"descend"`` default, without the
    500. Recorded as a deliberate deviation.
    """
    return sort_order == ASC
