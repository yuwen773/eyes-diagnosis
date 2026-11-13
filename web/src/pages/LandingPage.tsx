import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react"
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import { Link } from "react-router-dom"
import type { DiagnosisResult } from "@/lib/api"
import { CLASSES } from "@/lib/domain"
import { useInView, useRevealScan } from "@/lib/useInView"
import { useTheme } from "@/components/theme-provider"
import { LandingHero } from "@/components/brand/LandingHero"
import { RecordSheet } from "@/components/RecordSheet"
import { SectionHead } from "@/components/SectionHead"
import { Dialog } from "@/components/ui/dialog"
import { BrandFooter } from "@/components/brand/BrandFooter"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { TargetCursor } from "@/components/TargetCursor"

// 重型视觉组件独立成块：首屏的扫描舱要立刻有，其余等进入视口再下载。
const ScrollExpand = lazy(() =>
  import("@/components/ScrollExpand").then((m) => ({ default: m.ScrollExpand })),
)
const AgentComposer = lazy(() =>
  import("@/components/AgentComposer").then((m) => ({ default: m.AgentComposer })),
)
const AgentScreenDeck = lazy(() =>
  import("@/components/AgentScreenDeck").then((m) => ({ default: m.AgentScreenDeck })),
)

/**
 * 进入视口后再挂载子树（含其 chunk）。
 * 未挂载时用 minHeight 撑住版面，避免滚动到该段时页面高度突然变化。
 */
function Deferred(props: { minHeight: string; children: ReactNode }) {
  const [ref, inView] = useInView<HTMLDivElement>("360px 0px 360px 0px")
  return (
    <div ref={ref} style={inView ? undefined : { minHeight: props.minHeight }}>
      {inView ? <Suspense fallback={null}>{props.children}</Suspense> : null}
    </div>
  )
}

/** 索引格右列的示例概率，与下方 SPECIMEN 同一套演示口径。 */
const SPECIMEN_RATE: Record<string, string> = {
  DR: "0.78",
  AMD: "0.05",
  CAT: "0.04",
  GLA: "0.02",
  HR: "0.07",
  PM: "0.02",
  N: "0.01",
  OTH: "0.01",
}

/** 页脚章节索引。顶栏只放跨产品目的地，页面内的章节从这里进。 */
const LANDING_SECTIONS = [
  { href: "#specimen", label: "模型读什么" },
  { href: "#how", label: "使用流程" },
  { href: "#record", label: "判读记录" },
  { href: "#agent", label: "诊断 Agent" },
  { href: "#bounds", label: "责任边界" },
  { href: "#start", label: "开始" },
]

