import { useEffect, useRef, useState, type ReactElement } from "react"

import { mountBeams, type BeamsEngine, type BeamsSettings } from "./beamsMount"
import { useMediaQuery } from "@/lib/useMediaQuery"
import "@/styles/brand.css"

/**
 * 首屏光学主视觉。
 *
 * <p>一个渲染器，就一个：光带走 vendored 的 Beams（WebGL2，裸 GL，不引 Three.js）。
 * 细纤维材质是同一张画面上的**低成本 SVG 附加层**，不再起第二个 WebGL 循环——
 * 两套重型循环同时跑是明令禁止的。
 *
 * <p>降级路径（都保留可读且美观的静态画面）：
 * <ul>
 *   <li>WebGL2 不可用 / 着色器编译失败 → SVG 静态光带；</li>
 *   <li>`prefers-reduced-motion: reduce` → 引擎冻结在一帧（不跑 rAF 循环），
 *       纤维层也停掉位移动画；</li>
 *   <li>上下文丢失（webglcontextlost）→ 切回 SVG 静态光带；</li>
 *   <li>离屏 / 标签页隐藏 → 引擎停机（引擎自带 IntersectionObserver 与
 *       visibilitychange 监听）。</li>
 * </ul>
 *
 * <p>画布是纯装饰：`aria-hidden`，不承担任何信息。医学信息一律在 DOM 文本里。
 */

/**
 * 读取材质令牌作为着色器颜色。
 *
 * <p>WebGL uniform 只吃具体色值，吃不了 `var()`，所以颜色必须在挂载时解析一次。
 * 这样 `--brand-glass-optical-tint` 才是唯一真源：改令牌，画面跟着变。
 * jsdom / 无样式环境下读不到值，退回调用方给的常量。
 */
function tokenColor(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback
}
export function OpticFlow(props: {
  theme: "light" | "dark"
  /** 用户主动暂停动效（首屏那个「暂停动画」按钮）。 */
  paused?: boolean
  className?: string
}): ReactElement {
  const { theme, paused = false, className } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<BeamsEngine | null>(null)
  const settingsRef = useRef<BeamsSettings>(beamsSettings(theme))
  const pausedRef = useRef(paused)
  const [fallback, setFallback] = useState(false)
  const [visible, setVisible] = useState(true)

  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)")

  useEffect(() => {
    // 主题切换：参数换一套，让引擎重绘一帧。暂停同理。
    settingsRef.current = beamsSettings(theme)
    pausedRef.current = paused
    engineRef.current?.wake()
  }, [theme, paused])

  useEffect(() => {
    // 已经降到静态画面：没有画布，也没有引擎要管。
    if (fallback) return
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const engine = mountBeams({
      canvas,
      container,
      getSettings: () => ({ ...settingsRef.current, paused: pausedRef.current }),
      onContextLost: () => setFallback(true),
    })
    // WebGL2 不可用或着色器编译失败：直接上静态光带。
    if (!engine) {
      setFallback(true)
      return
    }
    engineRef.current = engine
    return () => {
      // 这里的 cleanup 会在三种情形下跑：路由离开、StrictMode 的假卸载、
      // 以及降级切换（fallback 变 true）。dispose 只回收自己建的 GPU 资源，
      // 不丢上下文——StrictMode 会立刻用同一张 canvas 再挂一次。
      engine.dispose()
      engineRef.current = null
    }
  }, [fallback])

  // 离屏暂停：纤维层的位移动画跟着可见性走。
  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const classes = ["optic-flow", className].filter(Boolean).join(" ")
  const mode = fallback ? "static" : paused || reduce ? "paused" : "live"
  const drifting = visible && !paused && !reduce

  return (
    <div ref={containerRef} className={classes} data-mode={mode} data-theme={theme} aria-hidden="true">
      {fallback ? (
        <StaticBands theme={theme} />
      ) : (
        <>
          <canvas ref={canvasRef} className="optic-flow__canvas" />
          <Fibers theme={theme} drifting={drifting} />
        </>
      )}
    </div>
  )
}

/**
 * 主题对应的引擎参数。
 *
 * <p>两套**不是反色关系**，是两种材质：
 * <ul>
 *   <li>**Light · 冰川银蓝**：带体更亮、更透，靠合成阶段的 `alpha` 压低边缘
 *       让画布透出来当反光；颗粒调低，避免玻璃显脏灰。</li>
 *   <li>**Dark · 午夜蓝**：整体压暗，只有带边与高光发亮；填充光调低、
 *       sharpness 调高，让轮廓（冰蓝边缘光）成为主要结构。</li>
 * </ul>
 */
