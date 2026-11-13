import { Wrench } from "lucide-react"
import type { StreamMessage } from "@/lib/agentStream"

/** 扳手图标：同 Vue 版 ToolRequestMessage 的 tool-icon。 */
function WrenchIcon() {
  return <Wrench size={12} strokeWidth={2.5} aria-hidden="true" />
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
