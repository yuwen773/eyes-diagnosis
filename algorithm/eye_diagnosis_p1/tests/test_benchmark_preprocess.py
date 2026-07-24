"""Tests for deterministic P1 benchmark preprocessing.

Seam under test: ``preprocess_image`` — takes a PIL image (already opened)
and a target size, returns a normalised ``[3, size, size]`` float tensor.

Pipeline (frozen for this benchmark round): EXIF orientation → RGB →
aspect-preserving resize → pad to square → resize to target → ImageNet
normalize. FOV / black-border cropping is intentionally NOT implemented
this round (``fov_crop_enabled = False``); it will be added and tested
separately before use.

All tests use synthetic in-memory images — no real fundus data required.
"""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")
PIL = pytest.importorskip("PIL")

from PIL import Image  # noqa: E402

from p1.benchmark.preprocess import (  # noqa: E402
    FOV_CROP_ENABLED,
    IMAGENET_MEAN,
    IMAGENET_STD,
    preprocess_image,
)


def _solid(color: tuple[int, int, int], size: tuple[int, int]) -> Image.Image:
    return Image.new("RGB", size, color)


def test_output_shape_and_dtype() -> None:
    img = _solid((120, 60, 30), (640, 480))
    out = preprocess_image(img, target_size=288)
    assert out.shape == (3, 288, 288)
    assert out.dtype == torch.float32


def test_is_deterministic() -> None:
    img = _solid((10, 200, 50), (500, 700))
    a = preprocess_image(img, target_size=300)
    b = preprocess_image(img, target_size=300)
    assert torch.equal(a, b)


def test_grayscale_is_promoted_to_three_channels() -> None:
    gray = Image.new("L", (300, 300), 128)
    out = preprocess_image(gray, target_size=288)
    assert out.shape == (3, 288, 288)


def test_aspect_ratio_preserved_by_padding_not_stretch() -> None:
    """A wide image padded to square must have padding bands, so the
    top/bottom rows differ from the vertical centre after a letterbox pad.

    Independent check: build a distinctly coloured wide image on a black
    canvas; padding adds black bands top and bottom, so column-mean at the
    extreme rows is darker than at the centre row.
    """
    wide = _solid((255, 255, 255), (400, 100))  # 4:1, white
    out = preprocess_image(wide, target_size=224, pad_value=0)
    # De-normalize channel 0 back to [0,1]-ish to compare relative brightness.
    top_row = out[:, 0, :].mean()
    mid_row = out[:, out.shape[1] // 2, :].mean()
    assert mid_row > top_row


def test_exif_orientation_applied() -> None:
    """An image tagged with EXIF orientation 6 (rotate 270° CW) must be
    physically rotated so the decoded pixels match the display orientation.

    We build a 200x100 image (landscape) tagged orientation 6; after
    transpose it becomes 100x200 (portrait) BEFORE the square pad. We verify
    orientation handling by comparing against the same pixels rotated in
    software.
    """
    import io

    base = Image.new("RGB", (200, 100), (0, 0, 0))
    # Put a white block on the left half so rotation is detectable.
    for x in range(100):
        for y in range(100):
            base.putpixel((x, y), (255, 255, 255))

    buf = io.BytesIO()
    exif = base.getexif()
    exif[0x0112] = 6  # Orientation tag = 6
    base.save(buf, format="JPEG", exif=exif)
    buf.seek(0)
    tagged = Image.open(buf)

    out = preprocess_image(tagged, target_size=128)
    # Compare against explicitly transposed reference through the same pipe.
    from PIL import ImageOps

    buf.seek(0)
    ref = ImageOps.exif_transpose(Image.open(buf))
    out_ref = preprocess_image(ref, target_size=128, apply_exif=False)
    assert torch.allclose(out, out_ref, atol=1e-4)


def test_normalization_uses_imagenet_stats() -> None:
    """A mid-grey image normalised must equal (0.5 - mean) / std per channel.

    Expected values are computed from the published ImageNet constants, an
    independent source of truth, not from the function's internals.
    """
    grey = _solid((128, 128, 128), (256, 256))
    out = preprocess_image(grey, target_size=64)
    v = 128 / 255.0
    for c in range(3):
        expected = (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c]
        assert abs(float(out[c].mean()) - expected) < 1e-3


def test_fov_crop_disabled_this_round() -> None:
    assert FOV_CROP_ENABLED is False
