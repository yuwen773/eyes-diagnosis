"""Diagnosis-domain contract tests (Phase 2.2).

Three groups:

* **Structural** -- endpoint parity against ``DiagnosisController.java``,
  auth dependencies, and the wire shape of both VOs. These need no database and
  are what the ``python-web`` CI job actually runs.
* **Desensitization / projection** -- ``objToVo`` + ``clearAiConclusion`` and
  ``buildDiagnosisResult``. Run against SQLite, because these decide whether a
  rejected upload can be read as a diagnosis.
* **Cache** -- the 5-tuple key, the fingerprint gate and the round trip through
  ``t_inference_cache``.

The desensitization tests are the ones worth having. ``DiagnosisController`` has
no automated coverage, the frontend's generated client has none, and the failure
mode they guard -- a rejected image rendered with a confident label -- is
silent and clinically serious.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import API_PREFIX, create_app  # noqa: E402
from web.auth import require_role  # noqa: E402
from web.constant import (  # noqa: E402
    DIAGNOSIS_CATEGORY_LABELS,
    DIAGNOSIS_RECOMMENDATIONS,
    HUMAN_REVIEW_AI_ONLY,
    HUMAN_REVIEW_AWAITING_REVIEW,
    HUMAN_REVIEW_REVIEWED,
    HUMAN_RESULT_REQUIRED,
    ONLY_ADMIN_CAN_REVIEW,
    STATUS_COMPLETED,
)
from web.inference import InferenceResult  # noqa: E402
from web.models.diagnosis import Diagnosis  # noqa: E402
from web.models.inference_cache import CACHE_KEY_COLUMNS, InferenceCache  # noqa: E402
from web.models.user import User  # noqa: E402
from web.routers.diagnosis import (  # noqa: E402
    OOD_STATUSES,
    PICTURE_REQUIRED,
    build_diagnosis_result,
    find_cached,
    is_cache_enabled,
    normalize_weight_sha256,
    _diagnosis_query,
    _diagnose_via_engine,
    _query_page,
    _result_from_cache,
    _to_manage_vo,
    _to_result_vo,
    router,
    store_cached,
)
from web.schemas.diagnosis import (  # noqa: E402
    DiagnosisManageVO,
    DiagnosisQueryDTO,
    DiagnosisResultDTO,
    DiagnosisResultVO,
    is_ascending,
    requires_review,
)

DIAGNOSIS_CONTROLLER = (
    REPO_ROOT / "src/main/java/com/csust/eyediagnosis/controller/DiagnosisController.java"
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def db():
    """SQLite session with just ``t_diagnosis`` and ``t_user``.

    Only those two are needed: the projection and query functions take a session
    directly, so there is no engine to swap out.
    """
    engine = create_engine("sqlite://", future=True)
    Diagnosis.__table__.create(engine)
    User.__table__.create(engine)
    InferenceCache.__table__.create(engine)
    session = sessionmaker(bind=engine, future=True)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _diagnosis(**overrides) -> Diagnosis:
    defaults = dict(
        id=1,
        url="https://cos.example/public/1/a.jpg",
        user_id=7,
        result="青光眼",
        probability=88.5,
        confidence=88.5,
        recommendations=DIAGNOSIS_RECOMMENDATIONS["glaucoma"],
        details="青光眼是一组以视神经萎缩...",
        severity="NOT_ASSESSED",
        reexamine_status=1,
        create_time=datetime(2025, 1, 2, 3, 4, 5),
        is_delete=0,
        ai_rejected=0,
        abstain_reason=None,
        model_version="efficientnet-b4@1.0.0",
        weight_sha256=None,
        human_review_status="AI_ONLY",
        human_reviewer_id=None,
        human_reviewed_at=None,
        human_review_note=None,
        human_result=None,
        human_severity=None,
        human_recommendations=None,
        preprocess_version="v1",
        inference_policy_version="medical-safety-v3-quality-observe",
        calibration_status="NOT_CALIBRATED",
        calibrated_probability=None,
        quality_score=90,
        quality_reasons=None,
        ood_status="NOT_EVALUATED",
        ood_score=None,
        pic_size=1024,
        pic_width=100,
        pic_height=200,
        pic_scale=0.5,
        pic_format="jpeg",
    )
    defaults.update(overrides)
    return Diagnosis(**defaults)


def _inference(**overrides) -> InferenceResult:
    defaults = dict(
        predicted_label="glaucoma",
        probability=88.5,
        reliability_score=89,
        description="青光眼是一组以视神经萎缩和视野缺损为特征的疾病。",
        top_predictions=[
            {"label": "glaucoma", "probability": 88.5},
            {"label": "cataract", "probability": 7.2},
            {"label": "normal", "probability": 4.3},
        ],
        rejected=False,
        abstain_reason="",
        quality_score=90,
        quality_reasons="",
        is_ood=False,
        ood_score=0.0,
        ood_status="NOT_EVALUATED",
        requires_review=False,
        calibrated_probability=0.0,
        calibration_status="NOT_CALIBRATED",
        model_version="efficientnet-b4@1.0.0",
        weight_sha256="ab" * 32,
        preprocess_version="v1",
        inference_policy_version="medical-safety-v3-quality-observe",
    )
    defaults.update(overrides)
    return InferenceResult(**defaults)


# ---------------------------------------------------------------------------
# Structural: endpoint parity
# ---------------------------------------------------------------------------
def _java_diagnosis_paths() -> set[str]:
    source = DIAGNOSIS_CONTROLLER.read_text(encoding="utf-8")
    return {"/diagnosis" + p for p in re.findall(r'@(?:Post|Get)Mapping\("([^"]+)"\)', source)}


def _python_diagnosis_paths() -> set[str]:
    spec = create_app().openapi()
    return {
        path[len(API_PREFIX):]
        for path in spec["paths"]
        if path.startswith(f"{API_PREFIX}/diagnosis/")
    }


def test_all_eight_diagnosis_endpoints_are_migrated():
    """All 8 move to Python -- unlike the user domain, none of them need the
    Java session for anything but the caller lookup, which Python already does
    by forwarding JSESSIONID."""
    assert len(_java_diagnosis_paths()) == 8
    assert _java_diagnosis_paths() - _python_diagnosis_paths() == set()


_ASYNC_WORKFLOW_PATHS = {"/diagnosis/workflows", "/diagnosis/workflows/{workflowId}",
    "/diagnosis/workflows/{workflowId}/image", "/diagnosis/workflows/{workflowId}/save-confirmation",
    "/diagnosis/workflows/{workflowId}/save-confirmations/{confirmationId}/approve",
    "/diagnosis/workflows/{workflowId}/save-confirmations/{confirmationId}/reject"}


def test_python_adds_only_approved_async_workflow_endpoints():
    """Async workflow and issue11 consent routes; legacy paths still match Java."""
    assert _python_diagnosis_paths() - _java_diagnosis_paths() == _ASYNC_WORKFLOW_PATHS


def test_router_declares_exactly_the_migrated_endpoints():
    declared = {route.path for route in router.routes}
    assert declared == _python_diagnosis_paths() - _ASYNC_WORKFLOW_PATHS


def _route(suffix: str):
    return next(r for r in router.routes if r.path.endswith(suffix))


def _auth_dependencies(route) -> list:
    found = []
    for dependant in route.dependant.dependencies:
        call = dependant.call
        if getattr(call, "func", call) is require_role:
            found.append(call)
    return found


def test_every_diagnosis_route_is_authenticated():
    """``DiagnosisController`` annotates all 8 with ``@AuthCheck``. Dropping a
    Depends would expose a patient's diagnosis history anonymously."""
    for route in router.routes:
        assert _auth_dependencies(route), route.path


