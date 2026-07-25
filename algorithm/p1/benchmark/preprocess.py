"""Deterministic preprocessing for the P1-01c benchmark.

Pipeline (frozen for this benchmark round)::

    EXIF orientation → RGB → aspect-preserving resize → pad to square
    → resize to target → ImageNet normalize

Design notes
------------
- **Deterministic**: no random crops, flips, colour jitter. The same image
  and target size always yield the same tensor. Augmentations are prohibited
  in the P1 protocol.
- **FOV / black-border crop is DISABLED this round** (``FOV_CROP_ENABLED =
  False``). The fundus field-of-view crop is not yet implemented and tested;
  per the P1-01c scope, we do not ship an unverified version. The benchmark
  artifacts record ``fov_crop_enabled: false`` so a future FOV-enabled I/O
  run is distinguishable.
- Uses only Pillow + torch (no torchvision transforms) so the exact
  arithmetic is explicit and auditable.
"""

from __future__ import annotations

import torch
from PIL import Image, ImageOps

# Whether the fundus field-of-view crop is applied. Frozen False this round.
FOV_CROP_ENABLED: bool = False

# Published ImageNet normalisation constants (independent source of truth).
IMAGENET_MEAN: tuple[float, float, float] = (0.485, 0.456, 0.406)
IMAGENET_STD: tuple[float, float, float] = (0.229, 0.224, 0.225)


def _resize_keep_aspect(img: Image.Image, target: int) -> Image.Image:
    """Resize so the longer side == ``target``, preserving aspect ratio."""
    w, h = img.size
    if w >= h:
        new_w = target
        new_h = max(1, round(h * target / w))
    else:
        new_h = target
        new_w = max(1, round(w * target / h))
    return img.resize((new_w, new_h), Image.BILINEAR)


def _pad_to_square(img: Image.Image, target: int, pad_value: int) -> Image.Image:
    """Centre-pad ``img`` onto a ``target × target`` canvas."""
    canvas = Image.new("RGB", (target, target), (pad_value, pad_value, pad_value))
    w, h = img.size
    left = (target - w) // 2
    top = (target - h) // 2
    canvas.paste(img, (left, top))
    return canvas


def preprocess_image(
    img: Image.Image,
    *,
    target_size: int,
    pad_value: int = 0,
    apply_exif: bool = True,
) -> torch.Tensor:
    """Deterministically preprocess a PIL image to a normalised tensor.

    Parameters
    ----------
    img:
        An opened PIL image (any mode).
    target_size:
        Output square side length (e.g. 288 / 300 / 380).
    pad_value:
        0–255 grey level used for letterbox padding.
    apply_exif:
        Apply EXIF orientation transpose. Default ``True``; tests set it
        ``False`` to feed a pre-transposed reference.

    Returns
    -------
    torch.Tensor
        ``[3, target_size, target_size]`` float32, ImageNet-normalised.
    """
    if apply_exif:
        img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")

    img = _resize_keep_aspect(img, target_size)
    img = _pad_to_square(img, target_size, pad_value)

    # HWC uint8 → CHW float in [0,1]. bytearray gives a writable buffer.
    tensor = torch.frombuffer(bytearray(img.tobytes()), dtype=torch.uint8)
    tensor = tensor.view(target_size, target_size, 3).permute(2, 0, 1).contiguous()
    tensor = tensor.to(torch.float32) / 255.0

    mean = torch.tensor(IMAGENET_MEAN, dtype=torch.float32).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=torch.float32).view(3, 1, 1)
    return (tensor - mean) / std
