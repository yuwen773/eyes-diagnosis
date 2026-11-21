/**
 * Chat session export — one canonical React implementation.
 *
 * The server returns `BaseResponse<string>`; adding a second attachment
 * endpoint would break `request<string>`. These helpers normalize only the
 * local download filename / MIME type and keep the user-visible session title
 * out of the filename: the title is derived from the first user message and
 * may contain symptoms or other private text.
 */

export type ExportFormat = "markdown" | "json"

export type ExportDescriptor = {
  filename: string
  mime: string
  extension: "md" | "json"
}

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
const RESERVED_FALLBACK = "会话"
const MAX_BASE_LENGTH = 48

/** Keep only a conservative, cross-platform-safe subset of characters. */
export function safeFileName(name: string): string {
  const cleaned = Array.from(name ?? "")
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0x20 && code !== 0x7f && !/[\\/:*?"<>|]/.test(char)
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, MAX_BASE_LENGTH)
    .trim()
  if (!cleaned || RESERVED.test(cleaned)) return RESERVED_FALLBACK
  return cleaned
}

/**
 * A neutral name: never interpolate the session title, message content, user
 * name or date-derived private text into a file that leaves the browser.
 */
export function exportDescriptor(sessionId: string, format: ExportFormat): ExportDescriptor {
  const extension: ExportDescriptor["extension"] = format === "json" ? "json" : "md"
  const id = safeFileName(sessionId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)
  const suffix = id ? `-${id}` : ""
  return {
    filename: `会话导出${suffix}.${extension}`,
    mime: format === "json"
      ? "application/json;charset=utf-8"
      : "text/markdown;charset=utf-8",
    extension,
  }
}

/** Returns an error message on failure; undefined means the download was started. */
export function downloadText(content: string, descriptor: ExportDescriptor): string | undefined {
  if (typeof content !== "string") return "导出内容无效"
  try {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return "当前浏览器不支持文件下载"
    }
    const blob = new Blob([content], { type: descriptor.mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = descriptor.filename
    anchor.style.display = "none"
    document.body.appendChild(anchor)
    try {
      anchor.click()
    } finally {
      document.body.removeChild(anchor)
      // Chrome silently fails when the URL is revoked before the click is handled.
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    return undefined
  } catch {
    return "下载失败，请重试"
  }
}
