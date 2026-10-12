"""``/news`` routes -- all 7 endpoints in ``NewsController.java``.

Four things in this domain are worth knowing before reading the code:

1. **Delete is physical.** ``News.java`` has no ``isDelete`` field and no
   ``@TableLogic`` annotation, and ``t_news`` has no such column -- so
   ``removeById`` issues a real ``DELETE``. This is the opposite of
   ``/user/delete/{id}`` and ``/diagnosis/delete/{id}``, which are logical.
2. **There is no create endpoint.** All 7 routes read, update or delete. The
   only INSERT paths are ``/uploadCover`` (which cannot succeed, see below) and
   ``/edit`` (which is an UPDATE, so a missing id fails). Articles must have
   been inserted out of band. See ruling 20.
3. **The cache key contains a space.** ``NewsController.java:87`` builds
   ``diagnosis:listNewsVOByPage {md5}`` -- space-separated, no ``v2`` segment,
   unlike the user and diagnosis keys. Reproduced verbatim: a different key
   means the two services simply do not share entries, and Nginx routes the
   path to exactly one of them anyway.
4. **Nothing filters by ``status``.** ``getNewsQueryWrapper`` has no status
   predicate and ``NewsVO`` does not expose the field, so the public list
   serves drafts and unpublished articles alongside live ones. See ruling 22.
"""

import hashlib
import json
import logging
import random
from datetime import datetime
from functools import partial
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from web.auth import LoginUser, require_role
from web.constant import ADMIN_ROLE, PARAMS_IS_NULL
from web.deps import get_db
from web.files import upload_picture
from web.models.news import News
from web.models.user import User
from web.response import BaseResponse, BizError, ErrorCode, PageResult
from web.schemas.news import (
    NewsQueryDTO,
    NewsUpdateDTO,
    NewsUploadDTO,
    NewsVO,
    derive_summary,
    is_ascending,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/news", tags=["news"])

#: ``NewsController.java:140`` -- inline images in the article body.
ATTACHMENT_PREFIX = "news/{user_id}"
#: ``NewsServiceImpl.java:121``.
COVER_PREFIX = "cover/{user_id}"

#: ``NewsController.java:87``. The literal space matters -- it is not a typo to
#: be tidied, and normalising it would silently orphan every existing entry.
_DIAGNOSIS_PAGE_CACHE_PREFIX = "diagnosis:listNewsVOByPage"

_CACHE_TTL_BASE = 300
_CACHE_TTL_JITTER = 300

#: The literal ``GlobalExceptionHandler.java:37`` passes -- not
#: ``ErrorCode.SYSTEM_ERROR.message``.
SYSTEM_ERROR_MESSAGE = "系统错误"

require_admin = partial(require_role, ADMIN_ROLE)


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------
def _author_map(db: Session, user_ids: set[int]) -> dict[int, tuple[str | None, str | None]]:
    """``selectUserNameAndUserAvatarByUserId`` for every author at once.

    Java issues one query per row. Batching them is not a contract change --
    ``UserMapper.xml:5`` selects only ``userName``/``userAvatar`` with **no**
    ``isDelete`` filter, so a logically deleted author still resolves. A missing
    row yields ``(None, None)`` instead of Java's ``NullPointerException``
    (:90), which would 500 the entire news list.
    """
    if not user_ids:
        return {}
    rows = db.execute(
        select(User.id, User.user_name, User.user_avatar).where(User.id.in_(user_ids))
    ).all()
    return {row.id: (row.user_name, row.user_avatar) for row in rows}


def _to_vo(row: News, author: tuple[str | None, str | None] | None) -> NewsVO:
    """``NewsServiceImpl.getNewsVO`` (:83-102).

    ``coverImage`` is assigned explicitly rather than by a bean copy, because
    the VO and the entity disagree on the name.
    """
    return NewsVO(
        id=row.id,
        title=row.title,
        author=author[0] if author else None,
        avatar=author[1] if author else None,
        content=row.content,
        summary=row.summary,
        coverImage=row.cover_img,
        publishTime=row.publish_time,
    )


# ---------------------------------------------------------------------------
# Query wrapper -- NewsServiceImpl:54-72
# ---------------------------------------------------------------------------
def _news_query(query: NewsQueryDTO):
    """``getNewsQueryWrapper``.

    Two things are absent on purpose:

    * **No ``isDelete`` filter.** There is no such column and no ``@TableLogic``
      annotation, unlike the user and diagnosis domains.
    * **No ``status`` filter.** ``status`` exists (0 draft / 1 published /
      2 unpublished) but nothing filters on it and the VO does not expose it,
      so drafts are served publicly. Reproduced -- see ruling 22.

    ``sortField`` is a column name here as everywhere else, resolved against the
    table rather than interpolated.
    """
    stmt = select(News)
    if query.id is not None:
        stmt = stmt.where(News.id == int(query.id))
    if query.title and query.title.strip():
        stmt = stmt.where(News.title.like(f"%{query.title}%"))
    if query.summary and query.summary.strip():
        stmt = stmt.where(News.summary.like(f"%{query.summary}%"))
    if query.sortField and query.sortField.strip():
        column = News.__table__.columns.get(query.sortField)
        if column is not None:
            stmt = stmt.order_by(column.asc() if is_ascending(query.sortOrder) else column.desc())
    return stmt


def _query_page(db: Session, query: NewsQueryDTO) -> PageResult[NewsVO]:
    base = _news_query(query)
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.limit(query.pageSize).offset((query.current - 1) * query.pageSize)
    ).scalars().all()
    authors = _author_map(db, {row.user_id for row in rows})
    return PageResult.of(
        [_to_vo(row, authors.get(row.user_id)) for row in rows],
        total,
        query.pageSize,
        query.current,
    )


