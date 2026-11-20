import { useId, type ReactNode } from "react"

import type { FaultSeverity } from "@/lib/faults"

const SEVERITY_LABEL: Record<FaultSeverity, string> = {
  critical: "需要处理",
  attention: "请留意",
  info: "提示",
}

/**
 * Inline / form 层状态：给登录、注册和字段校验用。
 *
 * 这不是第二套设计系统：严重度仍来自 Fault，文案仍是 title/detail，
 * 但表单里不展示 NET / AUTH / CHECK 这类机器标签，也不把 HTTP 状态
 * 或端点塞进用户眼前。它只讲「发生了什么」「接下来怎么办」。
 */
export function IrisFormAlert({
  severity,
  title,
  detail,
  action,
  id,
  field = false,
}: {
  severity: FaultSeverity
  title: string
  detail?: string
  action?: ReactNode
  id?: string
  /** 字段级：贴着输入框，不占一整块。 */
  field?: boolean
}) {
  const fallbackId = useId()
  const titleId = id ?? fallbackId
  return (
    <div
      className={`iris-form-alert iris-form-alert--${severity}${field ? " is-field" : ""}`}
      role={severity === "critical" ? "alert" : "status"}
      aria-live={severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-labelledby={titleId}
      data-field={field ? "true" : undefined}
      data-severity={severity}
    >
      {field ? null : <span className="iris-form-alert__severity">{SEVERITY_LABEL[severity]}</span>}
      <span className="iris-form-alert__title" id={titleId}>
        {title}
      </span>
      {detail ? <p className="iris-form-alert__detail">{detail}</p> : null}
      {action ? <div className="iris-form-alert__action">{action}</div> : null}
    </div>
  )
}
