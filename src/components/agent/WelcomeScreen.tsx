/**
 * 欢迎屏：白色仪器语言。
 *
 * Vue 版靠粒子云雾动画撑场（违反本项目 AI 装饰零容忍），这里换成
 * 仪器级的线稿眼 + 能力读数当视觉锚点——安静，但有东西可看。
 */
const HINTS = [
  {
    no: "01",
    title: "解读眼底照片",
    desc: "上传检查影像，逐项读出可疑迹象",
    prompt: "帮我解读这张眼底照片",
  },
  {
    no: "02",
    title: "症状问诊",
    desc: "描述不适，逐步收敛到可能的成因",
    prompt: "最近眼睛容易疲劳、偶尔胀痛，可能是什么问题？",
  },
  {
    no: "03",
    title: "知识问答",
    desc: "检索知识库，回答眼科常识与护理问题",
    prompt: "青光眼的早期症状有哪些？",
  },
] as const

export function WelcomeScreen({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="agent-welcome">
      <div className="agent-welcome__mark" aria-hidden="true">
        <svg viewBox="0 0 240 120" fill="none">
          {/* 外轮廓：眼睑线 */}
          <path
            d="M8 60 C 48 12, 192 12, 232 60 C 192 108, 48 108, 8 60 Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          {/* 虹膜与瞳孔 */}
          <circle cx="120" cy="60" r="34" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="120" cy="60" r="14" fill="currentColor" />
          {/* 十字标线：判读仪的对焦记号 */}
          <line x1="120" y1="10" x2="120" y2="34" stroke="currentColor" strokeWidth="1" />
          <line x1="120" y1="86" x2="120" y2="110" stroke="currentColor" strokeWidth="1" />
          <line x1="70" y1="60" x2="94" y2="60" stroke="currentColor" strokeWidth="1" />
          <line x1="146" y1="60" x2="170" y2="60" stroke="currentColor" strokeWidth="1" />
          {/* 半球经线：眼底的纹理暗示 */}
          <path d="M120 26 C 98 40, 98 80, 120 94" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
          <path d="M120 26 C 142 40, 142 80, 120 94" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        </svg>
      </div>

      <div className="agent-welcome__head">
        <div className="agent-welcome__kicker overline">CONSULT · 在线问诊</div>
        <h2 className="agent-welcome__title">眼科智能助手</h2>
        <p className="agent-welcome__lede">
          描述症状、上传检查照片，或直接提问。回答仅供参考，
          涉及确诊与治疗请以医生意见为准。
        </p>
      </div>

      <div className="agent-welcome__hints">
        {HINTS.map((h) => (
          <button
            key={h.no}
            type="button"
            className="agent-welcome__hint"
            onClick={() => onSend(h.prompt)}
          >
            <span className="agent-welcome__hintno num">{h.no}</span>
            <span className="agent-welcome__hinttitle">{h.title}</span>
            <span className="agent-welcome__hintdesc">{h.desc}</span>
          </button>
        ))}
      </div>

      <div className="agent-welcome__capabilities num" aria-hidden="true">
        <span>SSE · 流式回答</span>
        <span>RAG · 知识库检索</span>
        <span>VL · 影像读片</span>
        <span>MCP · 工具扩展</span>
      </div>
    </div>
  )
}
