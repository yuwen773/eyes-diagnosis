import type { StreamMessage } from "@/lib/agentStream"

/** 扳手图标：同 Vue 版 ToolRequestMessage 的 tool-icon。 */
function WrenchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

/** 工具调用卡：排版复刻 Vue 版 ToolRequestMessage——头部（扳手 + 工具名 + 调用）+ 参数键值行。 */
export function ToolRequestMessage({ msg }: { msg: StreamMessage }) {
  return (
    <div className="agent-toolcard">
      <div className="agent-toolcard__head">
        <span className="agent-toolcard__icon">
          <WrenchIcon />
        </span>
        <span className="agent-toolcard__name">
          {(msg.toolCalls ?? []).map((tc) => tc.name).join(", ") || "工具"}
        </span>
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
