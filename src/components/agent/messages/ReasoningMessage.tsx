import { useMemo } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { renderMarkdown } from "@/lib/markdown"

/** 思考过程：原生 details 折叠，零 JS。 */
export function ReasoningMessage({ msg }: { msg: StreamMessage }) {
  const html = useMemo(() => renderMarkdown(msg.content), [msg.content])

  return (
    <details className="trace agent-msg agent-msg--reasoning">
      <summary className="trace__role">REASONING · 思考过程</summary>
      <div className="trace__content">
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </details>
  )
}
