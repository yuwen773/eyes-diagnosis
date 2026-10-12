"""Inference configuration contract tests (Phase 2.2).

The critical property here is **import safety**: ``web.config`` must stay
importable without torch/numpy/PIL, because the ``python-web`` CI job installs
``requirements-web.txt`` only and still has to build the app and exercise the
exception envelope. ``mcp_server/config.py`` shows what happens when that rule is
broken -- it does ``import torch`` at module scope.
"""

import subprocess
import sys
from pathlib import Path

import pytest

ALGORITHM_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.config import QUALITY_GATE_MODES, WebConfig  # noqa: E402


def test_web_config_does_not_import_torch():
    """Import in a subprocess so an already-imported torch cannot mask it."""
    code = (
        "import sys; sys.path.insert(0, %r);"
        "import web.config;"
        "heavy = [m for m in ('torch','torchvision','numpy','PIL') if m in sys.modules];"
        "print(','.join(heavy))" % str(ALGORITHM_ROOT)
    )
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, cwd=str(ALGORITHM_ROOT)
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "", (
        f"web.config pulled in heavy modules: {result.stdout.strip()}"
    )


def test_web_config_module_has_no_heavy_source_imports():
    """A source-level check, so it holds even on a machine that happens to have
    torch installed (which would mask the subprocess test above).

    Matches only real statements at line start, not the docstring/comments that
    discuss *why* torch must stay out -- the file deliberately mentions it.
    """
    source = (ALGORITHM_ROOT / "web" / "config.py").read_text(encoding="utf-8")
    statements = [
        line.strip()
        for line in source.splitlines()
        if line.strip().startswith(("import ", "from ")) and not line.strip().startswith("#")
    ]
    banned = ("torch", "torchvision", "numpy", "PIL")
    offenders = [s for s in statements if s.split()[1].split(".")[0] in banned]
    assert offenders == [], f"web/config.py has heavy module-scope imports: {offenders}"


# ---------------------------------------------------------------------------
# Fingerprint defaults
# ---------------------------------------------------------------------------
def test_fingerprint_defaults_match_java_application_yml():
    """application.yml:86-89. A deployment that sets neither env var must still
    write the same fingerprint tuple, or every cached row becomes unreachable."""
    config = WebConfig()
    assert config.model_version == "efficientnet-b4@1.0.0"
    assert config.preprocess_version == "v1"
    assert config.inference_policy_version == "medical-safety-v3-quality-observe"


def test_fingerprint_matches_the_registry_file():
    """checkpoints/registry.json is the authority for model_version and
    preprocess_version; config defaults must agree or the cache key and the
    response fingerprint disagree."""
    import json

    registry = json.loads(
        (ALGORITHM_ROOT / "checkpoints" / "registry.json").read_text(encoding="utf-8")
    )
    config = WebConfig()
    assert config.model_version == registry["model_version"]
    assert config.preprocess_version == registry["preprocess_version"]


def test_weight_sha_is_trimmed_and_lowercased():
    """Mirrors ``normalizeWeightSha256`` (:309-311). Case matters on the
    in-memory write-path comparison even though MySQL's collation would not
    care."""
    assert WebConfig(model_weights_sha256="  ABCDEF  ").model_weights_sha256 == "abcdef"


def test_empty_weight_sha_is_preserved_as_empty():
    """Java leaves it empty by default, which disables the cache. It must not
    become None or 'None'."""
    assert WebConfig().model_weights_sha256 == ""
    assert WebConfig(model_weights_sha256="").model_weights_sha256 == ""


def test_weights_path_defaults_to_empty_not_none():
    """Empty string means "not configured" -- the app boots and fails closed at
    request time. ``None`` would break the truthiness checks downstream."""
    assert WebConfig().model_weights_path == ""


# ---------------------------------------------------------------------------
# Quality gate mode
# ---------------------------------------------------------------------------
def test_quality_gate_mode_defaults_to_observe():
    """observe records reasons without rejecting -- the safe default, and the
    one every checked-in config uses."""
    assert WebConfig().quality_gate_mode == "observe"


