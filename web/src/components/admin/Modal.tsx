import type { ReactElement, ReactNode } from "react"
import { X } from "lucide-react"

import { Dialog } from "@/components/ui/dialog"

/**
 * 居中弹窗。
 *
 * <p>弹层行为（Portal / 焦点 / Esc / 滚动锁 / 叠层）由 Base UI Dialog 负责，
 * 这里只管 Iris 的面板结构与类名。遮罩复用全站 `.scrim` 词汇类；
 * 内容区（__body）单独 overflow auto，头尾固定。
 */
export function Modal(props: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}): ReactElement {
  const { open, title, onClose, children, footer } = props

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      className="admin-modal is-field"
    >
      <header className="admin-modal__head">
        <h2 className="admin-modal__title">{title}</h2>
        <button
          type="button"
          className="admin-modal__close"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className="admin-modal__body">{children}</div>

      {footer ? <footer className="admin-modal__foot">{footer}</footer> : null}
    </Dialog>
  )
}
