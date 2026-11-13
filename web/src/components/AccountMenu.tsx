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

  // 收起前留一点迟疑：从头像斜着划到菜单的路上会短暂离开 .acct，
  // 立刻收会让菜单够不着（CSS 里那道 10px 的桥只挡住垂直方向）。
  const closeTimer = useRef<number | null>(null)

  const showMenu = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setOpen(true)
  }

  const hideMenuSoon = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, 180)
  }

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

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
      onPointerEnter={canHover ? showMenu : undefined}
      onPointerLeave={canHover ? hideMenuSoon : undefined}
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
        {user.userRole === "admin" ? (
          <Link
            role="menuitem"
            className="acct__item"
            to="/admin"
            onClick={() => setOpen(false)}
          >
            系统管理
          </Link>
        ) : null}
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
        {["doctor", "admin"].includes(user.userRole ?? "") &&
          import.meta.env.VITE_COLLABORATION_ENABLED === "true" && (
            <Link
              role="menuitem"
              className="acct__item"
              to="/doctor-reviews"
              onClick={() => setOpen(false)}
            >
              医生复核
            </Link>
          )}
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
