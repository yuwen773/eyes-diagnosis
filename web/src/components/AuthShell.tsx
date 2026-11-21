import { useMemo, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import Threads from "@/components/brand/Threads"
import { Wordmark } from "@/components/shell/Wordmark"
import { useTheme } from "@/components/theme-provider"
import { useMediaQuery } from "@/lib/useMediaQuery"
import "@/styles/auth.css"

/**
 * 认证壳：蓝青光学品牌背景 + Layered Glass 表单（Visual Completion U6）。
 *
 * <p>认证页是用户端品牌体验，与首页同属一个品牌：钴蓝 / 银蓝 / 冰青的光学
 * 画布，光学虹膜标 + Manrope 字标与首页连续。背景主视觉是 vendored 的
 * React Bits · Threads（裸 WebGL2 纤维光场，许可见 `brand/THIRD-PARTY-NOTICES.md`），
 * 全页只有一个 GPU 渲染器。
 *
 * <p>降级路径（都保留可读且美观的静态画面）：
 * <ul>
 *   <li>WebGL2 不可用 / 着色器编译失败 / `webglcontextlost` → 切回纯 CSS 光学资产
 *       （同心环虹膜 + 品牌光带 + 一层缓慢漂移的柔光）；</li>
 *   <li>`prefers-reduced-motion: reduce` → 引擎停在当前帧（不跑 rAF 循环）；</li>
 *   <li>离屏 / 标签页隐藏 → 引擎停机（引擎自带 IntersectionObserver 与
 *       visibilitychange 监听）。</li>
 * </ul>
 *
 * <p>画布是纯装饰（`aria-hidden`），不暗示任何业务事件。登录注册逻辑、重定向、
 * 错误反馈与安全机制全部留在页面组件里，这里只负责外壳排版。
 */

/**
 * 读取品牌令牌作为着色器颜色。
 *
 * <p>WebGL uniform 只吃具体色值，吃不了 `var()`；在主题切换时解析一次，
 * 让 `--brand-primary` / `--brand-cyan` 保持唯一真源。
 * jsdom / 无样式环境下读不到值，退回调用方给的常量。
 */
function tokenRgb(name: string, fallback: [number, number, number]): [number, number, number] {
  if (typeof window === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(raw)
  if (!hex) return fallback
  const value = Number.parseInt(hex[1], 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

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
  const narrow = useMediaQuery("(max-width: 900px)")
  // 先按「有 WebGL2」渲染；引擎报不可用或丢上下文后切回 CSS 光学资产。
  const [live, setLive] = useState(true)

  const fiber = useMemo(
    () => ({
      color: tokenRgb("--brand-primary", dark ? [0.52, 0.71, 1] : [0.14, 0.34, 0.79]),
      accent: tokenRgb("--brand-cyan", dark ? [0.38, 0.84, 0.9] : [0, 0.44, 0.51]),
    }),
    [dark],
  )

  return (
    <div className={"auth-auth " + (dark ? "is-dark" : "is-light")} data-theme={dark ? "dark" : "light"}>
      {/* 光学背景层：全部 aria-hidden，纯装饰，不参与信息。 */}
      <div
        className={"auth-auth__optics" + (live ? " auth-auth__optics--fibers" : "")}
        aria-hidden="true"
      >
        <span className="auth-auth__wash" />
        {live ? (
          <Threads
            color={fiber.color}
            accentColor={fiber.accent}
            lineCount={narrow ? 64 : 130}
            thickness={0.8}
            softness={1.5}
            speed={0.5}
            amplitude={2.3}
            opacity={narrow ? 0.8 : dark ? 1 : 0.95}
            brightness={dark ? 1.5 : 1.7}
            angle={22}
            enableMouseInteraction
            onUnavailable={() => setLive(false)}
          />
        ) : (
          <>
            <span className="auth-auth__iris" />
            <span className="auth-auth__beam" />
          </>
        )}
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
              AI 先判读，
              <br />
              依据留在记录里。
            </p>
            <p className="auth-auth__statement-en">
              AI reads first. The evidence stays on record.
            </p>
            <p className="auth-auth__note">
              判读记录归在你的账号下：其他账号看不到，管理员与获指派的复核人可查看。
            </p>
          </div>

          <p className="auth-auth__trust-line">
            模型版本、权重指纹和人工复核状态都随记录保留，复核时可以逐项核对。
          </p>
        </aside>

        <main id="main-content" tabIndex={-1} className="auth-auth__panel">
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
