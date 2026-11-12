import { useRef } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"

import { AccountMenu } from "@/components/AccountMenu"
import { MobileNav } from "@/components/MobileNav"
import { NAV_LINKS, Wordmark } from "@/components/SiteHeader"
import { useTheme } from "@/components/theme-provider"

/**
 * 品牌层顶栏：字标 + **中央悬浮胶囊导航** + 右侧功能区。
 *
 * <p>这是 `SiteHeader` 的品牌变体，不是全站替换：只挂在品牌场景页面，
 * 类名 `.brand-head` 与 `.site-head` 完全分离——改这里不会让临床页、管理端
 * 或协作台被动获得玻璃顶栏（DESIGN.md §2.1.2）。
 *
 * <p>胶囊用 **Frosted Glass** 材质（`.brand-panel--frosted`），当前路由有独立
 * 高亮胶囊。
 *
 * <p>移动端不把胶囊压扁塞进 390px：导航收进既有 `MobileNav` 抽屉，
 * 抽屉的路由、认证、焦点与滚动锁逻辑原样复用。
 */
export function BrandHeader() {
  const headerRef = useRef<HTMLElement | null>(null)
  const location = useLocation()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    // `data-site-head` 是 ScrollExpand 量顶栏高度用的通用标记（它判断黑画面
    // 有没有压到顶栏下沿），不是样式类，跟 `.site-head` 没有耦合。
    <header
      ref={headerRef}
      className="brand-head no-print"
      data-brand-head
      data-site-head
    >
      {/* 换路由就重挂：下拉与抽屉的状态自然回到初始。 */}
      <div className="brand-head__inner" key={location.pathname}>
        <Link to="/" aria-label="Iris 首页" className="brand-head__brand">
          <Wordmark />
        </Link>

        <nav className="brand-head__nav brand-panel brand-panel--frosted" aria-label="主导航">
          {NAV_LINKS.map((item) => (
            <NavLink key={item.to} to={item.to} className="brand-head__link" data-cursor>
              <span className="brand-head__code num" aria-hidden="true">
                {item.code}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="brand-head__actions">
          <button
            type="button"
            className="theme-toggle"
            data-cursor
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={resolvedTheme === "dark" ? "切换到浅色主题" : "切换到暗色主题"}
            title={resolvedTheme === "dark" ? "切换到浅色" : "切换到暗色"}
          >
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

          <Link to="/diagnosis" className="brand-head__cta" data-cursor>
            开始判读
            <span className="brand-head__cta-go" aria-hidden="true">
              ↗
            </span>
          </Link>

          <MobileNav />
        </div>
      </div>
    </header>
  )
}
