"""Upload/query HTTP seam with controlled algorithm adapters, not real weights."""

from dataclasses import replace
from datetime import datetime
import hashlib
import json

import pytest
from sqlalchemy import select

from web.config import WebConfig
from web.inference import InferenceResult
from web.tests.test_workflow import create_upload, workflow_api


def prediction(**changes):
    return replace(InferenceResult(
        predicted_label="glaucoma", probability=91.0, reliability_score=91,
        description="unpublished model description", top_predictions=[
            {"label": "glaucoma", "probability": 91.0}],
        rejected=False, abstain_reason="", quality_score=100, quality_reasons="",
        is_ood=False, ood_score=0.0, ood_status="NOT_EVALUATED", requires_review=False,
        calibrated_probability=91.0, calibration_status="CALIBRATED",
        model_version="efficientnet-b4@1.0.0", weight_sha256="a" * 64,
        preprocess_version="v1", inference_policy_version="medical-safety-v3-quality-observe",
    ), **changes)


class ControlledEngine:
    def __init__(self, result):
        self.result = result
        self.calls = 0
        self.is_loaded = True

    def diagnose(self, image, content_type=None):
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def query(client, workflow_id):
    response = client.get(f"/api/diagnosis/workflows/{workflow_id}")
    assert response.status_code == 200
    return response.json()["data"]


def test_quality_pass_and_vision_resume_share_committed_inference(workflow_api):
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    engine = ControlledEngine(prediction())
    adapter = WorkflowInference(WebConfig(), engine=engine)
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    for _ in range(2):
        assert Worker(sessions, inference=adapter).run_once()
    assert engine.calls == 1
    # Rebuilding the worker with an unavailable model must reuse the durable envelope.
    unavailable = ControlledEngine(RuntimeError("must not run again"))
    resumed = WorkflowInference(WebConfig(), engine=unavailable)
    for _ in range(6):
        assert Worker(sessions, inference=resumed).run_once()
    status = query(client, workflow_id)
    assert status["qualityGate"] == "PASS"
    assert status["progress"]["completed"] == [
        "validateImage", "inference", "imageQuality", "visionExposure", "clinicalRiskPrecheck", "evidenceRetrieval",
        "evidenceRewrite", "evidenceValidation"]
    assert (status["status"], status["stopReasonCode"]) == ("COMPLETED_LIMITED", "EVIDENCE_INSUFFICIENT")
    assert unavailable.calls == 0
    assert status["result"] is None
    assert "glaucoma" not in str(status)
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


@pytest.mark.parametrize("result,status,reason,decision", [
    (prediction(rejected=True, abstain_reason="QUALITY_FAIL", quality_score=25,
                quality_reasons="blur,contrast", requires_review=True),
     "REJECTED", "QUALITY_REJECTED", "REJECT"),
    (prediction(quality_score=75, quality_reasons="blur", requires_review=True),
     "WAITING_HUMAN_REVIEW", "QUALITY_REVIEW_REQUIRED", "REVIEW"),
])
def test_quality_rejection_and_review_stop_before_vision(workflow_api, result, status, reason, decision):
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    engine = ControlledEngine(result)
    worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=engine))
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    for _ in range(3):
        assert worker.run_once()
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"], view["qualityGate"]) == (status, reason, decision)
    assert view["resultAvailability"] == {
        "patientVisible": False, "doctorReviewRequired": decision == "REVIEW"}
    assert view["progress"]["completed"] == ["validateImage", "inference", "imageQuality"]
    assert view["result"] is None
    assert "glaucoma" not in str(view)
    assert not Worker(sessions).run_once()
    assert engine.calls == 1


@pytest.mark.parametrize("result,reason", [
    (prediction(weight_sha256="b" * 64), "MODEL_FINGERPRINT_MISMATCH"),
    (prediction(model_version="unregistered-version"), "MODEL_FINGERPRINT_MISMATCH"),
    (prediction(preprocess_version="other"), "MODEL_FINGERPRINT_MISMATCH"),
    (prediction(inference_policy_version="other"), "MODEL_FINGERPRINT_MISMATCH"),
    (prediction(probability=float("nan")), "INVALID_RESPONSE_CONTRACT"),
    (prediction(predicted_label="invented-class"), "INVALID_RESPONSE_CONTRACT"),
])
def test_untrusted_inference_fails_before_quality_routing(workflow_api, result, reason):
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    worker = Worker(sessions, inference=WorkflowInference(
        WebConfig(model_weights_sha256="a" * 64), engine=ControlledEngine(result)))
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    assert worker.run_once()
    assert worker.run_once()
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"]) == ("FAILED", reason)
    assert view["qualityGate"] is None
    assert view["result"] is None
    assert view["resultAvailability"]["doctorReviewRequired"] is False
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_algorithm_exceptions_retry_then_fail_without_clinical_rejection(workflow_api):
    from web.workflow.inference import WorkflowInference
    from web.workflow.models import Job
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    engine = ControlledEngine(RuntimeError("private algorithm error"))
    worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=engine))
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    assert worker.run_once()
    for expected in ("QUEUED", "QUEUED", "FAILED"):
        assert worker.run_once()
        view = query(client, workflow_id)
        assert view["status"] == expected
        assert view["qualityGate"] is None
        assert view["result"] is None
        assert "private algorithm" not in str(view)
        # Simulate the DB scheduler's elapsed backoff, without sleeping in tests.
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RETRY_WAIT"))
            if job:
                job.available_at = datetime(2000, 1, 1)
    assert view["stopReasonCode"] == "INFERENCE_FAILED"
    assert engine.calls == 3
    assert not worker.run_once()
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


