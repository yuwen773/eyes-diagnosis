from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class AbstainReason(str, Enum):
    QUALITY_FAIL = "QUALITY_FAIL"
    OOD = "OOD"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    NOT_ASSESSED = "NOT_ASSESSED"
    MODEL_NOT_LOADED = "MODEL_NOT_LOADED"


@dataclass(frozen=True)
class AbstainDecision:
    rejected: bool
    reason: Optional[AbstainReason]
    requires_review: bool

    def to_proto(self) -> dict:
        return {
            "rejected": self.rejected,
            "abstain_reason": self.reason.value if self.reason else "",
            "requires_review": self.requires_review,
        }


CONFIDENCE_REVIEW_THRESHOLD = 0.7
QUALITY_GATE_MODES = {"observe", "enforce"}


def should_reject_for_quality(quality_reasons: List[str], quality_gate_mode: str) -> bool:
    mode = quality_gate_mode.strip().lower()
    if mode not in QUALITY_GATE_MODES:
        raise ValueError("QUALITY_GATE_MODE must be observe or enforce")
    return mode == "enforce" and bool(quality_reasons)


def decide_abstain(
    *,
    quality_rejected: bool,
    quality_reasons: List[str],
    ood: bool,
    top1_prob: float,
    top2_prob: float,
) -> AbstainDecision:
    if quality_rejected:
        return AbstainDecision(True, AbstainReason.QUALITY_FAIL, True)
    if ood:
        return AbstainDecision(True, AbstainReason.OOD, True)
    if top1_prob < CONFIDENCE_REVIEW_THRESHOLD or (top1_prob - top2_prob) < 0.15:
        return AbstainDecision(False, AbstainReason.LOW_CONFIDENCE, True)
    return AbstainDecision(False, None, False)
