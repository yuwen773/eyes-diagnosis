import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import type { Fault, FaultSeverity } from "@/lib/faults"
import { newId } from "@/lib/id"

/**
 * 瞬时故障读数（右上角浮条）+ 全局投放口。
 *
 * 页面上任何一次失败都该有一句统一的说法：出现方式、停留时长、能不能关掉、
 * 要不要给「重试」，全站一致。页面只管把故障丢进来（`useFault().push`），
 * 不自己写浮层。
 */

type Toast = {
  id: string
  fault: Fault
  phase: "in" | "out"
}

type FaultApi = {
  /** 丢一条故障进来。 */
  push: (fault: Fault) => void
  /** 收掉一条。 */
  dismiss: (id: string) => void
  /** 当前挂着哪些（渲染用）。 */
  toasts: Toast[]
}

const NOOP: FaultApi = { push: () => {}, dismiss: () => {}, toasts: [] }

const FaultContext = createContext<FaultApi | null>(null)

/** 停留时长：越严重给越久，但都留了关闭。 */
const DWELL: Record<FaultSeverity, number> = {
  info: 4000,
  attention: 6000,
  critical: 9000,
}

/** 同时最多挂几条——再多就成墙了。 */
const MAX_TOASTS = 3

/* ── 下滑关闭 ─────────────────────────────────────────────── */

/** 死区：先动这几像素不算拖拽，免得把点击吃掉。 */
const DRAG_DEAD_ZONE = 4
/** 滑过这个距离就收掉。 */
const SWIPE_DISTANCE = 56
/** 或者甩得够快——但要又走了点距离、又够利索（800px/s 上下），
    免得手指一哆嗦就把提示条扫没了。 */
const SWIPE_FLICK_DISTANCE = 24
const SWIPE_VELOCITY = 0.8
/** 往上拽只给 20% 位移：提示条不该被拉出界。 */
const PULL_RESIST = 0.2
/** 收掉前的滑出距离与时长。 */
const EXIT_DISTANCE = 72
const EXIT_MS = 200

type Sample = { t: number; y: number }

/** 最近 120ms 内的平均速度（px/ms）。手指停住再松手算 0。 */
function velocityOf(samples: Sample[]): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const first = samples.find((s) => last.t - s.t <= 120) ?? samples[0]
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.y - first.y) / dt
}

export function FaultProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, phase: "out" as const } : t)),
    )
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 200)
  }, [])

  const push = useCallback((fault: Fault) => {
    const id = newId()
    const toast: Toast = { id, fault, phase: "in" }
    setToasts((prev) => [...prev, toast].slice(-MAX_TOASTS))
  }, [])

  const value = useMemo<FaultApi>(() => ({ push, dismiss, toasts }), [push, dismiss, toasts])

  return <FaultContext.Provider value={value}>{children}</FaultContext.Provider>
}

/**
 * 投放口。
 *
 * 没有 Provider 时（组件单测里单独渲染）退化成空操作，不抛错——
 * 提示系统挂掉不该连带把页面弄崩。
 */
export function useFault(): FaultApi {
  return useContext(FaultContext) ?? NOOP
}

