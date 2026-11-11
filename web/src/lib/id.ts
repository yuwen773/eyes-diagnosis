/**
 * 本地 id / 会话 id。
 *
 * <p>`crypto.randomUUID` 只在安全上下文（https / localhost）可用；内网 http 下它是
 * `undefined`。而调用方都在「出错路径」上——故障提示、附件、流消息——这里抛错等于
 * 让报错本身把页面弄崩，所以必须有降级。
 */
export function newId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
