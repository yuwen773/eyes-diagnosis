/**
 * 查询键的唯一来源。
 *
 * <p>键里带什么，决定「什么时候重新取数」：统计按窗口天数分键，切换窗口就是
 * 另一个键，旧数据立刻不可见。失效也按前缀来——写操作只失效它真正影响的域。
 */
import type { DiagnosisQuery, NewsQuery, UserQuery, KnowledgeQuery } from "./adminApi"

export const queryKeys = {
  admin: {
    stats: (days: number) => ["admin", "stats", days] as const,
    statsAll: ["admin", "stats"] as const,
    recentDiagnoses: ["admin", "diagnosis", "recent"] as const,
    users: (q: UserQuery) => ["admin", "users", q] as const,
    usersAll: ["admin", "users"] as const,
    news: (q: NewsQuery) => ["admin", "news", q] as const,
    newsAll: ["admin", "news"] as const,
    newsDetail: (id: string) => ["admin", "news", "detail", id] as const,
    diagnosis: (q: DiagnosisQuery) => ["admin", "diagnosis", q] as const,
    diagnosisAll: ["admin", "diagnosis"] as const,
    diagnosisDetail: (id: string) => ["admin", "diagnosis", "detail", id] as const,
    knowledge: (q: KnowledgeQuery) => ["admin", "knowledge", q] as const,
    knowledgeAll: ["admin", "knowledge"] as const,
    knowledgeDetail: (id: string) => ["admin", "knowledge", "detail", id] as const,
  },
  records: {
    mine: (q: { current?: number; pageSize?: number; result?: string }) =>
      ["records", "mine", q] as const,
  },
  profile: {
    user: ["profile", "user"] as const,
  },
  news: {
    list: () => ["news", "list"] as const,
    detail: (id: string) => ["news", "detail", id] as const,
  },
} as const
