import type { ReactElement, ReactNode } from "react"
import { useAdminDialog } from "./Modal"

/**
 * 右侧滑入抽屉。行为与 Modal 共用 `useAdminDialog`（Esc / 焦点 / 滚动锁），
 * 类名走 `.admin-drawer` 命名空间，不与全站左侧导航 `.drawer` 冲突；
 * 遮罩仍复用 `.scrim` 词汇类。
 * 内容区（__body）单独 overflow auto，头部固定。
 */
export function Drawer(props: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}): ReactElement {
  const { open, title, onClose, children } = props
  const panelRef = useAdminDialog(open, onClose)

  return (
    <>
      <div
        className="scrim"
        data-open={open ? "true" : "false"}
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className="admin-drawer"
        data-open={open ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        inert={!open}
      >
        <header className="admin-drawer__head">
          <h2 className="admin-drawer__title">{title}</h2>
          <button
            type="button"
            className="admin-drawer__close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="admin-drawer__body">{children}</div>
      </div>
    </>
  )
}
