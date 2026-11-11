import type { ReactElement, ReactNode } from "react"

import { Dialog } from "@/components/ui/dialog"

/**
 * 右侧滑入抽屉。
 *
 * <p>与 Modal 共用 Base UI Dialog 的弹层行为（Portal / 焦点 / Esc / 滚动锁 /
 * 叠层），只是面板类名与方位不同。类名走 `.admin-drawer` 命名空间，
 * 不与全站左侧导航 `.drawer` 冲突；遮罩仍复用 `.scrim`。
 */
export function Drawer(props: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}): ReactElement {
  const { open, title, onClose, children } = props

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      className="admin-drawer is-field"
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
    </Dialog>
  )
}
