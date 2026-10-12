"""``/diagnosis`` routes -- all 8 endpoints in ``DiagnosisController.java``.

This module replaces the gRPC hop. ``DiagnosisServiceImpl#doDiagnosis`` used to
call ``DiagnosisGrpcClient.diagnose(imageBytes, imageFormat)``; it now calls
:class:`web.inference.InferenceEngine` in-process, so the proto disappears from
the request path while its 19 fields survive as ``InferenceResult``.

Behaviour preserved verbatim from ``DiagnosisServiceImpl``, including several
that look like mistakes:

* **The inference cache is opt-in on a full fingerprint.** ``isCacheEnabled``
  requires all four of modelVersion / weightSha256 / preprocessVersion /
  policyVersion to be non-blank, and the *response's* fingerprint must equal
  the *configured* one before a row is written. With the default empty
  ``MODEL_WEIGHTS_SHA256`` the cache is never read or written -- which is
  Java's behaviour, not a missing feature here.
* **COS failure is swallowed, then the row fails on NOT NULL.** ``url`` is only
  set on the entity when the upload returned a value; with no value it stays
  null and the INSERT violates ``url NOT NULL``, so the caller gets the
  catch-all ``50000``/``系统错误`` and *nothing is stored*. See ruling 13.
* **A rejected upload is read back with its conclusion stripped.** Both VOs
  null out the AI fields when ``aiRejected`` is true, so a rejected image can
  never be rendered as a diagnosis. This happens on *read* (``objToVo``), not
  only on write.
* **The detail route is ownership-checked; the list routes are too**, because
  the controller overwrites ``userId`` with the session user before querying.

Deviations are called out inline and listed in ``docs/migration-decisions.md``.
"""

