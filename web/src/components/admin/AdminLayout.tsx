import "@/styles/admin.css"
import "@/styles/admin-redesign.css"

import { useState, type ReactElement } from "react"
import { Link, Outlet, useLocation } from "react-router-dom"
import { ArrowLeft, ChevronRight, Menu, Moon, Sun, X } from "lucide-react"

import { Dialog } from "@/components/ui/dialog"
import { useTheme } from "@/components/theme-provider"
import { AccountMenu } from "@/components/AccountMenu"
import { useSession } from "@/lib/session"
import { ADMIN_NAV, AdminBrand, AdminNav } from "./AdminNav"

/** 侧栏导航数据源（历史出口保留：外部按 ADMIN_NAV 取路由与编号）。 */
export { ADMIN_NAV } from "./AdminNav"

/**
 * 主题切换：两态分段控件。
 *
 * <p>不再是「一个圆环按钮 + 悬停变紫」——那读不出当前在哪一侧。
 * 分段控件把「浅色 / 深色」两个真实状态摆出来，当前段是实心紫面，
 * 与侧栏当前导航态同一套视觉语言。
 */
function ThemeSwitch(): ReactElement {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <div className="admin-theme" role="group" aria-label="主题切换">
      <button
        type="button"
        className="admin-theme__btn"
        aria-pressed={resolvedTheme === "light"}
        onClick={() => setTheme("light")}
        title="浅色主题"
        aria-label="切换到浅色主题"
      >
        <Sun size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="admin-theme__btn"
        aria-pressed={resolvedTheme === "dark"}
        onClick={() => setTheme("dark")}
        title="深色主题"
        aria-label="切换到深色主题"
      >
        <Moon size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * 管理后台外壳：左侧常驻导航 + 右侧工作区（自带 Topbar）。
 *
 * <p>结构（Iris 2.1）：侧栏从视口顶部开始，右侧工作区有自己的顶栏——
 * 顶栏只回答「我在哪、我是谁、什么主题」，不再重复 Iris 品牌铭牌；
 * 品牌与「返回主站」收在侧栏底部，形成一条清晰的「工作台 ↔ 主站」回路。
 *
 * <p>顶栏、侧栏、内容区共用同一组尺寸令牌（--admin-side-w /
 * --admin-topbar-h / --gutter / --admin-maxw），三者的左右缘因此始终对齐。
 *
 * <p>窄屏（≤900px）侧栏收成抽屉：顶栏左侧的菜单钮打开 Base UI Dialog
 * 抽屉，导航内容与桌面侧栏同源（ADMIN_NAV 一份），不另写一套横向标签条。
 * 抽屉自带一个显式关闭按钮——窄屏没有 Esc 键可依赖。
 *
 * <p>外壳吃 .is-admin 管理语境（tokens.css）：浅色是浅紫灰画布 + 紫白侧栏 +
 * 管理紫当前态，暗色整体翻成深紫蓝分层面板——外壳与内容区永远同主题，
 * 不出现「深色外壳 + 浅色内容」的割裂。医学语义（--risk-*）不进外壳。
 */
export function AdminLayout(): ReactElement {
  const { user } = useSession()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  // 抽屉里点导航后自动收起；浏览器前进后退换路由时同样收起。
  // 用「渲染期校正状态」而不是 effect：换路由就是换了一页，抽屉不该留着。
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setNavOpen(false)
  }

  const accountRole = user?.userRole === "admin" ? "系统管理员" : "管理账号"

  // 面包屑取当前路由，不写死页名：新增管理路由自动跟上。
  const current = ADMIN_NAV.find((item) => location.pathname.startsWith(item.to))
  const currentLabel = current?.label ?? "系统管理"

  return (
    <div className="is-admin admin-shell">
      <aside className="admin-side">
        <AdminBrand />
        <AdminNav />
        <div className="admin-side__foot">
          <Link to="/" className="admin-side__back">
            <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
            返回主站
          </Link>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-topbar__inner">
            <button
              type="button"
              className="admin-topbar__menu"
              onClick={() => setNavOpen(true)}
              aria-label="打开系统管理导航"
            >
              <Menu size={18} strokeWidth={1.9} aria-hidden="true" />
            </button>

            <nav className="admin-crumbs" aria-label="当前位置">
              <span className="admin-crumbs__root">系统管理</span>
              <ChevronRight className="admin-crumbs__sep" size={13} strokeWidth={2} aria-hidden="true" />
              <span className="admin-crumbs__current" aria-current="page">
                {currentLabel}
              </span>
            </nav>

            <div className="admin-topbar__right">
              <ThemeSwitch />
              {/* 账户身份只在这里出现一次：顶栏承载头像 / 姓名 / 角色，
                  侧栏不再叠一张账户卡。 */}
              <AccountMenu variant="admin" roleLabel={accountRole} />
            </div>
          </div>
        </header>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>

      <Dialog
        open={navOpen}
        title="系统管理导航"
        onClose={() => setNavOpen(false)}
        className="is-admin admin-navdrawer"
      >
        <div className="admin-navdrawer__head">
          <AdminBrand />
          <button
            type="button"
            className="admin-navdrawer__close"
            onClick={() => setNavOpen(false)}
            aria-label="关闭系统管理导航"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <AdminNav onNavigate={() => setNavOpen(false)} />
        <div className="admin-side__foot">
          <Link to="/" className="admin-side__back" onClick={() => setNavOpen(false)}>
            <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
            返回主站
          </Link>
        </div>
      </Dialog>
    </div>
  )
}
