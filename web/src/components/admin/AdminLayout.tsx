import "@/styles/admin.css"
import "@/styles/admin-redesign.css"

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
 * 侧栏分组：按「管理员此刻在做什么」切，不按功能数量平均分。
 * 编号仍取自 ADMIN_NAV，路由与顺序只有一份真源。
 */
const ADMIN_GROUPS = [
  { label: "概览", codes: ["01"] },
  { label: "业务管理", codes: ["02", "04"] },
  { label: "内容与知识", codes: ["03", "05"] },
  { label: "分析", codes: ["06"] },
] as const

/** 品牌标：同心虹膜。只用几何圆，不做发光 / 粒子。 */
function IrisMark() {
  return (
    <svg className="admin-side__mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="currentColor" strokeOpacity="0.28" />
      <circle cx="16" cy="16" r="8.6" fill="none" stroke="currentColor" strokeOpacity="0.55" />
      <circle cx="16" cy="16" r="4.2" fill="currentColor" />
      <path d="M16 2.8 A13.2 13.2 0 0 1 29.2 16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

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
  const accountRole = user?.userRole === "admin" ? "系统管理员" : "管理账号"
  const initial = accountName.slice(0, 1)

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
        <div className="admin-side__brand">
          <span className="admin-side__brand-mark">
            <IrisMark />
          </span>
          <span className="admin-side__brand-text">
            <span className="admin-side__brand-name">Iris</span>
            <span className="admin-side__brand-sub num">MEDICAL SAAS</span>
          </span>
        </div>

        <nav className="admin-side__nav" aria-label="系统管理导航">
          {ADMIN_GROUPS.map((group) => (
            <div className="admin-side__group" key={group.label}>
              <p className="admin-side__group-label">{group.label}</p>
              {ADMIN_NAV.filter((item) => (group.codes as readonly string[]).includes(item.code)).map(
                (item) => (
                  <NavLink key={item.to} to={item.to} className="admin-side__link">
                    <span className="admin-side__icon" aria-hidden="true">
                      <item.icon size={16} strokeWidth={1.75} />
                    </span>
                    <span className="admin-side__label">{item.label}</span>
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="admin-side__foot">
          <span className="admin-side__avatar" aria-hidden="true">
            {user?.userAvatar ? <img src={user.userAvatar} alt="" /> : initial}
          </span>
          <span className="admin-side__foot-text">
            <span className="admin-side__foot-name">{accountName}</span>
            <span className="admin-side__foot-role">{accountRole}</span>
          </span>
          <span className="admin-side__foot-status" role="status">
            <span className="sr-only">已登录</span>
          </span>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
