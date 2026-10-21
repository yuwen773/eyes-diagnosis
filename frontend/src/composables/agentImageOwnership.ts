import { deleteAgentImage } from '@/api/agentController'

/**
 * Agent 聊天图片的所有权账本。
 *
 * 同一张图片可能被多个上传批次共用：上传去重按文件指纹合并并发请求，
 * 两个批次会拿到同一个 URL。因此删除必须按引用计数进行——只要还有别的
 * 批次或已发送的消息引用它，就不能删。
 *
 * 三种状态：
 * - `holders`：进行中的批次持有数
 * - `retained`：已被成功发送的消息引用，终态，永不删除
 * - `deleted`：已发起删除，保证同一 URL 只删一次（上传失败路径与
 *   流式失败路径会先后释放同一个 URL）
 */
const holders = new Map<string, number>()
const retained = new Set<string>()
const deleted = new Set<string>()

/** 上传成功：登记一个新的持有者 */
export function acquireAgentImage(url: string): void {
  if (!url) return
  holders.set(url, (holders.get(url) ?? 0) + 1)
}

/** 消息已送达：对象从此归这条消息所有，不再参与清理 */
export function retainAgentImage(url: string): void {
  if (!url) return
  retained.add(url)
  holders.delete(url)
}

/** 释放一次持有；最后一个持有者释放时真正删除对象 */
export function releaseAgentImage(url: string): void {
  if (!url || retained.has(url) || deleted.has(url)) return

  const count = holders.get(url) ?? 0
  if (count > 1) {
    holders.set(url, count - 1)
    return
  }

  holders.delete(url)
  deleted.add(url)
  deleteAgentImage(url).catch(() => {})
}
