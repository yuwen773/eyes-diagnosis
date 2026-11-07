import type { ReactNode } from "react"
import type { Risk } from "@/lib/domain"

export function RiskTag({ risk, children }: { risk: Risk; children: ReactNode }) {
  return (
    <span className="risk" data-risk={risk}>
      {children}
    </span>
  )
}
