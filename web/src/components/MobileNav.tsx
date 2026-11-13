import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useSession } from "@/lib/session"
import { NAV_LINKS } from "./shell/navLinks"

/**
 * 移动端导航。顶栏收成一个汉堡按钮，点开是左侧滑入的窄抽屉；
 * 桌面端这整块不显示（见 .burger / .drawer 的媒体查询）。
 */
export function MobileNav() {
  const { user, status, signOut } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)

    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true })

    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // 焦点锁在抽屉里，别跑到后面的页面上去。
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    )
    if (!nodes || nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const authed = status === "authed" && user

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="burger"
        aria-label="打开导航"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="burger__bars" aria-hidden="true">
          <span />
          <span />
        </span>
      </button>

      <div
        className="scrim"
        data-open={open ? "true" : "false"}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />

      <div
        id="mobile-nav"
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="主导航"
        aria-hidden={!open}
        data-open={open ? "true" : "false"}
        inert={!open}
        onKeyDown={trap}
      >
        <div className="drawer__head">
          <span className="overline">导航 · NAVIGATION</span>
          <button
            type="button"
            className="drawer__close"
            aria-label="关闭导航"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>

        <nav className="drawer__nav" aria-label="产品">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="drawer__link"
              onClick={() => setOpen(false)}
            >
              <item.icon size={15} strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="drawer__rule" aria-hidden="true" />

        <nav className="drawer__nav" aria-label="账号">
          {authed ? (
            <>
              <Link to="/profile" className="drawer__link" onClick={() => setOpen(false)}>
                个人中心
              </Link>
              <Link to="/records" className="drawer__link" onClick={() => setOpen(false)}>
                判读记录
              </Link>
              <button
                type="button"
                className="drawer__link"
                onClick={async () => {
                  setOpen(false)
                  await signOut()
                  navigate("/")
                }}
              >
                退出登录
              </button>
            </>
          ) : (
            <Link to="/login" className="drawer__link" onClick={() => setOpen(false)}>
              登录
            </Link>
          )}
        </nav>
      </div>
    </>
  )
}
