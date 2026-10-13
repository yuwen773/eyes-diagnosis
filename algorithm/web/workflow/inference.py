"""One immutable inference epoch, shared by quality and vision graph nodes."""

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import Any, Literal, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from web.config import WebConfig
from web.inference import DISEASE_CATEGORIES, InferenceEngine, InferenceResult, InferenceUnavailable


class Engine(Protocol):
    @property
    def is_loaded(self) -> bool: ...
    def load(self) -> None: ...
    def diagnose(self, image_bytes: bytes, content_type: str | None = None) -> InferenceResult: ...


class InferenceExecutionError(RuntimeError):
    """A retryable algorithm failure, never a clinical rejection."""


class InferenceEnvelope(BaseModel):
    # Snapshots are canonical JSON strings, so no mutable nested result escapes.
    model_config = ConfigDict(frozen=True, from_attributes=True)

    envelope_id: str
    workflow_id: str
    inference_epoch: int
    image_reference: str
    input_digest: str
    media_type: str
    quality_outcome: Literal["PASS", "REJECT", "REVIEW"]
    quality_score: int
    quality_reasons: str
    outcome: Literal["VALID_PREDICTION", "SAFETY_ABSTENTION", "TECHNICAL_FAILURE"]
    prediction_snapshot: str | None = None
    confidence_snapshot: str | None = None
    abstention_reason: str | None = None
    failure_code: str | None = None
    ood_snapshot: str
    calibration_snapshot: str
    model_version: str
    model_fingerprint: str
    preprocess_version: str
    policy_version: str
    inferred_at: datetime


def snapshot(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)


class WorkflowInference:
    def __init__(self, config: WebConfig, *, engine: Engine | None = None):
        self.config = config
        self.engine = engine if engine is not None else InferenceEngine(config)

    def run(self, workflow_id: str, epoch: int, image: bytes, media_type: str) -> InferenceEnvelope:
        common: dict[str, Any] = dict(envelope_id=uuid4().hex, workflow_id=workflow_id, inference_epoch=epoch,
                      image_reference=f"mysql-upload:{workflow_id}",
                      input_digest=hashlib.sha256(image).hexdigest(), media_type=media_type,
                      inferred_at=datetime.now(timezone.utc).replace(tzinfo=None))
        try:
            if not self.engine.is_loaded:
                self.engine.load()
            result = self.engine.diagnose(image, media_type)
        except InferenceUnavailable:
            return self._technical(common, "MODEL_UNAVAILABLE")
        except Exception as exc:
            raise InferenceExecutionError("algorithm execution failed") from exc

        configured = (self.config.model_version, self.config.preprocess_version,
                      self.config.inference_policy_version)
        observed = (result.model_version, result.preprocess_version, result.inference_policy_version)
        if (observed != configured or not all(observed) or
                not re.fullmatch(r"[a-fA-F0-9]{64}", result.weight_sha256) or
                (self.config.model_weights_sha256 and
                 result.weight_sha256.lower() != self.config.model_weights_sha256)):
            return self._technical(common, "MODEL_FINGERPRINT_MISMATCH")
        if (result.predicted_label not in DISEASE_CATEGORIES or
                any(not math.isfinite(value) or not 0 <= value <= 100 for value in
                    (result.probability, result.calibrated_probability)) or
                result.calibration_status not in {"CALIBRATED", "NOT_CALIBRATED"}):
            return self._technical(common, "INVALID_RESPONSE_CONTRACT")

        quality: Literal["PASS", "REJECT", "REVIEW"] = "REJECT" if result.rejected and result.abstain_reason == "QUALITY_FAIL" else (
            "REVIEW" if result.quality_reasons.strip() else "PASS")
        abstention = "OOD" if result.is_ood else (
            "LOW_CONFIDENCE" if result.abstain_reason == "LOW_CONFIDENCE" else "MODEL_POLICY_REJECTED"
        ) if result.rejected else None
        outcome: Literal["VALID_PREDICTION", "SAFETY_ABSTENTION", "TECHNICAL_FAILURE"] = (
            "SAFETY_ABSTENTION" if abstention else "VALID_PREDICTION")
        return InferenceEnvelope(**common, quality_outcome=quality, quality_score=result.quality_score,
            quality_reasons=snapshot([r for r in result.quality_reasons.split(",") if r]),
            outcome=outcome, abstention_reason=abstention,
            prediction_snapshot=snapshot({"diseaseCode": result.predicted_label,
                "calibratedProbability": result.calibrated_probability}) if not abstention else None,
            confidence_snapshot=snapshot({"probability": result.probability,
                "reliabilityScore": result.reliability_score, "requiresReview": result.requires_review,
                "topPredictions": result.top_predictions}),
            ood_snapshot=snapshot({"outOfDistribution": result.is_ood,
                                   "status": result.ood_status, "score": result.ood_score}),
            calibration_snapshot=snapshot({"status": result.calibration_status,
                                           "probability": result.calibrated_probability}),
            model_version=result.model_version, model_fingerprint=result.weight_sha256.lower(),
            preprocess_version=result.preprocess_version, policy_version=result.inference_policy_version)

    @staticmethod
    def _technical(common: dict, code: str) -> InferenceEnvelope:
        return InferenceEnvelope(**common, quality_outcome="PASS", quality_score=0,
            quality_reasons="[]", outcome="TECHNICAL_FAILURE", failure_code=code,
            ood_snapshot='{"status": "NOT_EVALUATED"}',
            calibration_snapshot='{"status": "NOT_CALIBRATED"}',
            model_version="not-provided", model_fingerprint="not-provided",
            preprocess_version="not-provided", policy_version="not-provided")