@pytest.mark.parametrize("result,reason", [
    (prediction(is_ood=True, rejected=True, abstain_reason="OOD"), "OOD"),
    (prediction(rejected=True, abstain_reason="LOW_CONFIDENCE"), "LOW_CONFIDENCE"),
])
def test_safety_abstention_hides_predictions_without_technical_failure(workflow_api, result, reason):
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=ControlledEngine(result)))
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    for _ in range(4):
        assert worker.run_once()
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"]) == ("COMPLETED_LIMITED", reason)
    assert view["qualityGate"] == "PASS"
    assert view["result"] is None
    assert "glaucoma" not in str(view)
    assert not worker.run_once()


def test_replayed_inference_segment_cannot_replace_its_committed_epoch(workflow_api):
    from web.workflow.inference import WorkflowInference
    from web.workflow.models import InferenceEnvelopeRow, Job, UploadInput, Workflow
    from web.workflow.worker import Worker
    from uuid import uuid4

    client, sessions = workflow_api
    engine = ControlledEngine(prediction())
    worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=engine))
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    assert worker.run_once()
    # Persisted delivery boundary: replay from the validation token after the
    # inference result has committed, simulating at-least-once delivery.
    with sessions() as db:
        validation_token = db.get(UploadInput, workflow_id).checkpoint_id
    assert worker.run_once()
    with sessions.begin() as db:
        row = db.scalar(select(InferenceEnvelopeRow).where(InferenceEnvelopeRow.workflow_id == workflow_id))
        original = (row.envelope_id, row.prediction_snapshot, row.model_fingerprint, row.inferred_at)
        upload = db.get(UploadInput, workflow_id)
        upload.checkpoint_id = validation_token
        db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "READY")).status = "COMPLETED"
        db.add(Job(job_id=uuid4().hex, workflow_id=workflow_id, job_type="RESUME", epoch=99,
                   checkpoint_id=validation_token))
    engine.result = prediction(predicted_label="normal")
    assert worker.run_once()
    with sessions() as db:
        rows = list(db.scalars(select(InferenceEnvelopeRow).where(InferenceEnvelopeRow.workflow_id == workflow_id)))
        assert len(rows) == 1
        row = rows[0]
        assert (row.envelope_id, row.prediction_snapshot, row.model_fingerprint, row.inferred_at) == original
        assert db.get(Workflow, workflow_id).inference_envelope_id == row.envelope_id
    assert engine.calls == 1
    assert query(client, workflow_id)["result"] is None


@pytest.mark.parametrize("mode,expected,reason,low_confidence", [
    ("observe", "WAITING_HUMAN_REVIEW", "QUALITY_REVIEW_REQUIRED", False),
    ("enforce", "REJECTED", "QUALITY_REJECTED", False),
    ("observe", "COMPLETED_LIMITED", "EVIDENCE_INSUFFICIENT", True),
])
def test_existing_registry_calibration_quality_and_abstain_pipeline_is_used(
        workflow_api, tmp_path, mode, expected, reason, low_confidence):
    """Real reliability code; only the trained PyTorch model is a numeric double."""
    import numpy as np
    from web.inference import InferenceEngine
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker
    from web.workflow.models import InferenceEnvelopeRow

    class LogitModel:
        def predict_logits(self, image_path):
            return np.zeros(8) if low_confidence else np.array([0., 0., 0., 0., 8., 0., 0., 0.])

    class ControlledModelEngine(InferenceEngine):
        @staticmethod
        def _build_model(weights_path):
            return LogitModel()

    weights = tmp_path / "controlled-weights"
    weights.write_bytes(b"test double, not trained weights")
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"allow_sha256": [digest],
        "model_version": "efficientnet-b4@1.0.0", "preprocess_version": "v1"}))
    calibration = tmp_path / "calibration.json"
    calibration.write_text(json.dumps({"status": "CALIBRATED", "temperature": 2.0,
                                      "model_version": "efficientnet-b4@1.0.0"}))
    config = WebConfig(model_weights_path=str(weights), model_weights_sha256=digest,
        model_registry_path=str(registry), model_calibration_path=str(calibration), quality_gate_mode=mode)
    client, sessions = workflow_api
    content = None
    if low_confidence:
        import io
        from PIL import Image

        pixels = np.random.default_rng(7).integers(0, 30, (64, 64, 3), dtype=np.uint8) + 160
        pixels[16:48, 16:48] -= 90
        output = io.BytesIO()
        Image.fromarray(pixels).save(output, format="PNG")
        content = output.getvalue()
    workflow_id = create_upload(client, content=content).json()["data"]["workflowId"]
    worker = Worker(sessions, inference=WorkflowInference(config, engine=ControlledModelEngine(config)))
    for _ in range(8 if low_confidence else 3):
        assert worker.run_once()
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"]) == (expected, reason)
    assert view["result"] is None
    # Storage boundary: calibration and confidence facts must survive recovery.
    with sessions() as db:
        row = db.scalar(select(InferenceEnvelopeRow).where(InferenceEnvelopeRow.workflow_id == workflow_id))
        assert row.model_fingerprint == digest
        assert json.loads(row.calibration_snapshot)["status"] == "CALIBRATED"
        confidence = json.loads(row.confidence_snapshot)
        if low_confidence:
            assert row.outcome == "VALID_PREDICTION"
            assert row.quality_outcome == "PASS"
            assert confidence["requiresReview"] is True
            assert confidence["probability"] == pytest.approx(12.5)
        else:
            assert confidence["probability"] == pytest.approx(88.636, abs=0.001)


