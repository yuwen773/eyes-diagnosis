import "@/styles/diagnosis.css"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ApiError, runDiagnosis, type DiagnosisResult } from "@/lib/api"
import {
  CLASSES,
  canonicalClassName,
  classCode,
  confidenceBand,
  confidencePercent,
  type Risk,
} from "@/lib/domain"
import { useSession } from "@/lib/session"
import { rememberPendingUpload, takePendingUpload } from "@/lib/pendingUpload"
import {
  ACCEPTED_IMAGE_TYPES,
  UPLOAD_LIMIT_HINT,
  exceedsUploadLimit,
  uploadLimitError,
} from "@/lib/uploadLimits"
import { FaultNote } from "@/components/fault"
import { faultFromError, infoFault, validationFault, type Fault } from "@/lib/faults"
import { DisclaimerBar } from "@/components/DisclaimerBar"
import { ProductHeader } from "@/components/shell/ProductHeader"

type Stage = "empty" | "ready" | "running" | "done" | "error"

/**
 * 单张影像上限 = 服务端真实上限（`FileManager.validPicture`），
 * 口径集中在 `@/lib/uploadLimits`，不在页面里写字面量。
 *
 * <p>之前前端写 5 MB、服务端只收 2 MB：2–5 MB 的片子能判读出结果，
 * 但存图那步失败被吞掉，记录里**没有原图**——用户拿到结论却核验不了影像。
 * 前端口径与服务端对齐：本地就拦下并说清楚。
 */
const ACCEPTED = ACCEPTED_IMAGE_TYPES

function validate(file: File): string | null {
  if (!ACCEPTED.includes(file.type as (typeof ACCEPTED)[number]))
    return "只接受 JPG 与 PNG 格式的影像"
  if (exceedsUploadLimit(file.size)) return uploadLimitError("影像")
  return null
}

/** 秒表读数：分:秒。等待时长是真实耗时，不是进度。 */
function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds - m * 60)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/**
 * 结果的四种结局。区分是硬要求：拒识、待复核、有效分类、失败不能混成一句「完成」。
 * 全部来自响应字段，不从界面推断。
 */
type Outcome = { key: "classified" | "rejected" | "review"; label: string; risk: Risk }

function outcomeOf(result: DiagnosisResult): Outcome {
  if (result.aiRejected) return { key: "rejected", label: "模型未给出结论", risk: "attention" }
  if (result.requiresReview) return { key: "review", label: "已转入人工复核队列", risk: "attention" }
  return { key: "classified", label: "已给出分类", risk: "normal" }
}

const STEPS = [
  { key: "upload", zh: "上传影像" },
  { key: "read", zh: "等待判读" },
  { key: "result", zh: "查看结果" },
] as const

