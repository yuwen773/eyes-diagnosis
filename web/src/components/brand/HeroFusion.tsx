import { useEffect, useId, useRef, useState, type ReactElement } from "react"

import { mountBeams, type BeamsEngine, type BeamsSettings } from "./beamsMount"
import { useMediaQuery } from "@/lib/useMediaQuery"
import "./HeroFusion.css"

/**
 * 首屏融合主视觉：OpticFlow 的连续光带 × Prism 的棱镜色散（E-09 方案 C）。
 *
 * <p>**只有一个 WebGL 循环**：动态光场仍然是 vendored 的 Beams 引擎
 * （`beamsMount.ts`，裸 WebGL2），负责环境光与带体的明暗。棱镜、色散扇与
 * 细纤维是同一张画面上的 SVG 层——不起第二个 GPU 循环，也不引 Three.js / R3F。
 *
 * <p>光带本体**直接复用方案 A 的玻璃体样式**（`.optic-flow__sheath` /
 * `.optic-flow__fiber-set*` 与 `optic-stop--*` 渐变），所以「融合」不是两个特效
 * 并排：入射线与 A 是同一条带，只是它在棱镜处被散成了彩色细光。
 *
 * <p>降级路径：
 * <ul>
 *   <li>WebGL2 不可用 / 着色器失败 / 上下文丢失 → 只留 SVG 静态光学层；</li>
 *   <li>`prefers-reduced-motion: reduce` → 引擎冻结在一帧，SVG 层停掉漂移；</li>
 *   <li>离屏 / 标签页隐藏 → 引擎停机（引擎自带 IntersectionObserver 与
 *       visibilitychange 监听）；</li>
 *   <li>组件卸载 → `dispose()` 回收自己建的 GPU 资源。</li>
 * </ul>
 *
 * <p>画布与 SVG 都是纯装饰：整块 `aria-hidden`，医学信息一律在 DOM 文本里。
 */

type Theme = "light" | "dark"
type Breakpoint = "wide" | "phone"

/**
 * 几何：光带从画面左下升到棱镜，在棱镜处散成扇。
 *
 * <p>坐标全部在各自的 viewBox 里。桌面用 1100×800（与方案 A 同一套画布比例），
 * 窄屏换成 700×1400 的竖构图——同一张 1100×800 的图在手机上会被 `slice`
 * 裁成中间一条，棱镜与扇都会跑到视口外。
 */
type Geometry = {
  viewBox: [number, number]
  /** 入射线中轴线（二次/三次贝塞尔，与方案 A 同一套画法）。 */
  ribbon: string
  /** 棱镜中心、边长与倾角（度）。 */
  prism: { x: number; y: number; size: number; rotate: number }
  /** 色散扇：以入射方向为中心对称张开。 */
  fan: { angle: number; spread: number; length: number }
}

const GEOMETRY: Record<Breakpoint, Geometry> = {
  wide: {
    viewBox: [1100, 800],
    ribbon: "M-140 800 C 160 690, 500 357, 650 270",
    prism: { x: 650, y: 270, size: 134, rotate: -14 },
    fan: { angle: -30, spread: 18, length: 400 },
  },
  // 手机不是把桌面图压扁：标题、CTA、信息卡把画面切得只剩几条窄带，
  // 棱镜只能落在信息卡下方那条空档里（坐标按 390×844 的实测盒反推）。
  // 平板继续用桌面构图——1100×800 在 820×1180 上正好裁出与方案 A 同一条 S 形光带。
  phone: {
    viewBox: [700, 1400],
    ribbon: "M140 100 C 220 400, 300 800, 380 860",
    prism: { x: 380, y: 860, size: 110, rotate: -10 },
    fan: { angle: 5, spread: 20, length: 240 },
  },
}

/** 细纤维：跨带 23 根、间距 4.4 → 整束约 100px，与方案 A 完全一致。 */
const FIBER_LINES = Array.from({ length: 23 }, (_, index) => index - 11)

