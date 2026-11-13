import { useEffect, useRef, useState } from "react"
import {
  reviewApi,
  type Authorization,
  type PatientView,
  type Source,
} from "@/lib/reviewApi"
import {
  ClinicalClaims,
  ClinicalExplanation,
  ClinicalSource,
} from "./ClinicalContent"

/** Mount only for the owner and approved review; every read/save is revalidated by the server. */
export function PatientResultPanel({ taskId }: { taskId: string }) {
  const [view, setView] = useState<PatientView | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [offer, setOffer] = useState<Authorization | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const current = useRef<AbortController | null>(null)
  const pending = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    current.current = controller
    void reviewApi
      .patient(taskId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && next.taskId === taskId) setView(next)
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("说明暂不可读取，请重新核对权限与来源。")
      })
    return () => current.current?.abort()
  }, [taskId])
  useEffect(() => {
    const clear = () => {
      current.current?.abort()
      setView(null)
      setSource(null)
      setOffer(null)
      setConsent(false)
      setBusy(false)
      pending.current = false
    }
    window.addEventListener("blur", clear)
    return () => window.removeEventListener("blur", clear)
  }, [])

  async function action(
    kind: "refresh" | "offer" | "save" | "source",
    index?: number
  ) {
    if (pending.current) return
    pending.current = true
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    const selected = offer
    setBusy(true)
    setError("")
    setSource(null)
    setOffer(null)
    setConsent(false)
    // Protected content is hidden while a fresh gate or mutation is outstanding.
    setView(null)
    try {
      if (kind === "save" && selected && consent) {
        const result = await reviewApi.save(selected, controller.signal)
        if (result.taskId !== taskId) throw new Error("SCOPE_MISMATCH")
        if (!controller.signal.aborted) setOffer(result)
      } else if (kind === "offer") {
        const result = await reviewApi.offer(taskId, controller.signal)
        if (result.taskId !== taskId) throw new Error("SCOPE_MISMATCH")
        if (!controller.signal.aborted) setOffer(result)
      } else {
        const result = await reviewApi.patient(taskId, controller.signal)
        if (result.taskId !== taskId) throw new Error("SCOPE_MISMATCH")
        if (kind === "source" && result.result && index !== undefined) {
          const citation = await reviewApi.source(
            taskId,
            index,
            controller.signal
          )
          if (!controller.signal.aborted) setSource(citation)
        }
        if (!controller.signal.aborted) setView(result)
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          kind === "save"
            ? "保存尚未确认。请查询回执确认结果，重新查看内容后再决定；不会自动重复批准。"
            : "内容或来源暂不可用，旧内容已清除。请重新核对状态。"
        )
    } finally {
      if (current.current === controller) {
        pending.current = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }
  return (
    <section className="clinical-panel" aria-label="本人获准说明与保存">
      <span className="collab-eyebrow">REVIEWED INFORMATION</span>
      <h3>经复核的辅助说明</h3>
      <p>医生复核、查看许可与保存授权分别验证。模型预测并非确诊。</p>
      <div className="clinical-actions">
        <button
          type="button"
          className="collab-button"
          disabled={busy}
          onClick={() => void action("refresh")}
        >
          重新核对并查看说明
        </button>
        <button
          type="button"
          className="collab-button"
          disabled={busy}
          onClick={() => void action("offer")}
        >
          查看拟保存内容或查询回执
        </button>
      </div>
      {busy && <p role="status">正在核对冻结版本与来源…</p>}
      {error && (
        <p className="collab-fault" role="alert">
          {error}
        </p>
      )}
      {view?.result && (
        <>
          <p className="clinical-notice">{view.result.disclaimer}</p>
          <p>{view.result.calibrationNotice}</p>
          <ClinicalClaims
            claims={view.result.claims}
            onSource={(index) => void action("source", index)}
          />
        </>
      )}
      {view && !view.result && (
        <p role="status">
          {view.status === "RESTRICTED"
            ? "当前内容未获准展示，来源或任务可能已失效。"
            : "请等待医生复核与发布检查。"}
        </p>
      )}
      {source && <ClinicalSource source={source} />}
      {offer?.status === "OFFERED" && offer.content && (
        <section className="clinical-consent" aria-label="拟保存内容">
          <h4>请阅读本次拟保存的完整内容</h4>
          <p>
            模型预测{" "}
            <span className="num">{offer.content.modelPrediction}</span> ·
            原始概率{" "}
            <span className="num">
              {offer.content.modelProbability.toFixed(1)}%
            </span>
          </p>
          <ClinicalExplanation explanation={offer.content.explanation} />
          <p className="num">
            有效至 {new Date(offer.expiresAt).toLocaleString("zh-CN")}
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            我已阅读上述拟保存内容，同意保存本次辅助说明。
          </label>
          <button
            type="button"
            className="collab-button collab-button--primary"
            disabled={busy || !consent}
            onClick={() => void action("save")}
          >
            同意并保存
          </button>
        </section>
      )}
      {offer?.status === "RESTRICTED" && (
        <p role="status">拟保存内容已受限，禁止保存。</p>
      )}
      {offer?.receipt && (
        <section aria-label="保存回执">
          <h4>已保存，仅回放历史回执</h4>
          <p className="num">回执 {offer.receipt.receiptId}</p>
          <p className="num">记录 {offer.receipt.diagnosisId}</p>
          <p>查询或刷新不会创建第二条记录，也不代表失效来源重新获准发布。</p>
        </section>
      )}
    </section>
  )
}
