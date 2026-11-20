import type { ReactElement } from "react"

import { confidencePercent } from "@/lib/adminDomain"

/**
 * 置信度读数 + 迷你条。
 *
 * <p>数字仍是唯一读数（等宽、带 %）；条只是快速扫读的第二通道，
 * 「没有结论」时数字读「—」、条留空，绝不把拒识记录画成 0%。
 */
export function ConfidenceCell({ value }: { value?: number | null }): ReactElement {
  const text = confidencePercent(value)
  const pct = text === "—" ? null : Math.min(100, Math.max(0, Number.parseFloat(text)))
  return (
    <span className="admin-confidence">
      <span className="admin-confidence__bar" aria-hidden="true">
        {pct === null ? null : <span style={{ width: `${pct}%` }} />}
      </span>
      <span className="admin-confidence__text num">{text}</span>
    </span>
  )
}