const STEPS = [
  {
    title: "上传",
    body: "照片在浏览器端先校验格式与体积，只接受 JPG 与 PNG，单张不超过 5 MB。",
    readout: "JPG · PNG ≤ 5 MB",
  },
  {
    title: "过质量门",
    body: "对比度、清晰度与视野完整性不达标时，系统直接拒识，不给出任何结论。",
    // 质量门只有「通过 / 拒识」两种真实结果；86 是示例记录里的读数，
    // 不是平台阈值，不能挪到这里当指标（同 R2 页脚整改口径）。
    readout: "GATE · PASS / REJECT",
  },
  {
    title: "八类判读",
    body: "模型输出八类眼底改变的概率，判读结果与其余概率一并写入记录，不做取舍。",
    readout: "SOFTMAX · 8 CLS",
  },
  {
    title: "进入复核",
    body: "可疑病例进入人工复核队列，签字之后，这条记录才可被引用。",
    readout: "SIGN-OFF · 待签字",
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

/** 真实眼底样本的局部：把模型真正读到的解剖结构摊开给人看。
 *  每张图带一枚标注点：悬停浮出读片结论，点击进灯箱看原尺寸。 */
const SPECIMEN_DETAILS = [
  {
    src: "/fundus-detail-vessels.jpg",
    title: "血管弓",
    note: "走行与管径",
    alt: "眼底照片局部：颞侧上血管弓与分支血管",
    markLabel: "ARCADES",
    reading: "颞侧上血管弓走行自然，管径均匀，未见白鞘与动静脉交叉压迹。",
    mark: { x: 48, y: 36 },
  },
  {
    src: "/fundus-detail-macula.jpg",
    title: "黄斑",
    note: "中心凹与渗出",
    alt: "眼底照片局部：黄斑区与点状渗出",
    markLabel: "MACULA",
    reading: "中心凹反光可见，黄斑区散在点状渗出，边界尚清。",
    mark: { x: 41, y: 50 },
  },
  {
    src: "/fundus-detail-disc.jpg",
    title: "视盘",
    note: "边界与杯盘比",
    alt: "眼底照片局部：视盘中央凹与血管出入处",
    markLabel: "OPTIC DISC",
    reading: "视盘边界清晰，盘沿完整，杯盘比约 0.3。",
    mark: { x: 60, y: 62 },
  },
]

const AGENT_POINTS = [
  {
    title: "多轮问诊",
    body: "症状、病史、影像和检查报告留在同一段上下文里，不必反复描述。",
  },
  {
    title: "工具可见",
    body: "影像分析与知识库检索逐条留下回执，答案后面能看见依据。",
  },
  {
    title: "会话留存",
    body: "会话与消息写入记录；下次回来，从上次停下的地方接着说。",
  },
  {
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

export function LandingPage() {
  useRevealScan()
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  /* ── 样本局部灯箱 ─────────────────────────────────────── */
  const lightboxRef = useRef<HTMLDialogElement | null>(null)
  const [specimenOpen, setSpecimenOpen] = useState<number | null>(null)
  /* ── 示例记录完整弹层 ─────────────────────────────────── */
  const [recordPreviewOpen, setRecordPreviewOpen] = useState(false)

  const openSpecimen = (index: number) => setSpecimenOpen(index)
  const closeSpecimen = () => lightboxRef.current?.close()
  const stepSpecimen = (delta: number) =>
    setSpecimenOpen((cur) =>
      cur === null ? cur : (cur + delta + SPECIMEN_DETAILS.length) % SPECIMEN_DETAILS.length,
    )

  const onLightboxKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      stepSpecimen(-1)
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      stepSpecimen(1)
    }
  }

  // 状态与原生 <dialog> 同步：showModal 自带焦点与 Esc；jsdom 里没有该方法时退化为普通 open。
  useEffect(() => {
    const dialog = lightboxRef.current
    if (!dialog) return
    if (specimenOpen !== null && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal()
      else dialog.setAttribute("open", "")
    } else if (specimenOpen === null && dialog.open) {
      dialog.close()
    }
  }, [specimenOpen])

  return (
    // 整页语境随主题走：暗主题是深夜蓝，浅主题是品牌银蓝画布。
    // `.is-brand-page`（R2-04）只换画布与发丝线，文字与临床语义令牌不动——
    // 上半页的钴蓝光学台和下半页的章节因此落在同一块底色上。
    <div className={(dark ? "is-night " : "is-field ") + "night is-brand-page"}>
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

      <ProductHeader scene="brand" />

      <main>
        <LandingHero />

        <section className="plate" aria-label="眼底影像示意">
          <Deferred minHeight="100svh">
          <ScrollExpand
            src={dark ? "/scroll-expand-dark.webp" : "/scroll-expand-light.webp"}
            tone={dark ? "dark" : "light"}
            alt="眼底示意渲染：虹膜与血管分布的示意画，非真实患者影像"
            title={
              <span className="scroll-expand__title-inner">
                <span className="scroll-expand__title-kicker">RENDER · 眼底示意</span>
                <span className="scroll-expand__title-main">模型的唯一输入</span>
              </span>
            }
            scrollHint="滚动展开 · SCROLL"
            startWidth={46}
            startHeight={41}
            startRadius={6}
            endRadius={0}
            mediaZoom={1.04}
            scrollDistance={0.34}
            holdDistance={0}
            smoothing={0.12}
            overlayScrim={dark ? 0.5 : 0.85}
            useWindowScroll
          >
            <div className="scroll-expand__caption">
              <span className="scroll-expand__caption-kicker">SPECIMEN · 影像示意</span>
              <h2 className="scroll-expand__caption-title">输入只有一张图，输出八类概率</h2>
              <p className="scroll-expand__caption-body">
                模型只读这一张图。清晰度、对比度与视野完整性先过质量门，
                达标才给出判读；不达标就拒识。
              </p>
              <span className="scroll-expand__caption-note">眼底示意渲染 · 非真实患者影像</span>
            </div>
          </ScrollExpand>
          </Deferred>
        </section>

        {/* 光幕之后立刻给出真实样本：示意图讲「输入」，这组局部讲模型读什么。 */}
        <section className="section section--line landing-section specimen-details" id="specimen" aria-label="眼底样本局部">
          <div className="wrap">
            <div className="reveal">
              <SectionHead code="02" title="模型读的是这些结构" note="血管弓、黄斑、视盘——判读依据都摆在你眼前 · 示例影像，非真实患者" />
              <p className="lead" style={{ marginTop: 16, marginBottom: 40 }}>
                影像判读由 EfficientNet-B4 模型完成，输入一张眼底照片，输出八类眼底改变的
                概率。模型逐项看的东西不神秘：血管的走行、黄斑的渗出、视盘的边界。
              </p>
            </div>
            <div className="specimen-grid">
              {SPECIMEN_DETAILS.map((item, index) => (
                <figure
                  className="specimen-grid__item reveal"
                  key={item.src}
                  style={{ "--d": `${index * 90}ms` } as CSSProperties}
                >
                  <button
                    type="button"
                    className="specimen-grid__open"
                    onClick={() => openSpecimen(index)}
                    aria-haspopup="dialog"
                    aria-label={`放大查看${item.title}局部`}
                  >
                    <img src={item.src} alt={item.alt} loading="lazy" />
                    <span
                      className="specimen-grid__mark"
                      style={{ "--x": `${item.mark.x}%`, "--y": `${item.mark.y}%` } as CSSProperties}
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                    <span className="specimen-grid__reading" aria-hidden="true">
                      <span className="specimen-grid__reading-code num">{item.markLabel}</span>
                      <span className="specimen-grid__reading-text">{item.reading}</span>
                    </span>
                  </button>
                  <figcaption>
                    <span className="specimen-grid__title">{item.title}</span>
                    <span className="specimen-grid__note">{item.note}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="specimen-hint num">悬停显示读片标注 · 点击查看原尺寸</p>
          </div>

          {/* 灯箱：原生 dialog 管焦点与 Esc，左右方向键换图。 */}
          <dialog
            ref={lightboxRef}
            className="specimen-lightbox"
            aria-labelledby="specimen-lightbox-title"
            onClose={() => setSpecimenOpen(null)}
            onKeyDown={onLightboxKeyDown}
            onClick={(event) => {
              if (event.target === lightboxRef.current) closeSpecimen()
            }}
          >
            {specimenOpen !== null ? (
              <div className="specimen-lightbox__frame">
                <div className="specimen-lightbox__head">
                  <span className="specimen-lightbox__index num">
                    {String(specimenOpen + 1).padStart(2, "0")} / {String(SPECIMEN_DETAILS.length).padStart(2, "0")}
                  </span>
                  <h3 id="specimen-lightbox-title" className="specimen-lightbox__title">
                    {SPECIMEN_DETAILS[specimenOpen].title}
                  </h3>
                  <button
                    type="button"
                    className="specimen-lightbox__close"
                    onClick={closeSpecimen}
                    aria-label="关闭大图"
                  >
                    ✕
                  </button>
                </div>
                <div className="specimen-lightbox__stage">
                  <img
                    src={SPECIMEN_DETAILS[specimenOpen].src}
                    alt={SPECIMEN_DETAILS[specimenOpen].alt}
                  />
                </div>
                <div className="specimen-lightbox__foot">
                  <p className="specimen-lightbox__reading">{SPECIMEN_DETAILS[specimenOpen].reading}</p>
                  <div className="specimen-lightbox__nav">
                    <button
                      type="button"
                      className="specimen-lightbox__step"
                      onClick={() => stepSpecimen(-1)}
                      aria-label="上一张"
                    >
                      <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="specimen-lightbox__step"
                      onClick={() => stepSpecimen(1)}
                      aria-label="下一张"
                    >
                      <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                  <span className="specimen-lightbox__note num">示例影像 · 非真实患者</span>
                </div>
              </div>
            ) : null}
          </dialog>
        </section>

        <section id="how" className="section section--line landing-section">
          <div className="wrap">
            <div className="reveal">
              <SectionHead code="03" title="怎么用" note="从一张照片，到一条可以复核的记录" />
            </div>

            {/* 八类覆盖表 + 判读流程。八类覆盖与质量门是产品事实，
                从首屏技术铭牌挪到正文，按用户能理解的方式说明。 */}
            <div className="landing-how">
              <div className="landing-how__classes reveal">
                <div className="index">
                  <div className="index__head">
                    <span className="overline">八类覆盖</span>
                    <span className="overline">08 CLASSES</span>
                  </div>

                  {CLASSES.map((item) => (
                    <div className="index__row" key={item.code}>
                      <span className="index__code">{item.code}</span>
                      <span className="index__name">{item.name}</span>
                      <span className="index__rate num">{SPECIMEN_RATE[item.code]}</span>
                    </div>
                  ))}
                </div>

                <p className="small index__note">
                  示例概率，非真实患者。其余改变不会被硬塞进这八类里——记录上会写「其他」，并如实标记为需要人工判读。
                </p>
              </div>

              <ol className="landing-steps reveal" style={{ "--d": "90ms" } as CSSProperties}>
                {STEPS.map((step, index) => (
                  <li className="landing-step" key={step.title} data-cursor>
                    <span className="landing-step__index num" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="landing-step__main">
                      <h3 className="landing-step__title">{step.title}</h3>
                      <p className="landing-step__body">{step.body}</p>
                    </div>
                    <span className="landing-step__readout num">{step.readout}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="record" className="section section--line landing-section">
          <div className="wrap">
            <div className="landing-record__intro">
              <div className="reveal">
                <SectionHead
                  code="04"
                  title="你能看到什么结果"
                  note="一条可以逐项核对的判读记录"
                />
                <p className="lead landing-record__value">
                  判读结束不是一张只有结论的图：八类概率、质量门结果、复核状态与
                  模型版本都写在同一张记录纸上，条条可以核对。下面是一份示例记录的
                  展示——完整记录在判读页生成。
                </p>
              </div>
              <div className="reveal landing-record__actions" style={{ "--d": "90ms" } as CSSProperties}>
                <button
                  type="button"
                  className="landing-record__peek"
                  onClick={() => setRecordPreviewOpen(true)}
                  aria-haspopup="dialog"
                >
                  查看完整示例记录
                  <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
                </button>
                <span className="landing-record__peek-note num">示例 · 非真实患者</span>
              </div>
            </div>

            <div
              className="landing-record reveal"
              style={{ "--d": "120ms" } as CSSProperties}
            >
              {/* 记录纸在任何主题下都是同一张白纸（纸面原语不参与主题翻转）。
                  展示区只露纸上部的结论与置信读数：完整记录走「查看完整示例记录」弹层。
                  品牌画框只负责「陈列」：纸面、风险色与证据链一条不改。 */}
              <div className="landing-record__bar">
                <span className="overline">记录纸 · RECORD SHEET</span>
                <span className="num landing-record__stamp">示例 · 非真实患者</span>
              </div>
              <div className="landing-record__paper">
                <div className="landing-record__viewport" aria-hidden="true">
                  <RecordSheet
                    result={SPECIMEN}
                    recordId="IRIS-2026-1106-0042"
                    specimen
                    tone="paper"
                  />
                </div>
                <div className="landing-record__fade" aria-hidden="true" />
              </div>
              <div className="landing-record__foot">
                <span className="num">… 下方还有建议、复核提示与免责 · 载于完整记录</span>
                <button
                  type="button"
                  className="landing-record__foot-btn"
                  onClick={() => setRecordPreviewOpen(true)}
                >
                  展开完整记录
                </button>
              </div>
            </div>
          </div>

          {/* 完整示例记录弹层：Base UI Dialog 管焦点与滚动锁，
              语境类带上 .is-brand-page，纸面原语不随主题翻转。 */}
          <Dialog
            open={recordPreviewOpen}
            title="示例判读记录 · 非真实患者"
            onClose={() => setRecordPreviewOpen(false)}
            className="landing-record__modal is-brand-page"
          >
            <header className="landing-record__modal-head">
              <span className="overline">示例记录 · SPECIMEN</span>
              <button
                type="button"
                className="landing-record__modal-close"
                aria-label="关闭示例记录"
                onClick={() => setRecordPreviewOpen(false)}
              >
                ✕
              </button>
            </header>
            <div className="landing-record__modal-body">
              <RecordSheet
                result={SPECIMEN}
                recordId="IRIS-2026-1106-0042"
                specimen
                tone="paper"
              />
            </div>
          </Dialog>
        </section>

        <section id="agent" className="section section--line landing-section agent-section">
          <div className="wrap">
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
                下面的界面是演示预览，真实的对话从你的账号开始。
              </p>
            </div>

            <div className="agent-stage">
              <div
                className="agent-stage__composer reveal"
                style={{ "--d": "120ms" } as CSSProperties}
              >
                <Deferred minHeight="220px">
                  <AgentComposer dark={dark} />
                </Deferred>
              </div>

              <div
                className="agent-stage__deck reveal"
                style={{ "--d": "220ms" } as CSSProperties}
              >
                <Deferred minHeight="360px">
                  <AgentScreenDeck dark={dark} />
                </Deferred>
                <p className="small agent-stage__caption">
                  示例界面，非真实患者。工具调用、检索来源与回答均为演示数据。
                </p>
              </div>
            </div>

            <ol className="landing-agent__points reveal">
              {AGENT_POINTS.map((item, index) => (
                <li className="landing-agent__point" key={item.title}>
                  <span className="landing-agent__code num" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="landing-agent__title">{item.title}</h3>
                  <p className="landing-agent__body">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 责任边界：实体品牌面（浅色亮面 / 暗色深海蓝），条款印在发丝线上。 */}
        <section id="bounds" className="statute">
          <div className="wrap">
            <div className="statute__panel">
              <div className="statute__grid">
                <div className="statute__manifesto reveal">
                  <h2 className="display statute__title">
                    当 AI 说不确定，界面要说出口
                  </h2>
                  <p className="lead statute__lead">
                    辅助判读不是诊断。以下四条写进每一次输出，不接受例外。
                  </p>
                  <div className="statute__seal num" aria-hidden="true">
                    Iris · 辅助判读
                    <br />
                    NOT A DIAGNOSIS
                  </div>
                </div>

                <ol className="statute__list">
                  {BOUNDS.map((item, index) => (
                    <li
                      className="statute__item reveal"
                      key={item.code}
                      style={{ "--d": `${index * 90}ms` } as CSSProperties}
                    >
                      <span className="statute__code num">{item.code}</span>
                      <div>
                        <h3 className="statute__name">{item.title}</h3>
                        <p className="statute__body">{item.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="statute__sign num" aria-hidden="true">
                <span>医师签字 · SIGNATURE</span>
                <span className="statute__rule" />
                <span>日期 · DATE</span>
                <span className="statute__rule" />
              </div>
            </div>
          </div>
        </section>

        <section id="start" className="wrap pitch landing-start">
          <div className="reveal">
            <h2 className="pitch__title">先读一张片子试试</h2>
            <p className="lead" style={{ marginTop: 16 }}>
              不需要说明书——上传、等待、读记录，三步之内就能看见判断依据。
            </p>
          </div>

          <div className="pitch__aside reveal" style={{ "--d": "120ms" } as CSSProperties}>
            {/* 登录页那块磨砂玻璃，搬到收尾当台面。 */}
            <div className="pitch__glass auth__glass">
              <Link to="/diagnosis" className="btn" data-cursor data-cursor-label="开始判读">
                上传眼底照片
                <span className="btn__key">JPG · PNG</span>
              </Link>
              <p className="small">
                继续即表示你已阅读并理解：本系统输出为 AI 辅助判读，不构成诊断结论。
              </p>
            </div>
          </div>
        </section>

      </main>

      {/* 全幅：深海蓝实体面要铺满视口宽度，版心在组件内部自己收。 */}
      <BrandFooter sections={LANDING_SECTIONS} />

      <div className="night__grain" aria-hidden="true" />
    </div>
  )
}
