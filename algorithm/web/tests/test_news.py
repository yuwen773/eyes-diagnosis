"""News-domain contract tests (Phase 2.3).

``NewsController`` has no automated coverage and the frontend's generated client
has none either. Three behaviours here are worth pinning because each is silent
when it goes wrong:

* **Delete is physical**, unlike the user and diagnosis domains. A row deleted
  through this API is genuinely gone.
* **The public list is not filtered by ``status``**, so drafts are served to
  anonymous readers.
* **``/edit`` cannot create**, and re-saving an unchanged article reports
  failure.
"""

from web.tests.frozen_contract import domain_paths

import sys
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

from web.app import API_PREFIX, create_app  # noqa: E402
from web.auth import require_role  # noqa: E402
from web.constant import PARAMS_IS_NULL  # noqa: E402
from web.models.news import News  # noqa: E402
from web.models.user import User  # noqa: E402
from web.response import BizError, ErrorCode  # noqa: E402
from web.routers.news import (  # noqa: E402
    _news_query,
    _query_page,
    _to_vo,
    delete_news,
    router,
    update_news,
)
from web.schemas.news import (  # noqa: E402
    SUMMARY_LENGTH,
    NewsQueryDTO,
    NewsUpdateDTO,
    NewsVO,
    derive_summary,
    is_ascending,
)



@pytest.fixture
def db():
    engine = create_engine("sqlite://", future=True)
    News.__table__.create(engine)
    User.__table__.create(engine)
    session = sessionmaker(bind=engine, future=True)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _news(**overrides) -> News:
    defaults = dict(
        id=1,
        title="青光眼科普",
        user_id=7,
        content="青光眼是一组以视神经萎缩和视野缺损为特征的疾病。" * 3,
        summary="青光眼是一组以视神经萎缩和视野缺损为特征的疾病。主要危险因素包括眼压升高、近视、家族史等。早期常无症状",
        cover_img="https://cos.example/cover/7/a.jpg",
        status=1,
        publish_time=datetime(2025, 3, 1, 9, 0, 0),
        edit_time=datetime(2025, 3, 2, 9, 0, 0),
    )
    defaults.update(overrides)
    return News(**defaults)


# ---------------------------------------------------------------------------
# Structural: endpoint parity
# ---------------------------------------------------------------------------
def _java_news_paths():
    return domain_paths("news")


def _python_news_paths() -> set[str]:
    spec = create_app().openapi()
    return {
        path[len(API_PREFIX):]
        for path in spec["paths"]
        if path.startswith(f"{API_PREFIX}/news/")
    }


def test_all_seven_news_endpoints_are_migrated():
    assert len(_java_news_paths()) == 7
    assert _java_news_paths() - _python_news_paths() == set()


def test_python_serves_no_endpoint_java_does_not():
    assert _python_news_paths() - _java_news_paths() == set()


def test_router_declares_exactly_the_migrated_endpoints():
    assert {route.path for route in router.routes} == _python_news_paths()


def _route(suffix: str):
    return next(r for r in router.routes if r.path.endswith(suffix))


def _must_role(route):
    for dependant in route.dependant.dependencies:
        call = dependant.call
        if getattr(call, "func", call) is require_role:
            return call.args[0]
    return None


def test_only_delete_edit_and_the_two_uploads_require_a_role():
    """The three read endpoints carry no ``@AuthCheck`` -- the news list and
    detail pages are public. Adding auth to them would lock anonymous visitors
    out of the site."""
    assert _must_role(_route("/list/page/vo")) is None
    assert _must_role(_route("/list/page/vo/cache")) is None
    assert _must_role(_route("/get/{id}")) is None

    for suffix in ("/delete/{id}", "/edit", "/uploadAttachment", "/uploadCover"):
        assert _must_role(_route(suffix)) == "admin", suffix


def test_both_upload_endpoints_are_admin_only_which_the_java_source_also_says():
    for suffix in ("/delete/{id}", "/edit", "/uploadAttachment", "/uploadCover"):
        assert _must_role(_route(suffix)) == "admin"


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------
def test_cache_key_uses_a_space_and_has_no_version_segment():
    """``NewsController.java:87`` builds ``diagnosis:listNewsVOByPage {md5}``.

    Unlike the user (``diagnosis:listUserVOByPage:v2:...``) and diagnosis
    (``diagnosis:v2:listDiagnosisVOByPage:...``) keys, this one is
    space-separated with no version. Changing it would orphan every entry
    currently in Redis.
    """
    source = (ALGORITHM_ROOT / "web" / "routers" / "news.py").read_text(encoding="utf-8")
    assert '_DIAGNOSIS_PAGE_CACHE_PREFIX = "diagnosis:listNewsVOByPage"' in source
    assert 'f"{_DIAGNOSIS_PAGE_CACHE_PREFIX} {' in source


