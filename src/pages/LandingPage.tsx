import type { CSSProperties } from "react"
import { Link } from "react-router-dom"
import type { DiagnosisResult } from "@/lib/api"
import { CLASSES } from "@/lib/domain"
import { useRevealScan } from "@/lib/useInView"
import { AgentConsole } from "@/components/AgentConsole"
import { DotGrid } from "@/components/DotGrid"
import { ElectricBorder } from "@/components/ElectricBorder"
import { RecordSheet } from "@/components/RecordSheet"
import { ScrollExpand } from "@/components/ScrollExpand"
import { SectionHead } from "@/components/SectionHead"
import { SiteFooter } from "@/components/SiteFooter"
import { SiteHeader } from "@/components/SiteHeader"
import { TargetCursor } from "@/components/TargetCursor"

const STRIP = [
  { label: "覆盖", value: "8 类眼底改变" },
  { label: "模型", value: "EfficientNet-B4" },
  { label: "质量门", value: "通过 / 拒识" },
  { label: "复核", value: "医生签字" },
  { label: "溯源", value: "权重 SHA-256" },
]

/** 页脚章节索引。顶栏只放跨产品目的地，页面内的章节从这里进。 */
const LANDING_SECTIONS = [
  { href: "#how", label: "判读流程" },
  { href: "#record", label: "判读记录" },
  { href: "#agent", label: "诊断 Agent" },
  { href: "#bounds", label: "责任边界" },
  { href: "#start", label: "开始" },
]

const STEPS = [
  {
    code: "01",
    title: "上传",
    body: "照片在浏览器端先校验格式与体积，只接受 JPG 与 PNG，单张不超过 5 MB。",
  },
  {
    code: "02",
    title: "过质量门",
    body: "对比度、清晰度与视野完整性不达标时，系统直接拒识，不给出任何结论。",
  },
  {
    code: "03",
    title: "八类判读",
    body: "模型输出八类眼底改变的概率，主诊断与其余概率一并写入记录，不做取舍。",
  },
  {
    code: "04",
    title: "进入复核",
    body: "可疑病例进入医生复核队列，签字之后，这条记录才可被引用。",
  },
]

const BOUNDS = [
  {
    code: "R-01",
    title: "拒识",
    body: "影像质量不足时不出结论。一次诚实的拒识，比一条错误的判读更负责。",
  },
  {
    code: "R-02",
    title: "复核",
    body: "可疑病例不自动采纳，进入人工队列等待签字，签字前标记为待复核。",
  },
  {
    code: "R-03",
    title: "溯源",
    body: "每条记录保存模型版本与权重指纹，判读结果可回放、可核对。",
  },
  {
    code: "R-04",
    title: "免责",
    body: "输出是辅助判读，不构成诊断，也不能替代执业医师的检查与判断。",
  },
]

const AGENT_POINTS = [
  {
    code: "01",
    title: "多轮问诊",
    body: "症状、病史、影像和检查报告留在同一段上下文里，不必反复描述。",
  },
  {
    code: "02",
    title: "工具可见",
    body: "影像分析与知识库检索逐条留下回执，答案后面能看见依据。",
  },
  {
    code: "03",
    title: "会话留存",
    body: "会话与消息写入记录；下次回来，从上次停下的地方接着说。",
  },
  {
    code: "04",
    title: "可扩展",
    body: "通过 MCP 接入额外的工具服务器，工具清单由后端发现，不在前端硬编码。",
  },
]

/** 落地页展示用的示例记录，明确标注为非真实患者。 */
const SPECIMEN: DiagnosisResult = {
  result: "糖尿病视网膜病变",
  probability: 0.78,
  confidence: 78,
  severity: "moderate",
  details:
    "后极部可见散在点状出血与硬性渗出，沿颞侧血管弓分布；黄斑中心凹尚未受累，未见新生血管。",
  otherDisease: [
    { name: "高血压性视网膜病变", probability: 0.07 },
    { name: "年龄相关性黄斑变性", probability: 0.05 },
    { name: "白内障", probability: 0.04 },
    { name: "青光眼", probability: 0.02 },
    { name: "病理性近视", probability: 0.02 },
    { name: "正常", probability: 0.01 },
    { name: "其他", probability: 0.01 },
  ],
  recommendations:
    "建议 3 个月内复查眼底，并同步复核糖化血红蛋白与血压控制情况。\n如出现视力骤降、飞蚊突然增多，请尽快至眼科门诊就诊。",
  modelVersion: "v2.4.0",
  weightSha256: "8f3c1d0b57ae42c9bb1e7a91d4c2",
  humanReviewStatus: "PENDING",
  requiresReview: true,
  qualityScore: 86,
  createTime: "2026-11-06T14:32:00",
}

