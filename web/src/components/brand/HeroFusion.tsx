import { useEffect, useId, useRef, useState, type ReactElement } from "react"

import { mountBeams, type BeamsEngine, type BeamsSettings } from "./beamsMount"
import { useMediaQuery } from "@/lib/useMediaQuery"
import "./HeroFusion.css"

/**
 * 首屏融合主视觉：OpticFlow 的连续光带 × Prism 的棱镜色散（E-09 方案 C）。
 *
 * <p>**两层，各自管自己的裁切**（DESIGN.md §3.6）：
 * <ul>
 *   <li>**环境光层**——全幅的 Beams WebGL2 光场（`beamsMount.ts`，裸 WebGL），
 *       铺满整个 hero 区段，四周用径向遮罩收到透明，不出现画布矩形硬边。
 *       同一时刻**只有这一个 GPU 渲染循环**。</li>
 *   <li>**光学主体层**——棱镜、入射线、色散扇、细纤维，全部画在一张 SVG 上，
 *       并被约束在 `.hero-fusion__stage`（= 玻璃外壳的盒）里。可辨认的棱镜线框、
 *       纤维和色散射线**不许穿出玻璃外壳**；环境光可以往外扩散。</li>
 * </ul>
 *
 * <p>光带本体**直接复用方案 A 的玻璃体样式**（`.optic-flow__sheath` /
 * `.optic-flow__fiber-set*` 与 `optic-stop--*` 渐变），所以「融合」不是两个特效
 * 并排：入射线与 A 是同一条带，只是它在棱镜处被散成了彩色细光。
 *
 * <p>**因果关系是这条视觉的全部理由**：入射线**终点就是色散扇的起点**（`fan.origin`），
 * 两点重合在棱镜体内。光带不是「停在棱镜旁边」，扇也不是「在别处凭空起笔」——
 * 观众看到的必须是一束光穿过一块玻璃、出来时被分开。
 *
 * <p>动效生命周期（DESIGN.md §3.7）：intro 之后自动播约 5 秒，满 5 秒进
 * `data-mode="settled"` 并**真正停掉 GPU 绘制**（`engine.freeze()`，不是只改
 * 属性）。不设手动控件；指针继续悬停也不会把已完成的动画重新唤醒。5 秒是
 * **可见时长**：页面隐藏时暂停计时，切回来接着走，不会在后台把动效窗口耗光。
 *
 * <p>降级路径：
 * <ul>
 *   <li>WebGL2 不可用 / 着色器失败 / 上下文丢失 → 只留 SVG 静态光学层；</li>
 *   <li>`prefers-reduced-motion: reduce` → 引擎当场定格，SVG 层停掉漂移；</li>
 *   <li>离屏 / 标签页隐藏 → 引擎停机（引擎自带 IntersectionObserver 与
 *       visibilitychange 监听）；</li>
 *   <li>组件卸载 → `dispose()` 回收自己建的 GPU 对象（不主动丢上下文）。</li>
 * </ul>
 *
 * <p>画布与 SVG 都是纯装饰：整块 `aria-hidden`，医学信息一律在 DOM 文本里。
 */

type Theme = "light" | "dark"
type Breakpoint = "phone" | "tablet" | "wide"

/** 首屏动效窗口：intro（1.6s）之后继续走一段，满 5 秒定格。只计可见时长。 */
const MOTION_WINDOW_MS = 5000

/**
 * 几何：光带从画面上方落入棱镜，在棱镜处散成扇。
 *
 * <p>坐标在**外壳盒**里，`viewBox` 与外壳在该档的参考宽高一致；`preserveAspectRatio`
 * 用 `xMidYMin meet`，所以**顶部锚定**：舞台比其他比例更高时，多出来的高度在下方，
 * 「棱镜相对壳顶多少」「扇离信息卡底边多远」这些约束在各档之间是同一个数。
 *
 * <p>三档不是同一张图缩放：
 * <ul>
 *   <li>`wide`——外壳右侧有一条从标题到信息卡之间的竖向通道，棱镜落在通道里，
 *       色散扇从信息卡**下方**那条空带向右铺开（不越过信息卡底边，也不进条目行）。</li>
 *   <li>`tablet`——单栏布局，信息卡在右下方。棱镜落在信息卡左侧那块空地，
 *       色散扇朝右下走，从信息卡底边下面穿过。</li>
 *   <li>`phone`——信息卡占满整行，只有卡下到条目行之间约 77px 的一条横带可用。
 *       这一档不做等比缩小，改成一条**紧凑的横向光路**：光带从左边进来、
 *       棱镜在左、色散扇向右收窄（±6°），整组只占这条横带。</li>
 * </ul>
 */