function beamsSettings(theme: "light" | "dark"): BeamsSettings {
  const lowEnd =
    typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4
  const tint = tokenColor(
    "--brand-glass-optical-tint",
    theme === "dark" ? "#7cc4ff" : "#2f6fc9",
  )
  return theme === "light"
    ? {
        color: tint,
        beamWidth: 620,
        rotation: 22,
        speed: 0.72,
        waveLength: 420,
        depth: 0.9,
        sharpness: 0.5,
        twist: 0.26,
        fillLight: 0.62,
        glow: 1.05,
        brightness: 1.2,
        variation: 0.26,
        grain: 0.06,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.7,
        intro: true,
        fade: 0.16,
        opacity: 1,
        lightMode: true,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
    : {
        color: "#7cc4ff",
        beamWidth: 520,
        rotation: 22,
        speed: 0.78,
        waveLength: 380,
        depth: 1.05,
        sharpness: 0.62,
        twist: 0.24,
        fillLight: 0.36,
        glow: 1.05,
        brightness: 1.45,
        variation: 0.4,
        grain: 0.16,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.8,
        intro: true,
        fade: 0.14,
        opacity: 1,
        lightMode: false,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
}

/** 光带的中轴线：一条从右下流向左上的 S 形。 */
const RIBBON_AXIS = "M-90 735 C 195 545, 425 590, 655 438 S 990 232, 1210 262"

/** 纤维的横向偏移（-11…11），间距 4.4 → 整束宽约 100，正好落在带体内部。 */
const FIBER_LINES = Array.from({ length: 23 }, (_, index) => index - 11)

/**
 * 光带的梯度定义。
 *
 * <p>颜色不写死在 `stop-color` 上，而是挂在 class 上交给 CSS 管——
 * 双主题的差异（亮色钴蓝带 / 暗色冰蓝带）就只需要在 `brand.css` 里换一组值，
 * 不用在这里复制两套 SVG。
 */
function RibbonDefs(props: { id: string }): ReactElement {
  const { id } = props
  return (
    <defs>
      <linearGradient id={`${id}-sheath`} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" className="optic-stop--sheath-far" />
        <stop offset="0.42" className="optic-stop--sheath-mid" />
        <stop offset="0.78" className="optic-stop--sheath-near" />
        <stop offset="1" className="optic-stop--sheath-tip" />
      </linearGradient>
      <linearGradient id={`${id}-core`} x1="0" y1="0.4" x2="1" y2="0.7">
        <stop offset="0" className="optic-stop--core-far" />
        <stop offset="0.5" className="optic-stop--core-mid" />
        <stop offset="1" className="optic-stop--core-near" />
      </linearGradient>
    </defs>
  )
}

/**
 * 光带本体：**一条连续的带体**，不是几根散线。
 *
 * <p>参照 Optic Flow V4：带体先有一层宽的柔和鞘（sheath），鞘里铺二十余根
 * 等距细纤维（中间密、边缘亮），最外两根是镜面高光（rim）——玻璃的「厚度」
 * 由这一层给。全部是 SVG + CSS，不起第二个 GPU 循环。
 *
 * <p>WebGL 那层是**光**，这一层是**玻璃**。上一层负责环境亮度，这一层负责
 * 可辨认的形体：带体在哪、多厚、边在哪。
 */
function RibbonBody(props: { id: string; sheathWidth: number }): ReactElement {
  const { id, sheathWidth } = props
  return (
    <>
      <path
        className="optic-flow__sheath"
        d={RIBBON_AXIS}
        stroke={`url(#${id}-sheath)`}
        strokeWidth={sheathWidth}
      />
      <path
        className="optic-flow__sheath optic-flow__sheath--core"
        d={RIBBON_AXIS}
        stroke={`url(#${id}-core)`}
        strokeWidth={sheathWidth * 0.6}
      />
      <g className="optic-flow__fiber-set">
        {FIBER_LINES.map((offset) => (
          <path key={offset} d={RIBBON_AXIS} transform={`translate(0 ${offset * 4.4})`} />
        ))}
      </g>
      {/* 中间一道更实的芯线：带体不是中空的。 */}
      <g className="optic-flow__fiber-set optic-flow__fiber-set--core">
        <path d={RIBBON_AXIS} transform="translate(0 0)" />
        <path d={RIBBON_AXIS} transform="translate(0 5)" />
      </g>
      {/* 外缘镜面高光：厚度感来自这里。 */}
      <g className="optic-flow__fiber-set optic-flow__fiber-set--rim">
        <path d={RIBBON_AXIS} transform="translate(0 -50)" />
        <path d={RIBBON_AXIS} transform="translate(0 50)" />
      </g>
    </>
  )
}

/**
 * 细纤维层：叠在 WebGL 光场之上的玻璃体。
 *
 * <p>纯 SVG + CSS 位移；离屏与 reduced-motion 时停掉位移。
 */
function Fibers(props: { theme: "light" | "dark"; drifting: boolean }): ReactElement {
  const { theme, drifting } = props
  return (
    <svg
      className={`optic-flow__fibers${drifting ? " is-drifting" : ""}`}
      viewBox="0 0 1100 800"
      preserveAspectRatio="xMidYMid slice"
      data-theme={theme}
    >
      <RibbonDefs id="optic-live" />
      <RibbonBody id="optic-live" sheathWidth={104} />
    </svg>
  )
}

/**
 * 静态光带：WebGL 不可用 / 上下文丢失时的降级画面。
 *
 * <p>与动态版同一套构图语言（同一中轴线、同一束纤维、同一组梯度），只是不动，
 * 也不再需要 WebGL 的环境光。医疗信息不靠它承载——它是装饰。
 */
function StaticBands(props: { theme: "light" | "dark" }): ReactElement {
  const { theme } = props
  return (
    <svg
      className="optic-flow__fallback"
      viewBox="0 0 1100 800"
      preserveAspectRatio="xMidYMid slice"
      data-theme={theme}
    >
      <RibbonDefs id="optic-static" />
      <RibbonBody id="optic-static" sheathWidth={112} />
    </svg>
  )
}
