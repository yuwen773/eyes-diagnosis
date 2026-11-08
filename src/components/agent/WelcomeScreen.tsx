/** 欢迎屏：白色仪器语言——serif 标题 + 说明 + 快捷提示卡。零动画装饰。 */
export function WelcomeScreen({ onSend }: { onSend: (text: string) => void }) {
  const hints = [
    "帮我解读这张眼底照片",
    "青光眼的早期症状有哪些？",
    "用眼疲劳如何缓解？",
  ]

  return (
    <div className="agent-welcome">
      <div className="agent-welcome__kicker overline">CONSULT · 在线问诊</div>
      <h2 className="agent-welcome__title">眼科智能助手</h2>
      <p className="agent-welcome__lede">
        描述你的症状、上传检查照片，或直接提问。回答仅供参考，
        涉及确诊与治疗请以医生意见为准。
      </p>
      <div className="agent-welcome__hints">
        {hints.map((text) => (
          <button
            key={text}
            type="button"
            className="agent-welcome__hint"
            onClick={() => onSend(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