type Geometry = {
  viewBox: [number, number]
  /** 入射线中轴线（三次贝塞尔，与方案 A 同一套画法）；**终点 = `fan.origin`**。 */
  ribbon: string
  /**
   * 入射线顶端淡出的方向：从 `from`（全透明）到 `to`（全不透明）。
   * 贴着光带走，所以光带看起来是从环境光里长出来的，而不是被某条边切断。
   */
  fade: { from: [number, number]; to: [number, number] }
  /**
   * 带体渐变的走向（objectBoundingBox）：从 `(x1,y1)` 的透明端走到 `(x2,y2)` 的实端。
   * 和方案 A 不同的是，C 的带子**在棱镜那一端必须是实的**——它得真的「进」棱镜。
   */
  axis: [number, number, number, number]
  /** 带体鞘宽（viewBox 单位）。 */
  sheath: number
  /** 细纤维根数（奇数）。 */
  fibers: number
  /** 棱镜中心、边长与倾角（度）。 */
  prism: { x: number; y: number; size: number; rotate: number }
  /** 色散扇：**从入射线终点起笔**，以入射方向为中心对称张开。 */
  fan: { origin: [number, number]; angle: number; spread: number; length: number }
}

const GEOMETRY: Record<Breakpoint, Geometry> = {
  wide: {
    viewBox: [1240, 758],
    // 从标题上方的空档斜落到棱镜中心：整条带子走在标题右缘与信息卡左缘之间的通道里。
    ribbon: "M 420 -80 C 560 40, 700 200, 741 456",
    fade: { from: [420, -80], to: [620, 130] },
    axis: [0, 0, 1, 1],
    sheath: 92,
    fibers: 21,
    prism: { x: 712, y: 450, size: 150, rotate: -12 },
    fan: { origin: [741, 456], angle: 12, spread: 7, length: 340 },
  },
  tablet: {
    viewBox: [820, 1043],
    // 单栏：光带在标题下、信息卡左的那块空地里斜落，扇从卡底下面穿过去。
    ribbon: "M 40 430 C 110 510, 190 640, 286 679",
    fade: { from: [40, 430], to: [120, 500] },
    axis: [0, 0, 1, 1],
    sheath: 88,
    fibers: 15,
    prism: { x: 262, y: 672, size: 124, rotate: -12 },
    fan: { origin: [286, 679], angle: 17, spread: 7, length: 260 },
  },
  phone: {
    viewBox: [378, 1140],
    // 信息卡占满整行，只剩卡下到条目行之间约 77px 的横带：这一档改成紧凑的横向光路。
    ribbon: "M -70 712 C -10 707, 60 702, 129 699",
    fade: { from: [-70, 712], to: [0, 708] },
    axis: [0, 1, 1, 0],
    // 带子比棱镜还宽会把玻璃整个盖住：手机档压到 36，让三角形在带子两侧露出来。
    sheath: 36,
    fibers: 9,
    // 棱镜外接盒 ≈ 1.11×边长（含 −6° 倾角）：72 会探进信息卡 4px、入口行 3px，
    // 60 才既有 5px 上下的余量、又不至于小到读不出体量——先缩主体，不缩文字、不遮卡。
    prism: { x: 116, y: 698, size: 60, rotate: -6 },
    // 扇长收在 186：加辉光外扩之后仍离壳的右边缘留 40px 以上。
    fan: { origin: [129, 699], angle: 3, spread: 6, length: 186 },
  },
}

/**
 * 色散色板：**三条**就够讲清「折射」。
 *
 * <p>钴蓝 / 冰蓝 = 入射那一路的延续，青 = 折射，极光紫只在扇的一端露一点。
 * 亮色走墨（multiply），暗色走加光（screen），两套取的是同一批色相的不同明度。
 * 暖琥珀没有进色板——它在两套主题里都只能当噪点。第五、第六条射线只贡献「更热闹」
 * 不贡献「更清楚」，删掉；剩下的三条在角度上**故意不等距**。
 */
