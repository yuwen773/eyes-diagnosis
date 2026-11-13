import { useMemo, useState } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { renderMarkdown } from "@/lib/markdown"

/**
 * 思考过程：排版复刻 Vue 版 ReasoningMessage——「思考过程」标签 +
 * 折叠时的前 50 字预览。仍用原生 details（零 JS），展开瞬间渲染一次 markdown。
 */
export function ReasoningMessage({ msg }: { msg: StreamMessage }) {
  const [open, setOpen] = useState(false)
  const html = useMemo(
    () => (open ? renderMarkdown(msg.content) : ""),
    [open, msg.content],
  )
  const preview = msg.content.length > 50 ? `${msg.content.slice(0, 50)}...` : msg.content

  return (
    <details
      className="agent-msg--reasoning"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="agent-toolcard__head" style={{ borderRadius: "var(--radius-md)" }}>
        <span className="agent-toolcard__tag" style={{ marginLeft: 0, opacity: 1 }}>
          思考过程
        </span>
        {!open && preview && (
          <span
            className="agent-toolcard__name"
            style={{ color: "var(--on-dark-3)", fontWeight: 400 }}
          >
            {preview}
          </span>
        )}
      </summary>
      <div className="agent-toolcard__body">
        <div
          className="markdown-body"
          style={{ fontFamily: "var(--font-sans)", fontSize: 13 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </details>
  )
}
