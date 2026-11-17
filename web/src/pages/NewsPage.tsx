import "@/styles/news.css"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { describeError, listNews } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { newsDate } from "@/lib/news"
import { useRevealScan } from "@/lib/useInView"
import { FaultPanel } from "@/components/FaultPanel"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { BrandFooter } from "@/components/brand/BrandFooter"
import { JournalHeader } from "@/components/news/JournalHeader"
import { NewsCard } from "@/components/news/NewsCard"

const PAGE_SIZE = 9

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
  // 只有第一页、未检索时它才进抬头当头条；翻页或检索后全部回到网格，
  // 不制造「每页都有精选」。
  const featured = page === 1 && !query ? records[0] : undefined
  // slice 每次渲染都会产出新数组，先固定引用，下面的派生才缓存得住。
  const rows = useMemo(() => (featured ? records.slice(1) : records), [featured, records])

  const latest = useMemo(
    () =>
      records.reduce<string>((acc, item) => {
        const { date } = newsDate(item.publishTime)
        return !acc || date > acc ? date : acc
      }, ""),
    [records]
  )
  // 「更新至」只在第一页且有数据、未检索时成立：此时 records[0] 才是全站最新一条；
  // 翻页或检索后它只是当前结果集的日期，不能冒充站点更新时间。
  // 空库不写「更新至 —」——那是在报一个不存在的更新时间。
  const showLatest = page === 1 && !query && records.length > 0

  // 入场动画：网格卡片是数据到位后才挂上的，扫描要跟着数据重跑一次。
  useRevealScan([records.length, page, query])

  // 换页或换检索词之后回到列表开头：留在上一条的滚动位置，读者会以为
  // 「点了没反应」——新一页的第一行在屏幕外，谁也看不见。
  // 首次渲染不动：那时候读者本来就站在页首，一 scroll 就把刊名推出视口。
  const listRef = useRef<HTMLElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    listRef.current?.scrollIntoView({ block: "start" })
  }, [page, query])

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

      {/* 期刊抬头：刊名 + 检索 + 真实头条，压掉旧版 hero 的半屏空白。 */}
      <JournalHeader
        latest={featured}
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSearch={search}
        onClear={clear}
        searching={Boolean(query)}
      />

      <main className="wrap news" ref={listRef}>
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
          // 骨架与真卡同形：加载完切过去时版式不跳。
          <div className="news-skeleton" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="news-skeleton__card" key={index}>
                <span className="news-skeleton__plate" />
                <span className="news-skeleton__line" />
                <span className="news-skeleton__line is-short" />
              </div>
            ))}
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
            {rows.length > 0 ? (
              <ul className="journal-grid">
                {rows.map((item, index) => (
                  <NewsCard item={item} index={index} key={item.id} />
                ))}
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
