import grpc
from concurrent import futures
import hashlib
import hmac
import tempfile
import os
import logging
import json
from pathlib import Path

import diagnosis_pb2
import diagnosis_pb2_grpc
from eye_disease_model import EyeDiseaseModel, disease_categories
from eye_diagnosis.abstain import decide_abstain, should_reject_for_quality
from eye_diagnosis.calibration import apply_temperature
from eye_diagnosis.ood import OodDecision
from eye_diagnosis.quality import evaluate_quality
from eye_diagnosis.registry import ModelRegistry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DISEASE_DESCRIPTIONS = {
    "normal": "正常眼底图像，未发现明显异常。视网膜血管走行正常，视盘边界清晰，黄斑区结构正常。",
    "amd": "年龄相关性黄斑变性（AMD）是一种常见的老年性眼病，主要影响黄斑区，导致中心视力下降。早期表现为视网膜色素上皮改变，晚期可出现脉络膜新生血管或地图样萎缩。",
    "cataract": "白内障是晶状体混浊导致的视力下降疾病。常见症状包括视物模糊、色觉改变、眩光等。根据混浊部位可分为皮质性、核性和后囊下白内障。",
    "diabetes": "糖尿病视网膜病变是糖尿病的常见微血管并发症。早期表现为微血管瘤、出血点，后期可出现新生血管、玻璃体出血，严重者可导致失明。",
    "glaucoma": "青光眼是一组以视神经萎缩和视野缺损为特征的疾病。主要危险因素包括眼压升高、近视、家族史等。早期常无症状，晚期可导致不可逆性视力丧失。",
    "hypertension": "高血压视网膜病变是全身高血压在眼部的表现。早期可见视网膜动脉变细、反光增强，严重者可出现视网膜出血、渗出及视乳头水肿。",
    "myopia": "近视眼眼底改变主要表现为视盘倾斜、视网膜脉络膜萎缩、后巩膜葡萄肿等。高度近视者发生视网膜脱离、黄斑出血等并发症的风险增加。",
    "other": "眼底图像存在异常改变，但无法明确归类为特定疾病。建议进一步检查确诊。",
}


def _resolve_weights_path() -> Path:
    configured = os.getenv("MODEL_WEIGHTS_PATH")
    if not configured:
        raise RuntimeError(
            "MODEL_WEIGHTS_PATH is required; model weights are not configured"
        )
    path = Path(configured)
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Required model weights not found: {path}")
    return path


