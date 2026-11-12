/**
 * 欢迎屏：空会话时的工作区入口。
 *
 * 不用神经网络连线/节点做主视觉：后端没有多 Agent 拓扑，画出来就是虚构
 * 执行结构。这里用全站同一个金属虹膜标 + 三条真实入口（添图、描述症状、
 * 查疾病知识），每条都绑定真实输入框或真实发送动作。
 *
 * 「上传眼底图像」不发送一句空话：它直接打开输入区的选图对话框，
 * 并把引导句预填进输入框（不替用户发送），用户先拿到附件与一句话草稿，
 * 再决定发什么。
 */
const HINTS = [
  {
    icon: "image" as const,
    title: "上传眼底图像",
    desc: "发送眼底图片，AI 辅助分析",
    action: "上传我的眼底照片",
    prompt: "帮我解读这张眼底照片",
  },
  {
    icon: "text" as const,
    title: "描述症状",
    desc: "用文字描述眼部不适",
    action: "我最近眼睛干涩、偶尔模糊是怎么回事",
    prompt: "我最近眼睛干涩、偶尔模糊是怎么回事",
  },
  {
    icon: "learn" as const,
    title: "了解眼病",
    desc: "查询眼科疾病知识",
    action: "介绍一下白内障的症状和预防",
    prompt: "介绍一下白内障的症状和预防",
  },
]

function GuideIcon({ icon }: { icon: "image" | "text" | "learn" }) {
  if (icon === "image") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    )
  }
  if (icon === "text") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    )
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

export function WelcomeScreen({
  onSend,
  onPickImage,
}: {
  onSend: (text: string) => void
  /** 点「上传眼底图像」：打开选图对话框，并把引导句预填进输入框（不替用户发送）。 */
  onPickImage: (prefill: string) => void
}) {
  return (
    <div className="welcome">
      <div className="welcome-stage">
        {/* 全站同一个金属虹膜标：两版一起挂，靠 html.dark 换。 */}
        <div className="welcome-mark" aria-hidden="true">
          <img
            className="welcome-mark__img welcome-mark__img--light"
            src="/iris-mark-metallic-light.svg"
            alt=""
            width={56}
            height={56}
          />
          <img
            className="welcome-mark__img welcome-mark__img--dark"
            src="/iris-mark-metallic-dark.svg"
            alt=""
            width={56}
            height={56}
          />
        </div>

        <div className="welcome-text">
          <h2 className="welcome-title">Iris</h2>
          <p className="welcome-desc">上传眼底图片或描述症状，我来帮你理解影像与检查结果</p>
        </div>

        <div className="welcome-hints">
          {HINTS.map((h) => (
            <button
              key={h.title}
              type="button"
              className="guide-card"
              onClick={() => (h.icon === "image" ? onPickImage(h.prompt) : onSend(h.prompt))}
            >
              <span className="guide-icon-wrap">
                <GuideIcon icon={h.icon} />
              </span>
              <span className="guide-content">
                <span className="guide-title">{h.title}</span>
                <span className="guide-desc">{h.desc}</span>
              </span>
              <span className="guide-action">
                <span className="guide-action-text">{h.action}</span>
                <svg className="guide-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </button>
          ))}
        </div>

        <p className="welcome-note">支持常见图片格式，单张不超过 10 MB；图片只在发送时才上传。</p>
      </div>
    </div>
  )
}
