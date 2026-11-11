import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { Menu, MenuItem, MenuLinkItem } from "@/components/ui/menu"
import { useSession } from "@/lib/session"

/**
 * 账号控件。
 *
 * 未登录时是一个「登录」按钮；登录后是一个下拉，装着系统管理、个人中心、
 * 诊断记录和退出登录。打开方式、键盘导航、焦点归还交给 Base UI Menu，
 * 这里只声明条目。
 */
export function AccountMenu() {
  const { user, status, signOut } = useSession()
  const navigate = useNavigate()
  const [canHover] = useState(
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  )
  const authed = status === "authed" && user

  if (!authed) {
    return (
      <div className="acct">
        <Link to="/login" className="acct__trigger acct__trigger--anon">
          登录
        </Link>
      </div>
    )
  }

  const name = user.userName || user.userAccount || "账号"

  return (
    <div className="acct">
      <Menu
        label="账号"
        openOnHover={canHover}
        popupClassName="acct__menu"
        trigger={
          <button type="button" className="acct__trigger">
            <span className="acct__name">{name}</span>
            <span className="acct__caret" aria-hidden="true">
              ▾
            </span>
          </button>
        }
      >
        {user.userRole === "admin" ? (
          <MenuLinkItem className="acct__item" closeOnClick render={<Link to="/admin" />}>
            系统管理
          </MenuLinkItem>
        ) : null}
        <MenuLinkItem className="acct__item" closeOnClick render={<Link to="/profile" />}>
          个人中心
        </MenuLinkItem>
        <MenuLinkItem className="acct__item" closeOnClick render={<Link to="/records" />}>
          诊断记录
        </MenuLinkItem>
        <MenuItem
          className="acct__item"
          render={<button type="button" />}
          onClick={async () => {
            await signOut()
            navigate("/")
          }}
        >
          退出登录
        </MenuItem>
      </Menu>
    </div>
  )
}
