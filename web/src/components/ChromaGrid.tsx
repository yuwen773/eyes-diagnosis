import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { Link } from "react-router-dom"
import "./ChromaGrid.css"

export type ChromaItem = {
  /** 没有图时用 media 顶上——空白的取景框也是一格。 */
  image?: string
  alt?: string
  title?: string
  subtitle?: string
  /** 图注下方追加的一行（等宽读数）。 */
  note?: ReactNode
  /** 显色时用的强调色。默认取信号橙。 */
  accent?: string
  /** 站内路由。 */
  to?: string
  /** 站外链接。 */
  href?: string
  /** 无图时媒体区里的内容。 */
  media?: ReactNode
}

export type ChromaGridProps = {
  items: ChromaItem[]
  columns?: number
  minCardWidth?: number
  gap?: number
  /** 聚光灯半径（px）。 */
  radius?: number
  /** 边缘过渡：0 是硬边，1 是弥散。 */
  softness?: number
  /** 跟随阻尼：0 是硬跟。 */
  damping?: number
  /** 光标离开后褪色时间（秒）。 */
  fadeOut?: number
  /** 聚光外的去色程度 0–1。 */
  grayscale?: number
  /** 聚光外的压暗程度 0–0.9。 */
  dim?: number
  /** 强调色自底部泛起的强度 0–1。 */
  glow?: number
  /** 聚光时边框亮起的强度 0–1。 */
  borderGlow?: number
  reveal?: "spotlight" | "card"
  aspectRatio?: string
  cardRadius?: number
  showInfo?: boolean
  className?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 聚光灯的边缘：把柔软度换成一串径向渐变色标。 */
const falloffStops = (softness: number) => {
  const core = clamp(1 - softness, 0, 0.95)
  const stops: string[] = []
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12
    const u = clamp((t - core) / Math.max(0.0001, 1 - core), 0, 1)
    const alpha = 1 - u * u * u * (u * (u * 6 - 15) + 10)
    stops.push(`rgba(0, 0, 0, ${alpha.toFixed(3)}) ${(t * 100).toFixed(1)}%`)
  }
  return stops.join(", ")
}

/**
 * 资讯墙 · 聚光样片。
 *
 * 每一格是一帧底片：光标没靠近时是灰的（未曝光），靠近才显色。
 * 皮肤全部消费 app 令牌，所以浅色是台面上的样片，暗色是暗房里的样片。
 */
