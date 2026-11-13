import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { SiteHeader } from "@/components/SiteHeader"
import { DoctorReviewImage } from "@/components/agent/collaboration/DoctorReviewImage"
import {
  ClinicalClaims,
  ClinicalSource,
} from "@/components/agent/collaboration/ClinicalContent"
import { useSession } from "@/lib/session"
import {
  reviewApi,
  type ReviewDetail,
  type ReviewSummary,
} from "@/lib/reviewApi"

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}
function ReviewMessages({ messages }: { messages: unknown[] }) {
  return (
    <details>
      <summary>已冻结的交接与具体异议</summary>
      {messages.map((item, index) => {
        const message = object(item),
          output = object(message.output),
          result = object(output.result),
          handoff = object(output.collaboration)
        const objections = Array.isArray(result.objections)
          ? result.objections
          : []
        const outgoing = Array.isArray(handoff.outgoing) ? handoff.outgoing : []
        return (
          <section key={index} className="clinical-source">
            <p className="num">
              角色 {String(message.role ?? "")} · 顺序{" "}
              {String(message.sequence ?? "")} · {String(message.state ?? "")}
            </p>
            {typeof handoff.to === "string" && <p>收件人 {handoff.to}</p>}
            {typeof handoff.messageId === "string" && (
              <p className="num">消息 {handoff.messageId}</p>
            )}
            {outgoing.map((value, i) => {
              const envelope = object(value)
              return (
                <p key={i} className="num">
                  {String(envelope.senderRole ?? "")} →{" "}
                  {String(envelope.recipientRole ?? "")} ·{" "}
                  {String(envelope.kind ?? "")} · 草稿版本{" "}
                  {String(envelope.draftVersion ?? "—")} · 因果消息{" "}
                  {String(envelope.causationMessageId ?? "—")}
                </p>
              )
            })}
            {objections.map((value, i) => {
              const objection = object(value)
              return (
                <p key={i}>
                  异议定位{" "}
                  <span className="num">{String(objection.target ?? "")}</span>
                  ：{String(objection.reason ?? "")}
                </p>
              )
            })}
          </section>
        )
      })}
    </details>
  )
}
function ReviewWorkspace({ role }: { role: string }) {
  const [list, setList] = useState<ReviewSummary[]>([])
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [selected, setSelected] = useState("")
  const [taskId, setTaskId] = useState("")
  const [doctorId, setDoctorId] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  const pending = useRef(false)
  useEffect(() => {
    const clear = () => {
      request.current?.abort()
      setDetail(null)
      setNote("")
      setSelected("")
      setList([])
      pending.current = false
      setBusy(false)
    }
    window.addEventListener("blur", clear)
    return () => {
      request.current?.abort()
      window.removeEventListener("blur", clear)
    }
  }, [])
  async function perform(
    kind: "list" | "open" | "assign" | "APPROVED" | "REJECTED",
    id = selected
  ) {
    if (pending.current) return
    pending.current = true
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const frozen = detail
    setBusy(true)
    setError("")
    setNotice("")
    setDetail(null)
    setNote("")
    try {
      if (kind === "list") {
        const next = await reviewApi.list(controller.signal)
        if (!controller.signal.aborted) {
          setList(next)
          setSelected("")
        }
      } else if (kind === "assign") {
        const next = await reviewApi.assign(taskId, doctorId, controller.signal)
        if (!controller.signal.aborted)
          setNotice(
            `任务已明确分配，复核标识 ${next.reviewId}。请由该医生登录处理。`
          )
      } else {
        const next =
          kind === "open"
            ? await reviewApi.detail(id, controller.signal)
            : frozen
              ? await reviewApi.decide(frozen, kind, note, controller.signal)
              : null
        if (!next || next.reviewId !== id) throw new Error("SCOPE_MISMATCH")
        if (!controller.signal.aborted) {
          setDetail(next)
          setSelected(id)
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setList([])
        setError(
          "本次操作未获确认，旧材料已清除。请刷新任务列表并重新打开；不要重用先前表单。"
        )
      }
    } finally {
      if (request.current === controller) {
        pending.current = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }
  return (
    <section className="review-workspace" aria-label="医疗复核工作区">
      <header>
        <span className="collab-eyebrow">IRIS / HUMAN REVIEW</span>
        <h1>{role === "admin" ? "分配医生复核" : "医生复核"}</h1>
        <p>
          只处理冻结材料，不调用模型。医生批准、患者查看许可和患者保存授权分别验证。
        </p>
      </header>
      {role === "admin" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void perform("assign")
          }}
        >
          <label>
            待复核任务标识
            <input
              required
              maxLength={36}
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            />
          </label>
          <label>
            医生账号标识
            <input
              required
              inputMode="numeric"
              pattern="[0-9]+"
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="collab-button collab-button--primary"
            disabled={busy}
          >
            明确分配复核
          </button>
          <p>
            管理员不能读取完整材料或代替医生批准。医生不能是患者本人，已有分配不能覆盖。
          </p>
        </form>
      ) : (
        <div className="review-columns">
          <aside>
            <button
              type="button"
              className="collab-button"
              disabled={busy}
              onClick={() => void perform("list")}
            >
              刷新我的复核任务
            </button>
            <ul>
              {list.map((review, index) => (
                <li key={review.reviewId}>
                  <button
                    type="button"
                    className="collab-button"
                    disabled={busy}
                    onClick={() => void perform("open", review.reviewId)}
                  >
                    复核任务 {index + 1}
                    <span className="num">{review.taskId}</span>
                    <span>
                      {review.status === "PENDING" ? "等待决定" : "已有决定"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div>
            {detail ? (
              <section aria-label="冻结复核材料" key={detail.reviewId}>
              <h2>冻结材料</h2>
              <DoctorReviewImage key={detail.reviewId} reviewId={detail.reviewId} />
                <p className="num">任务 {detail.taskId}</p>
                <p className="num">
                  任务版本 {detail.taskVersion} · 草稿版本 {detail.draftVersion}{" "}
                  · 证据版本 {detail.evidenceVersion}
                </p>
                <p className="num">材料摘要 {detail.materialDigest}</p>
                <ClinicalClaims
                  claims={detail.materials.draft.claims}
                  showIds
                />
                <details>
                  <summary>受控来源与精确片段</summary>
                  {detail.materials.evidence.map((source, index) => (
                    <ClinicalSource
                      key={index}
                      source={{ ...source, citationIndex: index }}
                    />
                  ))}
                </details>
                <ReviewMessages messages={detail.materials.agentMessages} />
                {detail.status === "PENDING" ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <label>
                      复核意见
                      <textarea
                        maxLength={2000}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </label>
                    <div className="clinical-actions">
                      <button
                        type="button"
                        className="collab-button collab-button--primary"
                        disabled={busy || !note.trim()}
                        onClick={() => void perform("APPROVED")}
                      >
                        批准当前冻结版本
                      </button>
                      <button
                        type="button"
                        className="collab-button"
                        disabled={busy || !note.trim()}
                        onClick={() => void perform("REJECTED")}
                      >
                        不通过当前冻结版本
                      </button>
                    </div>
                    <p>提交后决定不可覆盖。来源、材料或版本变化将阻止批准。</p>
                  </form>
                ) : (
                  <>
                    <p role="status">
                      {detail.status === "APPROVED"
                        ? "该冻结版本已批准"
                        : detail.status === "REJECTED"
                          ? "该冻结版本未通过"
                          : "冻结材料已失效"}
                    </p>
                    <p>{detail.note}</p>
                  </>
                )}
              </section>
            ) : (
              <p>从本人获分配任务中打开材料。刷新或提交期间不会保留旧表单。</p>
            )}
          </div>
        </div>
      )}
      {busy && <p role="status">正在核对授权与冻结版本…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="collab-fault">
          {error}
        </p>
      )}
    </section>
  )
}
export function DoctorReviewsPage() {
  const { user, status } = useSession()
  const role = user?.userRole ?? ""
  return (
    <div className="is-field">
      <SiteHeader />
      <main className="wrap review-page">
        {import.meta.env.VITE_COLLABORATION_ENABLED === "true" &&
        status === "authed" &&
        ["doctor", "admin"].includes(role) ? (
          <ReviewWorkspace key={`${user?.id}:${role}`} role={role} />
        ) : (
          <section>
            <h1>医生复核</h1>
            <p>仅获授权的医生及分配管理员可进入。请使用对应身份登录。</p>
            <Link to="/login?redirect=%2Fdoctor-reviews">前往登录</Link>
          </section>
        )}
      </main>
    </div>
  )
}
