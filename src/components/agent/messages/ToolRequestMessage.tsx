import type { StreamMessage } from "@/lib/agentStream"

/** 工具调用卡：工具名 mono + 参数表。 */
export function ToolRequestMessage({ msg }: { msg: StreamMessage }) {
  return (
    <div className="trace trace--tool agent-msg agent-msg--tool-request">
      <div className="trace__role">TOOL</div>
      <div className="trace__content">
        {(msg.toolCalls ?? []).map((tc) => (
          <div className="trace__call" key={`${msg.id}-${tc.name}`}>
            <div className="trace__tool">{tc.name}</div>
            <dl className="trace__fields">
              {Object.entries(tc.args).map(([key, value]) => (
                <div className="trace__field" key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {typeof value === "string"
                      ? value
                      : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
