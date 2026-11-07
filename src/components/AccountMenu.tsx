import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useSession } from "@/lib/session"

/**
 * 账号控件。
 *
 * 未登录时是一个「登录」按钮；登录后是一个悬浮下拉，装着个人中心、诊断记录
 * 和退出登录。桌面靠 hover 打开，触屏靠点击，键盘走 Esc 与焦点。
 */
export function AccountMenu() {
  const { user, status, signOut } = useSession()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches
  const authed = status === "authed" && user

  // 点面板外收起。
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

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
    <div
      ref={rootRef}
      className="acct"
      onPointerEnter={canHover ? () => setOpen(true) : undefined}
      onPointerLeave={canHover ? () => setOpen(false) : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="acct__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="acct__name">{name}</span>
        <span className="acct__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      <div
        className="acct__menu"
        role="menu"
        aria-label="账号"
        data-open={open ? "true" : "false"}
        inert={!open}
      >
        <Link
          role="menuitem"
          className="acct__item"
          to="/profile"
          onClick={() => setOpen(false)}
        >
          个人中心
        </Link>
        <Link
          role="menuitem"
          className="acct__item"
          to="/records"
          onClick={() => setOpen(false)}
        >
          诊断记录
        </Link>
        <button
          role="menuitem"
          type="button"
          className="acct__item"
          onClick={async () => {
            setOpen(false)
            await signOut()
            navigate("/")
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  )
}
