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
import { ArrowRight, BookOpen, Image, MessageSquare } from "lucide-react"

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
    return <Image size={20} strokeWidth={1.8} aria-hidden="true" />
  }
  if (icon === "text") {
    return <MessageSquare size={20} strokeWidth={1.8} aria-hidden="true" />
  }
  return <BookOpen size={20} strokeWidth={1.8} aria-hidden="true" />
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
                <ArrowRight className="guide-arrow" size={12} strokeWidth={2.5} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>

        <p className="welcome-note">支持常见图片格式，单张不超过 10 MB；图片只在发送时才上传。</p>
      </div>
    </div>
  )
}