import hashlib
import json
import logging
import random
from datetime import datetime
from functools import partial

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from web.auth import LoginUser, require_role
from web.constant import (
    ADMIN_ROLE,
    DEFAULT_ROLE,
    DIAGNOSIS_CATEGORY_LABELS,
    DIAGNOSIS_RECOMMENDATIONS,
    HUMAN_REVIEW_AI_ONLY,
    HUMAN_REVIEW_AWAITING_REVIEW,
    HUMAN_REVIEW_REVIEWED,
    HUMAN_RESULT_REQUIRED,
    ONLY_ADMIN_CAN_REVIEW,
    REEXAMINE_STATUS_DONE,
    REEXAMINE_STATUS_UNDONE,
    SEVERITY_NOT_ASSESSED,
)
from web.db import id_generator
from web.deps import get_config, get_db
from web.files import upload_picture
from web.inference import InferenceResult, InferenceUnavailable
from web.models.diagnosis import Diagnosis
from web.models.inference_cache import InferenceCache
from web.models.user import User
from web.response import BaseResponse, BizError, ErrorCode, PageResult
from web.schemas.diagnosis import (
    Disease,
    DiagnosisManageVO,
    DiagnosisQueryDTO,
    DiagnosisResultDTO,
    DiagnosisResultVO,
    is_ascending,
    requires_review,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diagnosis", tags=["diagnosis"])

#: ``DiagnosisController.java:98`` -- ``String.format("public/%s", userId)``.
#: The same prefix avatars use, so both land in one per-user folder.
PICTURE_PREFIX = "public/{user_id}"

#: ``DiagnosisController.java:113`` -- ``diagnosis:v2:listDiagnosisVOByPage:{md5}``.
#: The ``v2`` is deliberate (the comment cites a medical privacy release) and is
#: reproduced as-is rather than bumped again.
_DIAGNOSIS_PAGE_CACHE_PREFIX = "diagnosis:v2:listDiagnosisVOByPage"

#: ``:110`` -- 5-10 minutes, randomised against a cache stampede.
_CACHE_TTL_BASE = 300
_CACHE_TTL_JITTER = 300

#: ``DiagnosisController.java:172`` -- empty multipart file.
PICTURE_REQUIRED = "请上传诊断图片"
#: The literal ``GlobalExceptionHandler.java:37`` passes. Note it is *not*
#: ``ErrorCode.SYSTEM_ERROR.message`` ("系统内部异常") -- the frontend shows
#: ``msg`` verbatim, so the wording is visible.
SYSTEM_ERROR_MESSAGE = "系统错误"

#: ``diagnosis.proto`` OodStatus enum names. Java stores ``.name()`` in
#: ``t_diagnosis.oodStatus`` / ``t_inference_cache.oodStatus`` (:240, :363) and
#: reads it back through ``parseOodStatus`` (:405-411), which falls back to
#: NOT_EVALUATED for anything unrecognised.
OOD_STATUSES = frozenset(
    {"OOD_STATUS_UNSPECIFIED", "NOT_EVALUATED", "IN_DISTRIBUTION",
     "OUT_OF_DISTRIBUTION", "EVALUATION_FAILED"}
)
OOD_STATUS_NOT_EVALUATED = "NOT_EVALUATED"
#: The only other accepted value; also the exact string Java compares against
#: before surfacing ``calibratedProbability`` (:236, :429).
CALIBRATED = "CALIBRATED"

#: The three boolean-ish columns are TINYINT in MySQL and ``Boolean`` in proto.
_TINY_TRUE = 1

require_admin = partial(require_role, ADMIN_ROLE)
any_user = partial(require_role, DEFAULT_ROLE)


# ---------------------------------------------------------------------------
# Inference cache -- DiagnosisServiceImpl:174-202, 332-411
# ---------------------------------------------------------------------------
def normalize_weight_sha256(value: str | None) -> str:
    """``normalizeWeightSha256`` (:309-311).

    Blank -> ``""`` (not ``None``): the value goes into a NOT NULL cache key,
    and ``StrUtil.isBlank`` treats null and "" alike, so an unset SHA disables
    the cache rather than crashing.
    """
    return (value or "").strip().lower()


def is_cache_enabled(model_version: str, weight_sha256: str, preprocess_version: str, policy_version: str) -> bool:
    """``isCacheEnabled`` (:313-319) -- all four parts must be non-blank."""
    return bool(
        model_version and normalize_weight_sha256(weight_sha256) and preprocess_version and policy_version
    )


def sha256_hex(data: bytes) -> str:
    """``sha256Hex`` (:295-307). Byte-identical to ``hashlib``'s hexdigest."""
    return hashlib.sha256(data).hexdigest()


def find_cached(db: Session, image_hash: str, fingerprint: tuple[str, str, str, str]) -> InferenceResult | None:
    """``InferenceCacheMapper.findByHash`` -- exact match on all five key columns.

    The weight SHA is compared lowercased on both sides, because Java
    normalises before the query while the stored value came from a lowercase
    digest. ``LIMIT 1`` in Java; here a unique key makes it at most one row.
    """
    model_version, weight_sha256, preprocess_version, policy_version = fingerprint
    row = db.execute(
        select(InferenceCache).where(
            InferenceCache.image_hash == image_hash,
            InferenceCache.model_version == model_version,
            InferenceCache.weight_sha256 == weight_sha256,
            InferenceCache.preprocess_version == preprocess_version,
            InferenceCache.inference_policy_version == policy_version,
        )
    ).scalars().first()
    return None if row is None else _result_from_cache(row)


def _result_from_cache(row: InferenceCache) -> InferenceResult:
    """``DiagnosisServiceImpl.toProto`` (:371-403), inverted.

    Two deliberate degradations are reproduced:

    * ``calibrationStatus`` null -> ``NOT_CALIBRATED`` (:380), because the proto
      field is a non-optional string and a null would have serialised to "".
    * ``parseOodStatus`` (:405-411) maps any unrecognised or NULL value to
      ``NOT_EVALUATED`` rather than raising, so a lowercase column value
      silently loses its meaning.

    ``topPredictions`` parse failure *does* propagate in Java
    (``IllegalStateException``) and does here too -- a silently empty list would
    hide a corrupted cache row behind a plausible-looking result.
    """
    top = json.loads(row.top_predictions) if row.top_predictions else []
    status = row.ood_status if row.ood_status in OOD_STATUSES else OOD_STATUS_NOT_EVALUATED
    return InferenceResult(
        predicted_label=row.predicted_label,
        probability=row.probability,
        reliability_score=row.reliability_score,
        description=row.description or "",
        top_predictions=top,
        rejected=bool(row.rejected),
        abstain_reason=row.abstain_reason or "",
        quality_score=row.quality_score,
        quality_reasons=row.quality_reasons or "",
        is_ood=bool(row.is_ood),
        ood_score=row.ood_score,
        ood_status=status,
        requires_review=bool(row.requires_review),
        calibrated_probability=row.calibrated_probability,
        calibration_status=row.calibration_status or "NOT_CALIBRATED",
        model_version=row.model_version,
        weight_sha256=row.weight_sha256,
        preprocess_version=row.preprocess_version,
        inference_policy_version=row.inference_policy_version,
    )


def store_cached(db: Session, image_hash: str, result: InferenceResult) -> None:
    """``DiagnosisServiceImpl.toCacheEntity`` + ``InferenceCacheMapper.upsert``.

    **Insert-only-if-absent.** The XML is ``ON DUPLICATE KEY UPDATE id = id`` --
    a no-op update that swallows the duplicate-key error. A stale row is never
    refreshed and ``createTime`` is never bumped. Reproduced as a plain INSERT:
    if the row is somehow still there the IntegrityError surfaces instead of
    silently succeeding, which is strictly more informative and can only happen
    in a concurrent-insert race that Java also loses.
    """
    db.add(
        InferenceCache(
            id=id_generator.next_id(),
            image_hash=image_hash,
            model_version=result.model_version,
            weight_sha256=normalize_weight_sha256(result.weight_sha256),
            preprocess_version=result.preprocess_version,
            inference_policy_version=result.inference_policy_version,
            predicted_label=result.predicted_label,
            probability=result.probability,
            calibrated_probability=result.calibrated_probability,
            calibration_status=result.calibration_status,
            description=result.description,
            reliability_score=result.reliability_score,
            top_predictions=json.dumps(result.top_predictions, ensure_ascii=False),
            quality_score=result.quality_score,
            quality_reasons=result.quality_reasons,
            is_ood=_TINY_TRUE if result.is_ood else 0,
            ood_score=result.ood_score,
            ood_status=result.ood_status,
            rejected=_TINY_TRUE if result.rejected else 0,
            abstain_reason=result.abstain_reason,
            requires_review=_TINY_TRUE if result.requires_review else 0,
            create_time=datetime.now(),
        )
    )


def build_diagnosis_result(result: InferenceResult) -> DiagnosisResultVO:
    """``DiagnosisServiceImpl.buildDiagnosisResult`` (:417-456).

    The early return on ``rejected`` is the important part: a rejected upload
    gets reliability metadata and **no** conclusion -- no label, no probability,
    no advice, no disease list. Setting those would show a patient a diagnosis
    the system just declined to make.

    ``severity`` is the constant ``NOT_ASSESSED`` (:445), never a value derived
    from the probability -- see ruling 14.
    """
    vo = DiagnosisResultVO(
        aiRejected=result.rejected,
        abstainReason=result.abstain_reason,
        qualityScore=result.quality_score,
        qualityReasons=result.quality_reasons,
        modelVersion=result.model_version,
        weightSha256=result.weight_sha256,
        preprocessVersion=result.preprocess_version,
        inferencePolicyVersion=result.inference_policy_version,
        calibrationStatus=result.calibration_status,
        # Null unless calibrated -- an uncalibrated 0.0 must not be read as
        # "the model is certain this is a 0% match" (:429).
        calibratedProbability=(
            result.calibrated_probability if result.calibration_status == CALIBRATED else None
        ),
        oodStatus=result.ood_status,
        oodScore=result.ood_score,
        requiresReview=result.requires_review,
        humanReviewStatus=(
            HUMAN_REVIEW_AWAITING_REVIEW if result.requires_review else HUMAN_REVIEW_AI_ONLY
        ),
        createTime=datetime.now(),
    )
    if result.rejected:
        return vo

    vo.result = DIAGNOSIS_CATEGORY_LABELS.get(result.predicted_label)
    vo.details = result.description
    vo.probability = result.probability
    vo.confidence = result.probability
    vo.recommendations = DIAGNOSIS_RECOMMENDATIONS.get(result.predicted_label)
    vo.severity = SEVERITY_NOT_ASSESSED
    vo.otherDisease = [
        Disease(name=entry["label"], probability=entry["probability"])
        for entry in result.top_predictions
    ]
    return vo


# ---------------------------------------------------------------------------
# VO projection
# ---------------------------------------------------------------------------
def _username_map(db: Session, user_ids: set[int]) -> dict[int, str]:
    """``selectUserNameAndUserAvatarByUserId`` for every owner at once.

    Java issues one query per row; this batches them. Not a contract change --
    ``UserMapper.xml:5`` selects only ``userName``/``userAvatar``, with **no**
    ``isDelete`` filter, so a logically deleted user still resolves to a name.
    A missing row yields ``None`` rather than Java's ``NullPointerException``
    at ``:158``, which would 500 the whole list page.
    """
    if not user_ids:
        return {}
    rows = db.execute(
        select(User.id, User.user_name).where(User.id.in_(user_ids))
    ).all()
    return {row.id: row.user_name for row in rows}


def _to_manage_vo(row: Diagnosis, username: str | None) -> DiagnosisManageVO:
    """``DiagnosisManageVO.objToVo`` (:93-104).

    ``clearAiConclusion`` nulls result/confidence/severity but **not**
    ``details``, ``probability`` or ``recommendations`` -- the manage view keeps
    the descriptive text even for a rejected image while dropping the headline
    diagnosis. Reproduced as-is.
    """
    vo = DiagnosisManageVO(
        id=row.id,
        url=row.url,
        username=username,
        result=row.result,
        confidence=row.confidence,
        severity=row.severity,
        reexamineStatus=row.reexamine_status,
        createTime=row.create_time,
        aiRejected=bool(row.ai_rejected),
        abstainReason=row.abstain_reason,
        requiresReview=requires_review(row.human_review_status),
    )
    if row.ai_rejected:
        vo.result = None
        vo.confidence = None
        vo.severity = None
    return vo


def _to_result_vo(row: Diagnosis) -> DiagnosisResultVO:
    """``DiagnosisResultVO.objToVo`` (:120-131).

    The detail view clears **more** than the manage view -- it also drops
    ``probability``, ``recommendations``, ``details`` and ``otherDisease``.
    """
    vo = DiagnosisResultVO(
        id=row.id,
        url=row.url,
        result=row.result,
        probability=row.probability,
        confidence=row.confidence,
        recommendations=row.recommendations,
        details=row.details,
        severity=row.severity,
        createTime=row.create_time,
        aiRejected=bool(row.ai_rejected),
        abstainReason=row.abstain_reason,
        modelVersion=row.model_version,
        weightSha256=row.weight_sha256,
        humanReviewStatus=row.human_review_status,
        humanResult=row.human_result,
        humanSeverity=row.human_severity,
        humanRecommendations=row.human_recommendations,
        humanReviewNote=row.human_review_note,
        requiresReview=requires_review(row.human_review_status),
        qualityScore=row.quality_score,
        qualityReasons=row.quality_reasons,
        preprocessVersion=row.preprocess_version,
        inferencePolicyVersion=row.inference_policy_version,
        calibrationStatus=row.calibration_status,
        calibratedProbability=row.calibrated_probability,
        oodStatus=row.ood_status,
        oodScore=row.ood_score,
    )
    if row.ai_rejected:
        vo.result = None
        vo.probability = None
        vo.confidence = None
        vo.recommendations = None
        vo.details = None
        vo.severity = None
        vo.otherDisease = None
    return vo


# ---------------------------------------------------------------------------
# Query wrapper -- DiagnosisServiceImpl:116-142
# ---------------------------------------------------------------------------
def _diagnosis_query(query: DiagnosisQueryDTO):
    """``getDiagnosisQueryWrapper`` (:116-142).

    The first ``eq`` in Java reads ``eq(isNotNull(id), "userId", userId)`` --
    the condition tests ``id`` but the column is ``userId``, so that clause
    fires only when ``id`` is supplied (:134). It is dead weight: the last
    ``eq`` (:138) applies the same ``userId`` predicate unconditionally, and the
    controller always sets it. Net predicate is therefore identical either way,
    and this port emits the single unconditional filter.

    No ``ORDER BY`` when ``sortField`` is blank -- MyBatis Plus treats the
    field name as the *condition*, so an empty sort silently drops sorting
    rather than erroring. Reproduced.

    ``sortField`` is a **column** name in Java (``orderBy`` interpolates it
    straight into SQL), i.e. camelCase ``createTime``, not the Python attribute
    ``create_time``. Looked up in the table's column map rather than by
    ``getattr``: that matches what the client sends, and it rejects anything
    that is not a real column instead of concatenating it.
    """
    stmt = select(Diagnosis).where(Diagnosis.is_delete == 0)
    if query.id is not None:
        stmt = stmt.where(Diagnosis.id == int(query.id))
    if query.result and query.result.strip():
        stmt = stmt.where(Diagnosis.result.like(f"%{query.result}%"))
    if query.sortField and query.sortField.strip():
        column = Diagnosis.__table__.columns.get(query.sortField)
        if column is not None:
            stmt = stmt.order_by(column.asc() if is_ascending(query.sortOrder) else column.desc())
    return stmt


def _query_page(db: Session, query: DiagnosisQueryDTO, user_id: int) -> PageResult[DiagnosisManageVO]:
    base = _diagnosis_query(query).where(Diagnosis.user_id == user_id)
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.limit(query.pageSize).offset((query.current - 1) * query.pageSize)
    ).scalars().all()
    names = _username_map(db, {row.user_id for row in rows})
    return PageResult.of(
        [_to_manage_vo(row, names.get(row.user_id)) for row in rows],
        total,
        query.pageSize,
        query.current,
    )