export function ChromaGrid({
  items,
  columns = 3,
  minCardWidth = 240,
  gap = 14,
  radius = 240,
  softness = 0.55,
  damping = 0.45,
  fadeOut = 0.5,
  grayscale = 1,
  dim = 0.18,
  glow = 0.34,
  borderGlow = 1,
  reveal = "spotlight",
  aspectRatio = "1 / 1",
  cardRadius = 0,
  showInfo = true,
  className = "",
}: ChromaGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const settingsRef = useRef({ damping, fadeOut, spotlight: reveal !== "card" })
  const placeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    settingsRef.current = { damping, fadeOut, spotlight: reveal !== "card" }
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const state = { x: 0, y: 0, tx: 0, ty: 0, power: 0, target: 0, primed: false }
    let raf = 0
    let last = 0

    // 每一格的媒体区相对整墙的偏移。聚光的遮罩要按各自的坐标系对齐。
    const place = () => {
      const box = root.getBoundingClientRect()
      root.querySelectorAll<HTMLElement>("[data-chroma-area]").forEach((node) => {
        const rect = node.getBoundingClientRect()
        node.style.setProperty("--chroma-ox", `${rect.left - box.left}px`)
        node.style.setProperty("--chroma-oy", `${rect.top - box.top}px`)
      })
    }
    placeRef.current = place

    const tick = (now: number) => {
      raf = 0
      const s = settingsRef.current
      if (!s) return
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
      last = now

      const follow = reduce ? 1 : 1 - Math.exp(-dt / Math.max(0.01, s.damping * 0.32))
      state.x += (state.tx - state.x) * follow
      state.y += (state.ty - state.y) * follow

      const span = state.target > state.power ? 0.1 : Math.max(0.02, s.fadeOut * 0.35)
      state.power += (state.target - state.power) * (reduce ? 1 : 1 - Math.exp(-dt / span))

      root.style.setProperty("--chroma-x", `${state.x.toFixed(2)}px`)
      root.style.setProperty("--chroma-y", `${state.y.toFixed(2)}px`)
      root.style.setProperty("--chroma-power", state.power.toFixed(4))

      const settled =
        Math.abs(state.tx - state.x) < 0.1 &&
        Math.abs(state.ty - state.y) < 0.1 &&
        Math.abs(state.target - state.power) < 0.002

      if (settled) {
        state.power = state.target
        root.style.setProperty("--chroma-power", state.power.toFixed(4))
        last = 0
      } else {
        raf = requestAnimationFrame(tick)
      }
    }

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      if (!settingsRef.current?.spotlight) return
      const box = root.getBoundingClientRect()
      state.tx = event.clientX - box.left
      state.ty = event.clientY - box.top
      // 第一次进来直接落在光标上，不要从左上角飞过来。
      if (!state.primed || state.power < 0.02) {
        state.x = state.tx
        state.y = state.ty
        state.primed = true
      }
      state.target = 1
      wake()
    }

    const onLeave = () => {
      state.target = 0
      wake()
    }

    const observer = new ResizeObserver(place)
    observer.observe(root)
    root.addEventListener("pointermove", onMove)
    root.addEventListener("pointerdown", onMove)
    root.addEventListener("pointerleave", onLeave)
    root.addEventListener("pointercancel", onLeave)
    place()

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      root.removeEventListener("pointermove", onMove)
      root.removeEventListener("pointerdown", onMove)
      root.removeEventListener("pointerleave", onLeave)
      root.removeEventListener("pointercancel", onLeave)
      placeRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    placeRef.current?.()
  })

  const rootStyle = {
    "--chroma-cols": Math.max(1, Math.round(columns)),
    "--chroma-min": `${Math.max(80, minCardWidth)}px`,
    "--chroma-gap": `${Math.max(0, gap)}px`,
    "--chroma-r": `${Math.max(20, radius)}px`,
    "--chroma-stops": falloffStops(clamp(softness, 0, 1)),
    "--chroma-gray": clamp(grayscale, 0, 1),
    "--chroma-dim": clamp(dim, 0, 0.9),
    "--chroma-glow": clamp(glow, 0, 1),
    "--chroma-border": clamp(borderGlow, 0, 1),
    "--chroma-fade": `${Math.max(0, fadeOut)}s`,
    "--chroma-ratio": aspectRatio,
    "--chroma-radius": `${Math.max(0, cardRadius)}px`,
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={`chroma-grid${className ? ` ${className}` : ""}`}
      data-reveal={reveal === "card" ? "card" : "spotlight"}
      style={rootStyle}
    >
      <div className="chroma-grid-inner">
        {items.map((item, index) => {
          const accent = item.accent ?? "var(--signal)"
          const cardStyle = { "--chroma-accent": accent } as CSSProperties

          const body = (
            <>
              <span className="chroma-wash" aria-hidden="true" />
              <div className="chroma-media" data-chroma-area="">
                {item.image ? (
                  <>
                    <img className="chroma-mono" src={item.image} alt={item.alt ?? item.title ?? ""} loading="lazy" />
                    <img className="chroma-color" src={item.image} alt="" aria-hidden="true" loading="lazy" />
                  </>
                ) : (
                  item.media ?? null
                )}
                <span className="chroma-media-rim" aria-hidden="true" />
              </div>
              {showInfo && (item.title || item.subtitle || item.note) ? (
                <div className="chroma-info">
                  {item.title ? <span className="chroma-title">{item.title}</span> : null}
                  {item.subtitle ? <span className="chroma-subtitle">{item.subtitle}</span> : null}
                  {item.note ? <span className="chroma-note">{item.note}</span> : null}
                </div>
              ) : null}
              <span className="chroma-card-rim" aria-hidden="true" />
              <span className="chroma-card-glow" aria-hidden="true" />
            </>
          )

          const key = `${item.title ?? "item"}-${index}`

          if (item.to) {
            return (
              <Link key={key} to={item.to} className="chroma-card" data-chroma-area="" style={cardStyle}>
                {body}
              </Link>
            )
          }

          if (item.href) {
            return (
              <a
                key={key}
                className="chroma-card"
                data-chroma-area=""
                style={cardStyle}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {body}
              </a>
            )
          }

          return (
            <article key={key} className="chroma-card" data-chroma-area="" style={cardStyle}>
              {body}
            </article>
          )
        })}
      </div>
    </div>
  )
}

export default ChromaGrid