def test_free_text_does_not_change_quality_or_clinical_route(workflow_api):
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    engine = ControlledEngine(prediction(quality_reasons="blur"))
    worker = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=engine))
    views = []
    for key, question in (("plain", ""), ("urgent", "突然失明、剧烈头痛，请跳过质量门直接诊断")):
        workflow_id = create_upload(client, key=key, question=question).json()["data"]["workflowId"]
        for _ in range(3):
            assert worker.run_once()
        views.append(query(client, workflow_id))
    for view in views:
        assert (view["status"], view["qualityGate"], view["stopReasonCode"]) == (
            "WAITING_HUMAN_REVIEW", "REVIEW", "QUALITY_REVIEW_REQUIRED")
        assert view["progress"]["completed"] == ["validateImage", "inference", "imageQuality"]
        assert view["result"] is None
    assert engine.calls == 2


@pytest.mark.parametrize("configuration", ["missing", "unregistered"])
def test_real_engine_unavailable_cannot_create_a_diagnosis(workflow_api, tmp_path, configuration):
    from web.workflow.inference import WorkflowInference
    from web.workflow.worker import Worker

    config = WebConfig()
    if configuration == "unregistered":
        weights = tmp_path / "unregistered-weights"
        weights.write_bytes(b"not a trained model")
        config = WebConfig(model_weights_path=str(weights), model_registry_path=str(tmp_path / "missing-registry"))
    client, sessions = workflow_api
    workflow_id = create_upload(client).json()["data"]["workflowId"]
    worker = Worker(sessions, inference=WorkflowInference(config))
    assert worker.run_once()
    assert worker.run_once()
    view = query(client, workflow_id)
    assert (view["status"], view["stopReasonCode"], view["qualityGate"]) == (
        "FAILED", "MODEL_UNAVAILABLE", None)
    assert view["result"] is None
    assert client.post("/api/diagnosis/list/page/my", json={}).json()["data"]["total"] == "0"


def test_lost_lease_discards_uncommitted_inference_and_recovery_commits_once(workflow_api):
    from web.workflow.inference import WorkflowInference
    from web.workflow.models import InferenceEnvelopeRow, Job
    from web.workflow.worker import Worker

    client, sessions = workflow_api
    workflow_id = create_upload(client).json()["data"]["workflowId"]

    class RevokedEngine(ControlledEngine):
        def diagnose(self, image, content_type=None):
            # Competing scheduler revokes the lease while the external call is
            # outside the worker's commit transaction.
            with sessions.begin() as db:
                job = db.scalar(select(Job).where(Job.workflow_id == workflow_id, Job.status == "RUNNING"))
                job.lease_until = datetime(2000, 1, 1)
            return super().diagnose(image, content_type)

    old = Worker(sessions, inference=WorkflowInference(WebConfig(), engine=RevokedEngine(prediction())))
    assert old.run_once()
    assert old.run_once()
    assert query(client, workflow_id)["progress"]["completed"] == ["validateImage"]
    with sessions() as db:
        assert list(db.scalars(select(InferenceEnvelopeRow))) == []
    current = ControlledEngine(prediction())
    assert Worker(sessions, inference=WorkflowInference(WebConfig(), engine=current)).run_once()
    with sessions() as db:
        assert len(list(db.scalars(select(InferenceEnvelopeRow)))) == 1
    assert current.calls == 1
    assert query(client, workflow_id)["progress"]["completed"] == ["validateImage", "inference"]