export function DiagnosisPage() {
  const { status } = useSession()
  const navigate = useNavigate()

  // 未登录上传被送去登录页时暂存的影像；回来时一次取出，不留在本机。
  const [restored] = useState(() => takePendingUpload())
  const [file, setFile] = useState<File | null>(restored)
  const [preview, setPreview] = useState<string | null>(() =>
    restored ? URL.createObjectURL(restored) : null,
  )
  const previewRef = useRef<string | null>(preview)
  const [stage, setStage] = useState<Stage>(restored ? "ready" : "empty")
  // 故障只有一份：要么是这张图没通过检查（贴影像区），要么是这次判读没成（给重试）。
  const [fault, setFault] = useState<Fault | null>(() =>
    restored ? infoFault("已为你保留上次选择的影像，继续判读即可") : null,
  )
  const [faultScope, setFaultScope] = useState<"slot" | "run">("slot")
  const [needsLogin, setNeedsLogin] = useState(false)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [dragging, setDragging] = useState(false)
  // 真实等待秒数：只用于显示已经等了多久，不做进度条。
  const [elapsed, setElapsed] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const startedAt = useRef<number>(0)
  // 本次判读的代号。每次真正发起判读就换号，回来时先核对号对不对得上：
  // 对不上说明这次结果已经被换图或重置取代了，直接丢掉，绝不落到新的影像上。
  const runId = useRef(0)

  // 本地预览的 object URL 在换图/重置时手动释放；卸载时兜底清理一次。
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  // 等待计时：只显示真实等待时长，不做进度假动作。
  useEffect(() => {
    if (stage !== "running") return
    const tick = () => setElapsed((Date.now() - startedAt.current) / 1000)
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [stage])

  function accept(next: File | null) {
    if (!next) return
    // 判读进行中不换图。在途请求的结论属于旧影像，落到新影像上就是张冠李戴。
    if (stage === "running") {
      setFault(infoFault("判读进行中，请等这次结果出来再换图"))
      setFaultScope("slot")
      return
    }
    const problem = validate(next)
    if (problem) {
      setFault(validationFault(problem))
      setFaultScope("slot")
      setNeedsLogin(false)
      return
    }
    setFault(null)
    setNeedsLogin(false)
    setResult(null)
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = URL.createObjectURL(next)
    previewRef.current = url
    setPreview(url)
    setFile(next)
    setStage("ready")
  }

  async function diagnose() {
    if (!file) return
    const id = ++runId.current
    setStage("running")
    setFault(null)
    setNeedsLogin(false)
    setResult(null)
    setElapsed(0)
    startedAt.current = Date.now()

    try {
      const value = await runDiagnosis(file)
      // 号对不上：这次判读期间用户换了图或点了重置，结果已经没有归属，丢掉。
      if (runId.current !== id) return
      setResult(value)
      setStage("done")
    } catch (cause) {
      if (runId.current !== id) return
      setStage("error")
      setFaultScope("run")
      const loginRequired = cause instanceof ApiError && cause.code === 40100
      setNeedsLogin(loginRequired)
      // 路由层马上会送去登录页；先把影像暂存，回来还能接着判读。
      if (loginRequired) rememberPendingUpload(file)
      setFault(
        faultFromError(cause, {
          intent: "load",
          action: { label: "重试", run: () => void diagnose() },
        }),
      )
    }
  }

  function reset() {
    // 作废在途请求：结果回来时已经没有对应的影像了。
    runId.current += 1
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setPreview(null)
    setFile(null)
    setResult(null)
    setStage("empty")
    setFault(null)
    setNeedsLogin(false)
    setElapsed(0)
    if (inputRef.current) inputRef.current.value = ""
  }

  // 未登录时撞上 40100：路由层会送人去登录页，这里只把话说清楚。
  const showLoginHint = needsLogin && status === "anon"

  const stepIndex = result ? 2 : stage === "running" ? 1 : 0
  const sizeMB = file ? (file.size / 1048576).toFixed(1) : null

  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="clinical" />

      <main className="wrap dx">
        <header className="dx__head">
          <p className="dx__kicker">影像判读</p>
          <h1 className="dx__title">上传一张彩色眼底照片</h1>
          <p className="dx__lead">
            单眼、清晰、光照均匀。系统先过质量门，不合格的影像不会给出结论。
          </p>
        </header>

        <ol className="dx__steps" aria-label="判读流程">
          {STEPS.map((step, index) => (
            <li
              key={step.key}
              className="dx__step"
              data-state={
                index < stepIndex ? "done" : index === stepIndex ? "current" : "todo"
              }
              aria-current={index === stepIndex ? "step" : undefined}
            >
              <span className="dx__step-no">{index + 1}</span>
              <span className="dx__step-zh">{step.zh}</span>
            </li>
          ))}
        </ol>

        <div className="dx__body">
          <section className="dx__media" aria-label="影像">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="sr-only"
              disabled={stage === "running"}
              onChange={(event) => accept(event.target.files?.[0] ?? null)}
            />

            {preview ? (
              <div className="dx__frame" data-busy={stage === "running"}>
                <img className="dx__img" src={preview} alt="待判读的眼底照片" />
                {stage === "running" ? (
                  <span className="dx__waiting" role="status">
                    <span className="dx__waiting-dot" aria-hidden="true" />
                    正在判读 · 已等待 {clock(elapsed)}
                  </span>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="dx__drop"
                data-drag={dragging}
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  accept(event.dataTransfer.files?.[0] ?? null)
                }}
                aria-label="选择或拖入眼底照片"
              >
                <img
                  className="dx__specimen"
                  src="/fundus-demo.jpg"
                  alt="示例眼底照片：视盘、血管弓与黄斑区"
                />
                <span className="dx__drop-copy">
                  <span className="dx__drop-title">
                    {dragging ? "松手，放入影像" : "点击或拖入影像"}
                  </span>
                  <span className="dx__drop-hint">JPG · PNG · {UPLOAD_LIMIT_HINT}</span>
                  <span className="dx__drop-note">示例影像 · 非真实患者</span>
                </span>
              </button>
            )}

            {file ? (
              <div className="dx__filebar">
                <p className="dx__filemeta">
                  {file.name} · {file.type === "image/png" ? "PNG" : "JPEG"} · {sizeMB} MB
                </p>
                <button
                  className="link"
                  type="button"
                  onClick={reset}
                  disabled={stage === "running"}
                >
                  换一张
                </button>
              </div>
            ) : null}
          </section>

          <aside className="dx__panel">
            {result ? (
              <ResultSummary result={result} onReset={reset} />
            ) : stage === "running" ? (
              <RunningPanel elapsed={elapsed} file={file} />
            ) : (
              <UploadPanel
                file={file}
                stage={stage}
                onStart={() => void diagnose()}
                onPick={() => inputRef.current?.click()}
              />
            )}

            {showLoginHint ? (
              <div className="dx__fault">
                <FaultNote
                  fault={{
                    severity: "attention",
                    kind: "auth",
                    tag: "AUTH",
                    title: "判读需要登录",
                    detail: "登录后这张影像的判读结果会归档到你的账号下。",
                    code: 40100,
                  }}
                  action={{
                    label: "去登录",
                    run: () => navigate("/login?redirect=/diagnosis"),
                  }}
                />
              </div>
            ) : fault ? (
              <div className="dx__fault" data-scope={faultScope}>
                <FaultNote fault={fault} variant={faultScope === "run" ? "block" : "field"} />
              </div>
            ) : null}
          </aside>
        </div>
      </main>

      <DisclaimerBar />
    </div>
  )
}

