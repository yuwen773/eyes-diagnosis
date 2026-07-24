import io
from PIL import Image
import numpy as np

from eye_diagnosis.quality import evaluate_quality, QualityVerdict


def _to_png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def _make_image(w: int, h: int, value: int = 80) -> bytes:
    arr = np.full((h, w, 3), value, dtype=np.uint8)
    return _to_png(arr)


def test_uniform_image_is_rejected_for_blur():
    image = _make_image(380, 380, value=80)
    report = evaluate_quality(image)
    assert report.verdict is QualityVerdict.REJECTED
    assert "blur" in report.reasons


def test_black_image_is_rejected_for_brightness():
    image = _make_image(380, 380, value=8)
    report = evaluate_quality(image)
    assert report.verdict is QualityVerdict.REJECTED
    assert "brightness" in report.reasons


def test_typical_fundus_is_accepted():
    rng = np.random.default_rng(0)
    arr = rng.integers(60, 150, size=(380, 380, 3), dtype=np.uint8)
    arr[60:320, 60:320, :] = rng.integers(40, 120, size=(260, 260, 3), dtype=np.uint8)
    report = evaluate_quality(_to_png(arr))
    assert report.verdict is QualityVerdict.ACCEPTED
    assert 0 <= report.score <= 100
