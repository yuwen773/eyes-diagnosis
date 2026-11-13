/**
 * 未读计数规则。
 *
 * 只有「新消息」才计数；流式内容增长（同一句话逐 token 变长）不计数，
 * 否则一条 200 token 的回复会显示成「↓ 200 条新消息」。
 */
export function computeUnread(
  prevUnread: number,
  opts: { atBottom: boolean; isNewMessage: boolean; isContentGrowth: boolean },
): number {
  if (opts.atBottom) return 0
  if (opts.isNewMessage) return prevUnread + 1
  return prevUnread
}
