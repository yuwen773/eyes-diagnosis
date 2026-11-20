/**
 * 认证页 redirect 白名单：只接受站内相对路径。
 *
 * 不能只判 startsWith("/")：浏览器会把 `/\evil.com` 里的反斜杠当斜杠，
 * 制表/换行也可能在 URL 解析时被剥掉，两者都能把"看起来是站内"变成外站。
 * 这里只放行以单个 / 开头、其后不跟 / 或 \、且不含控制字符的路径。
 */
export function safeRedirect(value: string | null | undefined, fallback = "/diagnosis"): string {
  if (!value) return fallback
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback
  return value
}
