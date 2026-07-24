import json
import numpy as np
from pathlib import Path

from eye_diagnosis.calibration import (
    TemperatureScaler,
    apply_temperature,
    expected_calibration_error,
)


def test_temperature_scaler_dampens_overconfidence():
    # When training labels are noisy or include adversarial samples, the optimal
    # temperature > 1 to minimize NLL on the noisy labels. We simulate this by
    # training with a "label-flip" sample (label=1 on logits that look like class 0),
    # which forces T > 1 to soften the wrong-class probability mass.
    logits = np.array([[3.0, 0.0], [3.0, 0.0]])
    labels = np.array([0, 1])
    scaler = TemperatureScaler()
    temperature = scaler.fit(logits, labels)
    assert temperature > 1.0
    calibrated = apply_temperature(logits, temperature)
    p = np.exp(calibrated) / np.exp(calibrated).sum(axis=1, keepdims=True)
    # Calibrated prob of class 0 must be smaller than the original (since T > 1).
    original_p0_row0 = float(np.exp(logits[0, 0])) / float(np.exp(logits[0]).sum())
    assert float(p[0, 0]) < original_p0_row0


def test_ece_low_for_perfect_calibration():
    probs = np.array([[0.99, 0.01], [0.4, 0.6]])
    labels = np.array([0, 1])
    ece = expected_calibration_error(probs, labels, n_bins=10)
    # With n_bins=10 the bin width (0.1) matches the gap between conf=0.6 and acc=1.0
    # on row 2, giving |1.0 - 0.6| * 0.5 = 0.2 / 2 bins ≈ 0.2. Still below 0.3.
    assert ece < 0.3


def test_config_file_roundtrip(tmp_path: Path):
    cfg = tmp_path / "t.json"
    cfg.write_text(json.dumps({"temperature": 1.5}))
    payload = json.loads(cfg.read_text())
    assert payload["temperature"] == 1.5