def test_admin_only_routes_are_delete_and_update():
    """``@AuthCheck(mustRole = ADMIN_ROLE)`` on exactly two endpoints: the
    logical delete and the human-review write. Every other route is
    ``DEFAULT_ROLE``, which ``AuthInterceptor`` treats as "logged in"."""
    admin_only = [r for r in router.routes if _admin_required(r)]
    assert {r.path for r in admin_only} == {
        "/diagnosis/delete/{id}",
        "/diagnosis/update",
    }


def _admin_required(route) -> bool:
    for dependant in route.dependant.dependencies:
        call = dependant.call
        if getattr(call, "func", call) is require_role:
            return call.args[0] == "admin"
    return False


def test_multipart_field_is_singular_file_on_both_upload_endpoints():
    """``@RequestPart("file")`` in Java. ``files`` (plural) is the *knowledge*
    domain's field and would bind nothing here, silently uploading nothing."""
    for suffix in ("/upload", "/diagnosis"):
        assert len(_route(suffix).dependant.body_params) >= 1


# ---------------------------------------------------------------------------
# Structural: wire shape
# ---------------------------------------------------------------------------
def test_manage_vo_id_is_a_string_but_reexamine_status_is_a_number():
    """``JsonConfig`` registers ``ToStringSerializer`` for ``Long``/``long``
    only. ``id`` is ``Long`` -> string. ``reexamineStatus`` is a primitive
    ``int`` (``DiagnosisManageVO.java:56``) -> number. Stringifying it would be
    a silent wire change that the frontend's ``Number(...)`` compensates for
    inconsistently.
    """
    vo = _to_manage_vo(_diagnosis(), "张三")
    dumped = vo.model_dump(mode="json")
    assert dumped["id"] == "1"
    assert isinstance(dumped["id"], str)
    assert dumped["reexamineStatus"] == 1
    assert isinstance(dumped["reexamineStatus"], int)
    # Doubles stay numbers.
    assert isinstance(dumped["confidence"], float)


