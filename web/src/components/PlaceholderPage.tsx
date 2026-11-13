import { Link } from "react-router-dom"
import { SectionHead } from "./SectionHead"
import { SiteFooter } from "./SiteFooter"
import { ProductHeader } from "./shell/ProductHeader"

export type PlaceholderPageProps = {
  /** 章节号或代号，出现在章节头左侧。 */
  code: string
  kicker: string
  en: string
  title: string
  body: string
  /** 补充说明：这个页面将来会装什么。 */
  detail: string
}

/**
 * 占位页。
 *
 * 后端接口已经就绪，界面还在装配。这里不填假内容——假列表比空页面更糟，
 * 用户会以为那是真的资讯。只说清楚在做什么、做到哪一步了。
 */
export function PlaceholderPage({
  code,
  kicker,
  en,
  title,
  body,
  detail,
}: PlaceholderPageProps) {
  return (
    <div className="is-field">
      <ProductHeader scene="clinical" />

      <main className="wrap placeholder">
        <SectionHead code={code} kicker={kicker} en={en} />

        <h1 className="h2 placeholder__title">{title}</h1>
        <p className="lead placeholder__body">{body}</p>
        <p className="small placeholder__detail">{detail}</p>

        <div className="placeholder__status">
          <div className="readout">
            <span className="readout__label">状态</span>
            <span className="readout__value readout__value--mono">IN ASSEMBLY</span>
          </div>
          <div className="readout">
            <span className="readout__label">后端</span>
            <span className="readout__value readout__value--mono">READY</span>
          </div>
        </div>

        <div className="placeholder__exit">
          <Link className="btn" to="/diagnosis">
            去判读
            <span className="btn__key">JPG · PNG</span>
          </Link>
          <Link className="link" to="/">
            返回落地页
            <span className="link__mark">↖</span>
          </Link>
        </div>
      </main>

      <div className="wrap">
        <SiteFooter />
      </div>
    </div>
  )
}
