import type { ReactElement, ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"

import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu"

export type RowMenuItem = {
  label: string
  icon?: ReactNode
  onSelect: () => void
  /** 破坏性动作：只改文字与图标语义色，不整块填红 */
  danger?: boolean
  disabled?: boolean
  /** 禁用原因：读屏与悬停都能读到，不让「灰掉」成为唯一解释。 */
  hint?: string
}

/**
 * 表格行内「更多操作」菜单。
 *
 * <p>行上只留一个主动作，其余收进菜单：窄表格不会因为三个按钮逐字折行，
 * 行高也不会被按钮撑成两层。菜单行为（方向键、Esc、outside click、翻转）
 * 交给 Base UI；这里只提供管理端的触发器与面板外观。
 */
export function RowMenu(props: {
  label: string
  items: Array<RowMenuItem | "separator">
}): ReactElement {
  const { label, items } = props
  return (
    <Menu
      label={label}
      align="end"
      sideOffset={6}
      popupClassName="admin-menu"
      positionerClassName="admin-menu__positioner"
      trigger={
        <button type="button" className="admin-iconbtn" aria-label={label} title={label}>
          <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      }
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <MenuSeparator key={`sep-${index}`} className="admin-menu__sep" />
        ) : (
          <MenuItem
            key={item.label}
            className={"admin-menu__item" + (item.danger ? " admin-menu__item--danger" : "")}
            disabled={item.disabled}
            title={item.disabled && item.hint ? item.hint : undefined}
            onClick={item.onSelect}
          >
            {item.icon ? <span className="admin-menu__icon">{item.icon}</span> : null}
            {item.label}
            {item.disabled && item.hint ? (
              <span className="sr-only">（{item.hint}）</span>
            ) : null}
          </MenuItem>
        ),
      )}
    </Menu>
  )
}
