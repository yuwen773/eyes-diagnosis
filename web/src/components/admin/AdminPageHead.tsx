import type { ReactElement, ReactNode } from "react"

/**
 * 管理端页面头。
 *
 * <p>成熟 SaaS 的页头承担三件事：说明「这一页在管什么」（标题 + 一句描述）、
 * 给出口径（时间窗 / 总数等读数），以及把本页主操作放在同一水平线上。
 * 短码与拉丁文只做节奏，不做装饰性大写堆叠。
 *
 * <p>与全站 `SectionHead` 的分工：`SectionHead` 是内容页的一行章节信息；
 * 管理端每一页都需要更大的标题、描述与动作位，因此单独有这一层。
 */
export function AdminPageHead(props: {
  /** 侧栏编号，与 ADMIN_NAV 同源 */
  code: string
  /** 中文页名 */
  title: string
  /** 拉丁文副标（大写 overline） */
  eyebrow: string
  /** 一句话说明本页职责与口径 */
  description?: string
  /** 口径读数（时间窗、总数等），放在标题右侧基线 */
  meta?: ReactNode
  /** 本页主操作 / 次操作 */
  actions?: ReactNode
}): ReactElement {
  const { code, title, eyebrow, description, meta, actions } = props
  return (
    <header className="admin-pagehead">
      <div className="admin-pagehead__lead">
        <p className="admin-pagehead__eyebrow">
          <span className="admin-pagehead__code num">{code}</span>
          <span className="admin-pagehead__en">{eyebrow}</span>
        </p>
        <h1 className="admin-pagehead__title">{title}</h1>
        {description ? <p className="admin-pagehead__desc">{description}</p> : null}
      </div>
      {meta ? <div className="admin-pagehead__meta">{meta}</div> : null}
      {actions ? <div className="admin-pagehead__actions">{actions}</div> : null}
    </header>
  )
}
