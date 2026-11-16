import { useCallback, useEffect, useState, type ReactElement } from "react"

import Prism from "./Prism"
import { useMediaQuery } from "@/lib/useMediaQuery"

/**
 * 首屏光学主视觉：Prism。
 *
 * <p>Prism 是 React Bits 的 WebGL2 棱镜光场（vendored，见 THIRD-PARTY-NOTICES.md）。
 * 这一层只做四件事：
 * <ul>
 *   <li>把品牌色板喂给着色器——亮色是钴蓝/青的墨，暗色是冰蓝/极光的发光体；</li>
 *   <li>把 `prefers-reduced-motion` 折算成 `timeScale = 0`，画面冻结在当前帧，
 *       而不是换一张图；</li>
 *   <li>自动循环只跑 5 秒（`data-mode="settled"` 后停住），不设手动暂停控件；</li>
 *   <li>WebGL2 不可用 / 着色器失败 / 上下文丢失时切到静态棱镜。</li>
 * </ul>
 *
 * <p>画布是纯装饰：整块 `aria-hidden`，医学信息一律在 DOM 文本里。
 */

type Theme = "light" | "dark"

/**
 * 首屏动效窗口：intro 1.4s + 约 3.6s 旋转，满 5s 后停在当前相位。
 * 不设手动暂停控件；系统 reduced-motion 仍可随时立即冻结。
 */
const MOTION_WINDOW_MS = 5000

export type HeroPrismProps = {
  theme: Theme
  className?: string
}

/**
 * 多色复合，但不用 Prism 的整条彩虹：品牌蓝/青打底，紫、暖琥珀、
 * 玫瑰只作为棱镜边缘的色散出现。`colors` 是循环色带，相邻两色会被
 * 插值成连续光；亮色走 `lightMode`（色相压成墨），暗色走加色发光。
 */
const PALETTES: Record<Theme, string[]> = {
  light: ["#2457c9", "#c9843a", "#2e8bdd", "#b44f6b", "#006f82", "#6b56c5"],
  dark: ["#85b5ff", "#e8b06a", "#60d7e6", "#e08aa2", "#7ce6fb", "#c0acff"],
}

export function HeroPrism({ theme, className }: HeroPrismProps): ReactElement {
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)")
  const narrow = useMediaQuery("(max-width: 1024px)")
  const [unavailable, setUnavailable] = useState(false)
  const [settled, setSettled] = useState(false)
  const handleUnavailable = useCallback(() => setUnavailable(true), [])

  // 自动循环动效只跑一个窗口，之后冻结在当前相位；不增加手动暂停控件。
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), MOTION_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const lowEnd =
    typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4
  const frozen = reduce || settled
  const mode = unavailable ? "static" : reduce ? "frozen" : settled ? "settled" : "live"
  const classes = ["hero-prism", className].filter(Boolean).join(" ")

  return (
    <div
      className={classes}
      data-mode={mode}
      data-theme={theme}
      aria-hidden="true"
    >
      {unavailable ? (
        <StaticPrism theme={theme} />
      ) : (
        <Prism
          animationType="rotate"
          timeScale={frozen ? 0 : 0.3}
          height={narrow ? 4.6 : 4.8}
          baseWidth={narrow ? 7.2 : 7.6}
          scale={narrow ? 3.8 : 4.4}
          offset={{ x: 0, y: narrow ? -8 : -4 }}
          colors={PALETTES[theme]}
          glow={0.75}
          saturation={theme === "light" ? 1.4 : 1.6}
          colorFrequency={2}
          noise={frozen ? 0 : theme === "light" ? 0.03 : 0.05}
          interactive={!lowEnd}
          hoverStrength={1.5}
          inertia={0.05}
          intro
          resolution={lowEnd ? 0.35 : 0.5}
          lightMode={theme === "light"}
          dpr={lowEnd ? 1 : 1.5}
          onUnavailable={handleUnavailable}
        />
      )}
    </div>
  )
}

/**
 * 静态棱镜：WebGL2 不可用 / 上下文丢失时的降级画面。
 *
 * <p>与动态版同一构图语言——一枚三角棱镜 + 右侧光束扇 + 环境光晕，
 * 只是不动。颜色全部走 CSS 类，双主题在 `brand.css` 里换一组值。
 */
function StaticPrism({ theme }: { theme: Theme }): ReactElement {
  return (
    <svg
      className="hero-prism__fallback"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
      data-theme={theme}
    >
      <defs>
        <radialGradient id="hero-prism-halo" cx="0.58" cy="0.46" r="0.5">
          <stop offset="0" className="hero-prism__halo-core" />
          <stop offset="1" className="hero-prism__halo-fade" />
        </radialGradient>
        <linearGradient id="hero-prism-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="hero-prism__face-a" />
          <stop offset="1" className="hero-prism__face-b" />
        </linearGradient>
        <linearGradient id="hero-prism-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="hero-prism__edge-a" />
          <stop offset="1" className="hero-prism__edge-b" />
        </linearGradient>
      </defs>

      <ellipse cx="468" cy="288" rx="300" ry="220" fill="url(#hero-prism-halo)" />

      <g className="hero-prism__rays">
        <path d="M560 300 L812 218" />
        <path d="M560 300 L812 262" />
        <path d="M560 300 L812 300" />
        <path d="M560 300 L812 338" />
        <path d="M560 300 L812 382" />
      </g>

      <g className="hero-prism__body">
        <path
          className="hero-prism__face"
          d="M470 132 L646 446 L294 446 Z"
          fill="url(#hero-prism-face)"
          stroke="url(#hero-prism-edge)"
        />
        <path className="hero-prism__facet" d="M470 132 L470 446" />
        <path className="hero-prism__facet" d="M470 132 L294 446" />
        <path className="hero-prism__facet" d="M470 132 L646 446" />
        <path className="hero-prism__facet hero-prism__facet--base" d="M294 446 L646 446" />
      </g>
    </svg>
  )
}
