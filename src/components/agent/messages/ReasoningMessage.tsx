import { useMemo, useState } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { renderMarkdown } from "@/lib/markdown"

/**
 * 思考过程：原生 details 折叠，零 JS。
 * 折叠时不渲染 markdown——reasoning 也是逐 token 增长的，
 * 展开瞬间渲染一次即可。
 */
export function ReasoningMessage({ msg }: { msg: StreamMessage }) {
  const [open, setOpen] = useState(false)
  const html = useMemo(
    () => (open ? renderMarkdown(msg.content) : ""),
    [open, msg.content],
  )

  return (
    <details
      className="trace agent-msg agent-msg--reasoning"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
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