def test_result_vo_id_is_a_string_and_probability_is_a_number():
    dumped = _to_result_vo(_diagnosis()).model_dump(mode="json")
    assert dumped["id"] == "1" and isinstance(dumped["id"], str)
    assert dumped["probability"] == 88.5
    assert isinstance(dumped["probability"], float)


def test_dates_are_formatted_as_yyyy_mm_dd_hh_mm_ss():
    dumped = _to_manage_vo(_diagnosis(), "张三").model_dump(mode="json")
    assert dumped["createTime"] == "2025-01-01 19:04:05"


def test_manage_vo_status_is_always_completed():
    """``DiagnosisManageVO.java:66`` initialises ``status`` at field-declaration
    time. It is not a column and does not track ``reexamineStatus`` -- a row
    marked "已复审" still reports "已完成"."""
    assert _to_manage_vo(_diagnosis(), "张三").status == STATUS_COMPLETED
    assert _to_manage_vo(_diagnosis(reexamine_status=3), "张三").status == STATUS_COMPLETED


def test_requires_review_is_derived_from_human_review_status():
    """``"AWAITING_REVIEW".equals(...)`` -- not from ``requiresReview``/AI."""
    assert requires_review("AWAITING_REVIEW") is True
    assert requires_review("AI_ONLY") is False
    assert requires_review("REVIEWED") is False
    assert requires_review(None) is False
    assert _to_manage_vo(_diagnosis(human_review_status="AWAITING_REVIEW"), "x").requiresReview
    assert not _to_manage_vo(_diagnosis(human_review_status="REVIEWED"), "x").requiresReview


def test_query_dto_inherits_page_request_defaults():
    query = DiagnosisQueryDTO()
    assert (query.current, query.pageSize, query.sortOrder) == (1, 10, "descend")


def test_sort_order_predicate_matches_the_java_comparison():
    assert is_ascending("ascend") is True
    assert is_ascending("descend") is False
    assert is_ascending("ASC") is False
    # Java NPEs on an explicit null; Python sorts descending, same as the default.
    assert is_ascending(None) is False


def test_result_dto_carries_no_ai_fields():
    """The schema itself is the guarantee: no AI column can arrive through this
    route, so there is nothing to filter."""
    assert set(DiagnosisResultDTO.model_fields) == {
        "id",
        "humanResult",
        "humanSeverity",
        "humanRecommendations",
        "humanReviewNote",
    }
    dto = DiagnosisResultDTO(id="1", humanResult="已复核", result="篡改", probability=99.0)
    assert not hasattr(dto, "result")
    assert not hasattr(dto, "probability")


