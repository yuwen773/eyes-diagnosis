import { useEffect, useState, type RefObject } from "react"

/**
 * 元素的内容宽度（布局宽，不受 transform 影响）。
 *
 * <p>为什么不用 `getBoundingClientRect()`：管理端预览把整页用
 * `transform: scale()` 缩放显示，rect 读到的是缩放后的值——390 的设备框
 * 在 0.5 倍缩放下只剩 195，阈值判断全错。`offsetWidth` 与 ResizeObserver 的
 * `contentRect` 给的都是布局宽，两种上下文一致。
 *
 * <p>没有 ResizeObserver 的环境（测试）返回 0，调用方按「未知宽度」处理。
 */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      // offsetWidth 在任何浏览器里都是数字，但个别环境（把它从原型上删掉
      // 的测试）读出来是 undefined——那要按「未知宽度」算成 0，
      // 别把 undefined 传进状态里，调用方会拿它去比阈值。
      const value = el.offsetWidth
      setWidth(typeof value === "number" && Number.isFinite(value) ? value : 0)
    }
    read()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