const RAY_TONES: Record<Theme, string[]> = {
  light: ["#6b56c5", "#2e8bdd", "#0f8fa6"],
  dark: ["#c0acff", "#85b5ff", "#7ce6fb"],
}

/** 色散扇条数。奇数，正中一条沿入射方向直穿。 */
const RAY_COUNT = RAY_TONES.light.length

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
  const frozenRef = useRef(false)
  const [fallback, setFallback] = useState(false)
  const [visible, setVisible] = useState(true)
  const [settled, setSettled] = useState(false)

  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)")
  const tablet = useMediaQuery("(max-width: 1024px)")
  const phone = useMediaQuery("(max-width: 640px)")
  const breakpoint: Breakpoint = phone ? "phone" : tablet ? "tablet" : "wide"

  const settingsRef = useRef<BeamsSettings>(fusionSettings(theme, breakpoint))

  // 首屏只播一个窗口。计时**只算可见时长**：在后台标签页里打开首页时，
  // 这 5 秒不该被白白耗掉——否则用户切回来看到的是一个已经定格、从未动过的画面。
  useEffect(() => {
    if (settled) return
    let remaining = MOTION_WINDOW_MS
    let startedAt = 0
    let timer = 0
    const start = () => {
      if (document.hidden) return
      startedAt = Date.now()
      timer = window.setTimeout(() => setSettled(true), Math.max(0, remaining))
    }
    const stop = () => {
      window.clearTimeout(timer)
      timer = 0
      if (startedAt) remaining -= Date.now() - startedAt
      startedAt = 0
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [settled])

  const frozen = reduce || paused || settled

  // 定格开关。`freeze()` 会先画完最后一帧再停循环，所以画面不会停在半帧上。
  useEffect(() => {
    frozenRef.current = frozen
    const engine = engineRef.current
    if (!engine) return
    if (frozen) engine.freeze()
    else engine.thaw()
  }, [frozen])

  // 主题 / 断点换一套参数。定格状态下只允许重绘一帧，不重启动效。
  useEffect(() => {
    settingsRef.current = fusionSettings(theme, breakpoint)
    const engine = engineRef.current
    if (!engine) return
    if (frozenRef.current) engine.repaint()
    else engine.wake()
  }, [theme, breakpoint])

  useEffect(() => {
    // 已经降到静态画面：没有画布，也没有引擎要管。
    if (fallback) return
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const engine = mountBeams({
      canvas,
      container,
      getSettings: () => ({ ...settingsRef.current, paused: frozenRef.current }),
      onContextLost: () => setFallback(true),
    })
    if (!engine) {
      setFallback(true)
      return
    }
    engineRef.current = engine
    // 首帧就是定格态（reduced-motion，或挂载时已经过窗口）时直接冻住。
    if (frozenRef.current) engine.freeze()
    return () => {
      // StrictMode 的假卸载、路由离开、降级切换都会走到这里；
      // dispose 只回收自己建的对象，不主动丢上下文。
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
  const mode = fallback ? "static" : reduce ? "frozen" : paused ? "paused" : settled ? "settled" : "live"
  // 静态降级就是静态：没有画布，SVG 层也不该继续漂 5 秒才安静下来。
  const drifting = visible && !frozen && !fallback

  return (
    <div
      ref={containerRef}
      className={classes}
      data-mode={mode}
      data-theme={theme}
      data-breakpoint={breakpoint}
      aria-hidden="true"
    >
      {fallback ? (
        <div className="hero-fusion__static-wash" />
      ) : (
        <canvas ref={canvasRef} className="hero-fusion__canvas" />
      )}
      <div className="hero-fusion__stage" data-breakpoint={breakpoint}>
        <FusionOptics theme={theme} breakpoint={breakpoint} drifting={drifting} />
      </div>
    </div>
  )
}

/**
 * 主题与断点对应的引擎参数。
 *
 * <p>Light 是**冰川银蓝**：带体亮、透，靠合成阶段压低边缘让画布透出来当反光。
 * Dark 是**深海钴蓝**：填充压暗，只有带边与高光发亮，冰蓝边缘光是主要结构。
 * 两套不是反色关系，是两种材质——**但亮度不能差一个数量级**：暗色如果让光束
 * 比底色亮 7 倍，读起来就是科幻海报，而不是同一台仪器在暗房里。
 */
function fusionSettings(theme: Theme, breakpoint: Breakpoint): BeamsSettings {
  const lowEnd = typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4
  const lightBeam = breakpoint === "phone" ? 300 : breakpoint === "tablet" ? 440 : 560
  // 暗色的光束必须比亮色窄一档：底色只有 20/255，同宽的光束会把整块壳填成一片灰蓝。
  const darkBeam = breakpoint === "phone" ? 296 : breakpoint === "tablet" ? 440 : 520

  return theme === "light"
    ? {
        color: tokenColor("--brand-glass-optical-tint", theme, "#2f6fc9"),
        beamWidth: lightBeam,
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
        color: tokenColor("--brand-glass-optical-tint", theme, "#7cc4ff"),
        beamWidth: darkBeam,
        rotation: 26,
        speed: 0.66,
        waveLength: 420,
        depth: 1.0,
        sharpness: 0.62,
        twist: 0.22,
        fillLight: 0.14,
        glow: 0.45,
        brightness: 0.55,
        variation: 0.34,
        grain: 0.14,
        quality: lowEnd ? 0.5 : 0.75,
        mouseInteraction: !lowEnd,
        mouseStrength: 0.8,
        intro: true,
        fade: 0.26,
        opacity: 0.74,
        lightMode: false,
        paused: false,
        dpr: lowEnd ? 1 : 1.5,
      }
}

/**
 * 读取材质令牌作为着色器颜色。
 *
 * <p>WebGL uniform 只吃具体色值，吃不了 `var()`，所以颜色在构造参数时解析——
 * `--brand-glass-optical-tint` 因此仍是唯一真源。
 *
 * <p>**必须校验 DOM 上的主题类名**：`ThemeProvider` 在自己的 `useEffect` 里才把
 * `html.dark` 换过来，而子组件的 effect 先跑（React 的 effect 自下而上）。不校验
 * 的话，暗→亮切主题的那一次会读到**上一套主题**的令牌，定格之后再也不重绘，
 * 亮色首屏上就永远挂着一条冰蓝光带。DOM 还没跟上时先用同主题的兜底值。
 */
function tokenColor(name: string, theme: Theme, fallback: string) {
  if (typeof window === "undefined") return fallback
  const applied = document.documentElement.classList.contains("dark") ? "dark" : "light"
  if (applied !== theme) return fallback
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
 * <p>两端都靠**遮罩**收掉，而不是靠容器硬裁：
 * <ul>
 *   <li>入射线顶端用一条竖向渐变遮罩淡出，看起来是从环境光里长出来的，
 *       不是被上边缘切断；</li>
 *   <li>色散扇用一个以出射点为圆心的径向遮罩淡出，射线末端没有圆头硬边，
 *       读起来是能量衰减，不是三根激光。</li>
 * </ul>
 *
 * <p>**入射线终点 = 色散扇起点**：带子结束的那一点就是扇起笔的那一点，两点都落在
 * 棱镜体内。棱镜画在它们**上面**（半透明玻璃），所以「进入玻璃」那一段被压暗、
 * 「离开玻璃」之后才恢复亮度——因果链是画面本身画出来的，不靠文案解释。
 */
function FusionOptics({ theme, breakpoint, drifting }: OpticsProps): ReactElement {
  // 只保留安全字符：`url(#…)` 里带冒号或引号会让整个渐变失效。
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "")
  const geometry = GEOMETRY[breakpoint]
  const [vbWidth, vbHeight] = geometry.viewBox
  const { prism, fan } = geometry
  const [originX, originY] = fan.origin

  const half = prism.size / 2
  const halfWidth = prism.size * 0.54

  const tones = RAY_TONES[theme]
  const rays = Array.from({ length: RAY_COUNT }, (_, index) => {
    const step = RAY_COUNT === 1 ? 0 : (index / (RAY_COUNT - 1)) * 2 - 1
    // 极光紫那一侧只张开 55%：三条线等距就是「一张光谱示意图」，不等距才像色散。
    const spread = step * (step < 0 ? 0.55 : 1)
    const angle = ((fan.angle + spread * fan.spread) * Math.PI) / 180
    const length = fan.length * (1 - 0.1 * Math.abs(spread))
    return {
      key: index,
      x: originX + Math.cos(angle) * length,
      y: originY + Math.sin(angle) * length,
      tone: tones[index % tones.length],
      width: 2.3 - 0.5 * Math.abs(spread),
      opacity: 0.68 - 0.14 * Math.abs(spread),
    }
  })

  const spacing = geometry.sheath / (geometry.fibers + 0.5)
  const fiberOffsets = Array.from(
    { length: geometry.fibers },
    (_, index) => index - (geometry.fibers - 1) / 2,
  )

  return (
    <svg
      className={`hero-fusion__optics${drifting ? " is-drifting" : ""}`}
      viewBox={`0 0 ${vbWidth} ${vbHeight}`}
      preserveAspectRatio="xMidYMin meet"
      data-theme={theme}
    >
      <defs>
        <linearGradient
          id={`${uid}-sheath`}
          x1={geometry.axis[0]}
          y1={geometry.axis[1]}
          x2={geometry.axis[2]}
          y2={geometry.axis[3]}
        >
          <stop offset="0" className="optic-stop--sheath-far" />
          <stop offset="0.55" className="optic-stop--sheath-mid" />
          <stop offset="1" className="optic-stop--sheath-near" />
        </linearGradient>
        <linearGradient
          id={`${uid}-core`}
          x1={geometry.axis[0]}
          y1={geometry.axis[1]}
          x2={geometry.axis[2]}
          y2={geometry.axis[3]}
        >
          <stop offset="0" className="optic-stop--core-far" />
          <stop offset="0.6" className="optic-stop--core-mid" />
          <stop offset="1" className="optic-stop--core-mid" />
        </linearGradient>

        {/* 棱镜的两个面：左面压暗、右面受光，玻璃的厚度来自这两个方向性面。 */}
        <linearGradient id={`${uid}-face-left`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" className="hero-fusion__stop--face-left-a" />
          <stop offset="1" className="hero-fusion__stop--face-left-b" />
        </linearGradient>
        <linearGradient id={`${uid}-face-right`} x1="0" y1="0" x2="1" y2="0.8">
          <stop offset="0" className="hero-fusion__stop--face-right-a" />
          <stop offset="1" className="hero-fusion__stop--face-right-b" />
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
        <radialGradient id={`${uid}-origin`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="hero-fusion__stop--origin-core" />
          <stop offset="1" className="hero-fusion__stop--origin-fade" />
        </radialGradient>

        {/* 入射线顶端淡出：沿光带自身方向从透明长到实，不是被上边缘切断。 */}
        <linearGradient
          id={`${uid}-ribbon-fade`}
          gradientUnits="userSpaceOnUse"
          x1={geometry.fade.from[0]}
          y1={geometry.fade.from[1]}
          x2={geometry.fade.to[0]}
          y2={geometry.fade.to[1]}
        >
          <stop offset="0" stopColor="#000" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <mask id={`${uid}-ribbon-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={vbWidth} height={vbHeight}>
          <rect width={vbWidth} height={vbHeight} fill={`url(#${uid}-ribbon-fade)`} />
        </mask>

        {/* 色散扇末端淡出：能量衰减，不是圆头激光。 */}
        <radialGradient
          id={`${uid}-ray-fade`}
          gradientUnits="userSpaceOnUse"
          cx={originX}
          cy={originY}
          r={fan.length * 1.15}
        >
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id={`${uid}-ray-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={vbWidth} height={vbHeight}>
          <rect width={vbWidth} height={vbHeight} fill={`url(#${uid}-ray-fade)`} />
        </mask>
      </defs>

      {/* 入射线：与方案 A 同一套玻璃体（宽鞘 + 细纤维 + 边缘高光）。 */}
      <g className="hero-fusion__ribbon" mask={`url(#${uid}-ribbon-mask)`}>
        <path
          className="optic-flow__sheath"
          d={geometry.ribbon}
          stroke={`url(#${uid}-sheath)`}
          strokeWidth={geometry.sheath}
        />
        <path
          className="optic-flow__sheath optic-flow__sheath--core"
          d={geometry.ribbon}
          stroke={`url(#${uid}-core)`}
          strokeWidth={geometry.sheath * 0.6}
        />
        <g className="optic-flow__fiber-set">
          {fiberOffsets.map((offset) => (
            <path
              key={offset}
              d={geometry.ribbon}
              transform={`translate(0 ${offset * spacing})`}
            />
          ))}
        </g>
        <g className="optic-flow__fiber-set optic-flow__fiber-set--core">
          <path d={geometry.ribbon} transform="translate(0 0)" />
          <path d={geometry.ribbon} transform={`translate(0 ${spacing})`} />
        </g>
        <g className="optic-flow__fiber-set optic-flow__fiber-set--rim">
          <path d={geometry.ribbon} transform={`translate(0 ${-geometry.sheath * 0.48})`} />
          <path d={geometry.ribbon} transform={`translate(0 ${geometry.sheath * 0.48})`} />
        </g>
      </g>

      {/* 出射段：色散扇。从入射线终点起笔，先一层模糊的同形描边当辉光，再画实线。 */}
      <g className="hero-fusion__rays hero-fusion__rays--glow" mask={`url(#${uid}-ray-mask)`}>
        {rays.map((ray) => (
          <line
            key={ray.key}
            x1={originX}
            y1={originY}
            x2={ray.x}
            y2={ray.y}
            stroke={ray.tone}
            strokeWidth={ray.width * 3.2}
            opacity={ray.opacity * 0.34}
          />
        ))}
      </g>
      <g className="hero-fusion__rays" mask={`url(#${uid}-ray-mask)`}>
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

      {/* 出射点的一小团辉光：三根线不该「凭空起笔」。 */}
      <circle
        cx={originX}
        cy={originY}
        r={prism.size * 0.26}
        fill={`url(#${uid}-origin)`}
      />

      {/* 光晕单独一层：它不该吃到棱镜本体的投影滤镜。
          半径压到 0.78×边长：1.02 时它的左上缘会探进标题右下角（实测有 0.7% 的
          标题像素被抬亮 47/255）。光晕只负责把棱镜从背景里托起来，不负责发光到字上。 */}
      <circle cx={prism.x} cy={prism.y} r={prism.size * 0.78} fill={`url(#${uid}-halo)`} />

      {/* 棱镜本体：两个方向性面 + 内反射 + 外轮廓 + 棱线 + 焦散 + 左棱反射。 */}
      <g
        className="hero-fusion__prism"
        transform={`translate(${prism.x} ${prism.y}) rotate(${prism.rotate})`}
      >
        <path
          className="hero-fusion__face hero-fusion__face--left"
          d={`M0 ${-half} L0 ${half} L${-halfWidth} ${half} Z`}
          fill={`url(#${uid}-face-left)`}
        />
        <path
          className="hero-fusion__face hero-fusion__face--right"
          d={`M0 ${-half} L${halfWidth} ${half} L0 ${half} Z`}
          fill={`url(#${uid}-face-right)`}
        />
        {/* 内反射：右面中段一片很淡的亮面，给玻璃「里面还有一层」的体量。 */}
        <path
          className="hero-fusion__inner-glow"
          d={`M${halfWidth * 0.06} ${-half * 0.5} L${halfWidth * 0.8} ${half * 0.72} L${halfWidth * 0.24} ${half * 0.9} Z`}
        />
        <ellipse
          className="hero-fusion__caustic"
          cx={-halfWidth * 0.22}
          cy={half * 0.18}
          rx={halfWidth * 0.78}
          ry={half * 0.58}
          fill={`url(#${uid}-caustic)`}
        />
        <path
          className="hero-fusion__outline"
          d={`M0 ${-half} L${halfWidth} ${half} L${-halfWidth} ${half} Z`}
          fill="none"
          stroke={`url(#${uid}-edge)`}
        />
        <path className="hero-fusion__facet" d={`M0 ${-half} L0 ${half}`} />
        <path
          className="hero-fusion__facet hero-fusion__facet--soft"
          d={`M0 ${-half} L${-halfWidth * 0.5} ${half}`}
        />
        <path
          className="hero-fusion__facet hero-fusion__facet--soft"
          d={`M${-halfWidth} ${half} L${halfWidth} ${half}`}
        />
        <path
          className="hero-fusion__specular"
          d={`M${-halfWidth * 0.84} ${half * 0.86} L${-halfWidth * 0.08} ${-half * 0.8}`}
        />
      </g>
    </svg>
  )
}