def test_extra_json_fields_are_ignored_not_rejected():
    """``extra="ignore"`` matters: the frontend posts AI fields alongside the
    human ones, and rejecting the body would break the admin review screen."""
    dto = DiagnosisResultDTO(id="1", humanResult="x", result="y", aiRejected=True)
    assert dto.humanResult == "x"


# ---------------------------------------------------------------------------
# Desensitization: the point of the whole read path
# ---------------------------------------------------------------------------
def test_rejected_diagnosis_hides_its_conclusion_in_the_manage_view():
    """``DiagnosisManageVO.clearAiConclusion`` nulls result/confidence/severity
    but deliberately keeps ``details`` and the reliability metadata."""
    vo = _to_manage_vo(_diagnosis(ai_rejected=1), "张三")
    assert vo.result is None
    assert vo.confidence is None
    assert vo.severity is None
    assert vo.aiRejected is True
    # Kept on purpose -- Java clears only these three.
    assert vo.url.endswith(".jpg")
    assert vo.reexamineStatus == 1


def test_rejected_diagnosis_hides_more_in_the_detail_view():
    """``DiagnosisResultVO.clearAiConclusion`` (:133-141) also nulls
    probability, recommendations, details and otherDisease. The patient-facing
    page reads this one, so it is the strictest of the two."""
    row = _diagnosis(ai_rejected=1)
    vo = _to_result_vo(row)
    for field in (
        "result", "probability", "confidence", "recommendations",
        "details", "severity", "otherDisease",
    ):
        assert getattr(vo, field) is None, field
    assert vo.aiRejected is True
    # Review metadata survives -- a clinician still needs to know it was rejected.
    assert vo.qualityScore == 90


def test_non_rejected_rows_keep_every_field():
    vo = _to_result_vo(_diagnosis())
    assert vo.result == "青光眼"
    assert vo.probability == 88.5
    assert vo.details.startswith("青光眼是一组")
    assert vo.severity == "NOT_ASSESSED"


def test_a_null_ai_rejected_column_is_not_treated_as_rejected():
    """The column predates the V5 migration, so older rows may be NULL.
    ``Boolean.TRUE.equals(null)`` is false in Java; ``if row.ai_rejected`` on a
    Python None would also be false, but ``not None`` style truthiness on a
    string would not be."""
    vo = _to_manage_vo(_diagnosis(ai_rejected=None), "张三")
    assert vo.result == "青光眼"


# ---------------------------------------------------------------------------
# buildDiagnosisResult
# ---------------------------------------------------------------------------
def test_build_result_maps_the_english_label_to_chinese():
    vo = build_diagnosis_result(_inference(predicted_label="diabetes"))
    assert vo.result == DIAGNOSIS_CATEGORY_LABELS["diabetes"] == "糖尿病"
    assert vo.recommendations == DIAGNOSIS_RECOMMENDATIONS["diabetes"]
    assert "\n" in vo.recommendations
    assert not vo.recommendations.startswith("[")


def test_build_result_sets_severity_to_not_assessed_only():
    """Ruling 14. Nothing in Java infers 低/中/高 from the probability, and
    neither does this -- a confidence number is not a severity assessment."""
    for probability in (1.0, 50.0, 99.9):
        vo = build_diagnosis_result(_inference(probability=probability))
        assert vo.severity == "NOT_ASSESSED"


def test_build_result_confidence_mirrors_probability():
    vo = build_diagnosis_result(_inference(probability=88.5))
    assert vo.confidence == vo.probability == 88.5


def test_build_result_rejected_early_return_carries_no_conclusion():
    """The single most important behaviour here: a rejected upload must not
    reach the patient with a label attached."""
    vo = build_diagnosis_result(
        _inference(rejected=True, abstain_reason="LOW_CONFIDENCE", predicted_label="amd")
    )
    for field in ("result", "details", "probability", "confidence",
                  "recommendations", "severity", "otherDisease"):
        assert getattr(vo, field) is None, field
    # ...but the reliability metadata is what a clinician needs to act on.
    assert vo.aiRejected is True
    assert vo.abstainReason == "LOW_CONFIDENCE"
    assert vo.qualityScore == 90


