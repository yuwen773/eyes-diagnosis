import "@/styles/news.css"

import { useMemo, type ReactNode } from "react"

import { newsDate, newsPlainText, newsSections, newsWithAnchors, newsWordCount } from "@/lib/news"
import { renderNewsHtml } from "@/lib/markdown"
import { sanitizeNewsHtml } from "@/lib/sanitize"

/**
 * 一篇资讯文章的完整版式——公开详情页与管理端预览共用这一份实现。
 *
 * <p>抽出来的理由不是「复用三个 div」，而是：管理端预览如果另写一套版式，
 * 它迟早会和公开页长得不一样，管理员就会对着一个不存在的页面签字。这里
 * 只保留一份标题 / 导语 / 封面 / 目录 / 正文纸面的摆法，页面级的东西
 * （返回链接、更多资讯、加载与错误态）留在调用方。
 *
 * <p>两条内容来源走同一条安全线：
 * - `contentFormat="html"`：库里存的富文本，过 `sanitizeNewsHtml`；
 * - `contentFormat="markdown"`：编辑中的 Markdown，先过 `renderNewsHtml`
 *   （markdown-it + 同一个白名单），与保存时落库的 HTML 同构。
 *
 * <p>字数口径：对未保存的 Markdown 预览，字数按渲染后的 HTML 算，与公开页
 * 「数库里存的 HTML」同口径；旧 HTML 文章（未改动正文）走 `html` 分支，
 * 与重构前的读数完全一致。Markdown 源里的 `&amp;` 类实体在渲染管线里会被
 * 还原成字符，而后端 `buildSummary` 数的是落库前的字符串——两边最多差在
 * 实体字符上，预览读数不假装等于后端摘要。
 *
 * <p>`kicker` 让预览可以如实说「尚未发布」，而不是编一个发布时间。
 */

export type NewsArticleInput = {
  title?: string | null
  content?: string | null
  coverImage?: string | null
  author?: string | null
  publishTime?: string | null
}

export type NewsArticleViewProps = {
  article: NewsArticleInput
  /** html：公开页读库；markdown：后台预览编辑中的表单。 */
  contentFormat?: "html" | "markdown"
  /** 覆盖标题上方那行眉线；不传则按真实发布时间显示。 */
  kicker?: ReactNode
  /** 作者缺省值。公开页是「编辑部」，预览是「未署名」。 */
  authorFallback?: string
  showDisclaimer?: boolean
  className?: string
}

export function NewsArticleView(props: NewsArticleViewProps): ReactNode {
  const {
    article,
    contentFormat = "html",
    kicker,
    authorFallback = "编辑部",
    showDisclaimer = true,
    className,
  } = props

  // 正文与导语：长文把首段提出来当导语，正文从第二段开始；短文不摆导语，
  // 正文本身就是全部。摘要基本就是正文开头，两处都摆会出现同一段话读两遍。
  const { html, lead, words } = useMemo(() => {
    const source = article.content ?? ""
    const sanitized =
      contentFormat === "markdown" ? renderNewsHtml(source) : sanitizeNewsHtml(source)
    const clean = newsWithAnchors(sanitized)
    // 字数按渲染后的全文算：公开页旧实现数的是库里存的原文，Markdown 管线
    // 会把 #、**、- 这些记号剥掉，字数只少不多——预览读数与公开页同口径。
    const total = newsWordCount(clean)
    if (total < 400) return { html: clean, lead: "", words: total }
    const first = /^\s*<p>([\s\S]*?)<\/p>/.exec(clean)
    if (!first) return { html: clean, lead: "", words: total }
    const text = newsPlainText(first[1])
    if (!text) return { html: clean, lead: "", words: total }
    return { html: clean.slice(first[0].length), lead: text, words: total }
  }, [article.content, contentFormat])

  const sections = useMemo(() => newsSections(html), [html])
  const { date, time } = newsDate(article.publishTime ?? undefined)

  return (
    <article className={`news-article${className ? ` ${className}` : ""}`}>
      <header className="news-article__head">
        <p className="overline news-article__kicker">
          {kicker ?? (
            <>
              发布于 <span className="num">{date}{time ? ` ${time}` : ""}</span>
            </>
          )}
        </p>
        <h1 className="display news-article__title">{article.title || "未命名文章"}</h1>
        {lead ? <p className="lead news-article__lead">{lead}</p> : null}
        <p className="news-article__meta num">
          <span>{article.author?.trim() || authorFallback}</span>
          <span aria-hidden="true">·</span>
          <span>{words} 字</span>
          {sections.length > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{sections.length} 节</span>
            </>
          ) : null}
        </p>
      </header>

      {/* 没有封面就不摆封面位——留一个空框只是占地方。 */}
      {article.coverImage ? (
        <figure className="news-article__plate">
          <img
            className="news-article__img"
            src={article.coverImage}
            alt=""
            loading="eager"
            fetchPriority="high"
          />
          <figcaption className="num">封面 · COVER</figcaption>
        </figure>
      ) : null}

      <div className="news-article__body">
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

        <div className="news-paper">
          <div className="news-paper__body" dangerouslySetInnerHTML={{ __html: html }} />
          {showDisclaimer ? (
            <div className="disclaimer">
              <p>
                本页内容由编辑部发布，仅用于眼健康科普与院内信息传达，不构成诊断结论，
                不能替代执业医师的检查与判断。如有眼部不适，请及时就医。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
