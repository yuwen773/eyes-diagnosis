import type { CSSProperties } from "react"

type TraceRow =
  | { kind: "user"; text: string; attachment: string }
  | {
      kind: "tool"
      name: string
      call: string
      fields: { label: string; value: string }[]
    }
  | { kind: "agent"; text: string; note: string }

/** 示例会话：只用于说明「一次判读可以怎样继续对话」，非真实患者数据。 */
const TRACE: TraceRow[] = [
  {
    kind: "user",
    text: "右眼这两周看东西发暗，这张是上周拍的眼底照。",
    attachment: "fundus_od.jpg · 2.1 MB",
  },
  {
    kind: "tool",
    name: "analyzeEyeImage",
    call: "← fundus_od.jpg",
    fields: [
      { label: "图像类型", value: "彩色眼底照片" },
      { label: "影像质量", value: "86 / 100" },
      { label: "关键特征", value: "颞侧血管弓散在点状出血；黄斑中心凹未见受累" },
      { label: "检索词", value: "diabetic retinopathy, punctate hemorrhage" },
    ],
  },
  {
    kind: "tool",
    name: "searchDocuments",
    call: "← 糖尿病视网膜病变 点状出血 分期",
    fields: [
      { label: "知识库", value: "命中 3 段，已按相关度重排" },
      { label: "引用", value: "《眼底影像判读规范》4.2；《DR 筛查与随访指南》" },
    ],
  },
  {
    kind: "agent",
    text: "照片里颞侧血管弓附近有散在点状出血，黄斑中心凹还没有受累。结合「看东西发暗」这个描述，需要把糖尿病视网膜病变放在前面考虑——但单张照片不能确诊，建议 3 个月内复查眼底，并同步查一次糖化血红蛋白。",
    note: "以上为参考建议，不构成诊断；如视力骤降或黑影突然增多，请尽快到眼科门诊。",
  },
]

/**
 * 诊断 Agent 的示例会话屏：让「工具调用可见」这件事被看见。
 * 放在 ElectricBorder 里使用，本身不承担交互。
 */
export function AgentConsole() {
  return (
    <article className="console is-dark" aria-label="诊断 Agent 示例会话">
      <header className="console__head">
        <span className="console__title">眼瞳诊断助手 · AGENT</span>
        <span className="console__meta">SESSION · 7F3A-2C19</span>
        <span className="console__live">会话中</span>
      </header>

      <div className="console__body">
        {TRACE.map((row, index) => {
          const delay = `${index * 90}ms`

          if (row.kind === "user") {
            return (
              <div
                className="trace trace--user reveal"
                key={`user-${index}`}
                style={{ "--d": delay } as CSSProperties}
              >
                <span className="trace__role">USER</span>
                <div className="trace__content">
                  <p className="trace__text">{row.text}</p>
                  <span className="trace__file">{row.attachment}</span>
                </div>
              </div>
            )
          }

          if (row.kind === "agent") {
            return (
              <div
                className="trace trace--agent reveal"
                key={`agent-${index}`}
                style={{ "--d": delay } as CSSProperties}
              >
                <span className="trace__role">AGENT</span>
                <div className="trace__content">
                  <p className="trace__text">{row.text}</p>
                  <p className="trace__note">{row.note}</p>
                </div>
              </div>
            )
          }

          return (
            <div
              className="trace trace--tool reveal"
              key={`tool-${index}`}
              style={{ "--d": delay } as CSSProperties}
            >
              <span className="trace__role">TOOL</span>
              <div className="trace__content">
                <div className="trace__call">
                  <span className="trace__tool">{row.name}</span>
                  <span className="trace__args">{row.call}</span>
                </div>
                <dl className="trace__fields">
                  {row.fields.map((field) => (
                    <div className="trace__field" key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )
        })}
      </div>

      <footer className="console__foot">
        <span className="console__input">继续追问，或上传检查报告…</span>
        <span className="console__hint">ENTER 发送 · JPG / PNG</span>
      </footer>
    </article>
  )
}
