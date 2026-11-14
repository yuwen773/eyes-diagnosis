import "@/styles/news.css"

import { useMemo } from "react"
import { ArrowLeft } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { describeError, getNews, listNews } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { newsDate } from "@/lib/news"
import { FaultPanel } from "@/components/FaultPanel"
import { SectionHead } from "@/components/SectionHead"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { NewsArticleView } from "@/components/news/NewsArticleView"

export function NewsDetailPage() {
  const { id = "" } = useParams<{ id: string }>()

  // 正文：没有 id 就不发请求，页面直接落到「没有这条资讯」。
  const detailQuery = useQuery({
    queryKey: queryKeys.news.detail(id),
    queryFn: () => getNews(id),
    enabled: !!id,
  })

  // 页尾的「更多资讯」：取最新几条，把当前这条排除掉。
  const othersQuery = useQuery({
    queryKey: [...queryKeys.news.list(), { current: 1, pageSize: 6 }],
    queryFn: () => listNews({ current: 1, pageSize: 6 }),
  })

  const loading = detailQuery.isLoading
  const fault = detailQuery.error ? describeError(detailQuery.error) : null
  const item = detailQuery.data ?? null

  const others = useMemo(
    () =>
      (othersQuery.data?.records ?? [])
        .filter((row) => String(row.id) !== String(id))
        .slice(0, 4),
    [othersQuery.data, id],
  )

  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="editorial" />

      <main className="wrap news-detail">
        <Link className="news-detail__back" to="/news" data-cursor>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" /> 资讯列表
        </Link>

        {loading ? (
          <>
            {/* 载入态也有页面标题：同一路由的 h1 不随分支消失。 */}
            <h1 className="sr-only">资讯详情</h1>
            <div className="news-detail__loading" aria-hidden="true">
              <span className="news-detail__skeleton-title" />
              <span className="news-detail__skeleton-line" />
              <span className="news-detail__skeleton-line" />
              <span className="news-detail__skeleton-block" />
            </div>
          </>
        ) : fault ? (
          <>
            <h1 className="sr-only">资讯详情</h1>
            <FaultPanel
              code={fault.code}
              title="这条资讯没能读出来"
              body={fault.text}
              endpoint={`GET /news/get/${id}`}
              onRetry={() => void detailQuery.refetch()}
            />
          </>
        ) : !item ? (
          <div className="news-empty">
            <p className="overline">No bulletin</p>
            <h1 className="news-empty__title">没有这条资讯</h1>
            <p className="small">它可能已经下架，或者链接有误。</p>
            <Link className="news__clear" to="/news">
              回到资讯列表
            </Link>
          </div>
        ) : (
          <>
            {/* 版式与后台预览共用一份实现：公开页看到的就是预览看到的。 */}
            <NewsArticleView article={item} />

            <div className="news-article__return">
              <Link className="news__clear" to="/news" data-cursor>
                ← 返回资讯列表
              </Link>
            </div>

            {others.length > 0 ? (
              <section className="news-detail__more">
                <SectionHead code="更多" kicker="More bulletins" en="LATEST" />
                <ul className="news-rows">
                  {others.map((row) => {
                    const rowDate = newsDate(row.publishTime)
                    return (
                      <li className="news-rows__item" key={row.id}>
                        <Link
                          to={`/news/${row.id}`}
                          className="news-row"
                          data-cursor
                          data-cursor-label="阅读全文"
                        >
                          <span className="news-row__date num">{rowDate.date}</span>
                          <span className="news-row__main">
                            <span className="news-row__title">{row.title}</span>
                          </span>
                          <span className="news-row__mark" aria-hidden="true">
                            ↗
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>

      <DisclaimerBar />
    </div>
  )
}
