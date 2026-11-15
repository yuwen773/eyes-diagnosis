import { NavLink } from "react-router-dom"
import {
  ChartColumn,
  LayoutDashboard,
  Library,
  Newspaper,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react"

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
export function IrisMark() {
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
 * 侧栏品牌位：Iris 标识 + 产品身份。
 *
 * <p>品牌只在侧栏出现一次——工作区顶栏不再重复品牌铭牌，顶栏给的是
 * 「当前位置」而不是第二块 logo。
 */
export function AdminBrand() {
  return (
    <div className="admin-side__brand">
      <span className="admin-side__brand-mark">
        <IrisMark />
      </span>
      <span className="admin-side__brand-text">
        <span className="admin-side__brand-name">Iris</span>
        <span className="admin-side__brand-sub num">MEDICAL SAAS</span>
      </span>
    </div>
  )
}

/**
 * 侧栏导航（分组 + 当前项紫色高亮）。
 *
 * <p>桌面侧栏与窄屏抽屉共用这一份——路由、编号、分组只有一处真源，
 * 窄屏不再另写一套横向标签条。
 */
export function AdminNav(props: { onNavigate?: () => void }) {
  const { onNavigate } = props
  return (
    <nav className="admin-side__nav" aria-label="系统管理导航">
      {ADMIN_GROUPS.map((group) => (
        <div className="admin-side__group" key={group.label}>
          <p className="admin-side__group-label">{group.label}</p>
          {ADMIN_NAV.filter((item) => (group.codes as readonly string[]).includes(item.code)).map(
            (item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="admin-side__link"
                onClick={onNavigate}
              >
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
  )
}
