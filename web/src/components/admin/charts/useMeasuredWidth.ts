import { useEffect, useRef, useState } from "react"

/**
 * 量出容器的真实宽度，供手写 SVG 按它重算 viewBox。
 *
 * 手写图表原来用固定逻辑宽（viewBox 0 0 640 240）+ width:100%，
 * 卡片一变宽，SVG 就整体等比放大——坐标轴文字、端点直标跟着变大，
 * 在 2560 这类宽屏上字会胀到 20px，仪表读数感全失。
 *
 * 这里把「逻辑宽」直接设成容器的 CSS 像素宽：viewBox 与渲染尺寸 1:1，
 * 缩放比恒为 1，字号保持设计值，而绘图区（plot）随容器一起变宽——
 * 宽屏得到的是更长的横轴，不是更大的字。
 *
 * 容器比 min 窄时按 min 兜底：逻辑宽大于渲染宽 → 缩放比 < 1 → 图形等比缩小，
 * 几何不会塌陷（窄屏本来就要缩）。
 */
export function useMeasuredWidth<T extends Element>(min: number) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(min)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const apply = (value: number): void => {
      if (!Number.isFinite(value) || value <= 0) return
      setWidth(Math.max(Math.round(value), min))
    }

    apply(el.getBoundingClientRect().width)

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [min])

  return { ref, width }
}
