import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronDown, ClipboardList, LogOut, ShieldCheck, UserRound } from "lucide-react"

import { Menu, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu"
import { useSession } from "@/lib/session"

/**
 * 账号控件。
 *
 * 未登录时是一个「登录」按钮；登录后是一张 Iris Blue Optical Glass 悬浮卡片：
 * 身份区 + 四个真实目的地。打开方式、键盘导航、视口内定位和焦点归还交给
 * Base UI Menu，这里只声明内容。
 *
 * 身份区只读真实资料（昵称 / 账号 / 角色 / 头像），没有在线状态、会员等级
 * 或任何尚未实现的账户能力。
 */
function AccountAvatar({
  name,
  src,
  size,
}: {
  name: string
  src?: string
  size: "sm" | "lg"
}) {
  // 记录「哪一张头像加载失败」，而不是一个布尔：换账号 / 换头像时
  // src 变了，失败态自然失效，不需要在 effect 里重置 state。
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = Boolean(src) && failedSrc === src

  const initial = Array.from(name.trim())[0] ?? "I"

  return (
    <span className={`acct__avatar acct__avatar--${size}`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <span className="acct__avatar-initial">{initial}</span>
      )}
    </span>
  )
}

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
  const isAdmin = user.userRole === "admin"

  return (
    <div className="acct">
      <Menu
        label={`账号菜单：${name}`}
        openOnHover={canHover}
        popupClassName="acct__menu"
        trigger={
          <button type="button" className="acct__trigger" aria-label={`账号菜单：${name}`}>
            <AccountAvatar name={name} src={user.userAvatar} size="sm" />
            {/* 昵称允许截断，完整名称同时挂在 title 与按钮的可访问名上。 */}
            <span className="acct__name" title={name}>
              {name}
            </span>
            <ChevronDown className="acct__caret" aria-hidden="true" />
          </button>
        }
      >
        <div className="acct__identity">
          <AccountAvatar name={name} src={user.userAvatar} size="lg" />
          <div className="acct__identity-text">
            <span className="acct__identity-name" title={name}>
              {name}
            </span>
            <span className="acct__identity-meta">
              <span className="num">{user.userAccount}</span>
              {isAdmin ? <span className="acct__role">管理员</span> : null}
            </span>
          </div>
        </div>
        <MenuSeparator className="acct__sep" />
        <MenuLinkItem
          className="acct__item"
          closeOnClick
          render={<Link to="/profile" />}
        >
          <UserRound className="acct__item-icon" aria-hidden="true" />
          个人中心
        </MenuLinkItem>
        <MenuLinkItem
          className="acct__item"
          closeOnClick
          render={<Link to="/records" />}
        >
          <ClipboardList className="acct__item-icon" aria-hidden="true" />
          判读记录
        </MenuLinkItem>
        {isAdmin ? (
          <MenuLinkItem className="acct__item" closeOnClick render={<Link to="/admin" />}>
            <ShieldCheck className="acct__item-icon" aria-hidden="true" />
            系统管理
          </MenuLinkItem>
        ) : null}
        <MenuSeparator className="acct__sep" />
        <MenuItem
          className="acct__item"
          render={<button type="button" />}
          onClick={async () => {
            // 登出失败时 signOut 保留登录态（服务端会话还在），不能谎称已退出。
            await signOut()
            navigate("/")
          }}
        >
          <LogOut className="acct__item-icon" aria-hidden="true" />
          退出登录
        </MenuItem>
      </Menu>
    </div>
  )
}
