import "@/styles/news.css"

import { useMemo, useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { describeError, listNews, type NewsItem } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { newsDate, newsExcerpt, newsOpening } from "@/lib/news"
import { FaultPanel } from "@/components/FaultPanel"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { BrandFooter } from "@/components/brand/BrandFooter"

const PAGE_SIZE = 9

/** 日期 / 作者这行共用一套口径：有就写，没有就不占位。 */
function metaLine(item: NewsItem) {
  const { date, time } = newsDate(item.publishTime)
  return [date, time, item.author].filter(Boolean).join(" · ")
}

/** 列表行的摘要只给有封面的条目：无封面短讯的摘要基本是标题的回声。 */
function rowExcerpt(item: NewsItem) {
  if (!item.coverImage) return ""
  // 优先用正文开头：后端的 summary 常是标题的回声，摆在标题下面读两遍。
  return newsOpening(item.content, 64) || newsExcerpt(item.content, item.summary, 64)
}

export function NewsPage() {
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState("")
  const [query, setQuery] = useState("")

  // 已应用的筛选 + 分页：同时是查询键和请求体。键一变就是另一页数据，
  // 加载态由查询自己给出，不再需要 effect 里同步改状态。
  const params = useMemo(
    () => ({
      current: page,
      pageSize: PAGE_SIZE,
      ...(query ? { title: query } : {}),
    }),
    [page, query],
  )

  const listQuery = useQuery({
    queryKey: [...queryKeys.news.list(), params],
    queryFn: () => listNews(params),
  })

  const loading = listQuery.isPending
  const fault = listQuery.error ? describeError(listQuery.error) : null
  const data = listQuery.data ?? null

  const records = useMemo(() => data?.records ?? [], [data])
  const total = data?.total ?? 0
  const pages = Math.max(1, data?.pages ?? 1)

  // 后端默认按 publishTime 倒序，所以第一页第一条就是最新一条。
  // 只有第一页给它头版位置；翻页后全部回到列表，不制造「每页都有精选」。
  const featured = page === 1 && !query ? records[0] : undefined
  const rows = featured ? records.slice(1) : records

  const latest = records.reduce<string>((acc, item) => {
    const { date } = newsDate(item.publishTime)
    return !acc || date > acc ? date : acc
  }, "")
  // 「更新至」只在第一页且有数据、未检索时成立：此时 records[0] 才是全站最新一条；
  // 翻页或检索后它只是当前结果集的日期，不能冒充站点更新时间。
  // 空库不写「更新至 —」——那是在报一个不存在的更新时间。
  const showLatest = page === 1 && !query && records.length > 0

  function search(event: FormEvent) {
    event.preventDefault()
    const next = keyword.trim()
    setQuery(next)
    setPage(1)
  }

  function clear() {
    setKeyword("")
    setQuery("")
    setPage(1)
  }

  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="editorial" />

      <main className="wrap news">
        <header className="news__masthead">
          <div className="news__lede">
            <p className="overline">Briefing · 资讯</p>
            <h1 className="display news__title">眼科前沿</h1>
            <p className="lead">
              院内公告、学科动态与设备更新。按发布时间排列，条目打开即为全文。
            </p>
          </div>

          <form className="news__search" onSubmit={search}>
            <label className="news__search-label overline" htmlFor="news-search">
              检索标题 · SEARCH
            </label>
            <div className="news__search-row">
              <input
                id="news-search"
                className="news__input"
                type="search"
                value={keyword}
                placeholder="按标题检索…"
                onChange={(event) => setKeyword(event.target.value)}
              />
              <button className="news__submit" type="submit">
                检索
              </button>
              {query ? (
                <button className="news__clear" type="button" onClick={clear}>
                  清除
                </button>
              ) : null}
            </div>
          </form>
        </header>

        {/* 一条编辑口径的元信息，不是四列 KPI：总数、更新日期、页码都是列表接口的真实读数。 */}
        {fault || loading ? null : (
          <p className="news__meta num">
            <span>共 {total} 条</span>
            {showLatest ? (
              <>
                <span aria-hidden="true">·</span>
                <span>更新至 {latest || "—"}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>
              第 {String(page).padStart(2, "0")} / {String(pages).padStart(2, "0")} 页
            </span>
          </p>
        )}

        {loading ? (
          <div className="news-skeleton" aria-hidden="true">
            <div className="news-skeleton__lead" />
            <div className="news-skeleton__rows">
              {Array.from({ length: 6 }, (_, index) => (
                <span className="news-skeleton__row" key={index} />
              ))}
            </div>
          </div>
        ) : fault ? (
          <FaultPanel
            code={fault.code}
            title="资讯没能读出来"
            body={fault.text}
            endpoint="POST /news/list/page/vo"
            onRetry={() => void listQuery.refetch()}
          />
        ) : records.length === 0 ? (
          <div className="news-empty">
            <p className="overline">No bulletins</p>
            <p className="news-empty__title">
              {query ? `没有匹配「${query}」的资讯` : "资讯库里还没有条目"}
            </p>
            <p className="small">
              {query ? "换个词再试一次，或者把检索清掉看全部。" : "编辑部发布之后，这里会按发布时间排好队。"}
            </p>
            {query ? (
              <button className="news__clear" type="button" onClick={clear}>
                清除检索
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {featured ? (
              <article
                className={`news-lead${featured.coverImage ? "" : " news-lead--text"}`}
              >
                <div className="news-lead__body">
                  <p className="overline">最新 · LATEST</p>
                  <p className="news-lead__meta num">{metaLine(featured)}</p>
                  <h2 className="news-lead__title">
                    <Link
                      to={`/news/${featured.id}`}
                      data-cursor
                      data-cursor-label="阅读全文"
                    >
                      {featured.title}
                    </Link>
                  </h2>
                  <p className="news-lead__excerpt">
                    {newsOpening(featured.content, featured.coverImage ? 140 : 200) ||
                      newsExcerpt(featured.content, featured.summary, 120)}
                  </p>
                  <Link className="news-lead__more" to={`/news/${featured.id}`} data-cursor>
                    阅读全文
                    <span className="news-lead__more-mark" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                </div>

                {featured.coverImage ? (
                  <figure className="news-lead__plate">
                    <img
                      className="news-lead__img"
                      src={featured.coverImage}
                      alt=""
                      loading="eager"
                      fetchPriority="high"
                    />
                  </figure>
                ) : null}
              </article>
            ) : null}

            {rows.length > 0 ? (
              <ul className="news-rows">
                {rows.map((item) => {
                  const { date } = newsDate(item.publishTime)
                  const excerpt = rowExcerpt(item)
                  return (
                    <li className="news-rows__item" key={item.id}>
                      <Link
                        className="news-row"
                        to={`/news/${item.id}`}
                        data-cursor
                        data-cursor-label="阅读全文"
                      >
                        <span className="news-row__date num">{date}</span>
                        <span className="news-row__main">
                          <span className="news-row__title">{item.title}</span>
                          {excerpt ? (
                            <span className="news-row__excerpt">{excerpt}</span>
                          ) : null}
                        </span>
                        {item.coverImage ? (
                          <img
                            className="news-row__thumb"
                            src={item.coverImage}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span className="news-row__mark" aria-hidden="true">
                            ↗
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </>
        )}

        {pages > 1 && !loading && !fault ? (
          <nav className="news__pager" aria-label="分页">
            <button
              className="news__pager-step"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <span aria-hidden="true">‹</span> 上一页
            </button>
            <span className="news__pager-state num">
              {String(page).padStart(2, "0")} / {String(pages).padStart(2, "0")}
            </span>
            <button
              className="news__pager-step"
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((value) => Math.min(pages, value + 1))}
            >
              下一页 <span aria-hidden="true">›</span>
            </button>
          </nav>
        ) : null}
      </main>

      <DisclaimerBar />

      {/* 门户列表是公开品牌页的收尾：用精简页脚，不占满工作区。 */}
      <BrandFooter compact />
    </div>
  )
}
