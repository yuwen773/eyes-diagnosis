import { useEffect, useState } from "react"

/**
 * 等待反馈（Lattice Loader）。
 *
 * <p>只用在「用户已发送、真实事件还没到」这一小段窗口里：它回答的是
 * 「系统收到了吗」，不是「系统正在处理到第几步」。所以它不计时、不编进度，
 * 也不在事件到达后继续转——第一条真实事件到了就没有它了。
 *
 * <p>渲染是静态 SVG + CSS 动画，没有 canvas、没有逐帧 JS，因此不会带来
 * 额外的 React 重渲染。页面在后台（`document.hidden`）时暂停动画；
 * `prefers-reduced-motion: reduce` 时退化为静态点阵。
 */

const COLUMNS = 4
const ROWS = 3

/** 节点坐标：4×3 点阵，间距均匀。 */
const NODES = Array.from({ length: COLUMNS * ROWS }, (_, i) => ({
  x: 10 + (i % COLUMNS) * 20,
  y: 12 + Math.floor(i / COLUMNS) * 26,
  index: i,
}))

export function LatticeLoader({ label = "正在接收回复" }: { label?: string }) {
  const [hidden, setHidden] = useState(false)

  // 后台时停：visibilitychange 是事件驱动的，不产生轮询与定时器。
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  return (
    <div
      className="lattice"
      data-hidden={hidden ? "true" : undefined}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <svg
        className="lattice__grid"
        width="80"
        height="64"
        viewBox="0 0 80 64"
        aria-hidden="true"
        focusable="false"
      >
        {NODES.map((node) => (
          <circle
            key={node.index}
            className="lattice__node"
            cx={node.x}
            cy={node.y}
            r="2.4"
            style={{ animationDelay: `${(node.index % COLUMNS) * 90 + Math.floor(node.index / COLUMNS) * 60}ms` }}
          />
        ))}
      </svg>
      <span className="lattice__label">{label}</span>
    </div>
  )
}
