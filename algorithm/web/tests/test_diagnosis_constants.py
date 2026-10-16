"""Constant parity tests against the independently frozen legacy contract.

These strings are persisted in the DB and rendered by the frontend verbatim.
A typo in ``DIAGNOSIS_RECOMMENDATIONS`` would not fail any import, any ORM test
or any endpoint test -- it would just quietly show a patient the wrong medical
advice. Each mapping is compared with the reviewed static contract; these tests
never read the Java tree or derive expected values from the Python constants.
"""

from web.tests.frozen_contract import CONTRACT

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))


from web import constant as C  # noqa: E402

def test_category_labels_match_java():
    assert C.DIAGNOSIS_CATEGORY_LABELS == CONTRACT["diagnosis"]["categories"]


def test_recommendations_match_java():
    assert C.DIAGNOSIS_RECOMMENDATIONS == CONTRACT["diagnosis"]["recommendations"]


def test_all_eight_categories_are_parsed():
    """The frozen contract must cover all eight persisted disease categories."""
    parsed = CONTRACT["diagnosis"]["categories"]
    assert len(parsed) == 8
    assert parsed == C.DIAGNOSIS_CATEGORY_LABELS
    assert len(CONTRACT["diagnosis"]["recommendations"]) == 8


def test_every_recommendation_fits_the_column():
    """``recommendations VARCHAR(512)`` counts characters, not bytes. Longest
    today is MYOPIA at 122; this guards against an edit that adds lines without
    anyone noticing the column limit."""
    for label, text in C.DIAGNOSIS_RECOMMENDATIONS.items():
        assert len(text) <= 512, f"{label}: {len(text)} chars exceeds VARCHAR(512)"


def test_recommendations_use_newline_separator_not_list():
    """The column is a newline-joined string and the frontend splits on it. A
    port that returned a JSON array would break rendering."""
    for label, text in C.DIAGNOSIS_RECOMMENDATIONS.items():
        if label in ("normal", "other"):
            continue
        assert "\n" in text, label
        assert not text.startswith("["), label


def test_human_review_statuses_match_java():
    assert list(C.HUMAN_REVIEW_STATUSES) == ["PENDING_AI", "AI_ONLY", "AWAITING_REVIEW", "REVIEWED", "OVERRIDDEN"]


def test_status_constants_match_java():
    assert [C.STATUS_COMPLETED, C.STATUS_DOING, C.STATUS_CANCELED] == ["已完成", "进行中", "已取消"]


def test_severity_constant_is_the_only_value_written():
    assert C.SEVERITY_NOT_ASSESSED == "NOT_ASSESSED"


def test_reexamine_statuses_match_java():
    assert [C.REEXAMINE_STATUS_UNDONE, C.REEXAMINE_STATUS_WAITING, C.REEXAMINE_STATUS_DONE] == [1, 2, 3]


def test_zero_is_not_a_reexamine_status():
    """The DDL default is 1, and Phase 1 briefly declared ``default=0``."""
    assert 0 not in (
        C.REEXAMINE_STATUS_UNDONE,
        C.REEXAMINE_STATUS_WAITING,
        C.REEXAMINE_STATUS_DONE,
    )


def test_human_review_guard_messages_match_java():
    assert C.ONLY_ADMIN_CAN_REVIEW == "仅管理员可写入人工复核字段"
    assert C.HUMAN_RESULT_REQUIRED == "必须填写人工结论"
