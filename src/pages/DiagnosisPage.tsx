import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ApiError, runDiagnosis, type DiagnosisResult } from "@/lib/api"
import { useSession } from "@/lib/session"
import { RecordSheet } from "@/components/RecordSheet"
import { SectionHead } from "@/components/SectionHead"
import { SiteFooter } from "@/components/SiteFooter"
import { SiteHeader } from "@/components/SiteHeader"

type Stage = "empty" | "ready" | "running" | "done" | "error"

type LogLine = { key: string; text: string; note?: string; state: "done" | "run" | "fail" }

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPTED = ["image/jpeg", "image/png"]

function validate(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return "只接受 JPG 与 PNG 格式的影像"
  if (file.size > MAX_BYTES) return "影像超过 5 MB，请压缩后重试"
  return null
}

export function DiagnosisPage() {
  const { status } = useSession()

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>("empty")
  const [error, setError] = useState("")
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [dragging, setDragging] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const startedAt = useRef<number>(0)

  // 本地预览用 object URL，换了文件就把旧的释放掉。
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // 计时器：只显示真实等待时长，不做进度假动作。
  useEffect(() => {
    if (stage !== "running") return
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000)
    }, 100)
    return () => window.clearInterval(timer)
  }, [stage])

  function accept(next: File | null) {
    if (!next) return
    const problem = validate(next)
    if (problem) {
      setError(problem)
      return
    }
    setError("")
    setResult(null)
    setFile(next)
    setStage("ready")
  }

  async function diagnose() {
    if (!file) return
    setStage("running")
    setError("")
    setResult(null)
    setElapsed(0)
    startedAt.current = Date.now()

    try {
      const value = await runDiagnosis(file)
      const floor = 900 - (Date.now() - startedAt.current)
      if (floor > 0) await new Promise((resolve) => window.setTimeout(resolve, floor))
      setResult(value)
      setStage("done")
    } catch (cause) {
      setStage("error")
      setErrorCode(cause instanceof ApiError ? cause.code : null)
      setError(cause instanceof ApiError ? cause.message : "判读请求失败，请稍后重试")
    }
  }

  function reset() {
    setFile(null)
    setResult(null)
    setStage("empty")
    setError("")
    if (inputRef.current) inputRef.current.value = ""
  }

  const needsLogin = status === "anon" && errorCode === 40100

  if (result) {
    return (
      <div className="is-field">
        <SiteHeader />

        <div className="sheet-shell">
          <div className="wrap">
            <div className="no-print" style={{ marginBottom: 20 }}>
              <SectionHead code="判读" kicker="Reading record" en="IRIS · B4" />
            </div>

            <RecordSheet
              result={result}
              recordId={result.id ? `IRIS-${result.id}` : undefined}
              actions={
                <>
                  <button className="btn btn--ghost btn--sm" type="button" onClick={() => window.print()}>
                    打印记录
                  </button>
                  <button className="btn btn--ghost btn--sm" type="button" onClick={reset}>
                    换一张影像
                  </button>
                  <Link className="link" to="/" style={{ marginLeft: "auto" }}>
                    返回首页
                  </Link>
                </>
              }
            />
          </div>
        </div>

        <div className="wrap">
          <SiteFooter />
        </div>
      </div>
    )
  }

  const log: LogLine[] = []
  if (file) {
    log.push({ key: "check", text: "校验影像格式与体积", note: "PASS", state: "done" })
  }
  if (stage === "running" || stage === "done") {
    log.push({ key: "send", text: "发送判读请求", note: "POST /diagnosis/diagnosis", state: "done" })
    log.push({
      key: "wait",
      text: "等待模型响应",
      note: `${elapsed.toFixed(1)} s`,
      state: stage === "running" ? "run" : "done",
    })
  }
  if (stage === "error") {
    log.push({ key: "fail", text: error || "请求失败", note: "FAIL", state: "fail" })
  }

  return (
    <div className="is-field">
      <SiteHeader />

      <main className="wrap">
        <div className="diag">
          <section className="diag__left">
            <p className="overline">Upload · 影像</p>
            <h1 className="h2 diag__title" style={{ marginTop: 12, marginBottom: 10 }}>
              上传一张彩色眼底照片
            </h1>
            <p className="small" style={{ marginBottom: 24, maxWidth: "34em" }}>
              单眼、清晰、光照均匀。系统会先过质量门，不合格的影像不会给出结论。
            </p>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="sr-only"
              onChange={(event) => accept(event.target.files?.[0] ?? null)}
            />

            <button
              type="button"
              className="slot"
              data-busy={stage === "running"}
              data-filled={preview ? "true" : "false"}
              onClick={() => {
                if (stage !== "running") inputRef.current?.click()
              }}
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
              style={dragging ? { borderColor: "var(--fg)" } : undefined}
              aria-label="选择或拖入眼底照片"
            >
              <span className="slot__ticks" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>

              {preview ? (
                <>
                  <img className="slot__img" src={preview} alt="待判读的眼底照片" />
                  <span className="slot__crosshair" aria-hidden="true" />
                </>
              ) : (
                <span className="slot__inner">
                  <span className="slot__prompt">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="square"
                      />
                      <path d="M4 15v4.5h16V15" stroke="currentColor" strokeWidth="1.25" />
                    </svg>
                    <span className="slot__title">点击或拖入影像</span>
                    <span className="slot__hint">JPG · PNG · ≤ 5 MB</span>
                  </span>
                </span>
              )}
            </button>

            <div className="slot__actions">
              {stage === "ready" || stage === "error" ? (
                <button className="btn" type="button" onClick={diagnose}>
                  开始判读
                  <span className="btn__key">B4</span>
                </button>
              ) : null}
              {stage === "running" ? (
                <button className="btn" type="button" disabled>
                  正在判读…
                </button>
              ) : null}
              {file ? (
                <button className="btn btn--ghost" type="button" onClick={reset} disabled={stage === "running"}>
                  移除
                </button>
              ) : null}
            </div>

            {needsLogin ? (
              <p className="form__error" style={{ marginTop: 16 }} role="alert">
                判读需要登录。<Link to="/login?redirect=/diagnosis" style={{ textDecoration: "underline" }}>去登录</Link>
              </p>
            ) : error && stage === "error" ? (
              <p className="form__error" style={{ marginTop: 16 }} role="alert">
                {error}
              </p>
            ) : error ? (
              <p className="field__error" style={{ marginTop: 12 }} role="alert">
                {error}
              </p>
            ) : null}
          </section>

          <section className="diag__right">
            <div className="sec-head" style={{ marginBottom: 22 }}>
              <span className="sec-head__code">判读</span>
              <span className="sec-head__kicker">Readout</span>
              <span className="sec-head__rule" />
              <span className="sec-head__en">
                {stage === "empty" ? "IDLE" : stage === "running" ? "RUNNING" : stage.toUpperCase()}
              </span>
            </div>

            <ol className="journal" aria-live="polite">
              {log.length === 0 ? (
                <li data-state="idle">
                  <span>·</span>
                  <span>等待影像</span>
                  <span>—</span>
                </li>
              ) : (
                log.map((line) => (
                  <li key={line.key} data-state={line.state}>
                    <span>{line.state === "run" ? "›" : line.state === "fail" ? "×" : "✓"}</span>
                    <span>{line.text}</span>
                    <span>{line.note}</span>
                  </li>
                ))
              )}
            </ol>

            <div style={{ marginTop: 34, maxWidth: "40em" }}>
              <p className="overline" style={{ marginBottom: 14 }}>
                判读完成后你会看到
              </p>
              <ul className="expect">
                <li>
                  <span>01</span>
                  <span>主诊断与八类完整概率，不做取舍</span>
                </li>
                <li>
                  <span>02</span>
                  <span>质量门读数、严重程度与复核状态</span>
                </li>
                <li>
                  <span>03</span>
                  <span>模型版本与权重 SHA-256 指纹</span>
                </li>
                <li>
                  <span>04</span>
                  <span>明确的免责说明与转诊建议</span>
                </li>
              </ul>
            </div>

            <div className="diag__foot" aria-hidden="true">
              <span>{stage === "empty" ? "READY" : stage.toUpperCase()}</span>
              <span>MODEL · EFFICIENTNET-B4</span>
              <span>GATE · ON</span>
              <span>SESSION · {status.toUpperCase()}</span>
            </div>
          </section>
        </div>
      </main>

      <div className="wrap">
        <SiteFooter />
      </div>
    </div>
  )
}
