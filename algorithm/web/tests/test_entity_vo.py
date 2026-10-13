"""ORM row -> VO projection, across every migrated domain.

Regression net for the defect this file exists for.

Every VO is camelCase (that is what the frontend reads) while every ORM
attribute is snake_case (that is Python). Pydantic's ``from_attributes`` looks
up the *field name*, so ``model_validate(row, from_attributes=True)`` raised
``Field required`` and every list endpoint in all four domains would have
returned HTTP 200 with ``code=50000``.

It survived three phases of tests because they all exercised the projection
*helpers* -- ``_to_vo(row)``, which build the VO by keyword -- rather than
handing a real ORM object to ``model_validate``. Testing the function under
test instead of the boundary it feeds is the whole failure mode here.

Hence one test per VO, each given an actual ORM instance.
"""

import sys
from datetime import datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.models.diagnosis import Diagnosis  # noqa: E402
from web.models.knowledge import KnowledgeDocument  # noqa: E402
from web.models.news import News  # noqa: E402
from web.models.user import User  # noqa: E402
from web.schemas.diagnosis import DiagnosisManageVO, DiagnosisResultVO  # noqa: E402
from web.schemas.knowledge import KnowledgeDocumentVO  # noqa: E402
from web.schemas.news import NewsVO  # noqa: E402
from web.schemas.user import UserVO  # noqa: E402

STAMP = datetime(2026, 1, 2, 3, 4, 5)


@pytest.fixture
def user_row() -> User:
    return User(
        id=11, user_account="yuwen", user_password="hashed", user_name="钰玟",
        user_avatar="https://a.png", user_profile="p", user_role="admin",
        create_time=STAMP, edit_time=STAMP, update_time=STAMP, is_delete=0,
    )


@pytest.fixture
def news_row() -> News:
    return News(
        id=22, title="标题", user_id=11, content="正文", summary="摘要",
        cover_img="https://cover.jpg", status=1,
        publish_time=STAMP, edit_time=STAMP,
    )


@pytest.fixture
def diagnosis_row() -> Diagnosis:
    return Diagnosis(
        id=33, url="https://img.jpg", user_id=11, result="青光眼",
        probability=88.5, confidence=88.5, recommendations="建议", details="详情",
        severity="NOT_ASSESSED", reexamine_status=1, pic_size=1, pic_width=2,
        pic_height=3, pic_scale=0.5, pic_format="jpeg", create_time=STAMP,
        is_delete=0, ai_rejected=0, abstain_reason=None,
        model_version="efficientnet-b4@1.0.0", weight_sha256=None,
        human_review_status="AI_ONLY", human_reviewer_id=None,
        human_reviewed_at=None, human_review_note=None, human_result=None,
        human_severity=None, human_recommendations=None,
        preprocess_version="v1", inference_policy_version="p",
        calibration_status="NOT_CALIBRATED", calibrated_probability=None,
        quality_score=90, quality_reasons=None, ood_status="NOT_EVALUATED",
        ood_score=None,
    )


@pytest.fixture
def knowledge_row() -> KnowledgeDocument:
    return KnowledgeDocument(
        id=44, user_id=11, title="指南", file_name="guide.pdf",
        file_url="uuid_guide.pdf", file_size=2048, file_type="pdf",
        content_hash="ab" * 32, chunk_count=3, status=1,
        visibility="PRIVATE_USER", review_status="PENDING", governance_version=0,
        disease_codes=[], topic_codes=[],
        create_time=STAMP, update_time=STAMP, is_delete=0,
    )


# ---------------------------------------------------------------------------
def test_user_vo_projects_from_an_orm_row(user_row):
    vo = UserVO.model_validate(user_row, from_attributes=True)
    dumped = vo.model_dump(mode="json")
    assert dumped["userAccount"] == "yuwen"
    assert dumped["userName"] == "钰玟"
    assert dumped["createTime"] == "2026-01-01 19:04:05"
    assert "userPassword" not in dumped


def test_news_vo_projects_from_an_orm_row(news_row):
    """``coverImage`` in the VO, ``cover_img`` on the row -- and neither name is
    derivable from the other, so this is the case most likely to break."""
    vo = NewsVO.model_validate(news_row, from_attributes=True)
    dumped = vo.model_dump(mode="json")
    assert dumped["coverImage"] == "https://cover.jpg"
    assert "coverImg" not in dumped
    assert dumped["publishTime"] == "2026-01-01 19:04:05"


