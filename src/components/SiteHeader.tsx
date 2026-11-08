import { useEffect, useRef, type RefObject } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { AccountMenu } from "./AccountMenu"
import { MobileNav } from "./MobileNav"

/** 跨产品的目的地。落地页自己的章节不在这里，章节链接放在页脚。 */
export const NAV_LINKS = [
  { to: "/diagnosis", label: "判读", code: "01" },
  { to: "/agent", label: "诊断 Agent", code: "02" },
  { to: "/news", label: "新闻资讯", code: "03" },
]

/**
 * 铭牌：虹膜标记 + 中文品名 + 英文 mono 副标。
 *
 * 虹膜标记是一枚刻度环——落地页的准星、判读页的取景器都是同一套仪器语言，
 * 品牌处也应该有一枚。环随 hover 转动，瞳孔是全站唯一强调色的落点之一。
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark">
      <span className="wordmark__iris" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          {/* 刻度环：16 短刻 */}
          <circle
            className="wordmark__iris-ring"
            cx="12"
            cy="12"
            r="10.5"
            pathLength={64}
            strokeDasharray="0.5 3.5"
          />
          {/* 瞳孔 */}
          <circle cx="12" cy="12" r="3.2" fill="var(--signal)" stroke="none" />
        </svg>
      </span>
      <span className="wordmark__zh">眼瞳</span>
      {compact ? null : <span className="wordmark__en">IRIS · FUNDUS READING</span>}
    </span>
  )
}

/**
 * 顶栏压到深色区段上时反相。
 *
 * 区段用 data-head-invert="true" 标记；ScrollExpand 要等黑画面真正盖到顶栏
 * 下沿才会打上这个标记，所以判定用「顶栏下沿是否落在标记区段内」就够了。
 */
function useHeadInvert(ref: RefObject<HTMLElement | null>, pathname: string) {
  const checkRef = useRef<() => void>(() => {})

  useEffect(() => {
    let raf = 0

    const check = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const navH = el.offsetHeight

      const matched = Array.from(
        document.querySelectorAll<HTMLElement>('[data-head-invert="true"]'),
      ).find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.top <= navH && rect.bottom > navH
      })

      if (!matched) {
        el.classList.remove("is-invert")
        el.style.background = ""
        return
      }

      // 顶栏的底色跟着它下面那块深色区段走：照片是纯黑，深色段是墨色。
      const style = getComputedStyle(matched)
      const custom = style.getPropertyValue("--head-bg").trim()
      el.classList.add("is-invert")
      el.style.background = custom || style.backgroundColor
    }

    checkRef.current = check

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }

    schedule()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [ref])

  // 路由一变就重新判一次，别把上一页的反相状态带到新页面。
  useEffect(() => {
    checkRef.current()
  }, [pathname])
}

export function SiteHeader() {
  const headerRef = useRef<HTMLElement | null>(null)
  const location = useLocation()
  useHeadInvert(headerRef, location.pathname)

  return (
    <header ref={headerRef} className="site-head no-print" data-site-head>
      {/* 换路由就重挂：下拉与抽屉的状态自然回到初始。 */}
      <div className="wrap site-head__inner" key={location.pathname}>
        <Link to="/" aria-label="眼瞳 IRIS 首页" className="site-head__brand">
          <Wordmark />
        </Link>

        <span className="site-head__sep" aria-hidden="true" />

        <nav className="nav" aria-label="主导航">
          {NAV_LINKS.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav__link" data-cursor>
              <span className="nav__code num" aria-hidden="true">
                {item.code}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <AccountMenu />

        <MobileNav />
      </div>
    </header>
  )
}