/** 色散扇条数。奇数，正中一条沿入射方向直穿。 */
const RAY_COUNT = 7

/**
 * 色散色板：冰蓝 / 青打底，紫与暖琥珀只在扇的两端各露一点。
 * 亮色走墨（multiply），暗色走加光（screen），所以两套取的是同一批色相的不同明度。
 */
const RAY_TONES: Record<Theme, string[]> = {
  light: ["#6b56c5", "#2457c9", "#2e8bdd", "#0f7f92", "#b9773a"],
  dark: ["#c0acff", "#85b5ff", "#60d7e6", "#9ff0ff", "#e8b06a"],
}

export type HeroFusionProps = {
  theme: Theme
  /** 用户主动暂停动效（对照页工具栏那个按钮）。 */
  paused?: boolean
  className?: string
}

export function HeroFusion({ theme, paused = false, className }: HeroFusionProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<BeamsEngine | null>(null)
  const pausedRef = useRef(paused)
  const [fallback, setFallback] = useState(false)
  const [visible, setVisible] = useState(true)

  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)")
  const phone = useMediaQuery("(max-width: 640px)")
  const breakpoint: Breakpoint = phone ? "phone" : "wide"

  const settingsRef = useRef<BeamsSettings>(fusionSettings(theme, breakpoint))

  useEffect(() => {
    settingsRef.current = fusionSettings(theme, breakpoint)
    pausedRef.current = paused
    engineRef.current?.wake()
  }, [theme, breakpoint, paused])

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
    if (!engine) {
      setFallback(true)
      return
    }
    engineRef.current = engine
    return () => {
      // StrictMode 的假卸载、路由离开、降级切换都会走到这里；
      // dispose 只回收自己建的 GPU 资源，不主动丢上下文。
      engine.dispose()
      engineRef.current = null
    }
  }, [fallback])

  // 离屏暂停：SVG 层的漂移动画跟着可见性走。
  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const classes = ["hero-fusion", className].filter(Boolean).join(" ")
  const mode = fallback ? "static" : reduce ? "frozen" : paused ? "paused" : "live"
  const drifting = visible && !paused && !reduce

  return (
    <div
      ref={containerRef}
      className={classes}
      data-mode={mode}
      data-theme={theme}
      aria-hidden="true"
    >
      {fallback ? (
        <div className="hero-fusion__static-wash" />
      ) : (
        <canvas ref={canvasRef} className="hero-fusion__canvas" />
      )}
      <FusionOptics theme={theme} breakpoint={breakpoint} drifting={drifting} />
    </div>
  )
}

/**
 * 主题与断点对应的引擎参数。
 *
 * <p>Light 是**冰川银蓝**：带体亮、透，靠合成阶段压低边缘让画布透出来当反光。
 * Dark 是**深海钴蓝**：填充压暗，只有带边与高光发亮，冰蓝边缘光是主要结构。
 * 两套不是反色关系，是两种材质。
 */
