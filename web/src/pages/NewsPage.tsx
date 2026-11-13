import { useEffect, useMemo, useState, type FormEvent } from "react"
import { describeError, listNews, type ErrorDetail, type NewsItem, type NewsPage } from "@/lib/api"
import { newsDate, newsExcerpt, newsOpening } from "@/lib/news"
import { ChromaGrid, type ChromaItem } from "@/components/ChromaGrid"
import { EmptyFrame } from "@/components/EmptyFrame"
import { FaultPanel } from "@/components/FaultPanel"
import { SectionHead } from "@/components/SectionHead"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { SiteHeader } from "@/components/SiteHeader"

const PAGE_SIZE = 9

/** 把资讯条目摊成一张样片上的一格。 */
function toCard(item: NewsItem): ChromaItem {
  const { date, time } = newsDate(item.publishTime)
  const hasCover = Boolean(item.coverImage)

  return {
    image: hasCover ? item.coverImage : undefined,
    alt: hasCover ? item.title : undefined,
    title: item.title,
    // 无封面的条目都是几十字的短讯，摘要基本是标题的回声——不再复述一遍。
    subtitle: hasCover ? newsExcerpt(item.content, item.summary, 76) : undefined,
    note: (
      <>
        {date}
        {time ? ` · ${time}` : ""}
        {item.author ? ` · ${item.author}` : ""}
      </>
    ),
    to: `/news/${item.id}`,
    media: hasCover ? undefined : <EmptyFrame quote={newsOpening(item.content)} />,
  }
}

export function NewsPage() {
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState("")
  const [query, setQuery] = useState("")
  const [reload, setReload] = useState(0)

  // 请求键变了就是在等新的一页。加载态从键推出来，不必在 effect 里同步改状态。
  const requestKey = `${page}|${query}|${reload}`
  const [result, setResult] = useState<{
    key: string
    data: NewsPage | null
    fault: ErrorDetail | null
  }>({ key: "", data: null, fault: null })

  useEffect(() => {
    let alive = true

    listNews({
      current: page,
      pageSize: PAGE_SIZE,
      ...(query ? { title: query } : {}),
    }).then(
      (value) => {
        if (alive) setResult({ key: requestKey, data: value, fault: null })
      },
      (cause) => {
        if (!alive) return
        setResult({ key: requestKey, data: null, fault: describeError(cause) })
      },
    )

    return () => {
      alive = false
    }
  }, [page, query, reload, requestKey])

  const loading = result.key !== requestKey
  const fault = result.key === requestKey ? result.fault : null
  const data = result.key === requestKey ? result.data : null

  const records = useMemo(() => data?.records ?? [], [data])
  const total = data?.total ?? 0
  const pages = Math.max(1, data?.pages ?? 1)
  const cards = useMemo(() => records.map(toCard), [records])

  const latest = records.reduce<string>((acc, item) => {
    const { date } = newsDate(item.publishTime)
    return !acc || date > acc ? date : acc
  }, "")
  const withCover = records.filter((item) => item.coverImage).length

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
    <div className="is-field">
      <SiteHeader />

      <main className="wrap news">
        <SectionHead code="03" kicker="新闻资讯" en="NEWS · BULLETIN" />

        <div className="news__intro">
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
              <button className="btn btn--sm" type="submit">
                检索
              </button>
              {query ? (
                <button className="btn btn--ghost btn--sm" type="button" onClick={clear}>
                  清除
                </button>
              ) : null}
            </div>
          </form>
        </div>

        {/* 读不出来的时候，上面的读数条没有意义——一排 0 只是噪音。 */}
        {fault ? null : (
          <div className="strip news__strip">
            <div className="strip__cell">
              <div className="readout">
                <span className="readout__label">条目</span>
                <span className="readout__value readout__value--mono">{total} 条</span>
              </div>
            </div>
            <div className="strip__cell">
              <div className="readout">
                <span className="readout__label">页码</span>
                <span className="readout__value readout__value--mono">
                  {String(page).padStart(2, "0")} / {String(pages).padStart(2, "0")}
                </span>
              </div>
            </div>
            <div className="strip__cell">
              <div className="readout">
                <span className="readout__label">最新</span>
                <span className="readout__value readout__value--mono">{latest || "—"}</span>
              </div>
            </div>
            <div className="strip__cell">
              <div className="readout">
                <span className="readout__label">本页影像</span>
                <span className="readout__value readout__value--mono">
                  {withCover} / {records.length}
                </span>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="news__grid-skeleton" aria-hidden="true">
            {Array.from({ length: PAGE_SIZE }, (_, index) => (
              <span className="news__skeleton-cell" key={index} />
            ))}
          </div>
        ) : fault ? (
          <FaultPanel
            code={fault.code}
            title="资讯没能读出来"
            body={fault.text}
            endpoint="POST /news/list/page/vo"
            onRetry={() => setReload((value) => value + 1)}
          />
        ) : records.length === 0 ? (
          <div className="news__empty">
            <EmptyFrame label="空样张" />
            <p className="news__empty-title">
              {query ? `没有匹配「${query}」的资讯` : "资讯库里还没有条目"}
            </p>
            <p className="small">
              {query ? "换个词再试一次，或者把检索清掉看全部。" : "编辑部发布之后，这里会按发布时间排好队。"}
            </p>
            {query ? (
              <button className="btn btn--ghost btn--sm" type="button" onClick={clear}>
                清除检索
              </button>
            ) : null}
          </div>
        ) : (
          <ChromaGrid
            className="news__grid"
            items={cards}
            columns={3}
            minCardWidth={250}
            gap={16}
            aspectRatio="1 / 1"
            radius={230}
            softness={0.55}
            dim={0.2}
            glow={0.32}
            borderGlow={1}
            fadeOut={0.5}
          />
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
    </div>
  )
}
