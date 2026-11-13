import "@/styles/news.css"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { describeError, getNews, listNews } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { newsDate, newsPlainText, newsSections, newsWithAnchors, newsWordCount } from "@/lib/news"
import { sanitizeNewsHtml } from "@/lib/sanitize"
import { EmptyFrame } from "@/components/EmptyFrame"
import { FaultPanel } from "@/components/FaultPanel"
import { SectionHead } from "@/components/SectionHead"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"

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

  // 正文与导语。
  //
  // 后端的摘要基本就是正文开头，所以直接把摘要摆在正文上面会出现同一段话
  // 读两遍。长文就把首段抽出来当导语（正文从第二段开始）；短文干脆不摆导语，
  // 正文本身就是全部。
  const { html, lead } = useMemo(() => {
    const clean = newsWithAnchors(sanitizeNewsHtml(item?.content))
    if (newsWordCount(item?.content) < 400) return { html: clean, lead: "" }
    const first = /^\s*<p>([\s\S]*?)<\/p>/.exec(clean)
    if (!first) return { html: clean, lead: "" }
    const text = newsPlainText(first[1])
    if (!text) return { html: clean, lead: "" }
    return { html: clean.slice(first[0].length), lead: text }
  }, [item?.content])

  const sections = useMemo(() => newsSections(html), [html])
  const { date, time } = newsDate(item?.publishTime)
  const words = newsWordCount(item?.content)

  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="editorial" />

      <main className="wrap news-detail">
        <Link className="news-detail__back" to="/news" data-cursor>
          <span aria-hidden="true">←</span> 资讯列表
        </Link>

        <SectionHead code="03" kicker="新闻资讯" en="NEWS · BULLETIN" />

        {loading ? (
          <div className="news-detail__loading" aria-hidden="true">
            <span className="news__skeleton-cell" />
            <span className="news__skeleton-cell" />
            <span className="news__skeleton-cell" />
          </div>
        ) : fault ? (
          <FaultPanel
            code={fault.code}
            title="这条资讯没能读出来"
            body={fault.text}
            endpoint={`GET /news/get/${id}`}
            onRetry={() => void detailQuery.refetch()}
          />
        ) : !item ? (
          <div className="news__empty">
            <EmptyFrame label="空样张" />
            <p className="news__empty-title">没有这条资讯</p>
            <p className="small">它可能已经下架，或者链接有误。</p>
            <Link className="btn btn--ghost btn--sm" to="/news">
              回到资讯列表
            </Link>
          </div>
        ) : (
          <>
            <article className="news-detail__hero">
              {/* 没有封面就不摆封面位——留一个空框只是占地方。 */}
              {item.coverImage ? (
                <figure className="news-plate">
                  <img className="news-plate__img" src={item.coverImage} alt={item.title} />
                  <figcaption className="num">封面 · COVER</figcaption>
                </figure>
              ) : null}

              <div className="news-detail__head">
                <p className="overline">发布于 {date}{time ? ` ${time}` : ""}</p>
                <h1 className="display news-detail__title">{item.title}</h1>
                {lead ? <p className="lead news-detail__lead">{lead}</p> : null}
                <div className="news-detail__readout">
                  <div className="readout">
                    <span className="readout__label">作者</span>
                    <span className="readout__value">{item.author || "编辑部"}</span>
                  </div>
                  <div className="readout">
                    <span className="readout__label">字数</span>
                    <span className="readout__value readout__value--mono">{words} 字</span>
                  </div>
                  <div className="readout">
                    <span className="readout__label">章节</span>
                    <span className="readout__value readout__value--mono">{sections.length} 节</span>
                  </div>
                </div>
              </div>
            </article>

            <div className="news-detail__body">
              {sections.length > 1 ? (
                <aside className="news-toc" aria-label="正文目录">
                  <span className="overline">目录 · CONTENTS</span>
                  <ol className="news-toc__list">
                    {sections.map((section, index) => (
                      <li key={section.id}>
                        <a href={`#${section.id}`} data-cursor>
                          <span className="news-toc__index num">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="news-toc__text">{section.text}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </aside>
              ) : null}

              <div className="sheet is-sheet news-paper">
                <div
                  className="news-paper__body"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                <div className="disclaimer">
                  <p>
                    本页内容由编辑部发布，仅用于眼健康科普与院内信息传达，不构成诊断结论，
                    不能替代执业医师的检查与判断。如有眼部不适，请及时就医。
                  </p>
                </div>
              </div>
            </div>

            {others.length > 0 ? (
              <section className="news-detail__more">
                <SectionHead code="更多" kicker="More bulletins" en="LATEST" />
                <ul className="news-ledger">
                  {others.map((row) => {
                    const rowDate = newsDate(row.publishTime)
                    return (
                      <li key={row.id}>
                        <Link to={`/news/${row.id}`} className="news-ledger__row" data-cursor>
                          <span className="news-ledger__date num">{rowDate.date}</span>
                          <span className="news-ledger__title">{row.title}</span>
                          <span className="news-ledger__mark" aria-hidden="true">
                            ›
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