/* ── 阶段一：上传与预览 ─────────────────────────────── */

function UploadPanel(props: {
  file: File | null
  stage: Stage
  onStart: () => void
  onPick: () => void
}) {
  const { file, stage, onStart, onPick } = props
  return (
    <>
      <h2 className="dx__panel-title">{file ? "影像已就绪" : "先选一张影像"}</h2>
      <p className="dx__panel-text">
        {file
          ? "影像只在本机预览，点「开始判读」时才会上传。判读期间不能换图——结论必须对应同一张影像。"
          : `支持彩色眼底照片（JPG / PNG，${UPLOAD_LIMIT_HINT}）。选图后可以在本机先看清再决定是否判读。`}
      </p>

      <div className="dx__actions">
        {file ? (
          <button className="btn" type="button" onClick={onStart} disabled={stage === "running"}>
            开始判读
          </button>
        ) : (
          <button className="btn" type="button" onClick={onPick}>
            选择影像
          </button>
        )}
      </div>

      <section className="dx__range" aria-label="判读范围">
        <h3 className="dx__sub-title">可识别的八类改变</h3>
        <ul className="dx__range-list">
          {CLASSES.map((item) => (
            <li key={item.code}>
              <span className="dx__range-code">{item.code}</span>
              <span>{item.name}</span>
            </li>
          ))}
        </ul>
        <p className="dx__fineprint">
          无法归入八类的改变会标为「其他」并转人工判读。判读结果不构成诊断，需由医生结合临床判断。
        </p>
      </section>
    </>
  )
}

/* ── 阶段二：真实等待 ─────────────────────────────── */

function RunningPanel(props: { elapsed: number; file: File | null }) {
  return (
    <>
      <h2 className="dx__panel-title">正在判读</h2>
      <p className="dx__panel-text">
        影像已上传。模型需要完成质量门与分类，耗时取决于排队情况。
      </p>
      <dl className="dx__facts">
        <div>
          <dt>已等待</dt>
          <dd>{clock(props.elapsed)}</dd>
        </div>
        {props.file ? (
          <div>
            <dt>本次影像</dt>
            <dd>{props.file.name}</dd>
          </div>
        ) : null}
      </dl>
      <p className="dx__fineprint">
        这里没有进度条：后端不返回判读进度，画出百分比就是编的。质量门不通过时，结果会明确写成「拒识」而不是硬给一个类别。
      </p>
    </>
  )
}