def test_build_result_maps_top_predictions_to_diseases():
    vo = build_diagnosis_result(_inference())
    assert [d.name for d in vo.otherDisease] == ["glaucoma", "cataract", "normal"]
    # Percent, matching `probability`. Disease.name is the *English* label.
    assert vo.otherDisease[0].probability == 88.5


def test_build_result_uses_the_review_status_matching_requires_review():
    assert build_diagnosis_result(_inference(requires_review=False)).humanReviewStatus == HUMAN_REVIEW_AI_ONLY
    assert (
        build_diagnosis_result(_inference(requires_review=True)).humanReviewStatus
        == HUMAN_REVIEW_AWAITING_REVIEW
    )


def test_calibrated_probability_is_only_exposed_when_calibrated():
    """Java (:429) nulls it otherwise, so an uncalibrated 0.0 is never read as
    "the model is certain this is a 0% match"."""
    uncalibrated = build_diagnosis_result(
        _inference(calibration_status="NOT_CALIBRATED", calibrated_probability=0.0)
    )
    assert uncalibrated.calibratedProbability is None

    calibrated = build_diagnosis_result(
        _inference(calibration_status="CALIBRATED", calibrated_probability=91.2)
    )
    assert calibrated.calibratedProbability == 91.2


def test_unknown_label_yields_null_rather_than_a_guess():
    """``DiagnosisCategoryEnum.getChineseLabelByEnglishLabel`` returns null for
    an unrecognised label -- no fallback, no exception. A cache row written by a
    future model version could carry one."""
    vo = build_diagnosis_result(_inference(predicted_label="brand_new_class"))
    assert vo.result is None
    assert vo.recommendations is None
    assert vo.otherDisease[0].name == "glaucoma"


def test_ood_is_reported_as_never_evaluated():
    """OOD was never wired up (``web/inference.py``), so this is a constant and
    must not be presented as a passing distribution check."""
    vo = build_diagnosis_result(_inference())
    assert vo.oodStatus == "NOT_EVALUATED"
    assert vo.oodScore == 0.0


def test_empty_picture_message_is_the_java_string():
    assert PICTURE_REQUIRED == "请上传诊断图片"
    assert HUMAN_RESULT_REQUIRED == "必须填写人工结论"
    assert ONLY_ADMIN_CAN_REVIEW == "仅管理员可写入人工复核字段"
    assert HUMAN_REVIEW_REVIEWED == "REVIEWED"


# ---------------------------------------------------------------------------
# Query wrapper
# ---------------------------------------------------------------------------
def test_list_is_scoped_to_the_session_user(db):
    """The controller overwrites ``userId`` before querying, so a client posting
    another user's id gets their own rows back."""
    db.add_all([_diagnosis(id=1, user_id=7), _diagnosis(id=2, user_id=8)])
    db.flush()
    page = _query_page(db, DiagnosisQueryDTO(userId="8"), user_id=7)
    assert page.total == 1
    assert [record.id for record in page.records] == [1]


def test_user_id_in_the_body_never_widens_the_result(db):
    db.add_all([_diagnosis(id=1, user_id=7), _diagnosis(id=2, user_id=8)])
    db.flush()
    page = _query_page(db, DiagnosisQueryDTO(userId="8"), user_id=7)
    assert all(record.id == 1 for record in page.records)


def test_logically_deleted_rows_are_excluded(db):
    """``@TableLogic`` appends ``isDelete = 0`` to every MyBatis Plus query."""
    db.add_all([_diagnosis(id=1, is_delete=0), _diagnosis(id=2, is_delete=1)])
    db.flush()
    page = _query_page(db, DiagnosisQueryDTO(), user_id=7)
    assert page.total == 1
    assert [record.id for record in page.records] == [1]


def test_result_filter_is_a_substring_match(db):
    db.add_all([_diagnosis(id=1, result="青光眼"), _diagnosis(id=2, result="白内障")])
    db.flush()
    page = _query_page(db, DiagnosisQueryDTO(result="光眼"), user_id=7)
    assert page.total == 1
    assert page.records[0].id == 1


