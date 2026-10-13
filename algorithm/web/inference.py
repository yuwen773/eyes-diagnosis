"""In-process inference -- the replacement for the gRPC hop.

This is a port of ``grpc_server.py:57-166``, not a rewrite of it. Every
behaviour that Java depends on is reproduced deliberately, including several
that look like bugs:

* **Percentages, not probabilities.** ``probability=top1 * 100``
  (``grpc_server.py:134``). The value stored in ``t_diagnosis.probability``
  and rendered by the frontend is 0-100. ``decide_abstain`` is fed the raw
  0-1 ``top1`` instead, so the abstain thresholds (0.7 / 0.15 gap) are
  evaluated in 0-1 space while the response reports percent. Mixing the two
  units here silently disables the abstain gate.
* **A no-op OOD decision.** ``OodDecision(is_ood=False, score=0.0,
  threshold=0.0)`` is hardcoded (``:118-120``) with the comment explaining
  that no version-bound reference artifact exists and the all-zero placeholder
  detector must not be used as a rejection gate. ``ood.py`` still exists and
  still builds a zeroed detector; it is deliberately not wired in.
* **Empty response on failure.** The gRPC handler returns a default-constructed
  ``DiagnosisResponse()`` on any exception (``:161-166``), which Java would
  then persist as a garbage row (``rejected=false``, ``predicted_label=""``).
  That is a bug, and this port does **not** reproduce it -- see
  :meth:`InferenceEngine.diagnose`, which raises.

Import safety
-------------
Nothing heavy is imported at module scope. ``eye_disease_model`` fails at
line 1 without torch; ``eye_diagnosis.quality``/``calibration``/``ood`` import
numpy at module scope. The default interpreter has none of them, and the
``python-web`` CI job installs ``requirements-web.txt`` alone. So all of it is
imported inside :meth:`InferenceEngine.load` / :meth:`InferenceEngine.diagnose`.

The ``algorithm`` directory is added to ``sys.path`` here because
``eye_disease_model`` is a flat module, not a package -- see ruling 12.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from web.config import WebConfig

logger = logging.getLogger(__name__)

#: ``eye_disease_model.disease_categories`` -- 8 fundus disease classes, index
#: order matching the model's classifier head.
DISEASE_CATEGORIES = (
    "normal",
    "amd",
    "cataract",
    "diabetes",
    "glaucoma",
    "hypertension",
    "myopia",
    "other",
)

#: ``grpc_server.py:23-32``. Chinese description per class, written into
#: ``t_diagnosis.details`` and shown to the patient.
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

#: OOD was never evaluated against a version-bound reference artifact, so the
#: status is always this. ``grpc_server.py:152`` passes the proto enum
#: ``NOT_EVALUATED`` for every response.
OOD_STATUS_NOT_EVALUATED = "NOT_EVALUATED"

CALIBRATED = "CALIBRATED"
NOT_CALIBRATED = "NOT_CALIBRATED"


class InferenceUnavailable(RuntimeError):
    """Weights missing, SHA unverified, or the registry does not allow it.

    Raised at :meth:`InferenceEngine.load` time. Distinct from a runtime
    inference failure, which is a 500 but not a deployment problem.
    """


@dataclass(frozen=True)
class InferenceResult:
    """The 19-field response the proto carried, as a plain dataclass.

    ``proto`` field names are preserved verbatim (snake_case) because they are
    also the ``t_inference_cache`` column names in Python's own naming.
    """

    predicted_label: str
    #: 0-100. See the module docstring -- this is percent, not a 0-1 probability.
    probability: float
    reliability_score: int
    description: str
    top_predictions: list[dict[str, Any]]
    rejected: bool
    abstain_reason: str
    quality_score: int
    quality_reasons: str
    is_ood: bool
    ood_score: float
    ood_status: str
    requires_review: bool
    #: 0-100 when CALIBRATED, else 0.0.
    calibrated_probability: float
    calibration_status: str
    #: The deployment fingerprint, copied from the response on a real run.
    #: ``DiagnosisServiceImpl.responseMatchesConfiguredFingerprint`` (:321-330)
    #: compares all four against the *configured* values before allowing a
    #: cache write -- these are those four.
    model_version: str
    weight_sha256: str
    preprocess_version: str
    inference_policy_version: str

    def fingerprint(self) -> tuple[str, str, str, str]:
        return (
            self.model_version,
            self.weight_sha256.lower(),
            self.preprocess_version,
            self.inference_policy_version,
        )


@dataclass
class _Loaded:
    """Everything :meth:`InferenceEngine.load` produced. Held as one object so
    the engine can be swapped atomically rather than field-by-field."""

    model: Any
    provenance: Any
    temperature: float
    calibration_status: str
    temperature_applied: bool
    weight_sha256: str
    #: Populated lazily on first inference -- numpy import is deferred.
    _modules: dict[str, Any] = field(default_factory=dict)


class InferenceEngine:
    """Thread-safe holder for the loaded model.

    One instance per process, loaded during the FastAPI lifespan. Inference is
    CPU/GPU-bound and synchronous, so requests call it from the threadpool --
    the lock is held only for the duration of one forward pass, which is what
    keeps concurrent requests from interleaving on the shared model.
    """

    def __init__(self, config: WebConfig):
        self._config = config
        self._loaded: _Loaded | None = None
        self._lock = threading.Lock()

    # -- state ---------------------------------------------------------------

    @property
    def is_loaded(self) -> bool:
        return self._loaded is not None

    def _require(self) -> _Loaded:
        if self._loaded is None:
            raise InferenceUnavailable(
                "Model is not loaded. This deployment has no usable weights "
                "(set MODEL_WEIGHTS_PATH); /diagnosis/upload will fail closed."
            )
        return self._loaded

    # -- loading -------------------------------------------------------------

    def load(self) -> None:
        """Resolve, verify and load the weights. Idempotent.

        Mirrors ``DiagnosisServicer.__init__`` (:59-86) step for step, including
        the ordering: the SHA check happens *before* the registry read, so a
        tampered-but-present file reports a SHA mismatch rather than a generic
        registry rejection.
        """
        config = self._config
        weights_path = self._resolve_weights_path(config.model_weights_path)

        digest = hashlib.sha256(weights_path.read_bytes()).hexdigest()
        if config.model_weights_sha256 and digest != config.model_weights_sha256:
            raise InferenceUnavailable(
                f"Model weights SHA-256 mismatch: expected "
                f"{config.model_weights_sha256}, got {digest}"
            )

        provenance = self._resolve_provenance(weights_path, digest, config)
        temperature, calibration_status = self._load_calibration(config, provenance)

        model = self._build_model(weights_path)

        self._loaded = _Loaded(
            model=model,
            provenance=provenance,
            temperature=temperature,
            calibration_status=calibration_status,
            temperature_applied=calibration_status == CALIBRATED,
            weight_sha256=digest,
        )
        logger.info(
            "Model loaded from %s (version=%s, calibration=%s)",
            weights_path,
            provenance.version,
            calibration_status,
        )

    @staticmethod
    def _resolve_weights_path(configured: str) -> Path:
        """``_resolve_weights_path`` (:35-44).

        An empty path is the default in this deployment (no weights are
        checked in), so this raises on every request rather than at import.
        """
        if not configured:
            raise InferenceUnavailable(
                "MODEL_WEIGHTS_PATH is required; model weights are not configured"
            )
        path = Path(configured)
        if not path.is_file() or path.stat().st_size == 0:
            raise InferenceUnavailable(f"Required model weights not found: {path}")
        return path

    @staticmethod
    def _resolve_provenance(weights_path: Path, digest: str, config: WebConfig):
        """``ModelRegistry.resolve_current`` -- fail-closed on both counts.

        Note the registry's allow-list is currently empty
        (``checkpoints/registry.json``), so even once weights exist the
        registry check rejects them until a training run populates
        ``allow_sha256``. That is correct behaviour, not a gap in the port --
        see ruling 12 / the R6 note in docs/migration-decisions.md.
        """
        from eye_diagnosis.registry import ModelRegistry

        registry_path = Path(config.model_registry_path)
        try:
            return ModelRegistry(weights_path, registry_path).resolve_current()
        except RuntimeError as exc:
            raise InferenceUnavailable(str(exc)) from exc

    @staticmethod
    def _load_calibration(config: WebConfig, provenance) -> tuple[float, str]:
        """``grpc_server.py:67-77``.

        A missing calibration file is **not** fatal here. Java would throw, but
        the gRPC server is the only deployment that reads this file today; the
        web layer must boot for the seven non-inference endpoints to work. An
        uncalibrated deployment therefore records ``NOT_CALIBRATED`` and
        reports 0.0 for ``calibratedProbability`` -- the same value the response
        carries when calibration is absent.
        """
        path = Path(config.model_calibration_path)
        if not path.is_file():
            logger.warning(
                "Calibration file %s not found; serving uncalibrated. "
                "This is NOT the same as NOT_CALIBRATED being configured on a "
                "calibrated model -- probabilities will not be temperature-scaled.",
                path,
            )
            return 1.0, NOT_CALIBRATED

        payload = json.loads(path.read_text(encoding="utf-8"))
        status = str(payload.get("status", NOT_CALIBRATED))
        if status not in (CALIBRATED, NOT_CALIBRATED):
            raise InferenceUnavailable(
                f"Calibration status must be {CALIBRATED} or {NOT_CALIBRATED}, "
                f"got {status!r}"
            )
        if payload.get("model_version") != provenance.version:
            raise InferenceUnavailable(
                "Calibration model version does not match registered model"
            )
        return float(payload["temperature"]), status

    @staticmethod
    def _build_model(weights_path: Path):
        """``EyeDiseaseModel`` construction + ``load_model`` (:84-85).

        Imported here, not at module scope. Two side effects of the constructor
        are worth knowing about (ruling 12): it calls ``set_seed()``, mutating
        the process-global RNG, and it allocates an AdamW optimiser and a
        CosineAnnealingLR scheduler that inference never uses.
        """
        from eye_disease_model import EyeDiseaseModel

        model = EyeDiseaseModel(model_name="efficientnet_b4")
        model.load_model(str(weights_path))
        return model

    # -- inference -----------------------------------------------------------

    def diagnose(self, image_bytes: bytes, content_type: str | None = None) -> InferenceResult:
        """Port of ``DiagnosisServicer.Diagnose`` (:88-158).

        Unlike the gRPC handler, failures **raise**. The original returned an
        empty ``DiagnosisResponse``, which Java would then persist as a
        diagnosis with an empty label and ``rejected=false`` -- a fabricated
        result presented to a patient. See the module docstring.
        """
        loaded = self._require()
        if not image_bytes:
            raise ValueError("No image data provided")

        quality = self._evaluate_quality(image_bytes)
        temp_path = self._write_temp_file(image_bytes, content_type)
        try:
            logits = loaded.model.predict_logits(temp_path)
            probabilities = self._softmax(logits, loaded)
        finally:
            # Mirrors the ``finally: os.unlink`` at :159-160. The temp file
            # holds a patient's retinal image on disk; it must not survive the
            # request even when inference raises.
            _silent_unlink(temp_path)

        top_predictions = self._rank(probabilities)
        predicted_label, top1 = top_predictions[0]
        top2 = top_predictions[1][1] if len(top_predictions) > 1 else 0.0

        abstain = self._decide_abstain(quality.reasons, top1, top2)
        description = "" if abstain.rejected else DISEASE_DESCRIPTIONS.get(predicted_label, "")

        return InferenceResult(
            predicted_label=predicted_label,
            probability=top1 * 100,
            reliability_score=round(top1 * 100),
            description=description,
            # grpc_server.py:139-144 -- top 3, percent.
            top_predictions=[
                {"label": label, "probability": probability * 100}
                for label, probability in top_predictions[:3]
            ],
            rejected=abstain.rejected,
            abstain_reason=abstain.reason.value if abstain.reason else "",
            quality_score=quality.score,
            quality_reasons=",".join(quality.reasons),
            # OOD is hardcoded off -- see the module docstring.
            is_ood=False,
            ood_score=0.0,
            ood_status=OOD_STATUS_NOT_EVALUATED,
            requires_review=abstain.requires_review,
            calibrated_probability=top1 * 100 if loaded.temperature_applied else 0.0,
            calibration_status=loaded.calibration_status,
            model_version=loaded.provenance.version,
            weight_sha256=loaded.weight_sha256,
            preprocess_version=loaded.provenance.preprocess_version or "",
            inference_policy_version=self._config.inference_policy_version,
        )

    def _softmax(self, logits, loaded: _Loaded):
        """``grpc_server.py:107-112``.

        Temperature is applied to a *2-D* array (``logits[None, :]``) because
        ``apply_temperature`` expects a batch; then softmax is computed by hand
        with a max-subtraction for numerical stability.
        """
        import numpy as np

        scored = logits
        if loaded.temperature_applied:
            from eye_diagnosis.calibration import apply_temperature

            scored = apply_temperature(logits[None, :], loaded.temperature)[0]

        exp_logits = scored - scored.max()
        probabilities = np.exp(exp_logits)
        return probabilities / probabilities.sum()

    @staticmethod
    def _rank(probabilities) -> list[tuple[str, float]]:
        """Descending (label, 0-1 probability), all 8 classes.

        ``grpc_server.py:113-114`` uses ``argsort()[::-1]``; the indices are
        cast to ``int`` because numpy scalars do not index the tuple cleanly.
        """
        ranked_indices = probabilities.argsort()[::-1]
        return [(DISEASE_CATEGORIES[int(i)], float(probabilities[i])) for i in ranked_indices]

    @staticmethod
    def _evaluate_quality(image_bytes: bytes):
        from eye_diagnosis.quality import evaluate_quality

        return evaluate_quality(image_bytes)

    def _decide_abstain(self, quality_reasons: list[str], top1: float, top2: float):
        """``grpc_server.py:118-129`` condensed.

        Returns the shared ``AbstainDecision``. The abstain
        thresholds are compared against **0-1** values, unlike the percent
        values in the response -- see the module docstring.
        """
        from eye_diagnosis.abstain import decide_abstain, should_reject_for_quality

        decision = decide_abstain(
            quality_rejected=should_reject_for_quality(
                quality_reasons, self._config.quality_gate_mode
            ),
            quality_reasons=quality_reasons,
            ood=False,
            top1_prob=top1,
            top2_prob=top2,
        )
        return decision

    @staticmethod
    def _write_temp_file(image_bytes: bytes, content_type: str | None) -> str:
        """``grpc_server.py:96-102``.

        ``EyeDiseaseModel.predict_logits`` takes a **filesystem path**
        (``Image.open(image_path)``), so the in-memory upload has to be spilled
        to disk before inference. There is no batch or bytes API on the model.
        The suffix is derived from the declared content type because
        ``Image.open`` sniffs the real format regardless -- it matters only for
        tooling that reads the extension.
        """
        suffix = ".png" if "png" in (content_type or "").lower() else ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(image_bytes)
            return handle.name


def _silent_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:  # noqa: BLE001 - cleanup must never mask the real error
        logger.warning("failed to remove temp image %s", path, exc_info=True)


def ensure_algorithm_on_path() -> None:
    """Put the ``algorithm`` directory on ``sys.path``.

    ``eye_disease_model`` is a flat module (``algorithm/eye_disease_model.py``),
    not a package, so the import only resolves when ``algorithm/`` itself is
    importable. Uvicorn is started with ``working-directory: algorithm`` in the
    documented run command, which makes this a no-op there -- but running from
    the repo root or from a different cwd would otherwise fail at the first
    inference rather than at startup.
    """
    root = str(Path(__file__).resolve().parents[1])
    if root not in sys.path:
        sys.path.insert(0, root)
