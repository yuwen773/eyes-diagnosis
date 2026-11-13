import type { StreamMessage, ToolStepStatus } from "@/lib/agentStream"

/** 扳手图标：同 Vue 版 ToolRequestMessage 的 tool-icon。 */
function WrenchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

/**
 * 状态文案是前端固定字典，不接受后端自由文本；颜色永远与文字同时出现。
 * 没有 toolCallId 的历史卡不显示状态——旧数据没有真实执行结果可依据。
 */
const STATUS_TEXT: Record<ToolStepStatus, string> = {
  "awaiting-confirm": "等待确认",
  running: "执行中",
  succeeded: "执行成功",
  failed: "执行失败",
  cancelled: "已取消",
}

/** 工具调用卡：头部（扳手 + 固定标签 + 状态）+ 参数键值行。 */
export function ToolRequestMessage({ msg }: { msg: StreamMessage }) {
  const status = msg.toolCallId ? msg.toolStatus : undefined
  const label = msg.stepLabel ?? (msg.toolCalls ?? []).map((tc) => tc.name).join(", ") ?? "工具"
  return (
    <div className="agent-toolcard">
      <div className="agent-toolcard__head">
        <span className="agent-toolcard__icon">
          <WrenchIcon />
        </span>
        <span className="agent-toolcard__name">{label || "工具"}</span>
        {status && (
          <span
            className={`agent-toolcard__status agent-toolcard__status--${status}`}
            role="status"
            aria-live="polite"
          >
            <span className="agent-toolcard__dot" aria-hidden="true" />
            {STATUS_TEXT[status]}
          </span>
        )}
        <span className="agent-toolcard__tag">调用</span>
      </div>
      <div className="agent-toolcard__args">
        {(msg.toolCalls ?? []).map((tc) => {
          const entries = Object.entries(tc.args)
          if (entries.length === 0) {
            return (
              <span className="agent-toolcard__emptyargs" key={`${msg.id}-${tc.name}`}>
                {"{ }"}
              </span>
            )
          }
          return (
            <div key={`${msg.id}-${tc.name}`}>
              {entries.map(([key, value]) => (
                <div className="agent-toolcard__argrow" key={key}>
                  <span className="agent-toolcard__argkey">{key}</span>
                  <span className="agent-toolcard__argsep">:</span>
                  <span className="agent-toolcard__argval">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