function fusionSettings(theme: Theme, breakpoint: Breakpoint): BeamsSettings {
  const lowEnd = typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4
  const beamWidth = breakpoint === "phone" ? 320 : 640
  const tint = tokenColor("--brand-glass-optical-tint", theme === "dark" ? "#7cc4ff" : "#2f6fc9")

  return theme === "light"
    ? {
        color: tint,
        beamWidth,
        rotation: 22,
        speed: 0.62,
        waveLength: 460,
        depth: 0.85,
        sharpness: 0.55,
        twist: 0.22,
        fillLight: 0.6,
        glow: 1.0,
        brightness: 1.0,
        variation: 0.24,
        grain: 0.05,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.7,
        intro: true,
        fade: 0.2,
        opacity: 1,
        lightMode: true,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
    : {
        color: "#7cc4ff",
        beamWidth,
        rotation: 22,
        speed: 0.66,
        waveLength: 420,
        depth: 1.0,
        sharpness: 0.62,
        twist: 0.22,
        fillLight: 0.28,
        glow: 0.95,
        brightness: 1.05,
        variation: 0.34,
        grain: 0.14,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.8,
        intro: true,
        fade: 0.22,
        opacity: 1,
        lightMode: false,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
}

/**
 * 读取材质令牌作为着色器颜色。
 *
 * <p>WebGL uniform 只吃具体色值，吃不了 `var()`，所以颜色在挂载时解析一次——
 * `--brand-glass-optical-tint` 因此仍是唯一真源。
 */
function tokenColor(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback
}

type OpticsProps = {
  theme: Theme
  breakpoint: Breakpoint
  drifting: boolean
}

/**
 * SVG 光学层：入射线（方案 A 的玻璃体）→ 棱镜 → 出射色散扇。
 *
 * <p>棱镜与扇的位置来自 `GEOMETRY`，全部在 viewBox 坐标里；`slice` 让它们在
 * 不同视口下保持同一套比例关系。扇以**入射方向**为中心对称张开，正中那条
 * 沿原方向直穿，读起来才是「折射」而不是「两团光叠在一起」。
 */
function FusionOptics({ theme, breakpoint, drifting }: OpticsProps): ReactElement {
  const uid = useId().replace(/:/g, "")
  const geometry = GEOMETRY[breakpoint]
  const [vbWidth, vbHeight] = geometry.viewBox
  const { prism, fan } = geometry

  const half = prism.size / 2
  const halfWidth = prism.size * 0.54

  const originAngle = (fan.angle * Math.PI) / 180
  // 扇从棱镜出射面稍微往外一点起笔，看起来是「从棱镜里出来」而不是从中心穿过。
  const originX = prism.x + Math.cos(originAngle) * prism.size * 0.2
  const originY = prism.y + Math.sin(originAngle) * prism.size * 0.2

  const tones = RAY_TONES[theme]
  const rays = Array.from({ length: RAY_COUNT }, (_, index) => {
    const spread = (index / (RAY_COUNT - 1)) * 2 - 1
    const angle = ((fan.angle + spread * fan.spread) * Math.PI) / 180
    const length = fan.length * (1 - 0.16 * Math.abs(spread))
    const tone = tones[Math.round(((index / (RAY_COUNT - 1)) * (tones.length - 1)))]
    return {
      key: index,
      x: originX + Math.cos(angle) * length,
      y: originY + Math.sin(angle) * length,
      tone,
      width: 3.2 - 1.6 * Math.abs(spread),
      opacity: 0.72 - 0.3 * Math.abs(spread),
    }
  })

  return (
    <svg
      className={`hero-fusion__optics${drifting ? " is-drifting" : ""}`}
      viewBox={`0 0 ${vbWidth} ${vbHeight}`}
      preserveAspectRatio="xMidYMid slice"
      data-theme={theme}
    >
      <defs>
        <linearGradient id={`${uid}-sheath`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" className="optic-stop--sheath-far" />
          <stop offset="0.42" className="optic-stop--sheath-mid" />
          <stop offset="0.78" className="optic-stop--sheath-near" />
          <stop offset="1" className="optic-stop--sheath-tip" />
        </linearGradient>
        <linearGradient id={`${uid}-core`} x1="0" y1="0.4" x2="1" y2="0.7">
          <stop offset="0" className="optic-stop--core-far" />
          <stop offset="0.5" className="optic-stop--core-mid" />
          <stop offset="1" className="optic-stop--core-near" />
        </linearGradient>
        <linearGradient id={`${uid}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="hero-fusion__stop--face-a" />
          <stop offset="1" className="hero-fusion__stop--face-b" />
        </linearGradient>
        <linearGradient id={`${uid}-edge`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" className="hero-fusion__stop--edge-a" />
          <stop offset="0.55" className="hero-fusion__stop--edge-b" />
          <stop offset="1" className="hero-fusion__stop--edge-c" />
        </linearGradient>
        <radialGradient id={`${uid}-caustic`} cx="0.5" cy="0.55" r="0.55">
          <stop offset="0" className="hero-fusion__stop--caustic-core" />
          <stop offset="1" className="hero-fusion__stop--caustic-fade" />
        </radialGradient>
        <radialGradient id={`${uid}-halo`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="hero-fusion__stop--halo-core" />
          <stop offset="1" className="hero-fusion__stop--halo-fade" />
        </radialGradient>
      </defs>

      {/* 入射线：与方案 A 同一套玻璃体（宽鞘 + 细纤维 + 边缘高光）。 */}
      <g className="hero-fusion__ribbon">
        <path
          className="optic-flow__sheath"
          d={geometry.ribbon}
          stroke={`url(#${uid}-sheath)`}
          strokeWidth={104}
        />
        <path
          className="optic-flow__sheath optic-flow__sheath--core"
          d={geometry.ribbon}
          stroke={`url(#${uid}-core)`}
          strokeWidth={62}
        />
        <g className="optic-flow__fiber-set">
          {FIBER_LINES.map((offset) => (
            <path key={offset} d={geometry.ribbon} transform={`translate(0 ${offset * 4.4})`} />
          ))}
        </g>
        <g className="optic-flow__fiber-set optic-flow__fiber-set--core">
          <path d={geometry.ribbon} transform="translate(0 0)" />
          <path d={geometry.ribbon} transform="translate(0 5)" />
        </g>
        <g className="optic-flow__fiber-set optic-flow__fiber-set--rim">
          <path d={geometry.ribbon} transform="translate(0 -50)" />
          <path d={geometry.ribbon} transform="translate(0 50)" />
        </g>
      </g>

      {/* 出射段：色散扇。先画一层模糊的同形描边当辉光，再画实线。 */}
      <g className="hero-fusion__rays hero-fusion__rays--glow">
        {rays.map((ray) => (
          <line
            key={ray.key}
            x1={originX}
            y1={originY}
            x2={ray.x}
            y2={ray.y}
            stroke={ray.tone}
            strokeWidth={ray.width * 3.4}
            opacity={ray.opacity * 0.45}
          />
        ))}
      </g>
      <g className="hero-fusion__rays">
        {rays.map((ray) => (
          <line
            key={ray.key}
            x1={originX}
            y1={originY}
            x2={ray.x}
            y2={ray.y}
            stroke={ray.tone}
            strokeWidth={ray.width}
            opacity={ray.opacity}
          />
        ))}
      </g>

      {/* 棱镜本体：面 + 棱 + 入射侧焦散。 */}
      <g
        className="hero-fusion__prism"
        transform={`translate(${prism.x} ${prism.y}) rotate(${prism.rotate})`}
      >
        <circle r={prism.size * 0.98} fill={`url(#${uid}-halo)`} />
        <path
          className="hero-fusion__face"
          d={`M0 ${-half} L${halfWidth} ${half} L${-halfWidth} ${half} Z`}
          fill={`url(#${uid}-face)`}
          stroke={`url(#${uid}-edge)`}
        />
        <ellipse
          className="hero-fusion__caustic"
          cx={-halfWidth * 0.22}
          cy={half * 0.16}
          rx={halfWidth * 0.8}
          ry={half * 0.62}
          fill={`url(#${uid}-caustic)`}
        />
        <path
          className="hero-fusion__facet-fill"
          d={`M0 ${-half} L${halfWidth} ${half} L0 ${half} Z`}
        />
        <path className="hero-fusion__facet" d={`M0 ${-half} L0 ${half}`} />
        <path className="hero-fusion__facet" d={`M${-halfWidth * 0.52} ${half} L0 ${-half}`} />
        <path className="hero-fusion__facet" d={`M${-halfWidth} ${half} L${halfWidth} ${half}`} />
      </g>
    </svg>
  )
}
