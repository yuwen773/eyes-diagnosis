import "@/styles/admin.css"

import { Link, NavLink, Outlet } from "react-router-dom"
import {
  ArrowLeft,
  ChartColumn,
  LayoutDashboard,
  Library,
  Newspaper,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { useSession } from "@/lib/session"

/** 侧栏六项。导出供测试/复用；路由与占位页编号同源。 */
export const ADMIN_NAV = [
  { to: "/admin/dashboard", code: "01", label: "仪表盘", icon: LayoutDashboard },
  { to: "/admin/users", code: "02", label: "用户管理", icon: Users },
  { to: "/admin/news", code: "03", label: "新闻管理", icon: Newspaper },
  { to: "/admin/diagnosis", code: "04", label: "诊断管理", icon: Stethoscope },
  { to: "/admin/knowledge", code: "05", label: "知识库", icon: Library },
  { to: "/admin/data-analysis", code: "06", label: "数据分析", icon: ChartColumn },
] as const satisfies ReadonlyArray<{ to: string; code: string; label: string; icon: LucideIcon }>

/**
 * 管理后台外壳：仪表梁 + 紫色 SaaS 侧栏 + 内容区。
 * 主题切换直接复用全站 ThemeProvider 的 useTheme 与共享顶栏的半满读数环。
 * 管理端不挂载产品顶栏（R2.5，DESIGN.md §1.6），侧栏才是它的导航。
 *
 * 外壳吃 .is-admin 管理语境（tokens.css）：浅色是浅紫灰画布 + 紫白侧栏 +
 * 管理紫当前态，暗色整体翻成深紫蓝分层面板——外壳与内容区永远同主题，
 * 不出现「深色外壳 + 浅色内容」的割裂。医学语义（--risk-*）不进外壳。
 */
export function AdminLayout() {
  const { resolvedTheme, setTheme } = useTheme()
  const { user } = useSession()
  const accountName = user?.userName || user?.userAccount || "管理员"

  return (
    <div className="is-admin admin-shell">
      <header className="admin-beam">
        <div className="admin-beam__inner">
          <Link to="/" className="admin-beam__back">
            <ArrowLeft className="admin-beam__back-mark" size={14} strokeWidth={2} aria-hidden="true" />
            返回主站
          </Link>

          <span className="admin-beam__sep" aria-hidden="true" />

          <span className="admin-beam__plate">
            <span className="admin-beam__plate-zh">Iris · 系统管理</span>
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

      <aside className="admin-side">
        <nav className="admin-side__nav" aria-label="系统管理导航">
          {ADMIN_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className="admin-side__link">
              <item.icon className="admin-side__icon" size={15} strokeWidth={1.75} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-side__foot num">Iris · ADMINISTRATION / 系统管理</div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
