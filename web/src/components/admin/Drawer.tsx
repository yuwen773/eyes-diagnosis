import type { ReactElement, ReactNode } from "react"
import { X } from "lucide-react"

import { Dialog } from "@/components/ui/dialog"

/**
 * 右侧滑入抽屉。
 *
 * <p>与 Modal 共用 Base UI Dialog 的弹层行为（Portal / 焦点 / Esc / 滚动锁 /
 * 叠层），只是面板类名与方位不同。类名走 `.admin-drawer` 命名空间，
 * 不与全站左侧导航 `.drawer` 冲突；遮罩仍复用 `.scrim`。
 *
 * <p>`size="workspace"` 给文档阅读器这类双栏工作台用：桌面端展宽到内容区宽度，
 * 窄屏退化为全屏面板。内容区仍由抽屉自身滚动，页面背景不跟着动。
 * `headless` 让工作台用文档自己的头部（文件名 + 关闭）替代抽屉标题栏——
 * 同一份文件名不该在顶部出现两次。
 */
export function Drawer(props: {
  open: boolean
  title: string
  onClose: () => void
  size?: "default" | "workspace"
  /** 隐藏抽屉标题栏，由内容自己提供头部（工作台场景）。 */
  headless?: boolean
  children: ReactNode
}): ReactElement {
  const { open, title, onClose, size = "default", headless = false, children } = props

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      className={`admin-drawer is-field${size === "workspace" ? " admin-drawer--workspace" : ""}`}
    >
      {headless ? null : (
        <header className="admin-drawer__head">
          <h2 className="admin-drawer__title">{title}</h2>
          <button
            type="button"
            className="admin-drawer__close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
      )}

      <div className="admin-drawer__body">{children}</div>
    </Dialog>
  )
}
