import type { Fault, FaultSeverity } from "@/lib/faults"

/** 表单层只关心「这次错误能不能靠再提交一次解决」。 */
export type AuthFormTone = FaultSeverity

export type AuthFormMessage = {
  title: string
  detail: string
  tone: AuthFormTone
  retryable: boolean
}

/**
 * 把统一的 Fault 收敛成认证表单里的一句话。
 *
 * 不在这里重新判状态码：severity / kind 已由 lib/faults.ts 判过一遍，
 * 这里只决定表单里展示哪层措辞与是否提供「再试一次」。
 */
export function authFormMessage(fault: Fault, intent: "login" | "register" = "login"): AuthFormMessage {
  if (fault.kind === "validation") {
    return { title: fault.title, detail: fault.detail ?? "", tone: "attention", retryable: false }
  }
  if (fault.kind === "auth") {
    return {
      title: fault.title,
      detail: fault.detail ?? "",
      tone: fault.severity,
      retryable: false,
    }
  }
  if (fault.kind === "client") {
    return {
      title: fault.title || "这次没有提交成功",
      detail: "请核对输入后再试一次。",
      tone: fault.severity,
      retryable: false,
    }
  }
  if (fault.kind === "network" || fault.kind === "server") {
    const detail =
      intent === "register"
        ? "如果账号已经创建成功，可以直接登录；否则检查网络后再试。"
        : fault.detail ?? ""
    return { title: fault.title, detail, tone: "critical", retryable: intent === "login" }
  }
  return {
    title: fault.title || "这次没有提交成功",
    detail: fault.detail ?? "",
    tone: fault.severity,
    retryable: false,
  }
}
