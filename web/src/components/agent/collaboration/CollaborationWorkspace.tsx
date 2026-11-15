import { useContext } from "react"
import { roles, isTerminal } from "@/lib/collaborationProtocol"
import { CollaborationRunContext } from "@/hooks/useCollaborationRun"
import { CollaborationTimeline } from "./CollaborationTimeline"
import { AuthorizedRunImage } from "./AuthorizedRunImage"
import { PatientResultPanel } from "./PatientResultPanel"
import {
  clinicianProjection,
  executionLabel,
  reasons,
  reviewLabels,
  roleDescriptions,
  roleNames,
} from "./collaborationLabels"

export function CollaborationWorkspace({
  imageUrl,
  onClose,
}: {
  imageUrl?: string
  onClose: () => void
}) {
  const view = useContext(CollaborationRunContext)
  if (!view) return null
  const { run, connection, cancelling, error, cancel, retry } = view
  const snapshot = run?.snapshot
  const clinician = snapshot
    ? clinicianProjection(snapshot.projectionVersion)
    : false
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
  return (
    <section className="collab-workspace" aria-label="实时协作工作台">
      <header className="collab-workspace__head">
        <div>
          <span className="collab-eyebrow">IRIS / COLLABORATION</span>
          <h2>协作判读</h2>
        </div>
        <button type="button" className="collab-button" onClick={onClose}>
          返回问答
        </button>
      </header>
      <div
        className="collab-summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="collab-connection">
          {connectionLabels[connection]}
        </span>
        {snapshot && (
          <>
            <strong>{executionLabel(snapshot)}</strong>
            <span>{reviewLabels[snapshot.reviewStatus]}</span>
          </>
        )}
      </div>
      {!snapshot ? (
        <div className="collab-empty">
          <p>
            {connection === "forbidden"
              ? "任务信息已清除。请核对登录身份与授权后重新打开。"
              : "正在等待已授权的任务状态。重新连接只恢复进度，不会重新执行协作。"}
          </p>
          {["error", "forbidden"].includes(connection) && (
            <button className="collab-button" type="button" onClick={retry}>
              重新核对状态
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className="collab-roles"
            aria-label="协作角色状态"
            aria-live="polite"
          >
            {roles.map((role, index) => (
              <div
                key={role}
                className="collab-role"
                data-state={snapshot.roles[role] ?? "WAITING"}
              >
                <span className="collab-eyebrow">
                  0{index + 1} / {role}
                </span>
                <h3>{roleNames[role]}</h3>
                <span className="collab-role__status">
                  {
                    {
                      RUNNING: "处理中",
                      COMPLETED: "本轮已完成",
                      STOPPED: "已停止",
                      WAITING: isTerminal(snapshot.executionStatus)
                        ? "未执行"
                        : "等待执行",
                    }[snapshot.roles[role] ?? "WAITING"]
                  }
                </span>
                <p>{roleDescriptions[role]}</p>
              </div>
            ))}
          </div>
          <div className="collab-workspace__body">
            <div className="collab-workspace__record">
              {snapshot.reason && (
                <p className="collab-fault" role="alert">
                  {reasons[snapshot.reason] ??
                    "本次未满足处理条件，未形成可发布结果。请联系医生或稍后重试。"}
                </p>
              )}
              {snapshot.executionStatus === "SUCCEEDED" && (
                <div className="collab-review-note">
                  <h3>{reviewLabels[snapshot.reviewStatus]}</h3>
                  <p>
                    {snapshot.reviewStatus === "PENDING"
                      ? "协作已结束，辅助草稿尚未获得医生批准。此处不展示未复核的临床内容。"
                      : "复核状态与协作执行分别记录。获准内容仍须通过来源核验与发布许可。"}
                  </p>
                </div>
              )}
              <CollaborationTimeline key={snapshot.runId} run={run!} />
              {snapshot.projectionVersion === "v1:patient" &&
                snapshot.reviewStatus === "APPROVED" && (
                  <PatientResultPanel
                    key={snapshot.taskId}
                    taskId={snapshot.taskId}
                  />
                )}
              {clinician && (
                <p>
                  <a className="collab-text-button" href="/doctor-reviews">
                    进入医生复核
                  </a>
                </p>
              )}
            </div>
            <aside className="collab-evidence" aria-label="影像与证据">
              <details open>
                <summary>影像与证据</summary>
                <span className="collab-eyebrow">SOURCE / SAFETY</span>
                {snapshot.projectionVersion === "v1:patient" ||
                snapshot.projectionVersion.startsWith("v1:doctor:") ? (
                  <AuthorizedRunImage
                    key={snapshot.runId}
                    runId={snapshot.runId}
                    localUrl={imageUrl}
                  />
                ) : (
                  <p className="collab-image-empty">
                    当前身份没有本任务的影像读取许可。
                  </p>
                )}
                <p>
                  影像解读基于已有推理快照及质量限制，不表示 Agent
                  直接判读了原图像素。
                </p>
                <h4>引用与复核</h4>
                <p>
                  {snapshot.reviewStatus === "APPROVED" &&
                  snapshot.projectionVersion === "v1:patient"
                    ? "已获准的说明与逐条依据可在左侧查看。"
                    : "引用正文将在医生复核获准后提供。"}
                </p>
                {clinician && (
                  <p>
                    授权协作元数据可在记录中展开；完整审查材料请使用既有医生复核流程。
                  </p>
                )}
                <h4>医疗使用边界</h4>
                <p>辅助信息不构成诊断结论，不能替代执业医师。</p>
              </details>
            </aside>
          </div>
          <footer className="collab-workspace__foot">
            <p>
              {snapshot.executionStatus === "CANCELLED"
                ? "已取消后续处理；已发生的服务调用可能仍计费。"
                : "离开页面只断开进度连接。需要停止后续处理时，请取消任务。"}
            </p>
            {!isTerminal(snapshot.executionStatus) && (
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
            )}
            {isTerminal(snapshot.executionStatus) && (
              <button type="button" className="collab-button" onClick={retry}>
                刷新复核状态
              </button>
            )}
            {error === "CANCELLATION_UNCONFIRMED" && (
              <p className="collab-fault" role="alert">
                取消未获确认，任务可能仍在处理。请重试取消或核对状态。
              </p>
            )}
          </footer>
        </>
      )}
    </section>
  )
}
