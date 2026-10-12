"""Constant parity tests: Python vs the Java source of truth.

These strings are persisted in the DB and rendered by the frontend verbatim.
A typo in ``DIAGNOSIS_RECOMMENDATIONS`` would not fail any import, any ORM test
or any endpoint test -- it would just quietly show a patient the wrong medical
advice. So each mapping is diffed against the Java enum it was copied from.

The Java files are parsed rather than hardcoded, so the test fails if Java is
edited without updating the Python side.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

CONSTANT_DIR = REPO_ROOT / "src/main/java/com/csust/eyediagnosis/constant"

from web import constant as C  # noqa: E402

# Every entry is ``NAME("label", "value"),`` -- the last one in each Java enum
# ends with ``);`` rather than ``),\n``, so the terminator accepts both.
_ENUM_ENTRY = re.compile(r'(\w+)\("(\w+)",\s*(.*?)\)[,;]', re.S)
_QUOTED = re.compile(r'"((?:[^"\\]|\\.)*)"')


def _java_enum(filename: str, terminator: str) -> dict[str, str]:
    """englishLabel -> literal value, decoded from Java string concatenation."""
    text = (CONSTANT_DIR / filename).read_text(encoding="utf-8")
    body = text[text.index("public enum") : text.index(terminator)]
    result = {}
    for _name, label, raw in _ENUM_ENTRY.findall(body):
        literal = "".join(_QUOTED.findall(raw))
        result[label] = literal.replace("\\n", "\n")
    return result


def test_category_labels_match_java():
    assert C.DIAGNOSIS_CATEGORY_LABELS == _java_enum(
        "DiagnosisCategoryEnum.java", "private final String englishLabel"
    )


def test_recommendations_match_java():
    assert C.DIAGNOSIS_RECOMMENDATIONS == _java_enum(
        "DiagnosisRecommendationEnum.java", "private final String englishLabel"
    )


def test_all_eight_categories_are_parsed():
    """Guards the parser, not the data. If a future Java edit makes the
    regex silently skip entries, the equality assertions above would pass
    against a *subset* and a new disease class would go unhandled."""
    parsed = _java_enum(
        "DiagnosisCategoryEnum.java", "private final String englishLabel"
    )
    assert len(parsed) == 8
    assert parsed == C.DIAGNOSIS_CATEGORY_LABELS
    assert len(_java_enum(
        "DiagnosisRecommendationEnum.java", "private final String englishLabel"
    )) == 8


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
    """Parsed from the String-constant interface, not the enum machinery."""
    text = (CONSTANT_DIR / "HumanReviewStatus.java").read_text(encoding="utf-8")
    java_values = re.findall(r'String\s+\w+\s*=\s*"(\w+)"', text)
    assert list(C.HUMAN_REVIEW_STATUSES) == java_values
    assert java_values == [
        "PENDING_AI",
        "AI_ONLY",
        "AWAITING_REVIEW",
        "REVIEWED",
        "OVERRIDDEN",
    ]


def test_status_constants_match_java():
    text = (CONSTANT_DIR / "StatusConstant.java").read_text(encoding="utf-8")
    java_values = re.findall(r'String\s+\w+\s*=\s*"([^"]+)"', text)
    assert java_values == [C.STATUS_COMPLETED, C.STATUS_DOING, C.STATUS_CANCELED]


def test_severity_constant_is_the_only_value_written():
    """Ruling 14: Java hardcodes "NOT_ASSESSED" and never infers severity.
    The Chinese 低/中/高 values are a dead frontend branch."""
    service = (
        REPO_ROOT / "src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java"
    ).read_text(encoding="utf-8")
    assert f'setSeverity("{C.SEVERITY_NOT_ASSESSED}")' in service
    # Nothing anywhere writes a Chinese severity into a diagnosis result.
    assert "setSeverity(\"低\")" not in service
    assert "setSeverity(\"中\")" not in service
    assert "setSeverity(\"高\")" not in service


def test_reexamine_statuses_match_java():
    """1 undone / 2 waiting / 3 done. 0 is not a state -- see ruling 15."""
    text = (CONSTANT_DIR / "ReexamineConstant.java").read_text(encoding="utf-8")
    java_values = [int(v) for v in re.findall(r"int\s+\w+\s*=\s*(\d+)", text)]
    assert java_values == [
        C.REEXAMINE_STATUS_UNDONE,
        C.REEXAMINE_STATUS_WAITING,
        C.REEXAMINE_STATUS_DONE,
    ]


def test_zero_is_not_a_reexamine_status():
    """The DDL default is 1, and Phase 1 briefly declared ``default=0``."""
    assert 0 not in (
        C.REEXAMINE_STATUS_UNDONE,
        C.REEXAMINE_STATUS_WAITING,
        C.REEXAMINE_STATUS_DONE,
    )


def test_human_review_guard_messages_match_java():
    """String-concatenated messages the frontend may surface or match on."""
    service = (
        REPO_ROOT / "src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java"
    ).read_text(encoding="utf-8")
    assert C.ONLY_ADMIN_CAN_REVIEW in service
    assert C.HUMAN_RESULT_REQUIRED in service