def test_news_cache_key_is_not_user_scoped():
    """The user and diagnosis cache keys embed the user id so a shared Redis
    cannot leak one user's records to another. News is public, so Java omits it
    -- reproduced, not a bug."""
    source = (ALGORITHM_ROOT / "web" / "routers" / "news.py").read_text(encoding="utf-8")
    scope_block = source.split("def list_news_vo_cached")[1].split("# ---")[0]
    assert "user.id" not in scope_block
    assert "userRole" not in scope_block


def test_ttl_is_five_to_ten_minutes():
    """``300 + RandomUtil.randomInt(0, 300)`` -- the jitter is deliberate
    anti-stampede protection, so it must not be replaced by a flat TTL."""
    source = (ALGORITHM_ROOT / "web" / "routers" / "news.py").read_text(encoding="utf-8")
    assert "_CACHE_TTL_BASE = 300" in source
    assert "_CACHE_TTL_JITTER = 300" in source


# ---------------------------------------------------------------------------
# Wire shape
# ---------------------------------------------------------------------------
def test_vo_id_is_a_string_and_publish_time_is_formatted():
    vo = _to_vo(_news(), ("钰玟", "https://avatar/a.png"))
    dumped = vo.model_dump(mode="json")
    assert dumped["id"] == "1" and isinstance(dumped["id"], str)
    assert dumped["publishTime"] == "2025-03-01 01:00:00"
    assert dumped["author"] == "钰玟"
    assert dumped["avatar"] == "https://avatar/a.png"


def test_cover_image_comes_from_the_cover_img_column():
    """The VO field and the column have different names, which is why Java needs
    an explicit setter at ``NewsServiceImpl.java:97`` -- a bean copy silently
    misses. Asserted so the mapping is not "simplified" away."""
    assert "coverImg" in News.__table__.columns
    assert "coverImage" not in News.__table__.columns
    assert "coverImage" in NewsVO.model_fields
    assert _to_vo(_news(cover_img="https://x/y.png"), None).coverImage == "https://x/y.png"


def test_vo_does_not_expose_status():
    """``NewsVO`` has 8 fields and no ``status``, so the frontend cannot tell a
    draft from a live article -- which is why the unfiltered list below is
    invisible from the client side too."""
    assert set(NewsVO.model_fields) == {
        "id", "title", "author", "avatar", "content", "summary",
        "coverImage", "publishTime",
    }


def test_query_dto_inherits_page_request_defaults():
    query = NewsQueryDTO()
    assert (query.current, query.pageSize, query.sortOrder) == (1, 10, "descend")


def test_sort_order_predicate():
    assert is_ascending("ascend") is True
    assert is_ascending("descend") is False
    assert is_ascending(None) is False


# ---------------------------------------------------------------------------
# Delete is physical
# ---------------------------------------------------------------------------
def test_news_entity_has_no_logic_delete_field():
    assert "isDelete" not in News.__table__.columns


def test_delete_removes_the_row(db):
    db.add(_news(id=1))
    db.flush()
    db.commit()

    assert delete_news(id=1, db=db, _admin=None).data is True
    assert db.get(News, 1) is None


def test_deleting_a_missing_row_returns_false(db):
    """Java returns ``removeById``'s boolean, which is false when no row
    matched."""
    assert delete_news(id=99, db=db, _admin=None).data is False


def test_delete_rejects_a_non_positive_id(db):
    with pytest.raises(BizError) as excinfo:
        delete_news(id=0, db=db, _admin=None)
    assert excinfo.value.code == ErrorCode.PARAMS_ERROR.value


# ---------------------------------------------------------------------------
# Query wrapper
# ---------------------------------------------------------------------------
def test_no_status_filter_serves_drafts_to_the_public(db):
    """Ruling 22: ``getNewsQueryWrapper`` has no status predicate, so a draft
    (0) and an unpublished article (2) are served exactly like a live one."""
    db.add_all([
        _news(id=1, status=0, title="草稿"),
        _news(id=2, status=1, title="已发布"),
        _news(id=3, status=2, title="已下架"),
    ])
    db.flush()
    page = _query_page(db, NewsQueryDTO())
    assert page.total == 3
    assert sorted(r.title for r in page.records) == ["已下架", "已发布", "草稿"]


