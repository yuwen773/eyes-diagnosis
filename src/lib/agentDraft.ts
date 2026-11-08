/**
 * 输入草稿的存取。
 *
 * 未登录时发消息会被送去登录页，来回一趟不能把用户打的字弄丢——
 * 草稿落在 sessionStorage，登录回来还在。
 */
const DRAFT_KEY = "agent_draft"

export function saveDraft(text: string) {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text)
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // 隐私模式下 sessionStorage 可能不可用——草稿丢了不影响主流程
  }
}

export function loadDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) || ""
  } catch {
    return ""
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // 同上
  }
}
