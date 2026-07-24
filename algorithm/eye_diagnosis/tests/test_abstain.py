from eye_diagnosis.abstain import (
    AbstainDecision,
    AbstainReason,
    decide_abstain,
    should_reject_for_quality,
)
import pytest


def test_quality_gate_observe_records_without_rejecting():
    assert should_reject_for_quality(["blur"], "observe") is False


def test_quality_gate_enforce_rejects():
    assert should_reject_for_quality(["blur"], "enforce") is True


def test_quality_gate_rejects_invalid_mode():
    with pytest.raises(ValueError, match="QUALITY_GATE_MODE"):
        should_reject_for_quality([], "invalid")


def test_quality_rejection_overrides_others():
    decision = decide_abstain(
        quality_rejected=True,
        quality_reasons=["blur"],
        ood=False,
        top1_prob=0.95,
        top2_prob=0.04,
    )
    assert decision.rejected is True
    assert decision.reason is AbstainReason.QUALITY_FAIL


def test_ood_rejection():
    decision = decide_abstain(
        quality_rejected=False,
        quality_reasons=[],
        ood=True,
        top1_prob=0.9,
        top2_prob=0.05,
    )
    assert decision.rejected is True
    assert decision.reason is AbstainReason.OOD


def test_low_confidence_requires_review():
    decision = decide_abstain(
        quality_rejected=False,
        quality_reasons=[],
        ood=False,
        top1_prob=0.55,
        top2_prob=0.4,
    )
    assert decision.rejected is False
    assert decision.requires_review is True
    assert decision.reason is AbstainReason.LOW_CONFIDENCE


def test_high_confidence_accepted():
    decision = decide_abstain(
        quality_rejected=False,
        quality_reasons=[],
        ood=False,
        top1_prob=0.92,
        top2_prob=0.05,
    )
    assert decision.rejected is False
    assert decision.requires_review is False
