import { Menu as BaseMenu } from "@base-ui/react/menu"
import type { ReactElement, ReactNode } from "react"

export const MenuItem = BaseMenu.Item
export const MenuLinkItem = BaseMenu.LinkItem

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
 */
export function Menu(props: {
  label: string
  trigger: ReactElement
  openOnHover?: boolean
  closeDelay?: number
  popupClassName: string
  children: ReactNode
}): ReactElement {
  const { label, trigger, openOnHover, closeDelay = 180, popupClassName, children } = props

  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} openOnHover={openOnHover} delay={80} closeDelay={closeDelay} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="acct__positioner" sideOffset={10} align="end">
          <BaseMenu.Popup className={popupClassName} aria-label={label}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
