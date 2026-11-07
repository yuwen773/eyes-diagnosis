import { useEffect, useRef } from "react"

type Dot = {
  /** 归位点 */
  bx: number
  by: number
  /** 当前点 */
  x: number
  y: number
}

const GAP = 34
const RADIUS = 1
const PROXIMITY = 110
const PUSH = 9
const EASE = 0.16

/** 两个色调：亮页上点墨色，暗页上点纸色。 */
const TONES = {
  ink: { base: 0.19, lit: 0.4, rgb: "20,23,26" },
  paper: { base: 0.15, lit: 0.38, rgb: "244,245,241" },
} as const

/**
 * 点阵底：一张会回弹的测量板。
 * 指针靠近时点被推开，离开后自己归位；其余时候完全静止。
 * 不是特效层——它替代的就是原来那张静态工程纸网格。
 */
export function DotGrid({ tone = "ink" }: { tone?: keyof typeof TONES }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const toneRef = useRef(TONES[tone])
  toneRef.current = TONES[tone]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    let dots: Dot[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let pointer = { x: -9999, y: -9999 }
    /** 画布在视口里的左上角，滚动/缩放时更新，避免逐帧读布局。 */
    let originX = 0
    let originY = 0
    let frame = 0
    let running = true

    const syncOrigin = () => {
      const rect = canvas.getBoundingClientRect()
      originX = rect.left
      originY = rect.top
    }

    const build = () => {
      syncOrigin()
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      // 从版心外沿起算，左右留出对称的一格，点阵和栅格同宽。
      const pad = Math.max((width - 1240) / 2, 0) + 40
      const startX = pad - GAP
      const endX = width - pad + GAP

      dots = []
      for (let y = GAP; y < height; y += GAP) {
        for (let x = startX; x < endX; x += GAP) {
          dots.push({ bx: x, by: y, x, y })
        }
      }
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)

      const px = pointer.x - originX
      const py = pointer.y - originY
      const { base, lit, rgb } = toneRef.current
      const baseStyle = `rgba(${rgb},${base})`
      const litStyle = `rgba(${rgb},${lit})`

      for (const dot of dots) {
        let influence = 0

        if (px > -PROXIMITY && px < width + PROXIMITY) {
          const dx = dot.bx - px
          const dy = dot.by - py
          const distance = Math.hypot(dx, dy)
          if (distance < PROXIMITY) {
            influence = 1 - distance / PROXIMITY
            const safe = distance || 1
            dot.x = dot.bx + (dx / safe) * influence * PUSH
            dot.y = dot.by + (dy / safe) * influence * PUSH
          }
        }

        dot.x += (dot.bx - dot.x) * EASE
        dot.y += (dot.by - dot.y) * EASE

        const moved = Math.abs(dot.x - dot.bx) + Math.abs(dot.y - dot.by)
        context.fillStyle = moved > 0.15 ? litStyle : baseStyle
        context.fillRect(dot.x, dot.y, RADIUS * 2, RADIUS * 2)
      }

      if (running) frame = requestAnimationFrame(draw)
    }

    const onMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
    }

    const onLeave = () => {
      pointer = { x: -9999, y: -9999 }
    }

    build()

    if (calm) {
      running = false
      draw()
    } else {
      frame = requestAnimationFrame(draw)
      window.addEventListener("mousemove", onMove, { passive: true })
      window.addEventListener("mouseout", onLeave, { passive: true })
      window.addEventListener("scroll", syncOrigin, { passive: true })
    }

    const observer = new ResizeObserver(() => {
      build()
      if (!running) draw()
    })
    observer.observe(canvas)

    // 首屏滚出视口就停，别让一张看不见的图一直跑。
    const visibility = new IntersectionObserver(
      ([entry]) => {
        const next = entry.isIntersecting
        if (next === running) return
        running = next
        if (running) frame = requestAnimationFrame(draw)
        else cancelAnimationFrame(frame)
      },
      { threshold: 0 },
    )
    visibility.observe(canvas)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseout", onLeave)
      window.removeEventListener("scroll", syncOrigin)
      observer.disconnect()
      visibility.disconnect()
    }
  }, [])

  return <canvas className="dotgrid" ref={canvasRef} aria-hidden="true" />
}
