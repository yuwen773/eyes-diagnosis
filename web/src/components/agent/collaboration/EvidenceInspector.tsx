import { useEffect, useRef } from "react"
import { Tabs } from "@base-ui/react/tabs"
import {
  BookOpen,
  ClipboardCheck,
  Image,
  LockKeyhole,
  ScanEye,
} from "lucide-react"
import { Link } from "react-router-dom"
import type {
  CollaborationEvent,
  CollaborationSnapshot,
} from "@/lib/collaborationProtocol"
import { AuthorizedRunImage } from "./AuthorizedRunImage"
import { PatientResultPanel } from "./PatientResultPanel"
import { clinicianProjection, reviewLabels } from "./collaborationLabels"

const tabs = [
  { id: "image", label: "影像", Icon: Image },
  { id: "evidence", label: "证据", Icon: BookOpen },
  { id: "review", label: "复核", Icon: ClipboardCheck },
] as const
export type InspectorTab = (typeof tabs)[number]["id"]

export function EvidenceInspector({
  snapshot,
  events,
  tab,
  selected,
  onTab,
  unreadEvidence,
}: {
  snapshot: CollaborationSnapshot
  events: CollaborationEvent[]
  tab: InspectorTab
  selected: { eventId: string } | null
  onTab: (tab: InspectorTab) => void
  unreadEvidence: boolean
}) {
  const inspected = useRef<HTMLDivElement>(null)
  const patient = snapshot.projectionVersion === "v1:patient"
  const doctor = snapshot.projectionVersion.startsWith("v1:doctor:")
  const clinician = clinicianProjection(snapshot.projectionVersion)
  const evidence = events.filter((event) => event.type === "evidence.verified")
  const feedback = events.filter(
    (event) => event.type === "agent.feedback.requested"
  )
  const rec =
    feedback.find((event) => event.eventId === selected?.eventId) ??
    feedback.at(-1)

  useEffect(() => {
    if (!selected || !inspected.current) return
    inspected.current.scrollIntoView({ block: "nearest" })
    inspected.current.focus({ preventScroll: true })
  }, [selected])

  return (
    <aside
      className="roundtable-panel roundtable-inspector"
      aria-label="影像与证据"
    >
      <div className="roundtable-panel__head roundtable-inspector__heading">
        <h2>
          <ScanEye size={18} aria-hidden="true" />
          影像与证据
        </h2>
      </div>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          const current = tabs.find((item) => item.id === value)
          if (current) onTab(current.id)
        }}
      >
        <Tabs.List className="roundtable-inspector__tabs" aria-label="资料类型">
          {tabs.map(({ id, label, Icon }) => (
            <Tabs.Tab key={id} value={id} className="roundtable-inspector__tab">
              <Icon size={15} aria-hidden="true" />
              {label}
              {id === "evidence" && unreadEvidence && (
                <span className="roundtable-new-dot" aria-label="证据有更新" />
              )}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="image" className="roundtable-inspector__content">
          {patient || doctor ? (
            <AuthorizedRunImage key={snapshot.runId} runId={snapshot.runId} />
          ) : (
            <p className="collab-image-empty">
              当前身份没有本任务的影像读取许可。
            </p>
          )}
          <h3>本次眼底影像</h3>
          <p>影像解读基于已有推理快照及质量限制。</p>
          <button
            className="roundtable-inspector__shortcut"
            type="button"
            onClick={() => onTab("evidence")}
          >
            <BookOpen size={17} aria-hidden="true" />
            <span>
              <strong>引用资料</strong>
              <small>
                {patient && snapshot.reviewStatus === "APPROVED"
                  ? "查看获准的辅助说明与依据"
                  : clinician
                    ? "查看授权范围内的核验记录"
                    : "医生复核批准后可查看"}
              </small>
            </span>
          </button>
          <button
            className="roundtable-inspector__shortcut"
            type="button"
            onClick={() => onTab("review")}
          >
            <ClipboardCheck size={17} aria-hidden="true" />
            <span>
              <strong>医生复核</strong>
              <small>{reviewLabels[snapshot.reviewStatus]}</small>
            </span>
          </button>
        </Tabs.Panel>
        <Tabs.Panel value="evidence" className="roundtable-inspector__content">
          {patient && snapshot.reviewStatus === "APPROVED" ? (
            <PatientResultPanel
              key={snapshot.taskId}
              taskId={snapshot.taskId}
            />
          ) : clinician ? (
            <>
              <h3>证据核验记录</h3>
              {evidence.length ? (
                evidence.map((event) => (
                  <div
                    key={event.eventId}
                    className="roundtable-inspector__record"
                    tabIndex={-1}
                    ref={
                      event.eventId === selected?.eventId
                        ? inspected
                        : undefined
                    }
                  >
                    <strong>Atlas · 受控证据已核验</strong>
                    <p>
                      证据版本{" "}
                      <span className="num">
                        {event.payload.evidenceVersion}
                      </span>
                    </p>
                  </div>
                ))
              ) : (
                <p>当前会话没有可查看的证据核验事件。</p>
              )}
              <p>来源正文与版本详情由既有医生复核流程校验。</p>
            </>
          ) : (
            <div className="roundtable-inspector__record">
              <h3>
                <LockKeyhole size={16} aria-hidden="true" />
                引用资料受限
              </h3>
              <p>医生复核批准后提供可查看的引用资料。</p>
            </div>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="review" className="roundtable-inspector__content">
          <div
            className="roundtable-inspector__record"
            tabIndex={-1}
            ref={tab === "review" ? inspected : undefined}
          >
            <h3>AI 安全复核</h3>
            {rec ? (
              <p>
                Vera{" "}
                {rec.payload.action === "SUPPLEMENT"
                  ? "已请求补充证据"
                  : "已请求修订说明"}
                。
              </p>
            ) : (
              <p>当前会话没有可查看的安全复核反馈。</p>
            )}
          </div>
          <div className="roundtable-inspector__record">
            <h3>医生复核</h3>
            <p>{reviewLabels[snapshot.reviewStatus]}</p>
            {clinician && (
              <Link className="collab-button" to="/doctor-reviews">
                进入医生复核
              </Link>
            )}
          </div>
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  )
}
