import { useInView } from "@/lib/useInView"

type DialProps = {
  /** 0–1 */
  value: number
  size?: number
  label?: string
}

const TICKS = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2 - Math.PI / 2
  const major = index % 6 === 0
  const outer = 50
  const inner = major ? 45.5 : 47.8
  return {
    x1: 50 + Math.cos(angle) * inner,
    y1: 50 + Math.sin(angle) * inner,
    x2: 50 + Math.cos(angle) * outer,
    y2: 50 + Math.sin(angle) * outer,
    major,
  }
})

/** 置信环：一圈刻度 + 一段弧。数字用等宽，读数像仪器。 */
export function ConfidenceDial({ value, size = 104, label = "CONF" }: DialProps) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const clamped = Math.min(Math.max(value, 0), 1)
  const offset = inView ? 100 - clamped * 100 : 100

  return (
    <div
      ref={ref}
      className="dial"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} ${clamped.toFixed(2)}`}
    >
      <svg viewBox="-2 -2 104 104" width={size} height={size} aria-hidden="true">
        {TICKS.map((tick, index) => (
          <line
            key={index}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="currentColor"
            strokeWidth={tick.major ? 1 : 0.5}
            opacity={tick.major ? 0.45 : 0.22}
          />
        ))}
        <circle cx="50" cy="50" r="40" fill="none" strokeWidth="1" className="dial__track" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="2"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={offset}
          className="dial__value"
        />
      </svg>
      <div className="dial__center">
        <span className="dial__num">{clamped.toFixed(2)}</span>
        <span className="dial__unit">{label}</span>
      </div>
    </div>
  )
}
