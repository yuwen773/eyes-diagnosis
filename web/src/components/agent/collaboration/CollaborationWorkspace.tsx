import { useContext, useState } from "react"
import { ArrowLeft, Info, ScanEye, X } from "lucide-react"
import { Dialog } from "@/components/ui/dialog"
import { CollaborationRunContext } from "@/hooks/useCollaborationRun"
import { isTerminal } from "@/lib/collaborationProtocol"
import { useMediaQuery } from "@/lib/useMediaQuery"
import {
  CollaborationTimeline,
  type TimelinePosition,
} from "./CollaborationTimeline"
import { CollaborationRoles } from "./CollaborationRoles"
import { EvidenceInspector, type InspectorTab } from "./EvidenceInspector"
import {
  clinicianProjection,
  executionLabel,
  reasons,
  reviewLabels,
} from "./collaborationLabels"

const connectionLabels = {
  disabled: "协作暂未开放",
  idle: "请选择协作任务",
  loading: "正在核对任务权限",
  connecting: "正在连接",
  live: "进度已连接",
  reconnecting: "连接中断，正在恢复",
  closed: "当前状态已同步",
  error: "进度暂不可用",
  forbidden: "当前无权查看此任务",
}

export function CollaborationWorkspace({ onClose }: { onClose: () => void }) {
  const view = useContext(CollaborationRunContext)
  const compact = useMediaQuery("(max-width: 1099px)")
  const [tab, setTab] = useState<InspectorTab>("image")
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [inspected, setInspected] = useState<{ eventId: string } | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{
    eventId: string
  } | null>(null)
  const [position, setPosition] = useState<TimelinePosition>({
    following: true,
    top: 0,
    expanded: false,
  })
  const [readEvidence, setReadEvidence] = useState<string>()
  if (!view) return null
  const { run, connection, cancelling, error, cancel, retry } = view
  const snapshot = run?.snapshot
  const clinician = snapshot && clinicianProjection(snapshot.projectionVersion)
  const events = (run?.events ?? []).filter(
    (event) => clinician || event.visibility === "PATIENT"
  )
  const latestEvidence = events.findLast(
    (event) => event.type === "evidence.verified"
  )?.eventId
  const criticAction = events.findLast(
    (event) =>
      event.actor === "CRITIC" &&
      (event.type === "agent.feedback.requested" ||
        event.type === "agent.started")
  )
  let currentFeedback: string | undefined
  if (
    snapshot?.executionStatus === "RUNNING" &&
    criticAction?.type === "agent.feedback.requested"
  ) {
    const supplement = criticAction.payload.action === "SUPPLEMENT"
    const target = supplement ? "EVIDENCE" : "EXPLANATION"
    const started = events.some(
      (event) =>
        event.actor === target &&
        event.type === "agent.started" &&
        event.sequence > criticAction.sequence
    )
    currentFeedback = `${started ? "正在" : "等待"}${supplement ? "补证" : "修订"}`
  }
  const unreadEvidence = Boolean(
    latestEvidence &&
    latestEvidence !== readEvidence &&
    (tab !== "evidence" || (compact && !drawerOpen))
  )

  function inspect(target: InspectorTab, eventId?: string) {
    setTab(target)
    setInspected(eventId ? { eventId } : null)
    if (
      target === "evidence" ||
      (tab === "evidence" && (!compact || drawerOpen))
    )
      setReadEvidence(latestEvidence)
    if (compact) setDrawerOpen(true)
  }
  function closeInspector() {
    if (tab === "evidence") setReadEvidence(latestEvidence)
    setDrawerOpen(false)
    setInspected(null)
  }
  function showHistory(eventId: string) {
    setPosition((current) => ({
      ...current,
      following: false,
      expanded:
        current.expanded ||
        !events.slice(-30).some((event) => event.eventId === eventId),
      oldest: current.oldest ?? events.slice(-30)[0]?.eventId,
      pausedAt: events.at(-1)?.eventId,
    }))
    setHistoryTarget({ eventId })
  }

  return (
    <section className="collab-workspace" aria-label="实时协作工作台">
      <div className="roundtable-runbar">
        <div
          className="collab-summary"
          role="status"
          aria-label="协作与连接状态"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="collab-connection" data-connection={connection}>
            {connectionLabels[connection]}
          </span>
          {snapshot && (
            <>
              <strong>{executionLabel(snapshot)}</strong>
              <span>{reviewLabels[snapshot.reviewStatus]}</span>
            </>
          )}
        </div>
        <button type="button" className="collab-button" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回问答
        </button>
      </div>

      {!snapshot ? (
        <div className="roundtable-panel collab-empty">
          <p>
            {connection === "forbidden"
              ? "任务信息已清除。请核对登录身份与授权后重新打开。"
              : "等待已授权的任务状态。重新连接只恢复进度。"}
          </p>
          {["error", "forbidden"].includes(connection) && (
            <button className="collab-button" type="button" onClick={retry}>
              重新核对状态
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="roundtable-taskline">
            <span>
              任务 <span className="num">{snapshot.taskId}</span>
            </span>
            {compact && (
              <button
                type="button"
                className="collab-button"
                aria-haspopup="dialog"
                onClick={() => inspect(tab)}
              >
                <ScanEye size={16} aria-hidden="true" />
                影像与证据
                {unreadEvidence && (
                  <span
                    className="roundtable-new-dot"
                    aria-label="证据有更新"
                  />
                )}
              </button>
            )}
          </div>
          {snapshot.reason && (
            <p className="collab-fault roundtable-run-fault" role="alert">
              {reasons[snapshot.reason] ??
                "本次未满足处理条件，未形成可发布结果。请联系医生或稍后重试。"}
            </p>
          )}
          <div className="roundtable-columns">
            <CollaborationRoles
              snapshot={snapshot}
              events={events}
              onHistory={showHistory}
            />
            <CollaborationTimeline
              events={events}
              snapshot={snapshot}
              target={historyTarget}
              onTargetApplied={() => setHistoryTarget(null)}
              position={position}
              setPosition={setPosition}
              currentFeedback={currentFeedback}
              onInspect={inspect}
            />
            {!compact && (
              <EvidenceInspector
                snapshot={snapshot}
                events={events}
                tab={tab}
                selected={inspected}
                onTab={inspect}
                unreadEvidence={unreadEvidence}
              />
            )}
          </div>

          {compact && drawerOpen && (
            <Dialog
              open
              title="影像与证据"
              onClose={closeInspector}
              className="roundtable-dialog roundtable-drawer"
              backdropClassName="roundtable-backdrop"
            >
              <div className="roundtable-dialog__head">
                <h2>影像与证据</h2>
                <button
                  type="button"
                  className="collab-button roundtable-icon-button"
                  aria-label="关闭影像与证据"
                  onClick={closeInspector}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <EvidenceInspector
                snapshot={snapshot}
                events={events}
                tab={tab}
                selected={inspected}
                onTab={inspect}
                unreadEvidence={unreadEvidence}
              />
            </Dialog>
          )}

          <footer className="collab-workspace__foot">
            <p>
              <Info size={16} aria-hidden="true" />
              {snapshot.executionStatus === "CANCELLED"
                ? "已取消后续处理；已发生的服务调用可能仍计费。"
                : isTerminal(snapshot.executionStatus)
                  ? "辅助信息仅供参考，临床结论由医生独立判断。"
                  : "离开页面只断开连接。如需停止后续处理，请取消任务。"}
            </p>
            {!isTerminal(snapshot.executionStatus) ? (
              <button
                type="button"
                className="collab-button"
                disabled={
                  cancelling || snapshot.executionStatus === "CANCEL_REQUESTED"
                }
                onClick={() => void cancel()}
              >
                {cancelling || snapshot.executionStatus === "CANCEL_REQUESTED"
                  ? "正在取消…"
                  : "取消协作任务"}
              </button>
            ) : (
              <button type="button" className="collab-button" onClick={retry}>
                刷新复核状态
              </button>
            )}
          </footer>
          {error === "CANCELLATION_UNCONFIRMED" && (
            <p className="collab-fault" role="alert">
              取消未获确认，任务可能仍在处理。请重试取消或核对状态。
            </p>
          )}
        </>
      )}
    </section>
  )
}