def test_sort_field_is_a_column_name_not_a_python_attribute():
    """Java's ``orderBy`` interpolates ``sortField`` as a raw column name, so
    the client sends camelCase ``createTime``. Matching it against the ORM
    attribute (``create_time``) would never hit and would silently drop the
    ORDER BY -- the query would still succeed, just unsorted.
    """
    assert _diagnosis_query(DiagnosisQueryDTO(sortField="createTime"))._order_by_clauses
    # The snake_case attribute name is *not* a column, so it must not match.
    assert not _diagnosis_query(DiagnosisQueryDTO(sortField="create_time"))._order_by_clauses


def test_blank_sort_field_produces_no_order_by():
    """MyBatis Plus treats the field name as the *condition* to ``orderBy``, so
    a blank sortField silently drops sorting rather than erroring."""
    assert _diagnosis_query(DiagnosisQueryDTO(sortField=None))._order_by_clauses == ()
    assert _diagnosis_query(DiagnosisQueryDTO(sortField="   "))._order_by_clauses == ()


def test_unknown_sort_field_cannot_reach_sql():
    """Java would interpolate this straight into the ORDER BY. Python resolves
    it against the table's columns instead, so the worst case is an unsorted
    query rather than injection."""
    assert _diagnosis_query(
        DiagnosisQueryDTO(sortField="1; DROP TABLE t_diagnosis")
    )._order_by_clauses == ()


def test_username_is_enriched_from_the_owner_row(db):
    db.add(_diagnosis(id=1, user_id=7))
    db.flush()
    page = _query_page(db, DiagnosisQueryDTO(), user_id=7)
    assert page.records[0].username is None  # no t_user row yet


def test_pagination_math_matches_mybatis_plus(db):
    db.add_all([_diagnosis(id=i, user_id=7) for i in range(1, 6)])
    db.flush()
    page = _query_page(db, DiagnosisQueryDTO(current=2, pageSize=2), user_id=7)
    assert page.total == 5
    assert page.size == 2
    assert page.current == 2
    assert page.pages == 3


# ---------------------------------------------------------------------------
# Inference cache
# ---------------------------------------------------------------------------
def test_cache_key_is_the_five_tuple_in_ddl_order():
    assert CACHE_KEY_COLUMNS == (
        "imageHash",
        "modelVersion",
        "weightSha256",
        "preprocessVersion",
        "inferencePolicyVersion",
    )


def test_cache_requires_a_complete_fingerprint():
    """``isCacheEnabled`` (:313-319). With the default empty
    ``MODEL_WEIGHTS_SHA256`` the cache is entirely off -- which is Java's
    default, not a gap in this port."""
    assert is_cache_enabled("v1", "a" * 64, "v1", "p1") is True
    assert is_cache_enabled("v1", "", "v1", "p1") is False
    assert is_cache_enabled("", "a" * 64, "v1", "p1") is False
    assert is_cache_enabled("v1", "a" * 64, "", "p1") is False
    assert is_cache_enabled("v1", "a" * 64, "v1", "") is False


def test_weight_sha_is_normalised_before_use():
    """``normalizeWeightSha256`` (:309-311) -- lowercase, and blank collapses to
    ``""`` rather than ``None`` so the NOT NULL cache key stays valid."""
    assert normalize_weight_sha256("  ABCDEF  ") == "abcdef"
    assert normalize_weight_sha256("") == ""
    assert normalize_weight_sha256(None) == ""
    assert normalize_weight_sha256("   ") == ""


def test_fingerprint_lowercases_the_weight_sha():
    """``responseMatchesConfiguredFingerprint`` (:321-330) compares normalised
    values, so an uppercase response must still match a lowercase configured
    SHA -- otherwise the cache silently stops working after an uppercase
    digest reaches the DB.
    """
    result = _inference(weight_sha256="AB" * 32)
    assert result.fingerprint()[1] == "ab" * 32
    assert result.fingerprint() == (
        "efficientnet-b4@1.0.0",
        "ab" * 32,
        "v1",
        "medical-safety-v3-quality-observe",
    )