/* ── 阶段三：结果摘要 ─────────────────────────────── */

function ResultSummary(props: { result: DiagnosisResult; onReset: () => void }) {
  const { result, onReset } = props
  const outcome = outcomeOf(result)
  const band = confidenceBand(result.confidence ?? result.probability)
  const className = canonicalClassName(result.result) ?? result.result ?? null
  const code = className ? classCode(className) : null
  const recordId = result.id
  // 记录 id 只证明「这条判读落库了」；原图是否留存要看影像地址。
  // 后端在对象存储失败时不写 url（它会吞掉异常继续落库），两者必须分开说。
  const imageArchived = Boolean(result.url)

  return (
    <>
      <div className="dx__outcome" data-outcome={outcome.key} data-risk={outcome.risk}>
        <span className="dx__outcome-label">{outcome.label}</span>
        {/* 拒识与待复核是两个独立维度：算法在拒识时同样会置 requiresReview，
            拒识记录也在人工复核队列里。不能因为拒识就把复核要求藏起来。 */}
        {result.requiresReview ? (
          <span className="dx__outcome-note">已转入人工复核队列，复核完成前不构成诊断</span>
        ) : null}
      </div>

      {result.aiRejected ? (
        <>
          <h2 className="dx__panel-title">模型没有给出分类</h2>
          <p className="dx__panel-text">
            {result.abstainReason || "影像未达到给出结论的条件（例如质量不足或超出判读范围）。"}
          </p>
        </>
      ) : (
        <>
          <h2 className="dx__panel-title">
            {className ?? "未提供分类"}
            {code ? <span className="dx__class-code">{code}</span> : null}
          </h2>
          <dl className="dx__facts">
            <div>
              <dt>模型置信度</dt>
              <dd>
                {confidencePercent(result.confidence ?? result.probability)}
                <span className="dx__band" data-risk={band.risk}>
                  {band.label}
                </span>
              </dd>
            </div>
            <div>
              <dt>模型版本</dt>
              <dd>{result.modelVersion ?? "未提供"}</dd>
            </div>
            {typeof result.qualityScore === "number" ? (
              <div>
                <dt>质量门</dt>
                <dd>{result.qualityScore.toFixed(2)}</dd>
              </div>
            ) : null}
          </dl>
          {result.qualityReasons ? (
            <p className="dx__panel-text">质量门说明：{result.qualityReasons}</p>
          ) : null}
          <p className="dx__fineprint">
            置信度是模型对这一分类的把握程度，不是患病概率，也不等于确诊。最终判断以人工复核结论为准。
          </p>
        </>
      )}

      <div className="dx__actions">
        {recordId ? (
          <Link className="btn" to={`/records/${recordId}`}>
            查看完整报告
          </Link>
        ) : null}
        <button className="btn btn--ghost" type="button" onClick={onReset}>
          换一张影像
        </button>
      </div>

      {recordId ? (
        <p className="dx__fineprint">
          报告编号 IRIS-{recordId} · 原始影像{imageArchived ? "已随记录归档" : "未保存"}
        </p>
      ) : (
        <p className="dx__fineprint">
          这次结果没有返回记录编号，未归档。需要留存请重试，或在记录页确认是否已有这条记录。
        </p>
      )}

      {/* 有记录但没影像：结论可查、原图不可追溯。这与「未归档」是两件事，
          不能合并成一句，也不能用成功态盖过去。 */}
      {recordId && !imageArchived ? (
        <div className="dx__outcome" data-risk="attention">
          <span className="dx__outcome-label">原始影像未保存</span>
          <span className="dx__outcome-note">
            影像存储失败，记录与结论仍可查看，但原图暂不可追溯。需要留存请重新判读或申请人工复核。
          </span>
        </div>
      ) : null}
    </>
  )
}