def test_title_and_summary_filters_are_substring_matches(db):
    db.add_all([
        _news(id=1, title="青光眼科普", summary="青光眼科普摘要"),
        _news(id=2, title="白内障科普", summary="白内障科普摘要"),
    ])
    db.flush()
    assert _query_page(db, NewsQueryDTO(title="光眼")).total == 1
    assert _query_page(db, NewsQueryDTO(summary="白内障")).total == 1
    assert _query_page(db, NewsQueryDTO(title="科普")).total == 2


def test_author_is_enriched_from_the_owner_row(db):
    db.add(_news(id=1, user_id=7))
    db.add(User(id=7, user_account="yuwen", user_name="钰玟",
                user_avatar="https://a.png", user_password="x", user_role="admin",
                create_time=datetime(2025, 1, 1), edit_time=datetime(2025, 1, 1),
                update_time=datetime(2025, 1, 1), is_delete=0))
    db.flush()
    record = _query_page(db, NewsQueryDTO()).records[0]
    assert record.author == "钰玟"
    assert record.avatar == "https://a.png"


def test_missing_author_row_degrades_to_nulls(db):
    """Java would ``NullPointerException`` at :90 and 500 the whole list page
    for one orphaned row. Nulls are the same information without the outage."""
    db.add(_news(id=1, user_id=999))
    db.flush()
    record = _query_page(db, NewsQueryDTO()).records[0]
    assert record.author is None
    assert record.avatar is None


def test_sort_field_is_a_column_name(db):
    assert _news_query(NewsQueryDTO(sortField="publishTime"))._order_by_clauses
    assert not _news_query(NewsQueryDTO(sortField="publish_time"))._order_by_clauses
    assert not _news_query(NewsQueryDTO(sortField=None))._order_by_clauses


def test_pagination_math(db):
    db.add_all([_news(id=i) for i in range(1, 6)])
    db.flush()
    page = _query_page(db, NewsQueryDTO(current=2, pageSize=2))
    assert (page.total, page.size, page.current, page.pages) == (5, 2, 2, 3)


# ---------------------------------------------------------------------------
# Summary derivation -- the fixed crash
# ---------------------------------------------------------------------------
def test_summary_is_the_first_30_characters():
    assert derive_summary("x" * 100) == "x" * 30
    assert len(derive_summary("x" * 100)) == SUMMARY_LENGTH


def test_short_content_produces_the_whole_string_not_a_crash():
    """``content.substring(0, 30)`` throws ``StringIndexOutOfBoundsException``
    for anything shorter. The admin editor imposes no minimum length, so a
    short article was unsaveable -- ``50000``/``系统错误`` and the text lost.
    """
    assert derive_summary("短") == "短"
    assert derive_summary("") == ""
    assert len(derive_summary("a" * 29)) == 29


def test_missing_content_yields_none():
    assert derive_summary(None) is None


def test_summary_is_not_truncated_on_a_character_boundary():
    """Java's ``substring`` cuts UTF-16 code units and can split a surrogate
    pair. Python slices code points, so an emoji-heavy article keeps whole
    characters. Strictly better and never worse."""
    text = "👁" * 20  # 20 code points, 40 UTF-16 units
    assert derive_summary(text) == text


# ---------------------------------------------------------------------------
# /edit
# ---------------------------------------------------------------------------
def test_edit_requires_an_id():
    with pytest.raises(BizError) as excinfo:
        update_news(body=NewsUpdateDTO(id=None, title="t", content="c"), db=None, _admin=None)
    assert excinfo.value.code == ErrorCode.PARAMS_ERROR.value


def test_edit_without_content_is_a_parameter_error(db):
    """Java NPEs on ``getContent().substring(...)``; the catch-all reports
    ``系统错误``. ``content`` is NOT NULL, so the write could never have
    succeeded -- a parameter error is the accurate code."""
    with pytest.raises(BizError) as excinfo:
        update_news(body=NewsUpdateDTO(id="1", title="t"), db=db, _admin=None)
    assert excinfo.value.code == ErrorCode.PARAMS_ERROR.value
    assert excinfo.value.message == PARAMS_IS_NULL


def test_edit_updates_title_content_and_summary(db):
    db.add(_news(id=1))
    db.flush()

    body = NewsUpdateDTO(id="1", title="新标题", content="新的正文内容" * 10, status=1)
    assert update_news(body=body, db=db, _admin=None).data is True

    row = db.get(News, 1)
    assert row.title == "新标题"
    assert row.summary == ("新的正文内容" * 10)[:30]


def test_edit_does_not_touch_edit_time(db):
    """The DTO has no ``editTime`` and the DDL's ``DEFAULT CURRENT_TIMESTAMP``
    applies to INSERT only -- there is no ``ON UPDATE``. So a news row's edit
    time reflects the last cover upload, never the last edit."""
    original = datetime(2020, 1, 1, 0, 0, 0)
    db.add(_news(id=1, edit_time=original))
    db.flush()

    update_news(
        body=NewsUpdateDTO(id="1", title="改过的标题", content="正文" * 20), db=db, _admin=None
    )
    assert db.get(News, 1).edit_time == original


