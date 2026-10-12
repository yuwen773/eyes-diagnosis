"""Inference layer tests (Phase 2.2).

Two groups:

* **Portability** -- runs with no torch, numpy or PIL installed. Asserts the
  fail-closed configuration behaviour, the import-safety rules and the data
  copied verbatim from ``grpc_server.py``.
* **Numerical** -- needs numpy/torch. Skipped automatically when absent, and
  exercised in CI's ``python`` job which installs ``requirements.txt``.

The descriptions are diffed against ``grpc_server.py`` by *parsing it*. An
earlier draft of ``web/inference.py`` hand-copied all eight Chinese strings and
got seven of them wrong; a test that only checked "there are eight entries"
would not have caught a single character of it.
"""

import ast
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

ALGORITHM_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = ALGORITHM_ROOT.parent
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.config import WebConfig  # noqa: E402
from web.inference import (  # noqa: E402
    CALIBRATED,
    DISEASE_CATEGORIES,
    DISEASE_DESCRIPTIONS,
    NOT_CALIBRATED,
    InferenceEngine,
    InferenceResult,
    InferenceUnavailable,
)

GRPC_SERVER = ALGORITHM_ROOT / "grpc_server.py"


# ---------------------------------------------------------------------------
# Data copied verbatim from grpc_server.py
# ---------------------------------------------------------------------------
def _literal_dict(source: str, name: str) -> dict:
    """Extract a module-level dict literal by AST -- no import, no torch."""
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == name for t in node.targets
        ):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} not found in {source!r}")


def test_disease_descriptions_match_grpc_server():
    """Character-exact. These strings are written to ``t_diagnosis.details``
    and shown to patients."""
    assert DISEASE_DESCRIPTIONS == _literal_dict(GRPC_SERVER.read_text(encoding="utf-8"), "DISEASE_DESCRIPTIONS")


def test_disease_descriptions_cover_every_category():
    assert set(DISEASE_DESCRIPTIONS) == set(DISEASE_CATEGORIES)
    assert len(DISEASE_CATEGORIES) == 8


def test_disease_descriptions_fit_the_details_column():
    """``t_diagnosis.details VARCHAR(512)`` counts characters. The longest is
    AMD at ~74; an edit that lengthens one entry must not silently overflow."""
    for label, text in DISEASE_DESCRIPTIONS.items():
        assert len(text) <= 512, f"{label}: {len(text)} chars"


def test_disease_categories_match_the_model_module():
    """``eye_disease_model.disease_categories`` defines the classifier head's
    class order; the response's ``predicted_label`` indexes into it. A drift
    here would mislabel **every** diagnosis.

    It is a dict keyed 0..7, so this parses the literal and sorts by key rather
    than trusting source order.
    """
    source = (ALGORITHM_ROOT / "eye_disease_model.py").read_text(encoding="utf-8")
    match = re.search(r"disease_categories\s*=\s*\{(.*?)\}", source, re.S)
    assert match, "disease_categories not found in eye_disease_model.py"
    mapping = _literal_dict(f"disease_categories = {{{match.group(1)}}}", "disease_categories")
    ordered = tuple(mapping[i] for i in sorted(mapping))
    assert ordered == DISEASE_CATEGORIES


# ---------------------------------------------------------------------------
# Import safety
# ---------------------------------------------------------------------------
def test_importing_the_module_does_not_pull_torch():
    """Subprocess so an already-imported torch cannot mask it."""
    code = (
        "import sys; sys.path.insert(0, %r);"
        "import web.inference;"
        "heavy = [m for m in ('torch','torchvision','numpy','PIL') if m in sys.modules];"
        "print(','.join(heavy))" % str(ALGORITHM_ROOT)
    )
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, cwd=str(ALGORITHM_ROOT)
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "", (
        f"web.inference pulled in heavy modules at import time: {result.stdout.strip()}"
    )


