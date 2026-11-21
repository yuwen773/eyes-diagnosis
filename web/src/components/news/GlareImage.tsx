import { useCallback, useRef, type CSSProperties, type ReactNode } from "react"

/**
 * 真实封面上的低强度聚光（Glare Hover）。
 *
 * <p>交互思路参考 React Bits 的 Glare Hover，但实现是本仓库独立编写的：
 * 上游那一版走 canvas 逐帧绘制，这里用一层 CSS 渐变跟随指针，零依赖、
 * 零重绘，reduced-motion 与触屏自然失效（见下）。
 *
 * <p>三条硬约束（DESIGN.md §2.1 / §3.7）：
 * - 只用在**真实封面**上，没有封面就不挂这个组件——不拿装饰补空位；
 * - 光斑不压标题、不盖正文：它只在这一层图片内部，标题在图片之外；
 * - 触屏与 reduced-motion 下没有效果：没有 hover 就没有指针位置，
 *   光斑停在默认的弱值上，看不出差别。
 *
 * <p>光斑位置写进 CSS 变量（`--gx` / `--gy`），不写 inline style，
 * 避免每次 pointermove 触发 React 重渲染。
 */
export function GlareImage({
  src,
  alt,
  className,
  imgClassName,
  children,
}: {
  src: string
  alt: string
  /** 容器类名（决定圆角与裁切）。 */
  className?: string
  /** 图片本身的类名。 */
  imgClassName?: string
  /** 图片之上的内容层（比如图注）。 */
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // 触屏没有 hover：不跟手，也不制造「点一下会发光」的错觉。
    if (event.pointerType === "touch") return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // 还没排版（或被 display:none 藏起来）时尺寸是 0，算出来的百分比没有
    // 意义——这一帧直接跳过，等下一次指针事件。
    if (rect.width === 0 || rect.height === 0) return
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    el.style.setProperty("--gx", `${x.toFixed(2)}%`)
    el.style.setProperty("--gy", `${y.toFixed(2)}%`)
    el.dataset.glare = "on"
  }, [])

  const onPointerLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.dataset.glare = "off"
  }, [])

  return (
    <div
      ref={ref}
      className={`glare${className ? ` ${className}` : ""}`}
      data-glare="off"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{ "--gx": "50%", "--gy": "35%" } as CSSProperties}
    >
      <img className={imgClassName} src={src} alt={alt} loading="lazy" />
      <span className="glare__sheen" aria-hidden="true" />
      {children}
    </div>
  )
}
