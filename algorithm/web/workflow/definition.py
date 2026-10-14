"""Versioned upload graph; clinical routing belongs only to this definition."""

import hashlib
import io
import json
import warnings
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from PIL import Image, UnidentifiedImageError

from web.workflow.inference import InferenceEnvelope, WorkflowInference
from web.evidence import EvidenceRetriever
from web.workflow.explanation import (
    ExplanationModel, make_draft, publication_decision, risk_assessment, validate_claims,
)

GRAPH_VERSION = "upload-validated-explanation-v5"
ACTION_VERSION = "upload-validated-explanation-v5"


class UploadState(TypedDict):
    workflow_id: str
    status: str
    reason: str | None
    completed: list[str]
    media_type: str
    envelope_id: str
    exposure_status: str
    waiting_review: bool
    evidence: dict[str, Any]
    risk: dict[str, Any]
    explanation: dict[str, Any]
    review_type: str


def build_graph(checkpointer, image_bytes: bytes = b"", *,
                inference: WorkflowInference | None = None,
                committed_envelope: InferenceEnvelope | None = None,
                pending_envelopes: list[InferenceEnvelope] | None = None,
                inference_epoch: int = 0, quality_decision: str | None = None,
                evidence: EvidenceRetriever | None = None,
                explanation_model: ExplanationModel | None = None):
    def validate_image(state: UploadState) -> dict:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(image_bytes)) as image:
                    if image.format not in {"JPEG", "PNG", "WEBP"}:
                        raise ValueError("unsupported image format")
                    media_type = Image.MIME[image.format]
                    image.verify()
                with Image.open(io.BytesIO(image_bytes)) as image:
                    image.load()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
                Image.DecompressionBombWarning):
            return {"status": "REJECTED", "reason": "INVALID_IMAGE",
                    "completed": ["validateImage"]}
        return {"status": "RUNNING", "reason": None, "completed": ["validateImage"],
                "media_type": media_type}

    def infer(state: UploadState) -> dict:
        envelope = committed_envelope
        if envelope is None:
            assert inference is not None and pending_envelopes is not None
            envelope = inference.run(state["workflow_id"], inference_epoch,
                                     image_bytes, state["media_type"])
            pending_envelopes.append(envelope)
        return {"envelope_id": envelope.envelope_id,
                "status": "FAILED" if envelope.outcome == "TECHNICAL_FAILURE" else "RUNNING",
                "reason": envelope.failure_code, "completed": [*state["completed"], "inference"],
                "exposure_status": "NOT_AVAILABLE" if envelope.failure_code else "HIDDEN"}

    def shared_envelope(state: UploadState) -> InferenceEnvelope:
        assert committed_envelope is not None
        if (committed_envelope.envelope_id != state["envelope_id"] or
                committed_envelope.workflow_id != state["workflow_id"] or
                committed_envelope.inference_epoch != inference_epoch or
                committed_envelope.input_digest != hashlib.sha256(image_bytes).hexdigest()):
            raise ValueError("committed inference binding mismatch")
        return committed_envelope

    def image_quality(state: UploadState) -> dict:
        envelope = shared_envelope(state)
        decision = envelope.quality_outcome
        return {"status": {"PASS": "RUNNING", "REJECT": "REJECTED",
                           "REVIEW": "WAITING_HUMAN_REVIEW"}[decision],
                "reason": {"PASS": None, "REJECT": "QUALITY_REJECTED",
                           "REVIEW": "QUALITY_REVIEW_REQUIRED"}[decision],
                "exposure_status": "HIDDEN" if decision == "PASS" else "WITHHELD_BY_QUALITY_GATE",
                "waiting_review": decision == "REVIEW",
                "completed": [*state["completed"], "imageQuality"]}

    def quality_review(state: UploadState) -> dict:
        envelope = shared_envelope(state)
        if envelope.quality_outcome != "REVIEW" or quality_decision not in {
                "APPROVE_CONTINUE", "REJECT_RESUBMIT"}:
            raise ValueError("quality review requires a bound doctor decision")
        approved = quality_decision == "APPROVE_CONTINUE"
        return {"status": "RUNNING" if approved else "REJECTED",
                "reason": None if approved else "QUALITY_REJECTED",
                "waiting_review": False,
                "completed": [*state["completed"], "qualityReview"]}

    def vision_exposure(state: UploadState) -> dict:
        envelope = shared_envelope(state)
        abstained = envelope.outcome == "SAFETY_ABSTENTION"
        return {"status": "COMPLETED_LIMITED" if abstained else "RUNNING",
                "reason": envelope.abstention_reason,
                "exposure_status": ("WITHHELD_BY_OOD" if envelope.abstention_reason == "OOD"
                                    else "WITHHELD_BY_ABSTENTION") if abstained else "AVAILABLE",
                "completed": [*state["completed"], "visionExposure"]}

    def risk_precheck(state: UploadState) -> dict:
        risk = risk_assessment(shared_envelope(state), state["exposure_status"])
        return {"risk": risk, "completed": [*state["completed"], "clinicalRiskPrecheck"]}

    def retrieve_evidence(state: UploadState) -> dict:
        envelope = shared_envelope(state)
        assert evidence is not None and envelope.prediction_snapshot
        disease = json.loads(envelope.prediction_snapshot)["diseaseCode"]
        return {"evidence": evidence.retrieve(disease),
                "completed": [*state["completed"], "evidenceRetrieval"]}

    def rewrite_evidence(state: UploadState) -> dict:
        assert evidence is not None and state["evidence"]["attempts"] == 1
        return {"evidence": evidence.retrieve(state["evidence"]["diseaseCode"], rewritten=True),
                "completed": [*state["completed"], "evidenceRewrite"]}

    def validate_sources(state: UploadState) -> dict:
        assert evidence is not None
        batch = evidence.validate(state["evidence"])
        sufficient = batch["status"] == "SUFFICIENT"
        return {"evidence": batch, "status": "RUNNING" if sufficient else "COMPLETED_LIMITED",
                "reason": None if sufficient else "EVIDENCE_INSUFFICIENT",
                "completed": [*state["completed"], "evidenceValidation"]}

    def risk_final(state: UploadState) -> dict:
        assert evidence is not None
        batch = evidence.validate(state["evidence"])
        risk = risk_assessment(shared_envelope(state), state["exposure_status"], evidence=batch)
        eligible = risk["disposition"] in {"AUTO_PUBLICATION_ELIGIBLE", "FINAL_REVIEW_REQUIRED"}
        return {"evidence": batch, "risk": risk,
                "status": "RUNNING" if eligible else "COMPLETED_LIMITED",
                "reason": None if eligible else "EVIDENCE_INSUFFICIENT",
                "completed": [*state["completed"], "clinicalRiskFinal"]}

    def draft_explanation(state: UploadState) -> dict:
        assert evidence is not None and explanation_model is not None
        batch = evidence.validate(state["evidence"])
        if batch["status"] != "SUFFICIENT":
            explanation = {"status": "NONE", "reason": "EXPLANATION_SOURCE_CHANGED"}
        else:
            explanation = make_draft(explanation_model, shared_envelope(state), batch, state["risk"])
        return {"explanation": explanation, "evidence": batch,
                "status": "RUNNING" if explanation["status"] == "DRAFT" else "COMPLETED_LIMITED",
                "reason": explanation["reason"],
                "completed": [*state["completed"], "explanationDraft"]}

    def validate_explanation(state: UploadState) -> dict:
        assert evidence is not None
        batch = evidence.validate(state["evidence"])
        explanation = validate_claims(state["explanation"], batch)
        return {"explanation": explanation, "evidence": batch,
                "status": "RUNNING" if explanation["status"] == "VALIDATED" else "COMPLETED_LIMITED",
                "reason": explanation["reason"],
                "completed": [*state["completed"], "explanationClaimValidation"]}

    def publication(state: UploadState) -> dict:
        assert evidence is not None
        batch = evidence.validate(state["evidence"])
        explanation = publication_decision(state["explanation"], batch, state["risk"])
        waiting = explanation["reason"] == "FINAL_CLINICAL_REVIEW_REQUIRED"
        return {"explanation": explanation, "evidence": batch, "reason": explanation["reason"],
                "status": "WAITING_HUMAN_REVIEW" if waiting else (
                    "COMPLETED" if explanation["status"] == "PUBLISHED" else "COMPLETED_LIMITED"),
                "waiting_review": waiting, "review_type": "FINAL_CLINICAL_REVIEW" if waiting else "",
                "completed": [*state["completed"], "explanationPublication"]}

    graph = StateGraph(UploadState)
    graph.add_node("validateImage", validate_image)
    graph.add_node("inference", infer)
    graph.add_node("imageQuality", image_quality)
    graph.add_node("qualityReview", quality_review)
    graph.add_node("visionExposure", vision_exposure)
    graph.add_node("clinicalRiskPrecheck", risk_precheck)
    graph.add_node("clinicalRiskFinal", risk_final)
    graph.add_node("explanationDraft", draft_explanation)
    graph.add_node("explanationClaimValidation", validate_explanation)
    graph.add_node("explanationPublication", publication)
    graph.add_node("evidenceRetrieval", retrieve_evidence)
    graph.add_node("evidenceRewrite", rewrite_evidence)
    graph.add_node("evidenceValidation", validate_sources)
    graph.add_edge(START, "validateImage")
    graph.add_conditional_edges("validateImage", lambda state: state["status"] == "REJECTED",
                                {True: END, False: "inference"})
    graph.add_conditional_edges("inference", lambda state: state["status"] == "FAILED",
                                {True: END, False: "imageQuality"})
    graph.add_conditional_edges("imageQuality", lambda state: state["status"],
                                {"RUNNING": "visionExposure", "REJECTED": END,
                                 "WAITING_HUMAN_REVIEW": "qualityReview"})
    graph.add_conditional_edges("qualityReview", lambda state: state["status"] == "RUNNING",
                                {True: "visionExposure", False: END})
    graph.add_conditional_edges("visionExposure", lambda state: state["status"] == "RUNNING",
                                {True: "clinicalRiskPrecheck", False: END})
    graph.add_conditional_edges("clinicalRiskPrecheck",
                                lambda state: state["risk"]["disposition"] == "PROCEED_TO_EVIDENCE",
                                {True: "evidenceRetrieval", False: END})
    graph.add_conditional_edges("evidenceRetrieval", lambda state: state["evidence"]["status"] == "SUFFICIENT",
                                {True: "evidenceValidation", False: "evidenceRewrite"})
    graph.add_edge("evidenceRewrite", "evidenceValidation")
    graph.add_conditional_edges("evidenceValidation", lambda state: state["status"] == "RUNNING",
                                {True: "clinicalRiskFinal", False: END})
    graph.add_conditional_edges("clinicalRiskFinal", lambda state: state["status"] == "RUNNING",
                                {True: "explanationDraft", False: END})
    graph.add_conditional_edges("explanationDraft", lambda state: state["status"] == "RUNNING",
                                {True: "explanationClaimValidation", False: END})
    graph.add_conditional_edges("explanationClaimValidation", lambda state: state["status"] == "RUNNING",
                                {True: "explanationPublication", False: END})
    graph.add_edge("explanationPublication", END)
    return graph.compile(checkpointer=checkpointer,
                         interrupt_after=["validateImage", "inference", "imageQuality",
                                          "qualityReview", "visionExposure", "clinicalRiskPrecheck", "evidenceRetrieval",
                                          "evidenceRewrite", "evidenceValidation", "clinicalRiskFinal", "explanationDraft",
                                          "explanationClaimValidation", "explanationPublication"])


# Node semantics are versioned by ACTION_VERSION; topology is hashed as well.
GRAPH_HASH = hashlib.sha256(json.dumps({
    "graph": build_graph(None).get_graph().to_json(), "actions": ACTION_VERSION,
}, sort_keys=True).encode()).hexdigest()