# ---------------------------------------------------------------------------
# POST /diagnosis/upload -- any signed-in user
# ---------------------------------------------------------------------------
@router.post("/upload", summary="诊断图片上传")
async def upload_picture_endpoint(
    request: Request,
    file: UploadFile = File(...),
    id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``DiagnosisServiceImpl.uploadDiagnosisPicture`` (:90-113).

    The ``id`` form field is accepted and **ignored** -- Java's
    ``saveOrUpdate`` inserts because the freshly built entity has no id, so the
    DTO's id never reaches the database even though the frontend sends it.

    ``username`` is ``None`` here even though the row has an owner: Java calls
    ``DiagnosisManageVO.objToVo(diagnosis)`` directly (:112), not
    ``getDiagnosisManageVO``, so this one endpoint skips the ``t_user`` lookup
    that the list endpoints perform.
    """
    data = await file.read()
    detail = await upload_picture(data, file.filename, prefix=PICTURE_PREFIX.format(user_id=user.id))

    row = Diagnosis(
        id=id_generator.next_id(),
        url=detail.url,
        user_id=int(user.id),
        pic_size=detail.pic_size,
        pic_width=detail.pic_width,
        pic_height=detail.pic_height,
        pic_scale=detail.pic_scale,
        pic_format=detail.pic_format,
        create_time=datetime.now(),
        is_delete=0,
    )
    db.add(row)
    db.flush()
    return BaseResponse.success(_to_manage_vo(row, None))


# ---------------------------------------------------------------------------
# POST /diagnosis/list/page/{vo,vo/cache,my} -- any signed-in user
# ---------------------------------------------------------------------------
@router.post("/list/page/vo", summary="获取分页诊断列表")
def list_diagnosis_vo(
    body: DiagnosisQueryDTO,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``listDiagnosisVOByPage``.

    The three list endpoints differ only in caching. ``userId`` is overwritten
    with the session user, so a client posting another user's id gets their own
    rows back rather than someone else's.
    """
    return BaseResponse.success(_query_page(db, body, int(user.id)))


@router.post("/list/page/vo/cache", summary="获取分页诊断列表（缓存版本）")
async def list_diagnosis_vo_cached(
    request: Request,
    body: DiagnosisQueryDTO,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``listDiagnosisVOByPageWithCache`` (:68-110).

    The key is ``md5(userId:userRole:json(dto))``, so a shared cache can never
    serve one user's medical records to another. The ``json(dto)`` term is not
    byte-identical to Hutool's, so a cache entry written by Java is simply a
    miss here -- harmless, and only possible before Nginx finishes the cutover.
    """
    scope = (
        f"{user.id}:{user.userRole}:"
        + json.dumps(body.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    )
    key = f"{_DIAGNOSIS_PAGE_CACHE_PREFIX}:{hashlib.md5(scope.encode('utf-8')).hexdigest()}"

    redis = request.app.state.redis
    cached = await redis.get(key)
    if cached:
        return BaseResponse.success(PageResult[DiagnosisManageVO].model_validate_json(cached))

    page = _query_page(db, body, int(user.id))
    await redis.setex(key, _CACHE_TTL_BASE + random.randint(0, _CACHE_TTL_JITTER), page.model_dump_json())
    return BaseResponse.success(page)


@router.post("/list/page/my", summary="获取我的诊断列表")
def list_my_diagnosis_vo(
    body: DiagnosisQueryDTO,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``listMyDiagnosisVOByPage`` (:113-131) -- identical to ``/list/page/vo``.

    The Java source looks like it calls a *static* setter
    (``DiagnosisQueryDTO.setUserId(...)`` with the class name), which would not
    compile. It does, because the parameter is declared
    ``DiagnosisQueryDTO DiagnosisQueryDTO`` -- the variable name shadows the
    type name (JLS 6.5.2), so it is an ordinary instance call and this endpoint
    is scoped to the caller exactly like the other two.
    """
    return BaseResponse.success(_query_page(db, body, int(user.id)))


# ---------------------------------------------------------------------------
# POST /diagnosis/delete/{id} -- admin
# ---------------------------------------------------------------------------
@router.post("/delete/{id}", summary="删除诊断记录")
def delete_diagnosis(
    id: int,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """Logical delete -- ``removeById`` on a ``@TableLogic`` field issues
    ``UPDATE t_diagnosis SET isDelete=1``, keeping the row for referential
    integrity while hiding it from every query. Returns ``false`` for a row
    that is absent or already deleted, as Java does.
    """
    if id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    row = db.get(Diagnosis, id)
    if row is None or row.is_delete:
        return BaseResponse.success(False)
    row.is_delete = 1
    db.flush()
    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# POST /diagnosis/diagnosis -- any signed-in user
# ---------------------------------------------------------------------------
@router.post("/diagnosis", summary="进行 AI 诊断")
async def do_diagnosis(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``DiagnosisServiceImpl.doDiagnosis`` (:169-252), with the gRPC hop
    replaced by :meth:`web.inference.InferenceEngine.diagnose`.

    Failure mode differs from Java's and that is the point: the gRPC servicer
    returned an **empty** ``DiagnosisResponse`` on any exception (:161-166),
    which Java then stored as a diagnosis with an empty label and
    ``rejected=false`` -- a fabricated result shown to a patient. The engine
    raises instead, so the failure reaches the caller as
    ``50000``/``系统错误`` with no row written.
    """
    data = await file.read()
    if not data:
        raise BizError(ErrorCode.PARAMS_ERROR, PICTURE_REQUIRED)

    config = get_config()
    image_hash = sha256_hex(data)
    fingerprint = (
        config.model_version,
        normalize_weight_sha256(config.model_weights_sha256),
        config.preprocess_version,
        config.inference_policy_version,
    )
    cache_enabled = is_cache_enabled(*fingerprint)

    result = find_cached(db, image_hash, fingerprint) if cache_enabled else None
    if result is None:
        # Off the event loop: this is CPU/GPU-bound and synchronous.
        result = await run_in_threadpool(
            _diagnose_via_engine, request, data, file.content_type
        )
        if cache_enabled and result.fingerprint() == fingerprint:
            store_cached(db, image_hash, result)
        elif cache_enabled:
            # Java logs and skips the write here; reproducing the skip matters
            # more than the log line -- writing under the *configured* key would
            # serve this response to every later deployment that shares the key.
            logger.warning(
                "skip inference cache: response fingerprint %s != configured %s",
                result.fingerprint(),
                fingerprint,
            )

    # COS upload is best-effort. Java swallows the failure and continues with a
    # null url -- which then fails the NOT NULL constraint on insert, so the
    # row is not stored and the caller sees 50000. Reproduced below rather than
    # "fixed", because storing a diagnosis with no image is worse.
    image_url = None
    try:
        detail = await upload_picture(data, file.filename, prefix=PICTURE_PREFIX.format(user_id=user.id))
        image_url = detail.url
    except BizError:
        logger.error("COS upload failed for diagnosis %s", user.id, exc_info=True)
    except Exception:  # noqa: BLE001
        logger.exception("COS upload failed for diagnosis %s", user.id)

    vo = build_diagnosis_result(result)
    vo.url = image_url

    # `url` is NOT NULL. Java gets here with a null url when COS failed, sets
    # it only "if (imageUrl != null)" (:221-223), and the INSERT then throws
    # inside the try -- wrapped as RuntimeException and surfaced by the catch-all
    # as {code: 50000, msg: "系统错误"} with **no row written**. Raising the same
    # envelope explicitly makes that deterministic instead of dependent on the
    # driver, and it keeps the promise that a COS outage never stores a
    # diagnosis whose image is unreachable.
    if image_url is None:
        raise BizError(ErrorCode.SYSTEM_ERROR, SYSTEM_ERROR_MESSAGE)

    row = Diagnosis(
        id=id_generator.next_id(),
        url=image_url,
        user_id=int(user.id),
        result=vo.result,
        probability=vo.probability,
        confidence=vo.confidence,
        recommendations=vo.recommendations,
        details=vo.details,
        severity=vo.severity,
        reexamine_status=REEXAMINE_STATUS_UNDONE,
        create_time=datetime.now(),
        is_delete=0,
        ai_rejected=result.rejected,
        abstain_reason=result.abstain_reason,
        model_version=result.model_version or config.model_version,
        weight_sha256=normalize_weight_sha256(result.weight_sha256) or None,
        preprocess_version=result.preprocess_version,
        inference_policy_version=result.inference_policy_version,
        calibration_status=result.calibration_status,
        calibrated_probability=vo.calibratedProbability,
        quality_score=result.quality_score,
        quality_reasons=result.quality_reasons,
        ood_status=result.ood_status,
        ood_score=result.ood_score,
        human_review_status=vo.humanReviewStatus,
    )
    db.add(row)
    db.flush()
    vo.id = row.id
    return BaseResponse.success(vo)


def _diagnose_via_engine(request: Request, data: bytes, content_type: str | None) -> InferenceResult:
    """Pull the process-wide engine off ``app.state`` and run one forward pass.

    Raises :class:`InferenceUnavailable` when no weights are configured, which
    is the correct production behaviour for a deployment that has none: fail
    closed rather than return a made-up result.
    """
    engine = getattr(request.app.state, "inference_engine", None)
    if engine is None:
        raise InferenceUnavailable(
            "inference engine is not initialised; /diagnosis/diagnosis will fail closed"
        )
    return engine.diagnose(data, content_type)


# ---------------------------------------------------------------------------
# GET /diagnosis/get/{id} -- any signed-in user
# ---------------------------------------------------------------------------
@router.get("/get/{id}", summary="获取诊断结果")
def get_diagnosis_result(
    id: int,
    db: Session = Depends(get_db),
    user: LoginUser = Depends(any_user),
):
    """``getOwnedDiagnosis`` (:282-290) + ``DiagnosisResultVO.objToVo``.

    Ownership: a non-admin gets ``NO_AUTH_ERROR`` for someone else's row. Note
    that ``NOT_FOUND_ERROR`` takes precedence over the ownership check, so the
    existence of a row is disclosed before authorisation -- Java's order, kept
    because the two codes drive different frontend flows.
    """
    if id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    row = db.get(Diagnosis, id)
    if row is None:
        raise BizError(ErrorCode.NOT_FOUND_ERROR)
    if user.userRole != ADMIN_ROLE and row.user_id != int(user.id):
        raise BizError(ErrorCode.NO_AUTH_ERROR)
    return BaseResponse.success(_to_result_vo(row))


# ---------------------------------------------------------------------------
# POST /diagnosis/update -- admin, human review
# ---------------------------------------------------------------------------
@router.post("/update", summary="人工复诊")
def update_diagnosis_result(
    body: DiagnosisResultDTO,
    db: Session = Depends(get_db),
    reviewer: LoginUser = Depends(require_admin),
):
    """``DiagnosisServiceImpl.recordHumanReview`` (:255-279).

    Only ``human*`` columns are writable. The AI conclusion is deliberately not
    in :class:`DiagnosisResultDTO`, so no payload -- however crafted -- can
    overwrite ``result``/``probability``/``details``/``aiRejected`` through this
    route. That is a schema-level guarantee, not a field-by-field filter.

    Validation order is copied because each branch has its own message:
    not-admin -> ``仅管理员可写入人工复核字段``, blank ``humanResult`` ->
    ``必须填写人工结论``.
    """
    if body.id is None or int(body.id) <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    if reviewer.userRole != ADMIN_ROLE:
        raise BizError(ErrorCode.NO_AUTH_ERROR, ONLY_ADMIN_CAN_REVIEW)
    if not body.humanResult or not body.humanResult.strip():
        raise BizError(ErrorCode.PARAMS_ERROR, HUMAN_RESULT_REQUIRED)

    row = db.get(Diagnosis, int(body.id))
    if row is None:
        raise BizError(ErrorCode.NOT_FOUND_ERROR)
    # ``getOwnedDiagnosis`` is called here, but the route already requires
    # ``admin`` -- the one thing that check would reject is unreachable, so
    # there is nothing left to re-test.

    row.human_result = body.humanResult
    row.human_severity = body.humanSeverity
    row.human_recommendations = body.humanRecommendations
    row.human_review_note = body.humanReviewNote
    row.human_reviewer_id = int(reviewer.id)
    row.human_reviewed_at = datetime.now()
    row.human_review_status = HUMAN_REVIEW_REVIEWED
    # Legacy mirror kept for the existing reexamine-status filters (:276).
    row.reexamine_status = REEXAMINE_STATUS_DONE
    db.flush()
    return BaseResponse.success(True)
