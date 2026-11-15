import { BookOpenCheck, Eye, FileText, ShieldCheck } from "lucide-react"
import {
  isTerminal,
  roles,
  type CollaborationSnapshot,
} from "@/lib/collaborationProtocol"
import { roleDescriptions, roleNames } from "./collaborationLabels"

const icons = {
  VISION: Eye,
  EVIDENCE: BookOpenCheck,
  EXPLANATION: FileText,
  CRITIC: ShieldCheck,
}

export function CollaborationRoles({
  snapshot,
}: {
  snapshot?: CollaborationSnapshot
}) {
  return (
    <div
      className="collab-roles"
      aria-label={snapshot ? "协作角色状态" : "协作角色职责"}
    >
      {roles.map((role, index) => {
        const state = snapshot?.roles[role] ?? "WAITING"
        const Icon = icons[role]
        return (
          <div
            key={role}
            className="collab-role"
            data-state={snapshot ? state : "IDLE"}
          >
            <div className="collab-role__top">
              <span className="collab-role__icon">
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="collab-role__number num">0{index + 1}</span>
            </div>
            <span className="collab-eyebrow">{role}</span>
            <h3>{roleNames[role]}</h3>
            <span className="collab-role__status">
              {!snapshot
                ? "尚未启动"
                : {
                    RUNNING: "处理中",
                    COMPLETED: "本轮已完成",
                    STOPPED: "已停止",
                    WAITING: isTerminal(snapshot.executionStatus)
                      ? "未执行"
                      : "等待执行",
                  }[state]}
            </span>
            <p>{roleDescriptions[role]}</p>
          </div>
        )
      })}
    </div>
  )
}