def test_heavy_imports_are_all_lazy():
    """The property that keeps the app importable without torch: no heavy module
    may appear in ``tree.body`` -- only inside a function body.

    Checked over ``tree.body`` rather than ``ast.walk`` on purpose. A walk sees
    the lazy imports *inside* :meth:`InferenceEngine.load` and would flag the
    very thing that makes this file work. The subprocess test above is the
    runtime proof; this is the source-level proof that also holds on a machine
    where torch happens to be installed and would mask it.
    """
    tree = ast.parse((ALGORITHM_ROOT / "web" / "inference.py").read_text(encoding="utf-8"))
    banned = {"torch", "torchvision", "numpy", "PIL", "eye_disease_model", "eye_diagnosis"}
    offenders = []
    for node in tree.body:  # module scope only
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        module = getattr(node, "module", None) or ""
        roots = {module.split(".")[0]} | {a.name.split(".")[0] for a in node.names}
        offenders += sorted(roots & banned)
    assert offenders == [], f"module-scope heavy imports in web/inference.py: {offenders}"


# ---------------------------------------------------------------------------
# Fail-closed configuration (no torch required)
# ---------------------------------------------------------------------------
def test_unconfigured_weights_fail_closed():
    """The default deployment has no weights checked in, so this is the normal
    state -- not an edge case. The engine must refuse rather than guess."""
    engine = InferenceEngine(WebConfig())
    assert engine.is_loaded is False
    with pytest.raises(InferenceUnavailable, match="MODEL_WEIGHTS_PATH"):
        engine.load()


def test_missing_weights_file_fails_closed():
    engine = InferenceEngine(WebConfig(model_weights_path="/nonexistent/b4.pth"))
    with pytest.raises(InferenceUnavailable, match="not found"):
        engine.load()


def test_empty_weights_file_fails_closed():
    """``_resolve_weights_path`` checks ``stat().st_size == 0`` too -- a
    truncated file would otherwise reach torch.load."""
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".pth", delete=False) as handle:
        empty = handle.name
    try:
        engine = InferenceEngine(WebConfig(model_weights_path=empty))
        with pytest.raises(InferenceUnavailable, match="not found"):
            engine.load()
    finally:
        Path(empty).unlink(missing_ok=True)


def test_diagnose_before_load_raises_instead_of_returning_empty():
    """The gRPC handler returned an empty DiagnosisResponse on failure, which
    Java persisted as a fabricated result. This port raises."""
    engine = InferenceEngine(WebConfig())
    with pytest.raises(InferenceUnavailable, match="not loaded"):
        engine.diagnose(b"not-an-image")


def test_empty_image_bytes_rejected():
    engine = InferenceEngine(WebConfig())
    # Force the loaded-state check past so the empty-bytes guard is what runs.
    engine._loaded = object()
    with pytest.raises(ValueError, match="No image data"):
        engine.diagnose(b"")


def test_sha256_mismatch_is_detected_before_registry_lookup(tmp_path):
    """Ordering is observable: a tampered file must report a SHA mismatch, not
    a generic registry rejection (``grpc_server.py:61`` precedes :66)."""
    weights = tmp_path / "b4.pth"
    weights.write_bytes(b"tampered weights")
    engine = InferenceEngine(
        WebConfig(model_weights_path=str(weights), model_weights_sha256="0" * 64)
    )
    with pytest.raises(InferenceUnavailable, match="SHA-256 mismatch"):
        engine.load()


def test_fingerprint_is_lowercased():
    """``normalizeWeightSha256`` (:309-311) lowercases before both the lookup
    and the insert. The in-memory comparison on the write path is
    case-sensitive even though MySQL's collation is not."""
    result = InferenceResult(
        predicted_label="normal", probability=99.0, reliability_score=99,
        description="", top_predictions=[], rejected=False, abstain_reason="",
        quality_score=100, quality_reasons="", is_ood=False, ood_score=0.0,
        ood_status="NOT_EVALUATED", requires_review=False,
        calibrated_probability=99.0, calibration_status=CALIBRATED,
        model_version="efficientnet-b4@1.0.0", weight_sha256="ABCDEF" + "0" * 58,
        preprocess_version="v1", inference_policy_version="p",
    )
    assert result.fingerprint()[1] == "abcdef" + "0" * 58