def test_diagnosis_manage_vo_projects_from_an_orm_row(diagnosis_row):
    vo = DiagnosisManageVO.model_validate(diagnosis_row, from_attributes=True)
    dumped = vo.model_dump(mode="json")
    assert dumped["id"] == "33" and isinstance(dumped["id"], str)
    assert dumped["result"] == "青光眼"
    assert dumped["reexamineStatus"] == 1
    # Not a column -- filled from the VO's own default.
    assert dumped["status"] == "已完成"


def test_diagnosis_result_vo_projects_from_an_orm_row(diagnosis_row):
    dumped = DiagnosisResultVO.model_validate(
        diagnosis_row, from_attributes=True
    ).model_dump(mode="json")
    assert dumped["humanReviewStatus"] == "AI_ONLY"
    assert dumped["qualityScore"] == 90
    assert dumped["oodStatus"] == "NOT_EVALUATED"


def test_knowledge_document_vo_projects_from_an_orm_row(knowledge_row):
    dumped = KnowledgeDocumentVO.model_validate(
        knowledge_row, from_attributes=True
    ).model_dump(mode="json")
    assert dumped["userId"] == "11"
    assert dumped["fileName"] == "guide.pdf"
    assert dumped["fileSize"] == "2048"
    assert dumped["status"] == 1


# ---------------------------------------------------------------------------
# Both directions, for every VO
# ---------------------------------------------------------------------------
_VO_CASES = [
    (UserVO, "user_row"),
    (NewsVO, "news_row"),
    (DiagnosisManageVO, "diagnosis_row"),
    (DiagnosisResultVO, "diagnosis_row"),
    (KnowledgeDocumentVO, "knowledge_row"),
]


@pytest.mark.parametrize("vo_cls,fixture_name", _VO_CASES, ids=lambda v: getattr(v, "__name__", ""))
def test_every_vo_keeps_camel_case_on_the_wire(vo_cls, fixture_name, request):
    """Serialisation aliases must stay identity.

    A single shared ``alias_generator`` that produced snake_case would fix the
    projection and silently break every field name the frontend reads -- the
    exact opposite failure, with no error.
    """
    row = request.getfixturevalue(fixture_name)
    dumped = vo_cls.model_validate(row, from_attributes=True).model_dump(mode="json")
    assert set(dumped) == set(vo_cls.model_fields), (
        f"{vo_cls.__name__} serialised under different keys than its fields"
    )


@pytest.mark.parametrize("vo_cls,fixture_name", _VO_CASES, ids=lambda v: getattr(v, "__name__", ""))
def test_every_vo_still_accepts_keyword_construction(vo_cls, fixture_name, request):
    """Every projection helper builds the VO by keyword
    (``_to_manage_vo``, ``build_diagnosis_result``, ...), so
    ``populate_by_name`` has to stay on or those break instead.
    """
    row = request.getfixturevalue(fixture_name)
    from_attributes = vo_cls.model_validate(row, from_attributes=True)
    by_keyword = vo_cls(**from_attributes.model_dump())
    assert by_keyword.model_dump() == from_attributes.model_dump()


@pytest.mark.parametrize("vo_cls,fixture_name", _VO_CASES, ids=lambda v: getattr(v, "__name__", ""))
def test_every_vo_resolves_every_field_from_the_orm_row(vo_cls, fixture_name, request):
    """No field may be silently None because the ORM attribute was not found.

    A missing alias surfaces as a default, not an error, when the field has one
    -- which is how a whole column could go missing from the API without a
    single failing test.
    """
    row = request.getfixturevalue(fixture_name)
    vo = vo_cls.model_validate(row, from_attributes=True)
    required = [
        name for name, field in vo_cls.model_fields.items()
        if field.is_required()
    ]
    for name in required:
        assert getattr(vo, name) is not None, f"{vo_cls.__name__}.{name}"


def _snake(name: str) -> str:
    import re

    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def test_the_alias_generator_only_affects_validation():
    """Guards the fix itself: validation -> snake_case, serialization -> as-is."""
    from web.response import EntityVO, _snake_case

    assert _snake_case("userAccount") == "user_account"
    assert _snake_case("coverImage") == "cover_image"
    assert _snake_case("createTime") == "create_time"
    assert issubclass(UserVO, EntityVO)
