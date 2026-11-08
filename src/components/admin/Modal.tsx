import { useEffect, useRef, type ReactElement, type ReactNode } from "react"

/**
 * 弹层滚动锁用引用计数，而不是「各存一份 prevOverflow」。
 * Task 9 的流程里 Drawer（详情）与 Modal（复核）会同时打开，简单的
 * save/restore 会让先关的那个把 body 提前解锁，或把 overflow 还原成
 * 另一个弹层写进去的 hidden。计数保证最后一层关闭时才还原。
 */
let openDialogCount = 0
let savedBodyOverflow = ""

function lockBodyScroll() {
  if (openDialogCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
  }
  openDialogCount += 1
}

function unlockBodyScroll() {
  openDialogCount = Math.max(0, openDialogCount - 1)
  if (openDialogCount === 0) {
    document.body.style.overflow = savedBodyOverflow
  }
}

/**
 * Modal / Drawer 共用的受控弹层行为：
 *   - open 时把焦点移入面板（tabIndex=-1 的可聚焦容器），close 时归还给
 *     开启那一刻的 document.activeElement（触发元素）。
 *   - Esc 监听在 open 时挂、close 时卸。
 *   - body 滚动锁定与还原。
 *
 * 焦点/滚动锁只在 open 切换时跑（不含 onClose），父级重渲染不会抢焦点；
 * Esc 监听单独挂，onClose 换身份只重挂监听，不动焦点。
 * 导出供 Drawer 复用，避免新建第六个文件。
 */
export function useAdminDialog(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    // 先记录触发元素，再把焦点移入面板——顺序不能反。
    const trigger = document.activeElement as HTMLElement | null
    lockBodyScroll()
    panelRef.current?.focus({ preventScroll: true })

    return () => {
      unlockBodyScroll()
      trigger?.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return panelRef
}

/**
 * 居中弹窗。遮罩复用全站 `.scrim` 词汇类；面板与遮罩是兄弟节点，
 * 点面板不会冒泡到遮罩，点面板外的遮罩才触发 onClose。
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
        className="admin-modal"
        data-open={open ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        inert={!open}
      >
        <header className="admin-modal__head">
          <h2 className="admin-modal__title">{title}</h2>
          <button
            type="button"
            className="admin-modal__close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="admin-modal__body">{children}</div>

        {footer ? <footer className="admin-modal__foot">{footer}</footer> : null}
      </div>
    </>
  )
}