@pytest.mark.parametrize("mode", sorted(QUALITY_GATE_MODES))
def test_valid_quality_gate_modes_accepted(mode):
    assert WebConfig(quality_gate_mode=mode).quality_gate_mode == mode


@pytest.mark.parametrize("mode", ["", "ENFORCE", "Observe", "on", "off", "reject"])
def test_invalid_quality_gate_mode_rejected(mode):
    """``abstain.should_reject_for_quality`` raises ValueError on an unknown
    mode; failing at construction gives a clearer message and an earlier
    signal than failing on the first upload."""
    with pytest.raises(ValueError, match="quality_gate_mode"):
        WebConfig(quality_gate_mode=mode)


def test_quality_gate_mode_set_matches_the_abstain_module():
    """Guard against the two copies drifting. ``abstain.py`` pulls numpy, so it
    cannot be imported by ``web/config.py`` -- this test can, because pytest
    runs with whatever the developer has installed."""
    abstain_source = (ALGORITHM_ROOT / "eye_diagnosis" / "abstain.py").read_text(encoding="utf-8")
    assert "QUALITY_GATE_MODES" in abstain_source
    # Both must accept exactly {"observe", "enforce"}.
    assert QUALITY_GATE_MODES == {"observe", "enforce"}


# ---------------------------------------------------------------------------
# from_env
# ---------------------------------------------------------------------------
def test_from_env_reads_grpc_server_variable_names(monkeypatch):
    """The names grpc_server.py already uses, so a deployment tuned for the
    gRPC service works unchanged after the cutover."""
    monkeypatch.setenv("MODEL_WEIGHTS_PATH", "/tmp/b4.pth")
    monkeypatch.setenv("MODEL_WEIGHTS_SHA256", "AABBCC")
    monkeypatch.setenv("MODEL_REGISTRY_PATH", "/tmp/registry.json")
    monkeypatch.setenv("QUALITY_GATE_MODE", "enforce")
    monkeypatch.setenv("INFERENCE_CACHE_ENABLED", "false")

    config = WebConfig.from_env()
    assert config.model_weights_path == "/tmp/b4.pth"
    assert config.model_weights_sha256 == "aabbcc"
    assert config.model_registry_path == "/tmp/registry.json"
    assert config.quality_gate_mode == "enforce"
    assert config.inference_cache_enabled is False


@pytest.mark.parametrize(
    "raw,expected",
    [("true", True), ("1", True), ("yes", True), ("on", True),
     ("false", False), ("0", False), ("no", False), ("off", False)],
)
def test_inference_cache_enabled_parses_truthy_strings(monkeypatch, raw, expected):
    monkeypatch.setenv("INFERENCE_CACHE_ENABLED", raw)
    assert WebConfig.from_env().inference_cache_enabled is expected


def test_from_env_defaults_match_the_constructor(monkeypatch):
    """A config built from the environment must equal one built from defaults
    when the environment is empty."""
    for name in (
        "MODEL_WEIGHTS_PATH", "MODEL_WEIGHTS_SHA256", "MODEL_REGISTRY_PATH",
        "MODEL_CALIBRATION_PATH", "MODEL_VERSION", "PREPROCESS_VERSION",
        "INFERENCE_POLICY_VERSION", "QUALITY_GATE_MODE", "INFERENCE_CACHE_ENABLED",
    ):
        monkeypatch.delenv(name, raising=False)
    from_env_config = WebConfig.from_env()
    assert from_env_config.model_weights_path == WebConfig().model_weights_path
    assert from_env_config.quality_gate_mode == WebConfig().quality_gate_mode
    assert from_env_config.inference_policy_version == WebConfig().inference_policy_version


# ---------------------------------------------------------------------------
# Secret redaction
# ---------------------------------------------------------------------------
def test_repr_redacts_the_weight_sha():
    """A full 64-char SHA in a log line is a fingerprint of the exact binary
    being served; only a short prefix is useful for debugging."""
    sha = "abcdef0123456789" + "0" * 48
    text = repr(WebConfig(model_weights_sha256=sha))
    assert sha not in text
    # 12 chars + the ellipsis, matching the slice in WebConfig.__repr__.
    assert f"{sha[:12]}..." in text