"""Safe MCP projection of the shared, unpublished reliability inference facts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from web.workflow.inference import InferenceEnvelope


class ImageAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    outcome: Literal["VALID_PREDICTION", "SAFETY_ABSTENTION"]
    qualityOutcome: Literal["PASS", "REJECT", "REVIEW"]
    inputDigest: str = Field(pattern=r"^[a-f0-9]{64}$")
    modelFingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    modelVersion: str = Field(max_length=128, pattern=r"^[A-Za-z0-9@._-]+$")
    preprocessVersion: str = Field(max_length=128, pattern=r"^[A-Za-z0-9@._-]+$")
    policyVersion: str = Field(max_length=128, pattern=r"^[A-Za-z0-9@._-]+$")
    patientVisible: Literal[False] = False
    publication: Literal["UNPUBLISHED"] = "UNPUBLISHED"


def unpublished_analysis(envelope: InferenceEnvelope) -> ImageAnalysis:
    if envelope.outcome == "TECHNICAL_FAILURE":
        raise RuntimeError(envelope.failure_code)
    return ImageAnalysis(outcome=envelope.outcome, qualityOutcome=envelope.quality_outcome,
        inputDigest=envelope.input_digest, modelFingerprint=envelope.model_fingerprint,
        modelVersion=envelope.model_version, preprocessVersion=envelope.preprocess_version,
        policyVersion=envelope.policy_version)