function FaultToast({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { fault } = toast
  const [paused, setPaused] = useState(false)
  const left = useRef(DWELL[fault.severity])
  // 渲染期不能读时钟（不纯）；进入计时 effect 时再落一次时间戳。
  const since = useRef(0)

  /* ── 下滑关闭 ─────────────────────────────────────────── */
  // critical 不给划走：错误信息不该被一次手滑抹掉，只能显式关或等它自己走。
  const swipeable = fault.severity !== "critical"
  const cardRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ startY: number; y: number; moved: boolean; samples: Sample[] } | null>(null)

  useEffect(() => {
    if (paused) return
    if (!since.current) since.current = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), left.current)
    return () => window.clearTimeout(timer)
  }, [paused, toast.id, onDismiss])

  /** 停表：鼠标悬停与拖拽都算，停了要把剩余时长扣掉。 */
  function pauseDwell() {
    if (!since.current) {
      since.current = Date.now()
    } else {
      left.current = Math.max(600, left.current - (Date.now() - since.current))
    }
    since.current = Date.now()
    setPaused(true)
  }

  /** 续表：从扣剩下的时长接着走。 */
  function resumeDwell() {
    since.current = Date.now()
    setPaused(false)
  }

  /** 系统说了不要动，就别动——回弹与滑出都改成瞬时。 */
  function reduced() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeable) return
    if (event.button !== 0) return
    // 按钮上的按下不当作拖拽起点。
    if ((event.target as HTMLElement).closest("button")) return
    drag.current = {
      startY: event.clientY,
      y: 0,
      moved: false,
      samples: [{ t: performance.now(), y: 0 }],
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 某些环境不支持指针捕获，拖不动也报错不划算。 */
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const dy = event.clientY - d.startY
    if (!d.moved) {
      if (Math.abs(dy) < DRAG_DEAD_ZONE) return
      d.moved = true
      pauseDwell()
    }
    const y = dy >= 0 ? dy : dy * PULL_RESIST
    d.y = y
    d.samples.push({ t: performance.now(), y })
    if (d.samples.length > 8) d.samples.shift()
    const el = cardRef.current
    if (!el) return
    el.dataset.dragging = "true"
    el.style.transition = "none"
    el.style.transform = `translate3d(0, ${y}px, 0)`
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* 同上：捕不住就算了。 */
    }
    if (!d.moved) return
    resumeDwell()

    const el = cardRef.current
    if (el) delete el.dataset.dragging
    const far = d.y >= SWIPE_DISTANCE
    const fast = d.y >= SWIPE_FLICK_DISTANCE && velocityOf(d.samples) >= SWIPE_VELOCITY
    if (far || fast) {
      // 甩出去了：卡片自己滑出屏幕，滑完再收掉。
      if (el) {
        el.style.transition = reduced()
          ? "none"
          : `transform ${EXIT_MS}ms var(--ease), opacity ${EXIT_MS}ms var(--ease)`
        el.style.transform = `translate3d(0, ${d.y + EXIT_DISTANCE}px, 0)`
        el.style.opacity = "0"
      }
      window.setTimeout(() => onDismiss(toast.id), reduced() ? 0 : EXIT_MS)
      return
    }
    // 没甩够：弹回原位。
    if (el) {
      el.style.transition = reduced() ? "none" : "transform 240ms var(--ease)"
      el.style.transform = "translate3d(0, 0, 0)"
    }
  }

  return (
    <div
      className={`fault-toast fault-tone-${fault.severity}`}
      data-phase={toast.phase}
      role={fault.severity === "critical" ? "alert" : "status"}
      onMouseEnter={pauseDwell}
      onMouseLeave={resumeDwell}
    >
      <div
        ref={cardRef}
        className="fault-toast__card"
        data-swipeable={swipeable ? "true" : "false"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDismiss(toast.id)
        }}
      >
        <div className="fault-toast__head">
          <span className="fault-toast__tag num">{fault.tag}</span>
          {fault.code != null && <span className="fault-toast__code num">{fault.code}</span>}
        </div>
        <p className="fault-toast__title">{fault.title}</p>
        {fault.detail && <p className="fault-toast__detail">{fault.detail}</p>}
        {fault.action && (
          <button
            type="button"
            className="fault-toast__action"
            onClick={() => {
              fault.action?.run()
              onDismiss(toast.id)
            }}
          >
            {fault.action.label}
          </button>
        )}
        <button
          type="button"
          className="fault-toast__close"
          aria-label="关闭提示"
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      </div>
    </div>
  )
}

/** 提示宿主：挂在应用根部，一处渲染，全站可用。 */
export function FaultToaster() {
  const { toasts, dismiss } = useFault()
  if (toasts.length === 0) return null
  return (
    <div className="fault-stack" aria-live="polite">
      {toasts.map((toast) => (
        <FaultToast key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
}