def test_cache_round_trip_preserves_the_response(db):
    original = _inference(requires_review=True, abstain_reason="LOW_CONFIDENCE")
    store_cached(db, "a" * 64, original)
    db.flush()

    found = find_cached(db, "a" * 64, original.fingerprint())
    assert found is not None
    for field in (
        "predicted_label", "probability", "reliability_score", "description",
        "rejected", "abstain_reason", "quality_score", "requires_review",
        "calibration_status", "model_version", "weight_sha256",
        "preprocess_version", "inference_policy_version",
    ):
        assert getattr(found, field) == getattr(original, field), field
    assert found.top_predictions == original.top_predictions


def test_cache_miss_on_a_different_fingerprint(db):
    """The whole point of the 5-tuple: a different policy version must never
    serve an old policy's answer."""
    store_cached(db, "a" * 64, _inference())
    db.flush()
    assert find_cached(db, "a" * 64, ("m", "ab" * 32, "v1", "OTHER-POLICY")) is None


def test_cache_row_stores_top_predictions_as_json(db):
    store_cached(db, "a" * 64, _inference())
    db.flush()
    row = db.query(InferenceCache).one()
    assert json.loads(row.top_predictions)[0] == {"label": "glaucoma", "probability": 88.5}


def test_cache_write_does_not_overwrite_an_existing_row(db):
    """``ON DUPLICATE KEY UPDATE id = id`` is insert-only-if-absent: a stale row
    is never refreshed and ``createTime`` is never bumped. Guarded because
    "improving" this into a real upsert would change which response a repeated
    image gets -- the first answer wins, forever.

    The second write must hit the ``uk_inference`` unique key. If the ORM ever
    drops that constraint this test fails, which is the point: the no-overwrite
    guarantee currently lives in the database, not in Python.
    """
    store_cached(db, "a" * 64, _inference())
    db.commit()

    store_cached(db, "a" * 64, _inference(probability=1.0))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

    row = db.query(InferenceCache).one()
    assert row.probability == 88.5


def test_corrupt_top_predictions_json_is_not_silently_emptied(db):
    """Java throws ``IllegalStateException`` (:400) rather than returning a
    result with an empty disease list, which would read as "no alternatives"."""
    row = InferenceCache(
        id=1, image_hash="a" * 64, model_version="m", weight_sha256="ab" * 32,
        preprocess_version="v1", inference_policy_version="p",
        predicted_label="glaucoma", probability=1.0, calibrated_probability=0.0,
        calibration_status="NOT_CALIBRATED", description="", reliability_score=1,
        top_predictions="{not json", quality_score=1, quality_reasons="",
        is_ood=0, ood_score=0.0, ood_status="NOT_EVALUATED", rejected=0,
        abstain_reason="", requires_review=0, create_time=datetime.now(),
    )
    db.add(row)
    db.flush()
    with pytest.raises(json.JSONDecodeError):
        _result_from_cache(row)


@pytest.mark.parametrize("stored", sorted(OOD_STATUSES))
def test_known_ood_statuses_survive_the_round_trip(db, stored):
    store_cached(db, "a" * 64, _inference())
    db.flush()
    row = db.query(InferenceCache).one()
    row.ood_status = stored
    db.flush()
    assert _result_from_cache(row).ood_status == stored


@pytest.mark.parametrize("stored", ["not_evaluated", "NOT EVALUATED", None, ""])
def test_unrecognised_ood_status_degrades_to_not_evaluated(db, stored):
    """``parseOodStatus`` (:405-411) falls back rather than raising -- the DB
    column is free text and only the enum names are meaningful."""
    row = InferenceCache(
        id=1, image_hash="a" * 64, model_version="m", weight_sha256="ab" * 32,
        preprocess_version="v1", inference_policy_version="p",
        predicted_label="normal", probability=1.0, calibrated_probability=0.0,
        calibration_status=None, description=None, reliability_score=1,
        top_predictions=None, quality_score=1, quality_reasons=None,
        is_ood=None, ood_score=0.0, ood_status=stored, rejected=None,
        abstain_reason=None, requires_review=None, create_time=datetime.now(),
    )
    assert _result_from_cache(row).ood_status == "NOT_EVALUATED"


