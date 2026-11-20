import { useCallback, useState, type CSSProperties, type ReactElement } from "react"
import { useSearchParams } from "react-router-dom"

import { ProductHeader } from "@/components/shell/ProductHeader"
import { useTheme } from "@/components/theme-provider"
import {
  HERO_VISUALS,
  HeroCompareStage,
  type HeroShell,
  type HeroVisual,
} from "@/components/brand/HeroCompareStage"

/**
 * E-09 · 三方案真实浏览器对照台（**仅设计评审用**）。
 *
 * <p>路由只在 `import.meta.env.DEV` 或构建期 `VITE_DESIGN_PREVIEW=true` 时注册，
 * 正式生产构建里根本不存在这条路由（见 `App.tsx`）。
 *
 * <p>三个方案共用 `HeroCompareStage` 的外壳，只切主视觉策略；切换时旧方案的
 * React 组件被卸载，它自己的 `dispose()` 会回收 WebGL 资源——所以同一时刻
 * 最多只有一个渲染循环在跑。
 *
 * <p>`?variant=optic|prism|fusion` 让截图脚本可以确定性地落到某个方案上；
 * `?shell=contained` 切到 multiagent 分支那种「壳内」构图。
 */

const VALID: HeroVisual[] = ["optic", "prism", "fusion"]

function readVariant(value: string | null): HeroVisual {
  return VALID.includes(value as HeroVisual) ? (value as HeroVisual) : "fusion"
}

function readShell(value: string | null): HeroShell {
  return value === "contained" ? "contained" : "bleed"
}

/**
 * 工具栏是 `position: fixed` 的浮层，**不占布局**：三个方案的首屏因此和原生页
 * 落在完全相同的纵向位置上，截图不必为它留补偿。`?bare=1` 把它整个收起来，
 * 截图脚本用这个参数取「只有外壳 + 主视觉」的画面。
 */
const barStyle: CSSProperties = {
  position: "fixed",
  left: 16,
  bottom: 16,
  zIndex: 40,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  maxWidth: "calc(100vw - 32px)",
  padding: "10px 14px",
  borderRadius: 16,
  border: "1px solid rgba(127, 145, 175, 0.36)",
  background: "rgba(248, 250, 253, 0.92)",
  backdropFilter: "blur(14px)",
  boxShadow: "0 18px 40px rgba(20, 40, 80, 0.16)",
  fontFamily: "var(--font-brand)",
  fontSize: 13,
}

const barStyleDark: CSSProperties = {
  ...barStyle,
  border: "1px solid rgba(150, 180, 220, 0.22)",
  background: "rgba(8, 14, 26, 0.9)",
  boxShadow: "0 18px 40px rgba(0, 0, 0, 0.42)",
}

const chipBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid rgba(127, 145, 175, 0.36)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  textDecoration: "none",
}

const chipActive: CSSProperties = {
  ...chipBase,
  borderColor: "#2457c9",
  background: "#2457c9",
  color: "#fff",
}

export function DesignHeroComparePage(): ReactElement {
  const [params, setParams] = useSearchParams()
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  const variant = readVariant(params.get("variant"))
  const shell = readShell(params.get("shell"))
  // `?paused=1` 让截图脚本能取到「冻结帧」：A / C 由工具栏同一个开关控制，
  // B（Prism）本身 5 秒后自动停住，脚本等过它的窗口即可。
  const [paused, setPaused] = useState(params.get("paused") === "1")

  const select = useCallback(
    (next: HeroVisual) => {
      const copy = new URLSearchParams(params)
      copy.set("variant", next)
      setParams(copy, { replace: true })
    },
    [params, setParams],
  )

  const selectShell = useCallback(
    (next: HeroShell) => {
      const copy = new URLSearchParams(params)
      if (next === "bleed") copy.delete("shell")
      else copy.set("shell", next)
      setParams(copy, { replace: true })
    },
    [params, setParams],
  )

  const active = HERO_VISUALS.find((item) => item.key === variant) ?? HERO_VISUALS[2]
  const bare = params.get("bare") === "1"

  return (
    <div className={(theme === "dark" ? "is-night " : "is-field ") + "night is-brand-page"}>
      <ProductHeader scene="brand" />

      {/* 对照工具栏：属于评审工具，不属于首屏外壳——三个方案看到的都是同一块。 */}
      {bare ? null : (
        <div style={theme === "dark" ? barStyleDark : barStyle} role="group" aria-label="方案对照工具">
          <strong style={{ fontWeight: 700, letterSpacing: "0.04em" }}>E-09 · 首屏主视觉对照</strong>

          {HERO_VISUALS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => select(item.key)}
              aria-pressed={item.key === variant}
              style={item.key === variant ? chipActive : chipBase}
            >
              <span aria-hidden="true">{item.code}</span>
              {item.name}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
            style={chipBase}
          >
            {paused ? "继续动效" : "暂停动效"}
          </button>

          <span style={{ opacity: 0.62, alignSelf: "center" }}>构图</span>
          <button
            type="button"
            onClick={() => selectShell("bleed")}
            aria-pressed={shell === "bleed"}
            style={shell === "bleed" ? chipActive : chipBase}
          >
            全幅
          </button>
          <button
            type="button"
            onClick={() => selectShell("contained")}
            aria-pressed={shell === "contained"}
            style={shell === "contained" ? chipActive : chipBase}
          >
            壳内
          </button>

          <a href="/" style={chipBase}>
            原生页面 /
          </a>

          <span style={{ opacity: 0.62 }}>{active.note}</span>
        </div>
      )}

      <main id="main-content" tabIndex={-1}>
        <HeroCompareStage visual={variant} theme={theme} paused={paused} shell={shell} />
      </main>
    </div>
  )
}
