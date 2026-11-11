import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import type { ReactElement, ReactNode } from "react"

/**
 * Base UI Dialog 的薄封装。
 *
 * <p>Portal、焦点陷阱、背景 inert、页面滚动锁、嵌套弹层的 Esc 栈全部由 Base UI
 * 负责——这些行为以前是 `useAdminDialog` 手写的，叠层边界条件越补越多。
 * 这里只保留 Iris 的类名与 aria 入口，不做任何交互实现。
 *
 * <p>Portal 会挂到 body，管理端的上下文类（`.is-field`）必须由调用方一并带过去，
 * 否则 --fg/--surface 会回退到根级。
 */
export function Dialog(props: {
  open: boolean
  title: string
  onClose: () => void
  className: string
  backdropClassName?: string
  children: ReactNode
}): ReactElement {
  const { open, title, onClose, className, backdropClassName = "scrim", children } = props

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      modal
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={backdropClassName} />
        <BaseDialog.Popup className={className} aria-label={title}>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
