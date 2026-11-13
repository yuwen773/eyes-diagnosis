import { lazy, Suspense, useState, type ReactElement } from "react"
import { ArrowUpRight } from "lucide-react"
import { Link } from "react-router-dom"

import { BrandKicker, BrandPanel } from "./BrandPanel"
import { useTheme } from "@/components/theme-provider"

// 光学主视觉独立成块：首屏文字与 CTA 不等它——主包先落地，动效随后到。
const OpticFlow = lazy(() =>
  import("./OpticFlow").then((m) => ({ default: m.OpticFlow })),
)

/** 首屏下缘三张入口卡。链接都指向真实去处，没有假按钮。 */
const ENTRIES = [
  {
    to: "/diagnosis",
    code: "01",
    title: "影像分析",
    body: "上传眼底照片，得到一条可复核的判读记录",
    glyph: "◎",
  },
  {
    to: "/#agent",
    code: "02",
    title: "Agent 协作",
    body: "与诊断 Agent 对话，工具调用回执全程可见",
    glyph: "✳",
  },
  {
    to: "#record",
    code: "03",
    title: "证据与复核",
    body: "概率、质量门与复核状态写在同一张记录上",
    glyph: "◇",
  },
]

/** 智能体协作的三个环节。这里写的是流程本身，不是某次真实会话的回放。 */
const LAYERS = [
  { code: "01", name: "影像" },
  { code: "02", name: "分析" },
  { code: "03", name: "证据" },
]

/**
 * 首屏：Iris 2.0 的光学台。
 *
 * <p>构图参照 V4 概念稿（通透顶栏、大字号排版、主次 CTA、右侧跨区域的连续
 * 光学带、半透明信息卡、底部产品体验区），但**内容全部是真的**：CTA 指向
 * 真实路由，卡片写的是产品实际做的事，没有任何一处冒充模型结论或患者数据。
 *
 * <p>主视觉是一个渲染器（见 OpticFlow）；这一层只负责排版与信息层级。
 */
export function LandingHero(): ReactElement {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  const [paused, setPaused] = useState(false)

  return (
    <section className="landing-hero iris2" aria-label="Iris 2.0 首屏">
      <div className="landing-hero__shell">
        <div className="landing-hero__badge brand-panel brand-panel--frosted">
          <span className="landing-hero__badge-tag num">IRIS 2.0 · OPTIC FLOW</span>
          <span className="landing-hero__badge-note">光带 × 细纤维 · 单渲染器</span>
          <button
            type="button"
            className="landing-hero__badge-btn"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
          >
            {paused ? "继续动效" : "暂停动效"}
          </button>
        </div>

        <div className="landing-hero__grid">
          <div className="landing-hero__copy">
            <p className="landing-hero__eyebrow">
              <span aria-hidden="true" className="landing-hero__eyebrow-rule" />
              <span className="num">INTRODUCING IRIS 2.0</span>
              <span className="landing-hero__eyebrow-sub">/ THE FUTURE OF VISION</span>
            </p>

            <h1 className="landing-hero__title">
              <span className="landing-hero__title-line">VISION,</span>
              <span className="landing-hero__title-line landing-hero__title-line--brand">
                REIMAGINED.
              </span>
              <span className="landing-hero__title-zh">看见更多，理解更深。</span>
            </h1>

            <p className="landing-hero__sub">
              融合眼底影像分析与多智能体协作，让复杂的视觉信息变得清晰、可解释、可追溯。
            </p>

            <div className="landing-hero__cta">
              <Link className="landing-hero__btn landing-hero__btn--primary" to="/diagnosis">
                探索影像分析
                <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
              <Link className="landing-hero__btn" to="/agent">
                探索 AI 协作
                <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="landing-hero__visual">
            <div className="landing-hero__flow">
              <Suspense fallback={<div className="landing-hero__visual-hold" aria-hidden="true" />}>
                <OpticFlow theme={theme} paused={paused} />
              </Suspense>
            </div>

            <BrandPanel variant="layered" as="aside" className="landing-hero__card">
              <BrandKicker>INTELLIGENCE LAYER</BrandKicker>
              <h2 className="landing-hero__card-title">让协作过程，清晰可见。</h2>
              <ol className="landing-hero__steps">
                {LAYERS.map((layer) => (
                  <li key={layer.code}>
                    <span className="num">{layer.code}</span>
                    <span>{layer.name}</span>
                  </li>
                ))}
              </ol>
              <p className="landing-hero__card-body">
                以结构化任务连接智能体、工具与可核对的辅助信息。
              </p>
              <span className="landing-hero__card-note num">流程示意 · 非实时结果</span>
            </BrandPanel>
          </div>
        </div>

        <ul className="landing-hero__entries">
          {ENTRIES.map((entry) => (
            <li key={entry.code}>
              <Link className="brand-panel brand-panel--soft landing-hero__entry" to={entry.to}>
                <span className="landing-hero__entry-glyph" aria-hidden="true">
                  {entry.glyph}
                </span>
                <span className="landing-hero__entry-title">{entry.title}</span>
                <span className="landing-hero__entry-body">{entry.body}</span>
                <span className="landing-hero__entry-go" aria-hidden="true">
                  <ArrowUpRight size={14} strokeWidth={2} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
