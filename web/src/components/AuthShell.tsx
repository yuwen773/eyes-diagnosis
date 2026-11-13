import { type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Wordmark } from "@/components/shell/Wordmark"
import { useTheme } from "@/components/theme-provider"
import "@/styles/auth.css"

/**
 * 认证壳：蓝青光学品牌背景 + Layered Glass 表单（Visual Completion U6）。
 *
 * <p>认证页是用户端品牌体验，与首页同属一个品牌：钴蓝 / 银蓝 / 冰青的光学
 * 画布，金属虹膜标 + Manrope 字标与首页连续。背景是纯 CSS 光学资产
 * （同心环虹膜 + 两道品牌渐变 + 校准网格），不引入第二个 GPU 渲染器；
 * 动效仅一层缓慢的光学漂移，尊重 prefers-reduced-motion，且只是氛围
 * （不暗示任何业务事件）。
 *
 * <p>登录注册逻辑、重定向、错误反馈与安全机制全部留在页面组件里，这里
 * 只负责外壳排版。
 */
export function AuthShell({
  kicker,
  title,
  sub,
  children,
}: {
  kicker: string
  title: string
  sub: string
  children: ReactNode
}) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  return (
    <div className={"auth-auth " + (dark ? "is-dark" : "is-light")} data-theme={dark ? "dark" : "light"}>
      {/* 光学背景层：全部 aria-hidden，纯装饰，不参与信息。 */}
      <div className="auth-auth__optics" aria-hidden="true">
        <span className="auth-auth__grid-bg" />
        <span className="auth-auth__wash" />
        <span className="auth-auth__iris" />
        <span className="auth-auth__beam" />
      </div>

      <div className="auth-auth__grid">
        <aside className="auth-auth__aside">
          <div className="auth-auth__brand">
            <Link to="/" aria-label="返回首页">
              <Wordmark />
            </Link>
            <span className="auth-auth__code num">IRIS · AUTH</span>
          </div>

          <div className="auth-auth__statement-wrap">
            <p className="auth-auth__statement">
              每一次判读，
              <br />
              都留下可以核对的记录。
            </p>
            <p className="auth-auth__statement-en">
              Every reading leaves a record worth checking.
            </p>
            <p className="auth-auth__note">
              判读记录只在本人账号下可见。每条记录保留模型版本与权重指纹，供复核时核对。
            </p>
          </div>

          <ul className="auth-auth__trust" aria-label="平台可信信息">
            <li>
              <span>会话</span>
              <b>登录态 · 服务端会话</b>
            </li>
            <li>
              <span>影像</span>
              <b>对象存储 · 私有读</b>
            </li>
            <li>
              <span>留痕</span>
              <b>模型版本 + 权重指纹</b>
            </li>
          </ul>
        </aside>

        <main className="auth-auth__panel">
          <div className="auth-auth__stack">
            <div className="auth-auth__glass">
              <p className="overline">{kicker}</p>
              <h1 className="auth-auth__title">{title}</h1>
              <p className="auth-auth__sub">{sub}</p>
              {children}
            </div>

            <p className="auth-auth__foot num">
              AI 辅助判读 · 不构成临床诊断结论
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
