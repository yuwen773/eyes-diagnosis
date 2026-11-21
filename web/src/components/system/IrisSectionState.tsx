import { useId } from "react"
import { RotateCw, ShieldAlert } from "lucide-react"

import type { FaultSeverity } from "@/lib/faults"

const SEVERITY_LABEL: Record<FaultSeverity, string> = {
  critical: "需要处理",
  attention: "请留意",
  info: "提示",
}

/**
 * Section / content 层状态：资讯、记录、知识库等内容区的失败与恢复。
 *
 * 与 Page / Fatal 的 IrisErrorState 分开：这里不居中、不占整屏、不展示
 * 内部端点。外壳留在业务页里，状态只替换内容区，并尽量保留用户已看到的
 * 内容与筛选交互。
 */
export function IrisSectionError({
  severity,
  title,
  detail,
  actionLabel,
  onAction,
  dense = false,
}: {
  severity: FaultSeverity
  title: string
  detail?: string
  actionLabel?: string
  onAction?: () => void
  dense?: boolean
}) {
  const titleId = useId()
  return (
    <section
      className={`iris-section-state iris-section-state--error iris-section-state--${severity}${dense ? " is-dense" : ""}`}
      role={severity === "attention" ? "status" : "alert"}
      aria-live={severity === "attention" ? "polite" : "assertive"}
      aria-atomic="true"
      aria-labelledby={titleId}
      data-severity={severity}
    >
      <span className="iris-section-state__mark" aria-hidden="true">
        <ShieldAlert size={18} strokeWidth={1.8} />
      </span>
      <div className="iris-section-state__body">
        <span className="iris-section-state__severity">{SEVERITY_LABEL[severity]}</span>
        <h2 className="iris-section-state__title" id={titleId}>
          {title}
        </h2>
        {detail ? <p className="iris-section-state__detail">{detail}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button className="iris-section-state__action" type="button" onClick={onAction}>
          <RotateCw size={14} aria-hidden="true" />
          {actionLabel}
        </button>
      ) : null}
    </section>
  )
}

/** 内容区底部的恢复提示：保留已有内容，同时明确说「这份内容没刷新成功」。 */
export function IrisRefreshNotice({
  detail,
  onRetry,
}: {
  detail?: string
  onRetry: () => void
}) {
  return (
    <div className="iris-refresh-notice" role="status" aria-live="polite" aria-atomic="true">
      <span className="iris-refresh-notice__dot" aria-hidden="true" />
      <span className="iris-refresh-notice__text">
        内容没有刷新成功
        {detail ? <span className="iris-refresh-notice__detail"> · {detail}</span> : null}
      </span>
      <button className="iris-refresh-notice__action" type="button" onClick={onRetry}>
        <RotateCw size={13} aria-hidden="true" />
        再试一次
      </button>
    </div>
  )
}
