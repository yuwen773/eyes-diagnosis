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


# ── 契约：拒识与人工复核是独立维度，且拒识必然带复核要求 ──────────────────
#
# 前端判读页 / 记录纸曾写成「requiresReview && !rejected」，把拒识记录的
# 复核要求藏起来。后端契约不是互斥的：拒识（质量门 / OOD）同样会进人工复核
# 队列，只有「低置信但未拒识」是同样需要复核的另一条路径。
# 若将来有人把这条不变量改掉，前端可以据此调整展示；在改掉之前，
# 界面必须同时呈现「AI 拒识」与「待人工复核」。

@pytest.mark.parametrize(
    "kwargs",
    [
        dict(quality_rejected=True, quality_reasons=["blur"], ood=False,
             top1_prob=0.95, top2_prob=0.04),
        dict(quality_rejected=False, quality_reasons=[], ood=True,
             top1_prob=0.9, top2_prob=0.05),
    ],
)
def test_rejection_always_requires_review(kwargs):
    decision = decide_abstain(**kwargs)
    assert decision.rejected is True
    assert decision.requires_review is True


def test_review_requirement_is_not_implied_by_rejection_flag_alone():
    """低置信：不拒识，但仍需复核——两个布尔量各自独立成立。"""
    decision = decide_abstain(
        quality_rejected=False,
        quality_reasons=[],
        ood=False,
        top1_prob=0.55,
        top2_prob=0.4,
    )
    assert decision.rejected is False
    assert decision.requires_review is True
