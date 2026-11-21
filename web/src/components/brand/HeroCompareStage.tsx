import type { ReactElement } from "react"
import { ArrowUpRight } from "lucide-react"
import { Link } from "react-router-dom"

import { BrandKicker, BrandPanel } from "./BrandPanel"
import { HeroFusion } from "./HeroFusion"
import { HeroPrism } from "./HeroPrism"
import { OpticFlow } from "./OpticFlow"
import "./HeroCompareStage.css"

/**
 * E-09 对照台：**同一个外壳，只换主视觉策略**。
 *
 * <p>外壳逐字取自 `ui@b805377f` 的 `LandingHero`（顶栏在页面层，不在这里）：
 * 同一个 `.landing-hero` 区段、同一套标题 / 副标题 / CTA / 信息卡 / 入口卡。
 * 三个方案之间的差异因此**只剩渲染器**，不会把「分支之间本来就存在的构图差异」
 * 误读成 OpticFlow 与 Prism 的差异。
 *
 * <p>首屏构图有**两版**，`shell` 参数切：
 * <ul>
 *   <li>`bleed`（默认）——`ui@b805377f` 现行：主视觉铺满整个 hero 区段，
 *       玻璃外壳浮在上面。</li>
 *   <li>`contained`——`feat/iris21-multiagent-integration` 的写法：主视觉整块
 *       裁在 `--maxw` 版心内的玻璃壳右侧栏里。</li>
 * </ul>
 * 两条分支的首屏构图本来就有分歧，把它们分开取帧，才能看清「渲染器差异」与
 * 「构图差异」各占多少。（`DESIGN.md` §3.6 描述的其实是第三种组合：画布全幅 +
 * 光带裁在壳里；两条分支各自只做到一半。）
 *
 * <p>与原生页的差别只有两处，都是为了让比较公平：
 * <ul>
 *   <li>去掉 OpticFlow 原生页那个「暂停动效」徽章——Prism 没有这个控件，
 *       留着就等于给 A 多一块玻璃；暂停改由对照台工具栏统一提供。</li>
 *   <li>不改任何字号、间距、卡片位置与缩放。</li>
 * </ul>
 *
 * <p>这个组件只在 `/design/hero-compare` 用，不参与正式首页渲染。
 */

export type HeroVisual = "optic" | "prism" | "fusion"
export type HeroShell = "bleed" | "contained"

export const HERO_VISUALS: { key: HeroVisual; code: string; name: string; note: string }[] = [
  { key: "optic", code: "A", name: "OpticFlow", note: "光带 × 细纤维 · 单 Beams 渲染器" },
  { key: "prism", code: "B", name: "Prism", note: "棱镜光场 · 单 Prism 渲染器" },
  { key: "fusion", code: "C", name: "OpticFlow × Prism", note: "Beams 光带 + SVG 棱镜色散" },
]

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

const LAYERS = [
  { code: "01", name: "影像" },
  { code: "02", name: "分析" },
  { code: "03", name: "证据" },
]

type Props = {
  visual: HeroVisual
  theme: "light" | "dark"
  paused: boolean
  /** 首屏构图：`bleed` = 全幅（ui 现行），`contained` = 壳内（DESIGN.md §3.6）。 */
  shell?: HeroShell
}

export function HeroCompareStage({
  visual,
  theme,
  paused,
  shell = "bleed",
}: Props): ReactElement {
  // 三方案共用这一段 DOM：切换时 React 换掉的是里面的渲染器。
  const flow = (
    <div className="landing-hero__flow" data-hero-visual={visual}>
      {visual === "optic" ? (
        <OpticFlow theme={theme} paused={paused} />
      ) : visual === "prism" ? (
        <HeroPrism theme={theme} />
      ) : (
        <HeroFusion theme={theme} paused={paused} />
      )}
    </div>
  )

  return (
    <section
      className={`landing-hero iris2${shell === "contained" ? " hero-compare--contained" : ""}`}
      data-hero-shell={shell}
      aria-label="Iris 2.0 首屏（设计对照）"
    >
      {shell === "contained" ? null : flow}

      <div className="landing-hero__shell">
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
            {shell === "contained" ? flow : null}

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
