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

/** 主题对应的引擎参数。浅色走 multiply（像玻璃上的反射），暗色走加色。 */
function beamsSettings(theme: "light" | "dark"): BeamsSettings {
  const lowEnd =
    typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4
  return theme === "light"
    ? {
        color: "#2f6fc9",
        beamWidth: 240,
        rotation: 24,
        speed: 0.75,
        waveLength: 320,
        depth: 1.15,
        sharpness: 0.7,
        twist: 0.18,
        fillLight: 0.55,
        glow: 0.8,
        brightness: 1.25,
        variation: 0.35,
        grain: 0.22,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.7,
        intro: true,
        fade: 0.1,
        opacity: 1,
        lightMode: true,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
    : {
        color: "#7cc4ff",
        beamWidth: 230,
        rotation: 24,
        speed: 0.8,
        waveLength: 300,
        depth: 1.2,
        sharpness: 0.66,
        twist: 0.22,
        fillLight: 0.42,
        glow: 0.95,
        brightness: 1.6,
        variation: 0.4,
        grain: 0.3,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.8,
        intro: true,
        fade: 0.12,
        opacity: 1,
        lightMode: false,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
}

/**
 * 细纤维层：几束稀疏的细线，跟着光带走。
 *
 * <p>纯 SVG + CSS 位移，没有第二个 WebGL 上下文；离屏与 reduced-motion 时停掉位移。
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
      <g className="optic-flow__fiber-set">
        <path d="M-60 640 C 220 470, 430 560, 640 430 S 980 260, 1180 300" />
        <path d="M-40 700 C 260 520, 470 600, 700 460 S 1010 300, 1180 340" />
        <path d="M-80 560 C 200 420, 420 480, 620 380 S 960 210, 1160 250" />
        <path d="M-20 760 C 300 560, 520 640, 740 500 S 1030 340, 1190 380" />
      </g>
      <g className="optic-flow__fiber-set optic-flow__fiber-set--fine">
        <path d="M0 620 C 240 480, 440 545, 660 415 S 990 250, 1170 290" />
        <path d="M-30 680 C 250 500, 460 570, 680 445 S 1000 280, 1175 320" />
        <path d="M-70 540 C 210 405, 430 465, 630 365 S 970 195, 1165 235" />
      </g>
    </svg>
  )
}

/**
 * 静态光带：WebGL 不可用时的降级画面。
 *
 * <p>与动态版同一套构图语言（连续带状层 + 内部细纤维 + 边缘高光），只是不动。
 * 医疗信息不靠它承载——它是装饰。
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
      <defs>
        <linearGradient id="optic-band-a" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9fc4ef" stopOpacity="0" />
          <stop offset="0.45" stopColor="#4e94f0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#64cadd" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="optic-band-b" x1="0" y1="0.4" x2="1" y2="0.7">
          <stop offset="0" stopColor="#b7d8f7" stopOpacity="0" />
          <stop offset="0.55" stopColor="#2f6fc4" stopOpacity="0.42" />
          <stop offset="1" stopColor="#8f7fe0" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <path
        className="optic-flow__fallback-band"
        d="M-60 700 C 240 520, 470 600, 690 450 S 1010 280, 1180 330"
        stroke="url(#optic-band-a)"
      />
      <path
        className="optic-flow__fallback-band optic-flow__fallback-band--b"
        d="M-70 620 C 220 450, 450 520, 660 390 S 980 220, 1170 270"
        stroke="url(#optic-band-b)"
      />
    </svg>
  )
}
