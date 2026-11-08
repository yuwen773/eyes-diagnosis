import type { StreamMessage } from "@/lib/agentStream"

const FOLD_LIMIT = 120

/** 工具返回卡：超过 120 字符默认折叠。 */
export function ToolResponseMessage({ msg }: { msg: StreamMessage }) {
  const long = msg.content.length > FOLD_LIMIT
  const summary = long ? `${msg.content.slice(0, FOLD_LIMIT)}…` : msg.content

  return (
    <div className="trace trace--tool agent-msg agent-msg--tool-response">
      <div className="trace__role">RETURN</div>
      <div className="trace__content">
        {msg.toolName && <div className="trace__tool">{msg.toolName}</div>}
        {long ? (
          <details className="agent-msg__fold">
            <summary className="trace__text">{summary}</summary>
            <div className="trace__text agent-msg__foldbody">{msg.content}</div>
          </details>
        ) : (
          <div className="trace__text">{msg.content}</div>
        )}
      </div>
    </div>
  )
}