def test_null_calibration_status_degrades_to_not_calibrated(db):
    """``toProto:380`` -- the proto field is a non-optional string, so a null
    column becomes the explicit value rather than ""."""
    row = InferenceCache(
        id=1, image_hash="a" * 64, model_version="m", weight_sha256="ab" * 32,
        preprocess_version="v1", inference_policy_version="p",
        predicted_label="normal", probability=1.0, calibrated_probability=0.0,
        calibration_status=None, description=None, reliability_score=1,
        top_predictions=None, quality_score=1, quality_reasons=None,
        is_ood=None, ood_score=0.0, ood_status="NOT_EVALUATED", rejected=None,
        abstain_reason=None, requires_review=None, create_time=datetime.now(),
    )
    restored = _result_from_cache(row)
    assert restored.calibration_status == "NOT_CALIBRATED"
    assert restored.description == ""
    assert restored.abstain_reason == ""
    # A NULL TINYINT is false, not an error -- ``Boolean.TRUE.equals(null)``.
    assert restored.is_ood is False
    assert restored.rejected is False
    assert restored.requires_review is False


# ---------------------------------------------------------------------------
# Fail-closed wiring -- no weights are checked in, so this is the default state
# ---------------------------------------------------------------------------
def test_app_boots_without_weights_and_yields_an_unloaded_engine():
    """The repository ships no ``.pth`` at all, so "weights missing" is the
    normal state, not an edge case. The lifespan must still complete: seven of
    the eight endpoints need no model, and aborting startup would take the whole
    diagnosis domain offline over one missing file.

    This is a deliberate difference from ``grpc_server.py``, whose process
    exits when the servicer cannot be built.
    """
    from web.app import _build_inference_engine
    from web.config import WebConfig

    engine = _build_inference_engine(WebConfig())
    assert engine.is_loaded is False


def test_do_diagnosis_fails_closed_when_there_is_no_engine():
    """Stands in for ``grpc_server.py``'s empty ``DiagnosisResponse`` (:161-166),
    which Java persisted as a diagnosis with an empty label and
    ``rejected=false``. Here the request fails and nothing is written.
    """
    from web.inference import InferenceUnavailable

    class _App:
        class state:
            pass

    class _Request:
        app = _App()

    with pytest.raises(InferenceUnavailable):
        _diagnose_via_engine(_Request(), b"bytes", "image/jpeg")


def test_do_diagnosis_delegates_to_the_engine():
    sentinel = _inference()
    calls = []

    class _Engine:
        def diagnose(self, data, content_type):
            calls.append((data, content_type))
            return sentinel

    class _App:
        class state:
            inference_engine = _Engine()

    class _Request:
        app = _App()

    assert _diagnose_via_engine(_Request(), b"bytes", "image/jpeg") is sentinel
    assert calls == [(b"bytes", "image/jpeg")]


# ---------------------------------------------------------------------------
# Views are constructed, never inherited
# ---------------------------------------------------------------------------
def test_vo_field_sets_match_the_java_classes():
    """Both VOs are ``@Data``; a dropped field is a dropped JSON key the
    frontend reads."""
    manage = {
        "id", "url", "username", "result", "confidence", "severity",
        "reexamineStatus", "createTime", "status", "aiRejected",
        "abstainReason", "requiresReview",
    }
    assert set(DiagnosisManageVO.model_fields) == manage

    java_result_vo = (
        REPO_ROOT
        / "src/main/java/com/csust/eyediagnosis/model/vo/diagnosis/DiagnosisResultVO.java"
    ).read_text(encoding="utf-8")
    declared = set(re.findall(r"private\s+[\w<>,. ]+\s+(\w+);", java_result_vo))
    declared -= {"serialVersionUID"}
    assert set(DiagnosisResultVO.model_fields) == declared, declared ^ set(
        DiagnosisResultVO.model_fields
    )
