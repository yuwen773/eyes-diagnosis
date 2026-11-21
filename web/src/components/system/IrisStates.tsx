import { useEffect, useId, useState, type ReactElement, type ReactNode } from "react"
import { Home, RotateCw, ShieldAlert } from "lucide-react"
import { Link } from "react-router-dom"

import { ProductHeader } from "@/components/shell/ProductHeader"
import type { Fault, FaultAction, FaultSeverity } from "@/lib/faults"

/**
 * Iris System States 的最小组件集。
 *
 * 只负责「状态怎么呈现」，不碰业务数据、鉴权与 SSE 契约。
 * 视觉全部走 system-states.css；故障的语义翻译仍由 lib/faults.ts 负责。
 */

const SEVERITY_LABEL: Record<FaultSeverity, string> = {
  critical: "需要处理",
  attention: "请留意",
  info: "提示",
}

/** 光学环：与 Agent 的 LatticeLoader 同属一套「真实在途」的视觉语言。 */
export function IrisOptic({ className = "" }: { className?: string }) {
  // 首帧就按当前可见性起步：后台标签页里挂载时不能先转一轮再等事件。
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden)

  // DESIGN.md §3.7：页面隐藏即停。事件驱动，不轮询、不产生定时器。
  // 离屏场景由 CSS content-visibility 不会触发，这里只处理页面可见性；
  // 加载态本身是短暂的，且 reduced-motion 下动画已完全停止。
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  return (
    <span
      className={`iris-optic${className ? ` ${className}` : ""}`}
      data-hidden={hidden ? "true" : undefined}
      aria-hidden="true"
    />
  )
}

/**
 * 路由 / 页面级加载：品牌标记 + 温和文案 + 与内容同形的骨架条。
 * 不造假百分比，不设置最短等待时间；role=status 只播报一次。
 */
export function IrisPageLoading({
  title = "正在载入",
  hint = "正在准备这一页的内容，请稍候。",
}: {
  title?: string
  hint?: string
}) {
  return (
    <div className="iris-page-loading" role="status" aria-live="polite">
      <IrisOptic />
      <p className="iris-page-loading__eyebrow">Iris</p>
      <h1 className="iris-page-loading__title">{title}</h1>
      <p className="iris-page-loading__hint">{hint}</p>
      <div className="iris-page-loading__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}

/** 恢复动作：主次分明，点击目标 ≥44px。 */
export function IrisRetryAction({
  action,
  variant = "primary",
}: {
  action: FaultAction
  variant?: "primary" | "secondary"
}) {
  return (
    <button
      type="button"
      className={`iris-action iris-action--${variant}`}
      onClick={action.run}
    >
      {variant === "primary" ? <RotateCw size={15} aria-hidden="true" /> : null}
      {action.label}
    </button>
  )
}

/**
 * 错误 / 恢复面板。
 *
 * 「发生了什么 → 哪些内容受影响 → 可以做什么」三件套齐全；
 * severity 始终有文字标签，颜色不是唯一通道。不展示堆栈或诊断细节。
 */
export function IrisErrorState({
  fault,
  readouts,
  secondary,
  className = "",
}: {
  fault: Fault
  readouts?: { label: string; value: string }[]
  /** 可选的次要出口（「回首页」「返回上一页」），不替代主恢复动作。 */
  secondary?: ReactNode
  className?: string
}) {
  const tone = `iris-error--${fault.severity}`
  const titleId = useId()
  return (
    <section
      className={`iris-error iris-state-enter ${tone}${className ? ` ${className}` : ""}`}
      role="alert"
      aria-labelledby={titleId}
    >
      <div className="iris-error__brand">
        <span className="iris-error__mark" aria-hidden="true">
          <ShieldAlert size={22} strokeWidth={1.8} />
        </span>
        <div>
          <p className="iris-error__kicker">Iris · 状态提示</p>
        </div>
      </div>

      <span className="iris-error__severity">{SEVERITY_LABEL[fault.severity]}</span>
      <h2 className="iris-error__title" id={titleId}>
        {fault.title}
      </h2>
      {fault.detail ? <p className="iris-error__body">{fault.detail}</p> : null}

      {readouts && readouts.length > 0 ? (
        <dl className="iris-error__readouts">
          {readouts.map((row) => (
            <div className="iris-error__readout" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {fault.action || secondary ? (
        <div className="iris-error__actions">
          {fault.action ? <IrisRetryAction action={fault.action} /> : null}
          {secondary}
        </div>
      ) : null}
    </section>
  )
}

/** 空状态：一句说明 + 一个出口，不用插画。 */
export function IrisEmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="iris-empty iris-state-enter">
      <span className="iris-empty__mark" aria-hidden="true">
        <IrisOptic />
      </span>
      <h2 className="iris-empty__title">{title}</h2>
      {description ? <p className="iris-empty__body">{description}</p> : null}
      {action}
    </div>
  )
}

/** 404：未知地址有明确语义与一条稳定的站内出口。 */
export function NotFoundPage(): ReactElement {
  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="brand" />
      <main id="main-content" tabIndex={-1} className="iris-notfound iris-state-enter">
        <p className="iris-notfound__code" aria-hidden="true">
          404
        </p>
        <h1 className="iris-notfound__title">这个地址不在 Iris 里</h1>
        <p className="iris-notfound__body">
          链接可能拼错了，或者页面已经搬走。回到首页后可以继续检索内容。
        </p>
        <div className="iris-error__actions">
          {/* replace：不让错误地址留在历史里，浏览器返回不会又落回 404。 */}
          <Link className="iris-action iris-action--primary" to="/" replace>
            <Home size={15} aria-hidden="true" />
            回到首页
          </Link>
        </div>
      </main>
    </div>
  )
}
