import "@/styles/news.css"

import { useMemo } from "react"
import { ArrowLeft } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { describeError, getNews, listNews } from "@/lib/api"
import { faultFromError } from "@/lib/faults"
import { queryKeys } from "@/lib/queryKeys"
import { useRevealScan } from "@/lib/useInView"
import { IrisRefreshNotice, IrisSectionError } from "@/components/system/IrisSectionState"
import { SectionHead } from "@/components/SectionHead"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { NewsArticleView } from "@/components/news/NewsArticleView"
import { NewsCard } from "@/components/news/NewsCard"

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
  const faultSeverity = detailQuery.error
    ? faultFromError(detailQuery.error, { intent: "load" }).severity
    : "attention"
  const hasData = detailQuery.data !== undefined
  const item = detailQuery.data ?? null

  const others = useMemo(
    () =>
      (othersQuery.data?.records ?? [])
        .filter((row) => String(row.id) !== String(id))
        .slice(0, 4),
    [othersQuery.data, id],
  )

  // 相关阅读的卡片是数据到位后才挂上的，入场扫描要跟着数据重跑一次。
  useRevealScan([others.length])

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
        ) : fault && !hasData ? (
          <>
            <h1 className="sr-only">资讯详情</h1>
            <IrisSectionError
              severity={faultSeverity}
              title="这条资讯没能读出来"
              detail={fault.text}
              actionLabel="重试"
              onAction={() => void detailQuery.refetch()}
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
            {fault && hasData ? (
              <IrisRefreshNotice detail={fault.text} onRetry={() => void detailQuery.refetch()} />
            ) : null}

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
                <ul className="journal-grid journal-grid--related">
                  {others.map((row, index) => (
                    <NewsCard item={row} index={index} key={row.id} />
                  ))}
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
