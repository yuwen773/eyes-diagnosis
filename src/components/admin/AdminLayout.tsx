import { Link, NavLink, Outlet } from "react-router-dom"
import { useTheme } from "@/components/theme-provider"
import { useSession } from "@/lib/session"

/** 侧栏六项。导出供测试/复用；路由与占位页编号同源。 */
export const ADMIN_NAV = [
  { to: "/admin/dashboard", code: "01", label: "仪表盘" },
  { to: "/admin/users", code: "02", label: "用户管理" },
  { to: "/admin/news", code: "03", label: "新闻管理" },
  { to: "/admin/diagnosis", code: "04", label: "诊断管理" },
  { to: "/admin/knowledge", code: "05", label: "知识库" },
  { to: "/admin/data-analysis", code: "06", label: "数据分析" },
] as const

/**
 * 管理后台外壳：仪表梁 + 侧栏恒定深墨（设备背面），内容区交给子路由。
 * 主题切换直接复用全站 ThemeProvider 的 useTheme 与 SiteHeader 的半满读数环。
 */
export function AdminLayout() {
  const { resolvedTheme, setTheme } = useTheme()
  const { user } = useSession()
  const accountName = user?.userName || user?.userAccount || "管理员"

  return (
    <div className="is-field admin-shell">
      <header className="is-dark admin-beam">
        <div className="admin-beam__inner">
          <Link to="/" className="admin-beam__back">
            <span className="admin-beam__back-mark" aria-hidden="true">
              ←
            </span>
            返回主站
          </Link>

          <span className="admin-beam__sep" aria-hidden="true" />

          <span className="admin-beam__plate">
            <span className="admin-beam__plate-zh">眼瞳 IRIS · 系统管理</span>
            <span className="admin-beam__plate-en num">/ ADMINISTRATION</span>
          </span>

          <div className="admin-beam__right">
            <span className="admin-beam__user">{accountName}</span>
            <button
              type="button"
              className="theme-toggle"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              aria-label={
                resolvedTheme === "dark" ? "切换到浅色主题" : "切换到暗色主题"
              }
              title={resolvedTheme === "dark" ? "切换到浅色" : "切换到暗色"}
            >
              {/* 环上是一半描边一半实心：亮一半暗一半，当前侧实心。 */}
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle
                  cx="8"
                  cy="8"
                  r="6.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                {resolvedTheme === "dark" ? (
                  <path d="M8 1.6 A6.4 6.4 0 0 1 8 14.4 Z" fill="currentColor" />
                ) : (
                  <path d="M8 1.6 A6.4 6.4 0 0 0 8 14.4 Z" fill="currentColor" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </header>

      <aside className="is-dark admin-side">
        <nav className="admin-side__nav" aria-label="系统管理导航">
          {ADMIN_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className="admin-side__link">
              <span className="admin-side__code num" aria-hidden="true">
                {item.code}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-side__foot num">IRIS · ADMINISTRATION / 系统管理</div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