def test_calibration_status_rejects_unknown_values(tmp_path):
    """``grpc_server.py:74-75`` -- only two values are accepted, and an
    unexpected one must not silently degrade to uncalibrated."""
    calibration = tmp_path / "cal.json"
    calibration.write_text(
        '{"temperature": 1.0, "status": "MAYBE", "model_version": "efficientnet-b4@1.0.0"}',
        encoding="utf-8",
    )
    engine = InferenceEngine(
        WebConfig(model_calibration_path=str(calibration))
    )

    class _Provenance:
        version = "efficientnet-b4@1.0.0"

    with pytest.raises(InferenceUnavailable, match="Calibration status"):
        InferenceEngine._load_calibration(engine._config, _Provenance())


def test_calibration_model_version_must_match_registry(tmp_path):
    """``grpc_server.py:76-77``."""
    calibration = tmp_path / "cal.json"
    calibration.write_text(
        '{"temperature": 1.0, "status": "CALIBRATED", "model_version": "b4@0.0.1"}',
        encoding="utf-8",
    )
    engine = InferenceEngine(WebConfig(model_calibration_path=str(calibration)))

    class _Provenance:
        version = "efficientnet-b4@1.0.0"

    with pytest.raises(InferenceUnavailable, match="does not match"):
        InferenceEngine._load_calibration(engine._config, _Provenance())


def test_missing_calibration_degrades_to_uncalibrated(tmp_path):
    """Deliberate deviation from grpc_server.py:71, which would throw.

    The web layer serves seven endpoints that do not need a model, so it must
    boot without a calibration file. The consequence is recorded: probabilities
    are not temperature-scaled, and ``calibrationStatus`` reports NOT_CALIBRATED
    so the response is self-describing.
    """
    engine = InferenceEngine(WebConfig(model_calibration_path=str(tmp_path / "absent.json")))

    class _Provenance:
        version = "efficientnet-b4@1.0.0"

    temperature, status = InferenceEngine._load_calibration(engine._config, _Provenance())
    assert status == NOT_CALIBRATED
    assert temperature == 1.0


def test_registry_rejection_is_wrapped_as_inference_unavailable():
    """``resolve_current`` raises ``RuntimeError``; the engine must not leak
    that type to callers, which only handle ``InferenceUnavailable``."""
    import tempfile
    from pathlib import Path as _Path

    with tempfile.NamedTemporaryFile(suffix=".pth", delete=False) as handle:
        weights = _Path(handle.name)
        weights.write_bytes(b"x" * 128)

    # The checked-in registry has an empty allow_sha256, so this must reject.
    engine = InferenceEngine(
        WebConfig(
            model_weights_path=str(weights),
            model_registry_path=str(ALGORITHM_ROOT / "checkpoints" / "registry.json"),
        )
    )
    try:
        with pytest.raises(InferenceUnavailable) as excinfo:
            engine.load()
        assert "SHA-256" in str(excinfo.value) or "allow" in str(excinfo.value)
    finally:
        weights.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Temp-file handling -- no torch needed
# ---------------------------------------------------------------------------
def test_temp_file_gets_a_png_suffix_for_png_content_type():
    from web.inference import InferenceEngine as E

    path = E._write_temp_file(b"data", "image/png")
    try:
        assert path.endswith(".png")
    finally:
        Path(path).unlink(missing_ok=True)


@pytest.mark.parametrize(
    "content_type,suffix",
    [(None, ".jpg"), ("image/jpeg", ".jpg"), ("", ".jpg"),
     ("image/PNG", ".png"), ("IMAGE/PNG; charset=binary", ".png")],
)
def test_temp_file_suffix_selection(content_type, suffix):
    path = InferenceEngine._write_temp_file(b"data", content_type)
    try:
        assert path.endswith(suffix)
    finally:
        Path(path).unlink(missing_ok=True)


def test_temp_file_contains_exact_bytes():
    payload = b"\x89PNG\r\n\x1a\n" + b"payload"
    path = InferenceEngine._write_temp_file(payload, "image/png")
    try:
        assert Path(path).read_bytes() == payload
    finally:
        Path(path).unlink(missing_ok=True)


def test_silent_unlink_never_raises():
    """Cleanup runs in a ``finally`` -- it must not mask the inference error
    that triggered it."""
    from web.inference import _silent_unlink

    _silent_unlink("/nonexistent/path/to/image.jpg")