# ---------------------------------------------------------------------------
# POST /news/list/page/vo -- public
# ---------------------------------------------------------------------------
@router.post("/list/page/vo", summary="获取分页新闻列表")
def list_news_vo(
    body: NewsQueryDTO,
    db: Session = Depends(get_db),
):
    """``listNewsVOByPage``. No ``@AuthCheck`` -- the news list is public."""
    return BaseResponse.success(_query_page(db, body))


@router.post("/list/page/vo/cache", summary="获取分页新闻列表（缓存版）")
async def list_news_vo_cached(
    request: Request,
    body: NewsQueryDTO,
    db: Session = Depends(get_db),
):
    """``listNewsVOByPageWithCache`` (:76-105).

    The key is ``md5(json(dto))`` with **no user scoping** -- unlike the user
    and diagnosis caches. That is correct here: the payload is public news, so
    there is nothing to leak between users.

    ``json(dto)`` is not byte-identical to Hutool's, so an entry written by Java
    is a miss rather than a misparse. Harmless, and only reachable before
    Nginx finishes the cutover.
    """
    scope = json.dumps(body.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    key = f"{_DIAGNOSIS_PAGE_CACHE_PREFIX} {hashlib.md5(scope.encode('utf-8')).hexdigest()}"

    redis = request.app.state.redis
    cached = await redis.get(key)
    if cached:
        return BaseResponse.success(PageResult[NewsVO].model_validate_json(cached))

    page = _query_page(db, body)
    await redis.setex(key, _CACHE_TTL_BASE + random.randint(0, _CACHE_TTL_JITTER), page.model_dump_json())
    return BaseResponse.success(page)


# ---------------------------------------------------------------------------
# GET /news/get/{id} -- public
# ---------------------------------------------------------------------------
@router.get("/get/{id}", summary="获取新闻详情")
def get_news_vo(
    id: int,
    db: Session = Depends(get_db),
):
    """``getNewsVO`` (:106-114).

    The controller builds the VO *before* the null check, which is safe only
    because ``getNewsVO(null)`` returns null (``NewsServiceImpl.java:84-86``).
    Checked first here.
    """
    if id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    row = db.get(News, id)
    if row is None:
        raise BizError(ErrorCode.NOT_FOUND_ERROR)
    return BaseResponse.success(_to_vo(row, _author_map(db, {row.user_id}).get(row.user_id)))


# ---------------------------------------------------------------------------
# POST /news/delete/{id} -- admin
# ---------------------------------------------------------------------------
@router.post("/delete/{id}", summary="删除新闻")
def delete_news(
    id: int,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """**Physical** delete.

    ``News.java`` carries no ``@TableLogic`` annotation and ``t_news`` has no
    ``isDelete`` column, so MyBatis Plus issues ``DELETE FROM t_news`` and the
    row is gone -- including any ``t_paragraph``/``t_attachment`` rows that
    reference it, since those declare no foreign key constraint in
    ``schema.sql:71-77``. That is the existing behaviour and is reproduced as-is.

    Returns ``false`` for a row that is already gone, as Java does.
    """
    if id <= 0:
        raise BizError(ErrorCode.PARAMS_ERROR)
    deleted = db.execute(
        delete(News).where(News.id == id)
    ).rowcount
    db.flush()
    return BaseResponse.success(deleted > 0)


# ---------------------------------------------------------------------------
# POST /news/uploadAttachment -- admin
# ---------------------------------------------------------------------------
@router.post("/uploadAttachment", summary="上传新闻图片")
async def upload_attachment(
    file: UploadFile = File(...),
    _admin: LoginUser = Depends(require_admin),
):
    """Inline article images.

    Returns a bare URL string, not an object -- the frontend collects the
    result into an array of ``src`` values (``NewsEditPage.vue:91-100``).
    Nothing is written to ``t_news``; ``t_attachment`` is untouched by this
    endpoint despite the table existing.
    """
    data = await file.read()
    detail = await upload_picture(
        data, file.filename, prefix=ATTACHMENT_PREFIX.format(user_id=_admin.id)
    )
    return BaseResponse.success(detail.url)


# ---------------------------------------------------------------------------
# POST /news/edit -- admin
# ---------------------------------------------------------------------------
@router.post("/edit", summary="修改新闻")
def update_news(
    body: NewsUpdateDTO,
    db: Session = Depends(get_db),
    _admin: LoginUser = Depends(require_admin),
):
    """``updateNews`` (:146-164).

    ``saveOrUpdate`` with a non-null id resolves to ``updateById``, which under
    MyBatis Plus's default ``NOT_NULL`` field strategy writes **only the fields
    the DTO populated**. Absent fields are left alone rather than nulled. This
    port builds the UPDATE from the fields actually supplied, which is the
    same rule.

    ``editTime`` is deliberately **not** touched. The DTO has no such field and
    the DDL's ``DEFAULT CURRENT_TIMESTAMP`` applies to INSERT only (there is no
    ``ON UPDATE`` clause), so in Java a news row's edit time reflects the last
    cover upload, not the last edit.

    Two consequences of the faithful port, both existing Java behaviour:

    * Re-saving an article with no actual change reports ``操作失败``.
      ``updateById`` returns the affected-row count, and MySQL counts *changed*
      rows by default, so a no-op UPDATE is 0. The frontend shows "保存失败"
      for an article that was, in fact, saved correctly.
    * ``id`` must already exist. A new id means ``UPDATE`` matches nothing and
      the same ``操作失败`` is returned -- this endpoint cannot create an
      article.
    """
    if body.id is None:
        raise BizError(ErrorCode.PARAMS_ERROR)
    summary = derive_summary(body.content)
    if summary is None:
        # Java NPEs on `getContent().substring(...)` and the catch-all reports
        # 系统错误. `content` is NOT NULL in the DDL, so the write could never
        # have succeeded anyway; a parameter error is the accurate code.
        raise BizError(ErrorCode.PARAMS_ERROR, PARAMS_IS_NULL)

    updates = {"summary": summary}
    if body.title is not None:
        updates["title"] = body.title
    updates["content"] = body.content
    if body.status is not None:
        updates["status"] = body.status

    affected = db.execute(
        update(News).where(News.id == int(body.id)).values(**updates)
    ).rowcount
    db.flush()
    if affected <= 0:
        raise BizError(ErrorCode.OPERATION_ERROR)
    return BaseResponse.success(True)


# ---------------------------------------------------------------------------
# POST /news/uploadCover -- admin
# ---------------------------------------------------------------------------
@router.post("/uploadCover", summary="上传新闻图片封面")
async def upload_cover(
    body: Annotated[NewsUploadDTO, Form()],
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: LoginUser = Depends(require_admin),
):
    """``NewsServiceImpl.uploadCoverImage`` (:104-139).

    This endpoint carries the most surprising behaviour in the domain, and the
    frontend depends on all of it:

    * **Without an ``id`` it cannot succeed.** It inserts a ``News`` populated
      only with ``title``/``userId``/``coverImg``, but ``content`` and
      ``publishTime`` are ``NOT NULL`` with no default
      (``schema.sql:57,61``). The INSERT always fails and the catch-all reports
      ``50000``/``系统错误``.
    * **With an ``id`` it overwrites two unrelated columns.** ``title`` is set
      to ``""`` and ``userId`` to the *uploader's* id before the UPDATE, and
      MyBatis Plus writes empty strings (only nulls are skipped). So uploading a
      cover wipes the article's title and reassigns its author.

      The admin editor is built around this: ``NewsEditPage.vue`` uploads the
      cover first, then POSTs ``/edit`` with the real title, restoring it. A
      user who uploads a cover and then closes the tab leaves the article with
      an empty title and a changed author.

      Both columns are written here for fidelity. Dropping them would be
      invisible to the two-step flow and strictly safer, but it is a behaviour
      change rather than a port -- see ruling 21 for the recommendation.
    * Returns the cover URL as a bare string, like ``/uploadAttachment``.
    """
    news_id = int(body.id) if body.id not in (None, "") else None
    if news_id is not None:
        exists = db.execute(
            select(func.count()).select_from(News).where(News.id == news_id)
        ).scalar_one()
        if not exists:
            # Java pairs NOT_FOUND_ERROR with the "参数为空" text (:116).
            raise BizError(ErrorCode.NOT_FOUND_ERROR, PARAMS_IS_NULL)

    data = await file.read()
    detail = await upload_picture(
        data, file.filename, prefix=COVER_PREFIX.format(user_id=admin.id)
    )

    if news_id is None:
        # The INSERT branch. See the docstring: it cannot satisfy the NOT NULL
        # constraints, so it fails here explicitly rather than depending on the
        # driver to reject it. Same envelope Java produces, same outcome: the
        # image is already in COS, the article is not written.
        logger.error("uploadCover called without an id; the insert is unsatisfiable")
        raise BizError(ErrorCode.SYSTEM_ERROR, SYSTEM_ERROR_MESSAGE)

    db.execute(
        update(News)
        .where(News.id == news_id)
        # title and userId are included deliberately -- see the docstring.
        .values(title="", user_id=int(admin.id), cover_img=detail.url, edit_time=datetime.now())
    )
    db.flush()
    return BaseResponse.success(detail.url)