def _verify_sha256(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    expected = os.getenv("MODEL_WEIGHTS_SHA256")
    if expected and not hmac.compare_digest(digest, expected.lower()):
        raise RuntimeError(
            f"Model weights SHA-256 mismatch: expected {expected}, got {digest}"
        )
    return digest


class DiagnosisServicer(diagnosis_pb2_grpc.DiagnosisServiceServicer):

    def __init__(self):
        weights_path = _resolve_weights_path()
        _verify_sha256(weights_path)
        registry_path = Path(os.getenv(
            "MODEL_REGISTRY_PATH",
            Path(__file__).resolve().parent / "checkpoints" / "registry.json",
        ))
        self.provenance = ModelRegistry(weights_path, registry_path).resolve_current()
        calibration_path = Path(os.getenv(
            "MODEL_CALIBRATION_PATH",
            Path(__file__).resolve().parent / "configs" / "calibration" / "efficientnet_b4_temperature.json",
        ))
        calibration = json.loads(calibration_path.read_text())
        self.temperature = float(calibration["temperature"])
        self.calibration_status = str(calibration.get("status", "NOT_CALIBRATED"))
        if self.calibration_status not in {"CALIBRATED", "NOT_CALIBRATED"}:
            raise RuntimeError("Calibration status must be CALIBRATED or NOT_CALIBRATED")
        if calibration.get("model_version") != self.provenance.version:
            raise RuntimeError("Calibration model version does not match registered model")
        self.inference_policy_version = os.getenv("INFERENCE_POLICY_VERSION", "medical-safety-v3-quality-observe").strip()
        if not self.inference_policy_version:
            raise RuntimeError("INFERENCE_POLICY_VERSION must not be empty")
        self.quality_gate_mode = os.getenv("QUALITY_GATE_MODE", "observe").strip().lower()
        if self.quality_gate_mode not in {"observe", "enforce"}:
            raise RuntimeError("QUALITY_GATE_MODE must be observe or enforce")
        self.model = EyeDiseaseModel(model_name='efficientnet_b4')
        self.model.load_model(str(weights_path))
        logger.info(f"Model loaded from {weights_path}")

    def Diagnose(self, request, context):
        try:
            image_data = request.image_data
            if not image_data:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("No image data provided")
                return diagnosis_pb2.DiagnosisResponse()

            suffix = '.jpg'
            if 'png' in (request.image_format or '').lower():
                suffix = '.png'

            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(image_data)
                temp_path = f.name

            try:
                quality = evaluate_quality(image_data)
                logits = self.model.predict_logits(temp_path)
                scored_logits = logits
                if self.calibration_status == "CALIBRATED":
                    scored_logits = apply_temperature(logits[None, :], self.temperature)[0]
                exp_logits = scored_logits - scored_logits.max()
                probabilities = __import__("numpy").exp(exp_logits)
                probabilities = probabilities / probabilities.sum()
                ranked_indices = probabilities.argsort()[::-1]
                predicted_class = int(ranked_indices[0])
                predicted_label = disease_categories[predicted_class]
                top1 = float(probabilities[ranked_indices[0]])
                top2 = float(probabilities[ranked_indices[1]]) if len(ranked_indices) > 1 else 0.0
                # No evaluated, version-bound OOD reference artifact is available. Do
                # not use the former all-zero placeholder detector as a rejection gate.
                ood = OodDecision(is_ood=False, score=0.0, threshold=0.0)
                abstain = decide_abstain(
                    quality_rejected=should_reject_for_quality(
                        quality.reasons, self.quality_gate_mode
                    ),
                    quality_reasons=quality.reasons,
                    ood=ood.is_ood,
                    top1_prob=top1,
                    top2_prob=top2,
                )
                description = "" if abstain.rejected else DISEASE_DESCRIPTIONS.get(predicted_label, "")

                return diagnosis_pb2.DiagnosisResponse(
                    predicted_label=predicted_label,
                    probability=top1 * 100,
                    calibrated_probability=top1 * 100 if self.calibration_status == "CALIBRATED" else 0.0,
                    calibration_status=self.calibration_status,
                    reliability_score=round(top1 * 100),
                    description=description,
                    top_predictions=[
                        diagnosis_pb2.DiseasePrediction(
                            label=disease_categories[int(index)],
                            probability=float(probabilities[index]) * 100,
                        )
                        for index in ranked_indices[:3]
                    ],
                    rejected=abstain.rejected,
                    abstain_reason=abstain.reason.value if abstain.reason else "",
                    quality_score=quality.score,
                    quality_reasons=",".join(quality.reasons),
                    is_ood=ood.is_ood,
                    ood_score=ood.score,
                    ood_status=diagnosis_pb2.NOT_EVALUATED,
                    model_version=self.provenance.version,
                    weight_sha256=self.provenance.weight_sha256,
                    preprocess_version=self.provenance.preprocess_version or "",
                    inference_policy_version=self.inference_policy_version,
                    requires_review=abstain.requires_review,
                )
            finally:
                os.unlink(temp_path)

        except Exception as e:
            logger.error(f"Diagnosis failed: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return diagnosis_pb2.DiagnosisResponse()


def serve():
    # 必须在 add_insecure_port 之前构造 Servicer，权重缺失则立即终止
    servicer = DiagnosisServicer()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    diagnosis_pb2_grpc.add_DiagnosisServiceServicer_to_server(
        servicer, server
    )
    server.add_insecure_port('0.0.0.0:50051')
    server.start()
    logger.info("gRPC Diagnosis Server started on 0.0.0.0:50051")
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