/** 标题逐字入场；每个字自带序号，CSS 用它排错落。 */
function Chars({
  text,
  offset = 0,
  marked = false,
}: {
  text: string
  offset?: number
  marked?: boolean
}) {
  return (
    <>
      {Array.from(text).map((char, index) => (
        <span
          key={`${char}-${index}`}
          className={marked ? "ch hero__mark" : "ch"}
          style={{ "--i": index + offset } as CSSProperties}
        >
          {char}
        </span>
      ))}
    </>
  )
}

export function LandingPage() {
  useRevealScan()

  return (
    <div className="is-field">
      {/* 准星只属于落地页，别的地方用系统光标。 */}
      <TargetCursor
        targetSelector="a, button, [data-cursor]"
        spinDuration={2.6}
        hoverDuration={0.2}
        size={30}
        cornerSize={10}
        thickness={1.5}
        padding={4}
        dotSize={3}
      />

      <SiteHeader />

      <main>
        <div className="hero-stage">
          <DotGrid />

          <section className="wrap hero">
            <div className="hero__copy">
              <div className="hero__eyebrow rise">
                <span>01 — 眼底判读</span>
              </div>

              <h1 className="display hero__title">
                <span className="line">
                  <Chars text="读片" />
                </span>
                <span className="line">
                  <Chars text="是一件可以被" offset={2} />
                </span>
                <span className="line">
                  <Chars text="复核" offset={8} marked />
                  <Chars text="的事" offset={10} />
                </span>
              </h1>

              <p className="lead hero__lead rise" style={{ "--d": "640ms" } as CSSProperties}>
                上传一张彩色眼底照片，模型给出八类常见眼底改变的判读。质量不足时主动拒识，
                可疑病例转入医生复核队列——判读之后，还可以和诊断 Agent 接着聊。
              </p>

              <div className="hero__actions rise" style={{ "--d": "760ms" } as CSSProperties}>
                <Link
                  to="/diagnosis"
                  className="btn"
                  data-cursor
                  data-cursor-label="开始判读"
                >
                  上传眼底照片
                  <span className="btn__key">JPG · PNG</span>
                </Link>
                <a className="link" href="#record" data-cursor data-cursor-label="示例记录">
                  看一份判读记录
                  <span className="link__mark">↓</span>
                </a>
                <a className="link" href="#agent" data-cursor data-cursor-label="追问 Agent">
                  和诊断 Agent 聊聊
                  <span className="link__mark">↘</span>
                </a>
              </div>
            </div>

            <div className="hero__index rise" style={{ "--d": "520ms" } as CSSProperties}>
              <div className="index">
                <div className="index__head">
                  <span className="overline">八类覆盖</span>
                  <span className="overline">08 CLASSES</span>
                </div>

                {CLASSES.map((item) => (
                  <div className="index__row" key={item.code} data-cursor>
                    <span className="index__code">{item.code}</span>
                    <span className="index__name">{item.name}</span>
                  </div>
                ))}
              </div>

              <p className="small" style={{ marginTop: 14, maxWidth: "32em" }}>
                其余改变不会被硬塞进这八类里——记录上会写「其他」，并如实标记为需要人工判读。
              </p>
            </div>
          </section>

          <div className="wrap">
            <div className="strip fade" style={{ "--d": "900ms" } as CSSProperties}>
              {STRIP.map((cell) => (
                <div className="strip__cell" key={cell.label}>
                  <div className="readout">
                    <span className="readout__label">{cell.label}</span>
                    <span className="readout__value">{cell.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="plate" aria-label="眼底影像示例">
          <ScrollExpand
            src="/fundus-demo.jpg"
            alt="示例彩色眼底照片：中央为黄斑区，鼻侧可见视盘与血管弓"
            title={
              <span className="scroll-expand__title-inner">
                <span className="scroll-expand__title-kicker">SAMPLE · 眼底照片</span>
                <span className="scroll-expand__title-main">模型的唯一输入</span>
              </span>
            }
            scrollHint="滚动展开 · SCROLL"
            startWidth={46}
            startHeight={41}
            startRadius={6}
            endRadius={0}
            mediaZoom={1.04}
            scrollDistance={0.9}
            holdDistance={0.22}
            smoothing={0.12}
            overlayScrim={0.5}
            useWindowScroll
          >
            <div className="scroll-expand__caption">
              <span className="scroll-expand__caption-kicker">SPECIMEN · 示例影像</span>
              <h2 className="scroll-expand__caption-title">一张眼底照片，八类改变</h2>
              <p className="scroll-expand__caption-body">
                模型只读这一张图。清晰度、对比度与视野完整性先过质量门，
                达标才给出判读；不达标就拒识。
              </p>
              <span className="scroll-expand__caption-note">示例影像 · 非真实患者</span>
            </div>
          </ScrollExpand>
        </section>

        <section id="how" className="section section--line">
          <div className="wrap">
            <div className="reveal">
              <SectionHead code="02" kicker="判读流程" en="How a reading is made" />
              <h2 className="h2">从一张照片，到一条可以复核的记录</h2>
            </div>

            <div className="steps" style={{ marginTop: 44 }}>
              {STEPS.map((step, index) => (
                <div
                  className="step reveal"
                  key={step.code}
                  style={{ "--d": `${index * 90}ms` } as CSSProperties}
                >
                  <span className="step__code">{step.code}</span>
                  <h3 className="step__title">{step.title}</h3>
                  <p className="step__body">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="record" className="section section--line">
          <div className="wrap">
            <div className="reveal">
              <SectionHead code="03" kicker="判读记录" en="Specimen record" />
              <h2 className="h2">一份记录长这样</h2>
              <p className="lead" style={{ marginTop: 16, marginBottom: 40 }}>
                八类概率、质量门、复核状态与权重指纹，全部写在同一张纸上。下方为示例，非真实患者。
              </p>
            </div>

            <div className="reveal" style={{ "--d": "120ms" } as CSSProperties}>
              <RecordSheet result={SPECIMEN} recordId="IRIS-2026-1106-0042" specimen />
            </div>
          </div>
        </section>

        <section id="agent" className="section section--line agent-section">
          <div className="wrap">
            <div className="reveal">
              <SectionHead code="04" kicker="诊断 Agent" en="Conversational review" />
            </div>

            <div className="agent-intro">
              <h2 className="h2 reveal">
                判读之外，
                <br />
                还有一个可以追问的对象
              </h2>
              <p
                className="lead agent-intro__lead reveal"
                style={{ "--d": "90ms" } as CSSProperties}
              >
                诊断 Agent 把一次判读延伸成一段对话：先问症状，再读影像，需要时检索知识库。
                每一次工具调用都摆在明面上——你可以顺着答案继续问「为什么」。
              </p>
            </div>

            <div className="agent-stage">
              <div
                className="agent-stage__main reveal"
                style={{ "--d": "120ms" } as CSSProperties}
              >
                <ElectricBorder
                  color="#e2622b"
                  glowColor="#d9541f"
                  theme="dark"
                  borderRadius={0}
                  thickness={1.1}
                  strands={3}
                  speed={0.85}
                  chaos={0.34}
                  spread={0.28}
                  glow={0.34}
                  intensity={0.52}
                  flicker={0.35}
                  cursorRadius={140}
                  style={{ width: "100%" }}
                >
                  <AgentConsole />
                </ElectricBorder>
                <p className="small agent-stage__caption">
                  示例会话，非真实患者。工具调用、检索来源与回答均为演示数据。
                </p>
              </div>

              <aside
                className="agent-stage__rail reveal"
                style={{ "--d": "220ms" } as CSSProperties}
              >
                <p className="overline">它的工作方式 · HOW IT WORKS</p>

                <ol className="agent-list">
                  {AGENT_POINTS.map((item) => (
                    <li className="agent-list__item" key={item.code}>
                      <span className="agent-list__code">{item.code}</span>
                      <div>
                        <h3 className="agent-list__title">{item.title}</h3>
                        <p className="agent-list__body">{item.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="agent-aside">
                  <p className="small">
                    Agent 不确诊、不开处方；涉及用药与手术，一律建议到眼科门诊。
                  </p>
                  <Link
                    to="/login?redirect=/diagnosis"
                    className="link"
                    data-cursor
                    data-cursor-label="登录"
                  >
                    登录后体验诊断 Agent
                    <span className="link__mark">→</span>
                  </Link>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section id="bounds" className="is-dark section" data-head-invert="true">
          <div className="wrap">
            <div className="reveal">
              <SectionHead code="05" kicker="责任边界" en="Responsibility" />
              <h2 className="h2" style={{ maxWidth: "22em" }}>
                当 AI 说「不确定」，界面必须把这句话说出口
              </h2>
            </div>

            <div className="bounds" style={{ marginTop: 44 }}>
              {BOUNDS.map((item, index) => (
                <div
                  className="bound reveal"
                  key={item.code}
                  style={{ "--d": `${index * 90}ms` } as CSSProperties}
                >
                  <span className="bound__code">{item.code}</span>
                  <h3 className="bound__title">{item.title}</h3>
                  <p className="bound__body">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="start" className="wrap pitch">
          <div className="reveal">
            <SectionHead code="06" kicker="开始" en="Start" />
            <h2 className="h2">先读一张片子试试</h2>
            <p className="lead" style={{ marginTop: 16 }}>
              不需要说明书——上传、等待、读记录，三步之内就能看见判断依据。
            </p>
          </div>

          <div className="pitch__aside reveal" style={{ "--d": "120ms" } as CSSProperties}>
            <Link
              to="/diagnosis"
              className="btn"
              data-cursor
              data-cursor-label="开始判读"
            >
              上传眼底照片
              <span className="btn__key">JPG · PNG</span>
            </Link>
            <p className="small">
              继续即表示你已阅读并理解：本系统输出为 AI 辅助判读，不构成诊断结论。
            </p>
          </div>
        </section>
      </main>

      <div className="wrap">
        <SiteFooter sections={LANDING_SECTIONS} />
      </div>
    </div>
  )
}
