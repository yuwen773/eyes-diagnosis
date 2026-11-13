import { Link, NavLink, useLocation } from "react-router-dom"

import { AccountMenu } from "@/components/AccountMenu"
import { MobileNav } from "@/components/MobileNav"
import { useTheme } from "@/components/theme-provider"
import { NAV_LINKS } from "./navLinks"
import { Wordmark } from "./Wordmark"

/**
 * 公开路由共享的产品顶栏（R2.5，DESIGN.md §1.6）。
 *
 * <p>**这才是唯一实现。** R2 阶段的 `BrandHeader` / `SiteHeader` 两套顶栏
 * 在这条分支上收敛成一个组件：结构、导航数据、主题切换、账号菜单、
 * 移动抽屉、路由变化重挂全部只写一遍。
 *
 * <p>**Visual Completion U2（DESIGN.md §2.1.2）**：所有用户端主页面共享同一套
 * Iris 悬浮玻璃导航身份——金属虹膜 Logo、Manrope 字标、钴蓝选中态、一致控件形态。
 * `scene` 只允许改**有限参数**（背景画布、空间密度），不再允许通过
 * `scene="clinical"` / `scene="intelligence"` 换回旧版纸面胶囊、橙色底线、
 * 实体仪器风格。首页 → 判读 → Agent → 新闻 → 记录 / 个人中心的导航视觉连续。
 *
 * <p>`data-site-head` 是 `ScrollExpand` 量顶栏高度用的通用标记，不是样式类。
 * 顶栏必须是页面直接子级——`position: sticky` 会被父盒的高度卡住。
 */
export type ProductScene = "brand" | "editorial" | "clinical" | "intelligence"

export function ProductHeader({ scene = "brand" }: { scene?: ProductScene }) {
  const location = useLocation()
  const { resolvedTheme, setTheme } = useTheme()

  // 已经在判读页时，再给一个「开始判读」CTA 只会占位；其余页面保留同一个入口。
  const showCta = location.pathname !== "/diagnosis"

  return (
    <header
      className="product-head no-print"
      data-product-head
      data-scene={scene}
      data-site-head
    >
      {/* 换路由就重挂：下拉与抽屉的状态自然回到初始。 */}
      <div className="product-head__inner" key={location.pathname}>
        <Link to="/" aria-label="Iris 首页" className="product-head__brand">
          <Wordmark />
        </Link>

        <nav className="product-head__nav" aria-label="主导航">
          {NAV_LINKS.map((item) => (
            <NavLink key={item.to} to={item.to} className="product-head__link" data-cursor>
              <span className="product-head__code num" aria-hidden="true">
                {item.code}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="product-head__actions">
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

          {showCta ? (
            <Link to="/diagnosis" className="product-head__cta" data-cursor>
              开始判读
              <span className="product-head__cta-go" aria-hidden="true">
                ↗
              </span>
            </Link>
          ) : null}

          <MobileNav />
        </div>
      </div>
    </header>
  )
}
