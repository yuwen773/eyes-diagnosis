import "@/styles/news.css"

import { useMemo, useRef, type MouseEvent, type ReactNode } from "react"

import { newsDate, newsPlainText, newsSections, newsWithAnchors, newsWordCount } from "@/lib/news"
import { renderNewsHtml } from "@/lib/markdown"
import { sanitizeNewsHtml } from "@/lib/sanitize"
import { useElementWidth } from "@/lib/useElementWidth"

/**
 * 正文版心的窄档阈值。
 *
 * <p>按**版心宽度**判，不按视口：管理端预览把一整页塞进设备框，设备框
 * 才是那一页真正的宽度。900 是公开页的媒体查询阈值，减去两侧页边距后
 * 版心到 860 左右就该切到窄版式，两边对齐。
 *
 * <p>阈值取 840：900 视口扣掉两侧页边距后版心约 820（窄），940 视口约
 * 860（宽）——正好卡在媒体查询的 900 断点两侧，两条判断不会打架。
 */
const NARROW_BODY = 840

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
  /**
   * 标题层级。公开页用 h1；管理端编辑页自己已经有一个 h1（「编辑资讯」），
   * 预览里的文章降成 h2，同一页不会出现两个 h1。外观不受影响——
   * 版式走 class，不走标签名。
   */
  headingLevel?: 1 | 2
  showDisclaimer?: boolean
  className?: string
}

/**
 * 目录跳转：平滑滚到章节，弱动效偏好下改成瞬时。
 *
 * <p>不用原生 `href="#id"` 的默认跳转——它没有过渡，长文里从第一屏滚到
 * 第五屏是「啪」的一下，读者会丢掉刚才看的位置。这里改成显式的
 * `scrollIntoView`，并保留 `replaceState`：地址栏里留得住锚点（可以直接
 * 复制分享），但不会给历史塞一串同页记录。
 *
 * <p>焦点不动：章节标题不是可聚焦元素，跳过去以后焦点仍留在目录链接上，
 * 键盘用户接着按 Tab 就能走目录，不用被扔到正文中间。
 */
function jumpTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id)
  if (!target) return
  event.preventDefault()
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
  window.history.replaceState(null, "", `#${id}`)
}

export function NewsArticleView(props: NewsArticleViewProps): ReactNode {
  const {
    article,
    contentFormat = "html",
    kicker,
    authorFallback = "编辑部",
    headingLevel = 1,
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
  const Heading = headingLevel === 2 ? "h2" : "h1"

  // 目录的窄版形态：宽屏是钉在左侧的常驻目录，窄屏收成可折叠的一份。
  // 宽度按版心算，公开页与管理端预览因此得到同一套判断。
  const bodyRef = useRef<HTMLDivElement>(null)
  const bodyWidth = useElementWidth(bodyRef)
  const narrow = bodyWidth > 0 && bodyWidth <= NARROW_BODY

  const tocList = (
    <ol className="news-toc__list">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a href={`#${section.id}`} data-cursor onClick={(event) => jumpTo(event, section.id)}>
            <span className="news-toc__index num">{String(index + 1).padStart(2, "0")}</span>
            <span className="news-toc__text">{section.text}</span>
          </a>
        </li>
      ))}
    </ol>
  )

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
        <Heading className="display news-article__title">
          {article.title || "未命名文章"}
        </Heading>
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
            // 固有宽高只用于加载前预留位置（CSS 的 width:100% / max-height 仍决定
            // 实际尺寸），否则图片解码前高度为 0，正文会被顶下来一次。
            width={1600}
            height={900}
            loading="eager"
            fetchPriority="high"
          />
          <figcaption className="num">封面 · COVER</figcaption>
        </figure>
      ) : null}

      <div className={`news-article__body${narrow ? " is-narrow" : ""}`} ref={bodyRef}>
        {sections.length > 1 ? (
          narrow ? (
            // 窄屏：目录收成可折叠的一份，默认合上——长文里一串章节名会
            // 把正文推到屏外。展开按钮就是原生 <summary>，键盘可用。
            <details className="news-toc news-toc--compact" aria-label="正文目录">
              <summary className="news-toc__summary overline">
                目录 · CONTENTS
                <span className="news-toc__summary-count num">{sections.length} 节</span>
              </summary>
              {tocList}
            </details>
          ) : (
            <aside className="news-toc" aria-label="正文目录">
              <span className="overline">目录 · CONTENTS</span>
              {tocList}
            </aside>
          )
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
