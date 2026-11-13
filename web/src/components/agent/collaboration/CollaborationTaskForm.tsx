import { useEffect, useRef, useState } from "react"
import { createAgentSession } from "@/lib/api"
import {
  collaborationApi,
  CollaborationHttpError,
} from "@/lib/collaborationApi"
import { diagnosisTaskApi, type ImageTask } from "@/lib/diagnosisTaskApi"
import type { CollaborationSnapshot } from "@/lib/collaborationProtocol"

const key = () =>
  `ui-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, 2000)
    signal.addEventListener("abort", done, { once: true })
    if (signal.aborted) done()
  })
}
export function CollaborationTaskForm({
  threadId,
  ready,
  onAccepted,
}: {
  threadId: string
  ready: boolean
  onAccepted: (snapshot: CollaborationSnapshot, file: File | null) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [taskId, setTaskId] = useState("")
  const [tasks, setTasks] = useState<ImageTask[]>([])
  const [phase, setPhase] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const request = useRef<AbortController | null>(null)
  const uploadKey = useRef("")
  useEffect(() => () => request.current?.abort(), [])

  function begin() {
    if (pending.current) return null
    pending.current = true
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    return controller.signal
  }
  function finish(signal: AbortSignal) {
    pending.current = false
    if (!signal.aborted) setBusy(false)
  }
  async function loadTasks() {
    const signal = begin()
    if (!signal) return
    try {
      const list = await diagnosisTaskApi.list(signal)
      if (!signal.aborted) setTasks(list)
    } catch {
      if (!signal.aborted) setError("任务列表暂不可用，请稍后重试。")
    } finally {
      finish(signal)
    }
  }
  async function submit() {
    if (!ready || (!file && !taskId)) return
    const signal = begin()
    if (!signal) return
    try {
      const session = await createAgentSession(threadId, signal)
      if (signal.aborted) return
      if (session.sessionId !== threadId) throw new Error("SCOPE_MISMATCH")
      let id = taskId
      if (!id && file) {
        setPhase("正在提交影像")
        uploadKey.current ||= key()
        const task = await diagnosisTaskApi.create(
          file,
          uploadKey.current,
          signal
        )
        if (signal.aborted) return
        id = task.taskId
        setTaskId(id)
      }
      setPhase("影像已受理，正在等待推理。此时尚未启动协作角色。")
      // Bounded polling; a retry resumes this task with the same admission key.
      for (let attempt = 0; attempt < 60 && !signal.aborted; attempt++) {
        const task = await diagnosisTaskApi.get(id, signal)
        if (signal.aborted) return
        if (task.taskId !== id) throw new Error("SCOPE_MISMATCH")
        if (task.status !== "PROCESSING") {
          try {
            const snapshot = await collaborationApi.create(
              {
                taskId: id,
                threadId,
                idempotencyKey: `collab-${id}-${threadId}`,
              },
              signal
            )
            if (signal.aborted) return
            if (snapshot.threadId !== threadId || snapshot.taskId !== id)
              throw new Error("SCOPE_MISMATCH")
            setPhase("")
            onAccepted(snapshot, file)
            return
          } catch (failure) {
            if (!(
              failure instanceof CollaborationHttpError &&
              failure.status === 409 &&
              failure.message === "INFERENCE_NOT_READY"
            ))
              throw failure
            if (task.status === "RESTRICTED") {
              setPhase(
                "本次影像处理受限，尚无可用的可信推理。协作角色未启动，请联系医生或重新提交合格影像。"
              )
              return
            }
          }
        }
        await pause(signal)
      }
      if (!signal.aborted)
        setPhase("影像仍在处理，稍后点击继续等待；不会重复提交影像。")
    } catch (failure) {
      if (!signal.aborted) {
        setPhase("")
        const reason =
          failure instanceof CollaborationHttpError ? failure.message : ""
        setError(
          reason === "TASK_ALREADY_BOUND"
            ? "该影像已绑定协作，请打开原协作链接查看。"
            : reason === "LEGACY_RUN_NOT_ADOPTABLE"
              ? "该任务使用先前的处理流程，无法转换为实时协作。"
              : failure instanceof CollaborationHttpError &&
                  [401, 403].includes(failure.status)
                ? "访问未获授权，请核对登录身份与会话。"
                : "本次受理未确认。内容已保留，可重试；重试沿用同一请求标识。"
        )
      }
    } finally {
      finish(signal)
    }
  }
  return (
    <section className="collab-submit" aria-labelledby="collab-submit-title">
      <div>
        <span className="collab-eyebrow">IMAGE · COLLABORATION</span>
        <h3 id="collab-submit-title">提交眼底影像</h3>
        <p>提交后才开始处理。协作产物需医生复核，不构成诊断结论。</p>
        {!ready && (
          <p role="status">请先登录，再提交影像。</p>
        )}
      </div>
      <label className="collab-file">
        选择一张 JPEG / PNG，最大 10 MB
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={busy || !ready}
          onChange={(event) => {
            const next = event.target.files?.[0]
            if (!next) return
            if (
              !/\.(jpe?g|png)$/i.test(next.name) ||
              next.size === 0 ||
              next.size > 10 * 1024 * 1024 ||
              (next.type && !["image/jpeg", "image/png"].includes(next.type))
            ) {
              setError("请选择不超过 10 MB 的有效 JPEG 或 PNG 影像。")
              event.target.value = ""
              return
            }
            setFile(next)
            setTaskId("")
            uploadKey.current = ""
            setError("")
            setPhase("")
          }}
        />
      </label>
      <div className="collab-task-picker">
        <button
          type="button"
          className="collab-button"
          disabled={busy || !ready}
          onClick={() => void loadTasks()}
        >
          选择本人已有影像任务
        </button>
        {tasks.length > 0 && (
          <label>
            最近任务
            <select
              aria-label="本人影像任务"
              value={taskId}
              disabled={busy}
              onChange={(e) => {
                setTaskId(e.target.value)
                setFile(null)
                setError("")
                setPhase("")
              }}
            >
              <option value="">请选择任务</option>
              {tasks.map((task, index) => (
                <option key={task.taskId} value={task.taskId}>
                  任务 {index + 1} ·{" "}
                  {task.status === "PROCESSING"
                    ? "推理中"
                    : task.status === "RESTRICTED"
                      ? "受限"
                      : "推理已就绪"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        className="collab-button collab-button--primary"
        disabled={busy || !ready || (!file && !taskId)}
        onClick={() => void submit()}
      >
        {busy ? "正在受理…" : taskId ? "继续受理协作" : "提交影像并开始协作"}
      </button>
      <p role="status" aria-live="polite">
        {phase}
      </p>
      {error && (
        <p className="collab-fault" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
