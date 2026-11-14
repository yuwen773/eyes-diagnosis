import type { ReactElement, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { AdminEmpty } from "@/components/admin/AdminEmpty"

/**
 * 解释型空态：图表位让位时给的说明卡。
 *
 * <p>外壳与图表卡同款（.admin-viz），里面只放「为什么空 + 下一步去哪」，
 * 不留一块空白大画布，也不画贴地的假曲线。
 *
 * <p>数据为空不是渲染失败，而是一个需要被解释的事实：这个窗口里没有
 * 发生什么、上一等长窗口里发生过什么、管理员下一步该去哪里。
 */
export function InsightEmpty(props: {
  /** 卡片标题（通常是这块内容的名字，如「判读趋势与分布」） */
  title: string
  /** 右上角口径小标（如「近 30 天」） */
  note: string
  icon: LucideIcon
  /** 空态标题：说清楚是「没有数据」而不是「出错了」 */
  emptyTitle: string
  /** 空态说明：解释原因 + 给出去向 */
  description: string
  action?: ReactNode
}): ReactElement {
  return (
    <section className="admin-viz admin-viz--empty">
      <div className="admin-viz__head">
        <span className="admin-viz__title">{props.title}</span>
        <span className="admin-viz__head-extra num">{props.note}</span>
      </div>
      <div className="admin-viz__body">
        <AdminEmpty
          icon={props.icon}
          title={props.emptyTitle}
          description={props.description}
          action={props.action}
        />
      </div>
    </section>
  )
}
