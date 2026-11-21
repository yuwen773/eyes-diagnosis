import "@/styles/collaboration.css"
import "@/styles/roundtable.css"
import { useEffect, useState } from "react"
import { ArrowLeft, ArrowUpRight, Plus, ShieldCheck } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { CollaborationTaskForm } from "@/components/agent/collaboration/CollaborationTaskForm"
import { CollaborationWorkspace } from "@/components/agent/collaboration/CollaborationWorkspace"
import { CollaborationRoles } from "@/components/agent/collaboration/CollaborationRoles"
import {
  CollaborationRunContext,
  useCollaborationRun,
} from "@/hooks/useCollaborationRun"
import { collaborationApi } from "@/lib/collaborationApi"
import type { CollaborationSnapshot } from "@/lib/collaborationProtocol"
import { newId } from "@/lib/id"
import { useSession } from "@/lib/session"

/** 独立协作会话，不读写普通聊天历史或其 localStorage 选择。 */
function CollaborationSession({ identity }: { identity: string | null }) {
  const enabled = import.meta.env.VITE_COLLABORATION_ENABLED === "true"
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [draftThread, setDraftThread] = useState(newId)
  const [admission, setAdmission] = useState<CollaborationSnapshot>()
  const [linkError, setLinkError] = useState<{
    run: string
    message: string
  } | null>(null)
  const runId = params.get("runId") || null
  const entryThread = params.get("threadId") || ""
  const threadId = runId ? entryThread : draftThread
  const view = useCollaborationRun({
    identityKey: identity,
    threadId,
    runId,
    enabled,
    initialSnapshot: admission?.runId === runId ? admission : undefined,
  })

  // 单 runId 深链先经服务端鉴权获取所属会话，再交给同一个协作 hook。
  useEffect(() => {
    if (!enabled || !identity || !runId || entryThread) return
    const controller = new AbortController()
    void collaborationApi
      .snapshot(runId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return
        if (snapshot.runId !== runId) throw new Error("SCOPE_MISMATCH")
        setParams({ runId, threadId: snapshot.threadId }, { replace: true })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLinkError({
            run: runId,
            message: "协作链接未获授权或已失效，请核对登录身份后重新打开。",
          })
      })
    return () => controller.abort()
  }, [enabled, identity, runId, entryThread, setParams])

  function newTask() {
    setAdmission(undefined)
    setDraftThread(newId())
    setLinkError(null)
    setParams({}, { replace: true })
  }
  function accepted(snapshot: CollaborationSnapshot) {
    setAdmission(snapshot)
    setLinkError(null)
    setParams(
      { runId: snapshot.runId, threadId: snapshot.threadId },
      { replace: true }
    )
  }

  return (
    <>
      <section
        className="collab-page-heading"
        aria-labelledby="collaboration-title"
      >
        <div>
          <span className="collab-eyebrow" lang="en">
            Agent Roundtable <span className="num">3.0</span>
          </span>
          <h1 id="collaboration-title">影像协作</h1>
        </div>
        <div className="collab-page-actions">
          {(!enabled || !identity || !runId) && (
            <Link to="/agent" className="collab-button">
              <ArrowLeft size={15} aria-hidden="true" />
              普通 AI 问答
            </Link>
          )}
          {enabled && identity && runId && (
            <button type="button" className="collab-button" onClick={newTask}>
              <Plus size={15} aria-hidden="true" />
              新建协作
            </button>
          )}
        </div>
      </section>
      {!enabled ? (
        <section className="collab-gate" role="status">
          <ShieldCheck size={24} aria-hidden="true" />
          <h2>协作暂未开放</h2>
          <p>本入口遵循现有功能开关。普通 AI 问答与历史会话可继续使用。</p>
          <Link to="/agent" className="collab-button">
            返回普通问答
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </section>
      ) : !identity ? (
        <section className="collab-gate">
          <ShieldCheck size={24} aria-hidden="true" />
          <h2>登录后查看本人协作任务</h2>
          <p>影像、协作记录与复核材料始终按服务端授权读取。</p>
          <Link
            className="collab-button collab-button--primary"
            to={`/login?redirect=${encodeURIComponent(`/agent/collaboration${params.size ? `?${params}` : ""}`)}`}
          >
            前往登录
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </section>
      ) : runId ? (
        linkError?.run === runId && !entryThread ? (
          <p className="collab-fault collab-gate" role="alert">
            {linkError.message}
          </p>
        ) : (
          <CollaborationRunContext.Provider value={view}>
            <CollaborationWorkspace
              key={runId}
              onClose={() => navigate("/agent")}
            />
          </CollaborationRunContext.Provider>
        )
      ) : (
        <div className="collab-launch">
          <CollaborationTaskForm
            key={draftThread}
            threadId={draftThread}
            ready
            onAccepted={accepted}
          />
          <aside className="collab-launch-guide" aria-label="协作流程说明">
            <CollaborationRoles />
            <div className="collab-boundary">
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                协作完成 ≠
                医生批准。未获批准的临床草稿不会向患者展示，保存还需要患者单独授权。
              </p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

export function CollaborationPage() {
  const { status, user, scope } = useSession()
  const identity = status === "authed" ? (user?.id ?? scope) : null
  // 身份/角色改变时同步卸载整个受保护子树；旧请求、Blob 与表单不能跨账号复用。
  const identityKey = `${status}:${identity ?? "anonymous"}:${user?.userRole ?? ""}`
  return (
    <div className="is-field is-brand-page collaboration-page">
      <ProductHeader scene="intelligence" />
      <main className="collab-page-main">
        {status === "loading" ? (
          <p className="collab-gate" role="status">
            正在核对登录状态…
          </p>
        ) : (
          <CollaborationSession key={identityKey} identity={identity} />
        )}
      </main>
    </div>
  )
}
