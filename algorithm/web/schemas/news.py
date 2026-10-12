"""News-domain DTOs and VO.

Wire contract:

* ``id`` is ``Long`` -> JSON **string** (``response.LongStr``).
* ``publishTime`` is ``java.util.Date`` -> ``"yyyy-MM-dd HH:mm:ss"``.
* ``status`` is ``Integer`` -> JSON **number**.

The one non-obvious mapping is ``coverImage``. The column is ``coverImg`` and
the VO field is ``coverImage``; Spring/Hutool ``copyProperties`` matches by
property name, so the bean copy silently misses and Java papers over it with an
explicit ``newsVO.setCoverImage(news.getCoverImg())``
(``NewsServiceImpl.java:97``). Python has no bean copy, so the mapping is
explicit here -- same result, no reliance on name coincidence.
"""

from pydantic import BaseModel, ConfigDict, Field

from web.constant import DESC
from web.response import JavaDateTimeStr, EntityVO, LongStr


class NewsQueryDTO(BaseModel):
    """``NewsQueryDTO.java`` -- ``extends common/PageRequest.java``.

    ``userRole`` is accepted and ignored: ``getNewsQueryWrapper`` never reads it.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None
    #: Substring match against the title.
    title: str | None = None
    #: Substring match against the derived summary.
    summary: str | None = None
    userRole: str | None = None

    current: int = 1
    pageSize: int = 10
    sortField: str | None = None
    sortOrder: str = DESC


class NewsUpdateDTO(BaseModel):
    """``NewsUpdateDTO.java``.

    ``coverImage`` is declared but **deliberately not written**.

    ``BeanUtils.copyProperties(newsUpdateDTO, news)`` matches properties by
    name; the DTO says ``coverImage`` and the entity says ``coverImg``, so the
    copy silently drops it. The frontend sends the field on every save
    (``NewsEditPage.vue:109``) and nothing ever complains -- it works only
    because the cover was already persisted by ``POST /news/uploadCover`` in a
    separate step. Reproduced as-is: honouring it here would be a behaviour
    change, not a port. See ruling 21.
    """

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None
    title: str | None = None
    content: str | None = None
    #: 0 draft / 1 published / 2 unpublished. **Not** exposed on the VO, so the
    #: public list shows drafts alongside published articles -- see ruling 22.
    status: int | None = None
    coverImage: str | None = None


class NewsUploadDTO(BaseModel):
    """``NewsUploadDTO.java`` -- one ``id``, used by ``/uploadCover`` to decide
    between insert and update."""

    model_config = ConfigDict(extra="ignore")

    id: LongStr | None = None


class NewsVO(EntityVO):
    """``model/vo/news/NewsVO.java`` -- 8 fields.

    ``author``/``avatar`` are enriched from ``t_user`` on every read.
    ``coverImage`` comes from the ``coverImg`` column. ``status`` is
    deliberately absent -- ``NewsVO`` does not declare it, so the frontend
    cannot tell a draft from a published article.
    """

    id: LongStr
    title: str
    author: str | None = None
    avatar: str | None = None
    content: str | None = None
    summary: str | None = None
    #: Column is ``coverImg``, VO field is ``coverImage`` -- the mismatch that
    #: makes Java's bean copy miss it (see the module docstring). Needs an
    #: explicit alias because the mechanical camelCase->snake_case transform in
    #: ``EntityVO`` yields ``cover_image``, which no ORM attribute has.
    coverImage: str | None = Field(default=None, validation_alias="cover_img")
    publishTime: JavaDateTimeStr | None = None


#: ``NewsController.java:156`` -- ``content.substring(0, 30)``.
SUMMARY_LENGTH = 30


def derive_summary(content: str | None) -> str | None:
    """First 30 characters of the body, or ``None`` when there is no body.

    Java computes this with ``content.substring(0, 30)``, which throws
    ``StringIndexOutOfBoundsException`` for any article shorter than 30
    characters -- reachable from the admin editor, which imposes no minimum
    length. The catch-all then reports ``50000``/``系统错误`` and the save is
    lost.

    The slice is made safe here. This is a deliberate deviation: it turns a
    server fault into a successful save of a short article, and the stored
    summary is identical to what Java would have produced had it not crashed.
    """
    if content is None:
        return None
    return content[:SUMMARY_LENGTH]


def is_ascending(sort_order: str | None) -> bool:
    """``sortOrder.equals(ASC)`` -- anything but the literal ``"ascend"``
    sorts descending, including ``None``.

    ``NewsServiceImpl.java:69`` guards the ORDER BY with ``isNotEmpty``
    (whitespace counts) where the diagnosis domain uses ``isNotBlank``. So a
    whitespace-only ``sortField`` reaches Java's SQL as a blank column name and
    the query fails with a syntax error. Resolving ``sortField`` against the
    table's columns (see the router) turns that into a plain unsorted query,
    which is the same outcome as the blank-value case.
    """
    return sort_order == "ascend"
