"""Picture upload to Tencent COS -- a port of ``manager/FileManager.java``.

Behavioural parity notes
------------------------
**URL shape.** Java builds ``uploadPath = "/{prefix}/{name}"`` and then
``url = host + "/" + uploadPath``, which yields a *double slash* between host
and path (``https://bucket.cos...//public/1/20250101_....jpg``). That is what
is stored in ``t_user.userAvatar`` and ``t_diagnosis.url`` today. It is
reproduced verbatim rather than tidied: these URLs are persisted and rendered,
and normalizing only the new ones would leave two shapes in the same column.

**Image dimensions.** Java reads width/height/format from Tencent CI's
``ImageInfo``, i.e. server-side analysis of the stored object. Python reads them
from the bytes with Pillow before uploading, which yields the same values for
the four allowed formats without a CI round-trip.

**Random suffix.** Java uses ``RandomUtil.randomNumbers(16)`` -- 16 *digits*,
not a UUID. The generator uses ``random`` from the standard library for the
same shape.
"""

import io
import logging
import random
from dataclasses import dataclass
from datetime import datetime

from web.constant import (  # noqa: F401  (re-exported for call sites)
    FAIL_UPLOAD,
    FILE_CAN_NOT_BE_NULL,
    FILE_SIZE_ERROR,
    FILE_TYPE_ERROR,
    ONE_M,
)
from web.response import BizError, ErrorCode

logger = logging.getLogger(__name__)

#: FileConstant.ALLOW_FILE_SUFFIX -- lowercase, no leading dot.
ALLOW_FILE_SUFFIX = ("jpg", "jpeg", "png", "webp")

#: FileConstant validation caps.
MAX_PICTURE_BYTES = 2 * ONE_M

#: Length of RandomUtil.randomNumbers(16).
_RANDOM_DIGITS = 16


@dataclass
class UploadPictureDetail:
    """``model/dto/file/UploadPictureDetail.java``."""

    url: str
    pic_width: int
    pic_height: int
    #: Rounded to 2 decimals, matching ``NumberUtil.round(x, 2)``.
    pic_scale: float
    pic_format: str
    pic_size: int


def file_suffix(original_filename: str | None) -> str:
    """``FileUtil.getSuffix`` -- substring after the last dot, lowercased.

    Hutool returns the text after the final ``.``; a name with no dot yields
    the empty string, which then fails the suffix allow-list.
    """
    if not original_filename:
        return ""
    return original_filename.rsplit(".", 1)[-1] if "." in original_filename else ""


def validate_picture(original_filename: str | None, size: int) -> None:
    """Port of ``FileManager#validPicture``, in the same order.

    Order is observable: a 3 MB ``.exe`` reports the size error, not the type
    error.
    """
    if original_filename is None:
        raise BizError(ErrorCode.PARAMS_ERROR, FILE_CAN_NOT_BE_NULL)
    if size > MAX_PICTURE_BYTES:
        raise BizError(ErrorCode.PARAMS_ERROR, FILE_SIZE_ERROR)
    if file_suffix(original_filename).lower() not in ALLOW_FILE_SUFFIX:
        raise BizError(ErrorCode.PARAMS_ERROR, FILE_TYPE_ERROR)


def build_upload_path(upload_path_prefix: str, original_filename: str | None) -> str:
    """Port of ``FileManager#uploadPicture``'s path construction.

    ``DateUtil.formatDate(new Date())`` is ``yyyyMMdd``.
    """
    suffix = file_suffix(original_filename).lower()
    name = "{}_{}.{}".format(
        datetime.now().strftime("%Y%m%d"),
        "".join(random.choices("0123456789", k=_RANDOM_DIGITS)),
        suffix,
    )
    return "/{}/{}".format(upload_path_prefix, name)


def read_image_metadata(data: bytes) -> tuple[int, int, str]:
    """``(width, height, format)`` from raw bytes.

    Replaces CI's ``ImageInfo``. A corrupt image raises, which the caller turns
    into the same ``SYSTEM_ERROR``/``FAIL_UPLOAD`` the Java catch-all produces.

    Pillow is imported lazily: it is only needed on the upload path, and
    keeping it out of module scope means ``create_app()`` still builds in a CI
    job that installs neither Pillow nor torch.
    """
    from PIL import Image

    with Image.open(io.BytesIO(data)) as image:
        return image.width, image.height, (image.format or "").lower()


async def upload_picture(data: bytes, original_filename: str | None, prefix: str) -> UploadPictureDetail:
    """Validate, upload and describe a picture.

    ``prefix`` is the caller's namespace -- ``public/{userId}`` for avatars,
    ``public/diagnosis/image`` for diagnosis images.
    """
    validate_picture(original_filename, len(data))

    upload_path = build_upload_path(prefix, original_filename)

    # Read dimensions before uploading: a corrupt file then costs nothing
    # remotely, and matches Java's failure mode (Java uploads first and reads
    # CI metadata back, so a CI failure surfaces as FAIL_UPLOAD).
    try:
        width, height, image_format = read_image_metadata(data)
    except Exception:  # noqa: BLE001 - mirrors Java's catch-all around the upload
        logger.exception("failed to read image metadata")
        raise BizError(ErrorCode.SYSTEM_ERROR, FAIL_UPLOAD) from None

    config = _current_config()
    try:
        import qcloud_cos

        client = qcloud_cos.CosConfig(
            Region=config.cos_region, SecretId=config.cos_secret_id, SecretKey=config.cos_secret_key
        )
        cos = qcloud_cos.CosS3Client(client)
        cos.put_object(
            Bucket=config.cos_bucket,
            Key=upload_path.lstrip("/"),
            Body=data,
        )
    except BizError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("COS upload failed for %s", upload_path)
        raise BizError(ErrorCode.SYSTEM_ERROR, FAIL_UPLOAD) from None

    return UploadPictureDetail(
        # Double slash preserved -- see the module docstring.
        url=f"{config.cos_host}/{upload_path}",
        pic_width=width,
        pic_height=height,
        pic_scale=round(width * 1.0 / height, 2) if height else 0.0,
        pic_format=image_format,
        pic_size=len(data),
    )


def _current_config():
    from web.deps import get_config

    return get_config()
