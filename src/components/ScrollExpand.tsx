import { useCallback, useEffect, useRef } from "react"
import type { CSSProperties, ReactNode, RefObject } from "react"
import "./ScrollExpand.css"

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

export type ScrollExpandProps = {
  /** 媒体地址。 */
  src?: string
  /** 媒体类型。 */
  mediaType?: "image" | "video"
  /** 视频加载前的封面。 */
  poster?: string
  /** 图片替代文本。 */
  alt?: string
  /** 静止时压在画面上的标题，展开时让位给媒体。 */
  title?: ReactNode
  /** 静止画面下方的小提示，开始滚动后淡出。 */
  scrollHint?: string
  /** 展开前的宽度，占舞台高度的百分比。 */
  startWidth?: number
  /** 展开前的高度，占舞台高度的百分比。 */
  startHeight?: number
  /** 静止画面的圆角，单位 px。 */
  startRadius?: number
  /** 完全展开后的圆角，单位 px。 */
  endRadius?: number
  /** 静止时媒体的放大倍数，展开时回到 1。 */
  mediaZoom?: number
  /** 展开所消耗的滚动长度，以舞台高度为单位。 */
  scrollDistance?: number
  /** 完全展开后额外停留的滚动长度。 */
  holdDistance?: number
  /** 跟随时间，单位秒；0 表示与滚动条严格同步。 */
  smoothing?: number
  /** 渐变压暗层的强度，保证叠加文字可读。 */
  overlayScrim?: number
  /** 用页面滚动驱动展开，而不是组件自己的滚动容器。 */
  useWindowScroll?: boolean
  /** 是否启用。 */
  enabled?: boolean
  /** 完全展开后淡入的内容。 */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * 展开光幕：静止时是一张带圆角的小画面，随页面滚动一路张开到满屏，
 * 标题让位给媒体本身。落地页用它把「一张眼底照片」推到眼前。
 */
export function ScrollExpand({
  src = "",
  mediaType = "image",
  poster = "",
  alt = "",
  title = "",
  scrollHint = "",
  startWidth = 42,
  startHeight = 58,
  startRadius = 24,
  endRadius = 0,
  mediaZoom = 1.35,
  scrollDistance = 1.2,
  holdDistance = 0.35,
  smoothing = 0.1,
  overlayScrim = 0.45,
  useWindowScroll = false,
  enabled = true,
  children,
  className = "",
  style,
}: ScrollExpandProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  // 顶栏高度用来判断黑画面有没有压到顶栏下面，缓存住别每帧查。
  const headRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const hintRef = useRef<HTMLDivElement | null>(null)

  const propsRef = useRef({
    startWidth,
    startHeight,
    startRadius,
    endRadius,
    mediaZoom,
    scrollDistance,
    holdDistance,
    smoothing,
    overlayScrim,
    useWindowScroll,
    enabled,
  })

  // 最近一次应用的进度；图片加载完要按它重算一次缩放。
  const progressRef = useRef(0)

  // props 供动画循环读取；不在渲染期直接写 ref。
  useEffect(() => {
    propsRef.current = {
      startWidth,
      startHeight,
      startRadius,
      endRadius,
      mediaZoom,
      scrollDistance,
      holdDistance,
      smoothing,
      overlayScrim,
      useWindowScroll,
      enabled,
    }
  })

  const applyProgress = useCallback((p: number) => {
    const frame = frameRef.current
    const media = mediaRef.current
    if (!frame || !media) return
    const c = propsRef.current
    progressRef.current = p

    const e = smoothstep(0, 1, p)

    // 窄屏上舞台比例不同，静止尺寸跟着调，免得裁成一条缝。
    const compact = window.innerWidth < 720
    const startW = compact ? Math.max(c.startWidth, 92) : c.startWidth
    const startH = compact ? Math.min(c.startHeight, 26) : c.startHeight
    const zoom = compact ? 1.02 : c.mediaZoom

    const w = startW + (100 - startW) * e
    const h = startH + (100 - startH) * e
    const ix = Math.max(0, (100 - w) / 2)
    const iy = Math.max(0, (100 - h) / 2)
    const r = c.startRadius + (c.endRadius - c.startRadius) * e
    frame.style.clipPath = `inset(${iy}% ${ix}% ${iy}% ${ix}% round ${r}px)`

    // 黑画面上沿压到顶栏下沿时，给舞台打一个标记，顶栏据此反相。
    const stage = stageRef.current
    if (stage) {
      let head = headRef.current
      if (!head) {
        head = document.querySelector<HTMLElement>("[data-site-head]")
        headRef.current = head
      }
      const navH = head?.offsetHeight ?? 0
      const stageTop = stage.getBoundingClientRect().top
      const frameTop = stageTop + (iy / 100) * (stage.clientHeight || 1)
      const invert = navH > 0 && frameTop <= navH
      const flag = String(invert)
      if (stage.dataset.headInvert !== flag) stage.dataset.headInvert = flag
    }

    // 媒体按窗口尺寸缩放：静止时整张照片正好落在小窗里，展开时一路涨到满屏。
    const elW = media.clientWidth || 1
    const elH = media.clientHeight || 1
    const ar =
      (media instanceof HTMLVideoElement
        ? media.videoWidth && media.videoHeight
          ? media.videoWidth / media.videoHeight
          : 0
        : media.naturalWidth && media.naturalHeight
          ? media.naturalWidth / media.naturalHeight
          : 0) || 16 / 9
    // object-fit: contain 之后的实际成像框。
    const contentW = Math.min(elW, elH * ar)
    const contentH = contentW / ar
    const fit = Math.min((elW * w) / 100 / contentW, (elH * h) / 100 / contentH)
    media.style.transform = `scale(${fit * (zoom + (1 - zoom) * e)})`

    if (scrimRef.current) scrimRef.current.style.opacity = `${c.overlayScrim * e}`

    if (titleRef.current) {
      // 照片压上来之前标题就让位，避免深色画面上出现深色字。
      const out = smoothstep(0.05, 0.28, p)
      titleRef.current.style.opacity = `${1 - out}`
      titleRef.current.style.transform = `translate3d(0, ${-28 * out}px, 0) scale(${1 + 0.06 * out})`
    }

    if (hintRef.current) {
      const gone = smoothstep(0, 0.12, p)
      hintRef.current.style.opacity = `${1 - gone}`
      hintRef.current.style.transform = `translate3d(0, ${8 * gone}px, 0)`
    }

    if (overlayRef.current) {
      const inn = smoothstep(0.78, 1, p)
      overlayRef.current.style.opacity = `${inn}`
      overlayRef.current.style.transform = `translate3d(0, ${18 * (1 - inn)}px, 0)`
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const track = trackRef.current
    const stage = stageRef.current
    if (!root || !track || !stage) return

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    let raf = 0
    let current = 0
    let target = 0
    let stageH = 0
    let running = false

    const measure = () => {
      const c = propsRef.current
      stageH = c.useWindowScroll ? window.innerHeight : root.clientHeight
      if (stageH <= 0) return
      stage.style.height = `${stageH}px`
      const travel = reduceMotion
        ? 0
        : Math.max(0, c.scrollDistance) + Math.max(0, c.holdDistance)
      track.style.height = `${stageH * (1 + travel)}px`
    }

    const readProgress = () => {
      const c = propsRef.current
      if (!c.enabled) return 1
      const span = stageH * Math.max(0.01, c.scrollDistance)
      if (c.useWindowScroll) {
        const top = track.getBoundingClientRect().top
        return clamp(-top / span, 0, 1)
      }
      return clamp(root.scrollTop / span, 0, 1)
    }

    const tick = () => {
      const c = propsRef.current
      const k = c.smoothing <= 0 ? 1 : 1 - Math.exp(-1 / (60 * c.smoothing))
      current += (target - current) * k
      if (Math.abs(target - current) < 0.0004) {
        current = target
        running = false
      }
      applyProgress(current)
      raf = running ? requestAnimationFrame(tick) : 0
    }

    const kick = () => {
      if (running) return
      running = true
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onScroll = () => {
      target = readProgress()
      if (propsRef.current.smoothing <= 0 || reduceMotion) {
        current = target
        applyProgress(current)
        return
      }
      kick()
    }

    const onResize = () => {
      measure()
      target = reduceMotion ? 1 : readProgress()
      current = target
      applyProgress(current)
    }

    measure()
    // 减少动效时不做滚动驱动的展开，直接呈现展开后的样子。
    target = reduceMotion ? 1 : readProgress()
    current = target
    applyProgress(current)

    const scroller = useWindowScroll ? window : root
    if (!reduceMotion) {
      scroller.addEventListener("scroll", onScroll, { passive: true })
    }
    window.addEventListener("resize", onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(root)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      scroller.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
      ro.disconnect()
    }
  }, [applyProgress, useWindowScroll])

  const media =
    mediaType === "video" ? (
      <video
        ref={mediaRef as RefObject<HTMLVideoElement>}
        className="scroll-expand__media"
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
      />
    ) : (
      <img
        ref={mediaRef as RefObject<HTMLImageElement>}
        className="scroll-expand__media"
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => applyProgress(progressRef.current)}
      />
    )

  return (
    <div
      ref={rootRef}
      className={`scroll-expand ${useWindowScroll ? "" : "scroll-expand--scroller"} ${className}`.trim()}
      style={style}
    >
      <div ref={trackRef} className="scroll-expand__track">
        <div ref={stageRef} className="scroll-expand__stage">
          <div ref={frameRef} className="scroll-expand__frame">
            {media}
            <div ref={scrimRef} className="scroll-expand__scrim" />
            {children ? (
              <div ref={overlayRef} className="scroll-expand__overlay">
                {children}
              </div>
            ) : null}
          </div>
          {title ? (
            <div ref={titleRef} className="scroll-expand__title">
              {title}
            </div>
          ) : null}
          {scrollHint ? (
            <div ref={hintRef} className="scroll-expand__hint">
              {scrollHint}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
