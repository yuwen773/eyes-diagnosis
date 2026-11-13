import type { ReactElement, ReactNode } from "react"

/**
 * 批量动作条：勾选之后浮在表格上方的一行。
 *
 * <p>它只在「有选中项」时出现——空着的时候占一条视觉带，却没有任何动作可做，
 * 是纯粹的噪音。选中数用等宽数字，动作按钮由调用方给（删除 / 封禁 / 发布…）。
 *
 * <p>「清除选择」始终在最右：批量操作最怕的是「不知道自己选了什么」，
 * 一键清空是最快的退出路径。
 */
export function BatchBar(props: {
  /** 已选条数 */
  count: number
  /** 动作按钮 */
  children: ReactNode
  /** 清除选择 */
  onClear: () => void
  /** 无障碍标签 */
  label?: string
}): ReactElement {
  const { count, children, onClear, label = "批量操作" } = props
  if (count === 0) return <></>

  return (
    <div className="admin-batch" role="group" aria-label={label}>
      <span className="admin-batch__count num">已选 {count} 项</span>
      <div className="admin-batch__actions">{children}</div>
      <button type="button" className="admin-btn admin-btn--ghost admin-batch__clear" onClick={onClear}>
        清除选择
      </button>
    </div>
  )
}
