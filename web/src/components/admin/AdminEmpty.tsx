import type { ReactElement, ReactNode } from "react"
import { Inbox, type LucideIcon } from "lucide-react"

/**
 * 管理端空态。
 *
 * <p>「没有数据」本身是有效信息：说清楚为什么空（筛选 / 窗口 / 真的没有）、
 * 下一步能做什么，而不是留一块白。图标只做语境提示，不配插画动画。
 */
export function AdminEmpty(props: {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
}): ReactElement {
  const { title, description, action, icon: Icon = Inbox } = props
  return (
    <div className="admin-empty">
      <span className="admin-empty__icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <p className="admin-empty__title">{title}</p>
      {description ? <p className="admin-empty__desc">{description}</p> : null}
      {action ? <div className="admin-empty__action">{action}</div> : null}
    </div>
  )
}