# ---------------------------------------------------------------------------
# Numerical behaviour -- needs numpy
#
# The skip is per-test rather than module-level: a module-level
# ``importorskip`` here would silently skip the ~25 fail-closed and
# import-safety tests above on a machine without numpy, which is exactly the
# situation the ``python-web`` CI job runs in.
# ---------------------------------------------------------------------------
requires_numpy = pytest.mark.skipif(
    importlib.util.find_spec("numpy") is None, reason="numerical tests need numpy"
)


@requires_numpy
def test_softmax_matches_grpc_server_formula():
    import numpy as np
    """grpc_server.py:107-112: max-subtracted exp, normalised. Temperature is
    NOT applied when the engine is uncalibrated."""
    engine = InferenceEngine(WebConfig())

    class _Loaded:
        temperature = 1.0
        temperature_applied = False

    logits = np.array([1.0, 2.0, 3.0])
    result = engine._softmax(logits, _Loaded())
    assert result.sum() == pytest.approx(1.0)
    assert result.argmax() == 2
    # Matches an independent computation.
    expected = np.exp(logits - logits.max())
    np.testing.assert_allclose(result, expected / expected.sum())


@requires_numpy
def test_softmax_is_numerically_stable_for_large_logits():
    """Without the max-subtraction, exp(800) overflows to inf and the whole
    vector becomes nan. This is the reason for the subtraction."""
    import numpy as np

    engine = InferenceEngine(WebConfig())

    class _Loaded:
        temperature = 1.0
        temperature_applied = False

    result = engine._softmax(np.array([800.0, 801.0, 802.0]), _Loaded())
    assert np.all(np.isfinite(result))
    assert result.sum() == pytest.approx(1.0)


@requires_numpy
def test_temperature_scaling_sharpens_the_distribution():
    """T < 1 sharpens; the argmax must not move, only the margins."""
    import numpy as np

    engine = InferenceEngine(WebConfig())

    class _Loaded:
        temperature = 0.5
        temperature_applied = True

    logits = np.array([1.0, 2.0, 3.0])
    scaled = engine._softmax(logits, _Loaded())

    class _Uncalibrated:
        temperature = 1.0
        temperature_applied = False

    plain = engine._softmax(logits, _Uncalibrated())
    assert scaled.argmax() == plain.argmax()
    assert scaled.max() > plain.max()


@requires_numpy
def test_rank_returns_all_eight_classes_descending():
    import numpy as np

    engine = InferenceEngine(WebConfig())
    probabilities = np.array([0.1, 0.05, 0.3, 0.02, 0.2, 0.15, 0.04, 0.13])
    ranked = engine._rank(probabilities)
    assert len(ranked) == 8
    assert [label for label, _ in ranked] == [
        "cataract", "glaucoma", "hypertension", "other", "normal", "amd", "myopia", "diabetes"
    ]
    values = [value for _, value in ranked]
    assert values == sorted(values, reverse=True)


@requires_numpy
def test_probabilities_are_floats_not_numpy_scalars():
    """numpy scalars leak into JSON badly and break ``==`` comparisons in
    tests; ``_rank`` casts with ``float()`` for exactly this reason."""
    import numpy as np

    engine = InferenceEngine(WebConfig())
    for _, value in engine._rank(np.array([0.25] * 8)):
        assert type(value) is float


def test_unit_mismatch_is_documented_and_guarded():
    """The abstain thresholds operate on 0-1 values while the response reports
    percent. This test pins the threshold constants so the two scales cannot be
    silently reconciled."""
    abstain_source = (ALGORITHM_ROOT / "eye_diagnosis" / "abstain.py").read_text(encoding="utf-8")
    assert "CONFIDENCE_REVIEW_THRESHOLD = 0.7" in abstain_source
    assert "< 0.15" in abstain_source

    # ...and the response reports 0-100. The warning is a `#:` comment on the
    # field, which does not survive into any runtime __doc__, so the source
    # lines around the annotation are what gets checked.
    lines = (ALGORITHM_ROOT / "web" / "inference.py").read_text(encoding="utf-8").splitlines()
    index = next(
        i for i, line in enumerate(lines) if line.strip() == "probability: float"
    )
    field_block = "\n".join(lines[index - 2 : index + 1])
    assert "0-100" in field_block, field_block

    # The percent conversion itself is not optional.
    assert "probability=top1 * 100" in "\n".join(lines)
