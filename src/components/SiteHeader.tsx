import { useEffect, useRef, type RefObject } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { AccountMenu } from "./AccountMenu"
import { MobileNav } from "./MobileNav"
import { useTheme } from "./theme-provider"

/** 跨产品的目的地。落地页自己的章节不在这里，章节链接放在页脚。 */
export const NAV_LINKS = [
  { to: "/diagnosis", label: "判读", code: "01" },
  { to: "/agent", label: "诊断 Agent", code: "02" },
  { to: "/news", label: "新闻资讯", code: "03" },
]

/**
 * 铭牌：虹膜标记 + 品名 + 英文 mono 副标。
 *
 * 虹膜标记是金属虹膜标：两片错开的月牙夹一枚橙色星芒，读起来是一只眼睛。
 * 浅色底用暗金属那版，深色底用亮金属那版——渐变在 SVG 里，
 * 不用 CSS filter 反相（反相会把金属高光变成脏灰）。
 * 两版一起挂在 DOM 里，靠 <html>.dark 切换，主题切换是即时的，也不会有闪烁。
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark">
      <span className="wordmark__iris" aria-hidden="true">
        <img
          className="wordmark__mark wordmark__mark--light"
          src="/iris-mark-metallic-light.svg"
          alt=""
          width={30}
          height={30}
        />
        <img
          className="wordmark__mark wordmark__mark--dark"
          src="/iris-mark-metallic-dark.svg"
          alt=""
          width={30}
          height={30}
        />
      </span>
      <span className="wordmark__zh">Iris</span>
      {compact ? null : <span className="wordmark__en">FUNDUS READING</span>}
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
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <header ref={headerRef} className="site-head no-print" data-site-head>
      {/* 换路由就重挂：下拉与抽屉的状态自然回到初始。 */}
      <div className="wrap site-head__inner" key={location.pathname}>
        <Link to="/" aria-label="Iris 首页" className="site-head__brand">
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

        <button
          type="button"
          className="theme-toggle"
          data-cursor
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label={resolvedTheme === "dark" ? "切换到浅色主题" : "切换到暗色主题"}
          title={resolvedTheme === "dark" ? "切换到浅色" : "切换到暗色"}
        >
          {/* 环上是一半描边一半实心：亮一半暗一半，当前侧实心。 */}
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1" />
            {resolvedTheme === "dark" ? (
              <path d="M8 1.6 A6.4 6.4 0 0 1 8 14.4 Z" fill="currentColor" />
            ) : (
              <path d="M8 1.6 A6.4 6.4 0 0 0 8 14.4 Z" fill="currentColor" />
            )}
          </svg>
        </button>

        <AccountMenu />

        <MobileNav />
      </div>
    </header>
  )
}
