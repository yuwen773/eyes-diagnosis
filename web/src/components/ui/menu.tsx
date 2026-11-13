import { Menu as BaseMenu } from "@base-ui/react/menu"
import type { ReactElement, ReactNode } from "react"

export const MenuItem = BaseMenu.Item
export const MenuLinkItem = BaseMenu.LinkItem
export const MenuSeparator = BaseMenu.Separator

/**
 * Base UI Menu 的薄封装。
 *
 * <p>hover 打开/延迟收起、方向键导航、首尾循环、outside click、Esc 收回到
 * 触发器都由 Base UI 负责——这些以前是 AccountMenu 里手写计时器 + pointerdown
 * 监听 + 只处理 Esc 的半套实现。
 *
 * <p>位置由 Positioner 计算，Portal 挂到 body：顶栏在深色区段上会 `is-invert`
 * 反相，但那套令牌只改文字色、不改面板底色，挂在顶栏里会变成浅底浅字；
 * 挂到根级反而跟随真正的主题。`sideOffset` 保持原先 10px 的缝。
 *
 * <p>`collisionPadding` 留 12px：面板贴近视口边缘时会自动翻转/平移，
 * 窄屏上也不会被裁掉。行级菜单由调用方通过 `open` / `onOpenChange` 托管状态，
 * 用来保证同一时刻只有一行菜单展开。
 */
export function Menu(props: {
  label: string
  trigger: ReactElement
  openOnHover?: boolean
  closeDelay?: number
  popupClassName: string
  positionerClassName?: string
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  sideOffset?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}): ReactElement {
  const {
    label,
    trigger,
    openOnHover,
    closeDelay = 180,
    popupClassName,
    positionerClassName = "acct__positioner",
    side = "bottom",
    align = "end",
    sideOffset = 10,
    open,
    onOpenChange,
    children,
  } = props

  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      <BaseMenu.Trigger render={trigger} openOnHover={openOnHover} delay={80} closeDelay={closeDelay} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          className={positionerClassName}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={12}
        >
          <BaseMenu.Popup className={popupClassName} aria-label={label}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