def test_edit_ignores_cover_image(db):
    """The DTO says ``coverImage``, the entity says ``coverImg``, so
    ``BeanUtils.copyProperties`` drops it. The frontend sends the field on every
    save and never notices, because the cover was persisted by ``/uploadCover``
    in a separate step. Ruling 21: reproduced, not "fixed"."""
    db.add(_news(id=1, cover_img="https://cos/old.jpg"))
    db.flush()

    update_news(
        body=NewsUpdateDTO(id="1", title="t", content="正文" * 20,
                           coverImage="https://cos/new.jpg"),
        db=db,
        _admin=None,
    )
    assert db.get(News, 1).cover_img == "https://cos/old.jpg"


def test_edit_cannot_create(db):
    """``saveOrUpdate`` with a non-null id is ``updateById``; a missing row
    matches nothing, so this endpoint has no create path at all."""
    with pytest.raises(BizError) as excinfo:
        update_news(body=NewsUpdateDTO(id="404", title="t", content="正文" * 20), db=db, _admin=None)
    assert excinfo.value.code == ErrorCode.OPERATION_ERROR.value
    assert db.get(News, 404) is None


def test_absent_optional_fields_are_left_alone(db):
    """MyBatis Plus's default ``NOT_NULL`` strategy skips nulls, so a save that
    omits ``title`` must not blank it out."""
    db.add(_news(id=1, title="原标题", status=1))
    db.flush()

    update_news(body=NewsUpdateDTO(id="1", content="新正文" * 10), db=db, _admin=None)

    row = db.get(News, 1)
    assert row.title == "原标题"
    assert row.status == 1


def test_no_op_save_outcome_depends_on_the_driver_and_is_left_to_it(db):
    """Re-saving an unchanged article is a no-op UPDATE.

    On MySQL, ``updateById`` returns the *changed*-row count by default, so a
    no-op is 0 -> ``操作失败`` and the frontend shows "保存失败" for an article
    that was in fact saved correctly. SQLite reports *matched* rows, so the
    same statement returns 1 here. That divergence cannot be observed from a
    SQLite fixture, so this test pins only the rule -- ``rowcount <= 0`` fails --
    and leaves the driver to decide what "no-op" means.

    Worth knowing before "fixing" the check: relaxing it would change the
    response for every idempotent re-save, and no frontend currently
    distinguishes the two.
    """
    db.add(_news(id=1))
    db.flush()
    body = NewsUpdateDTO(id="1", title="完全不同的标题", content="正文" * 20, status=1)

    assert update_news(body=body, db=db, _admin=None).data is True
    # A second identical save writes nothing; whether that is reported as
    # success or failure is the driver's call, not this port's.
    try:
        again = update_news(body=body, db=db, _admin=None)
    except BizError as exc:
        assert exc.code == ErrorCode.OPERATION_ERROR.value
    else:
        assert again.data is True

    assert db.get(News, 1).title == "完全不同的标题"


# ---------------------------------------------------------------------------
# Facts asserted against the Java source, not against Python
# ---------------------------------------------------------------------------
def test_summary_length_matches_the_java_literal():
    assert SUMMARY_LENGTH == 30


def test_upload_prefixes_are_news_and_cover_scoped():
    from web.routers.news import ATTACHMENT_PREFIX, COVER_PREFIX
    assert ATTACHMENT_PREFIX.format(user_id=7) == "news/7"
    assert COVER_PREFIX.format(user_id=7) == "cover/7"


def test_cover_upload_persistence_fields():
    # Existing HTTP upload tests cover the write; this pins the column mapping.
    assert {"title", "userId", "coverImg", "editTime"} <= set(News.__table__.columns.keys())


def test_cover_image_mismatch_is_real_in_java():
    from web.schemas.news import NewsUpdateDTO
    assert "coverImage" in NewsUpdateDTO.model_fields
    assert "coverImg" in News.__table__.columns


def test_cover_insert_cannot_satisfy_the_schema():
    for name in ("content", "publishTime"):
        column = News.__table__.columns[name]
        assert column.nullable is False and column.default is None
    assert "isDelete" not in News.__table__.columns


def test_no_is_delete_column_but_the_other_domains_have_one():
    from web.models.diagnosis import Diagnosis
    assert "isDelete" not in News.__table__.columns
    assert "isDelete" in Diagnosis.__table__.columns
    assert "isDelete" in User.__table__.columns
