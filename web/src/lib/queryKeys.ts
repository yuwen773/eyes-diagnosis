/**
 * 查询键的唯一来源。
 *
 * <p>键里带什么，决定「什么时候重新取数」：统计按窗口天数分键，切换窗口就是
 * 另一个键，旧数据立刻不可见。失效也按前缀来——写操作只失效它真正影响的域。
 *
 * <p>个人域（records / profile）的键里必须带当前账号的 <b>scope</b>：同一台
 * 浏览器换账号登录后，B 读的是 B 的键，A 的旧缓存即使还活着也不会被读到。
 * 账号变化时再整域清一次（见 queryClient.resetPrivateQueries），两层保险。
 * 管理域是服务端全局数据，不按账号分键，但同样在身份变化时清空。
 */
import type { DiagnosisQuery, NewsQuery, UserQuery, KnowledgeQuery } from "./adminApi"

/** 跟登录身份走、不能跨账号复用的缓存域。身份一变就整域作废。 */
export const PRIVATE_QUERY_ROOTS = ["records", "profile", "admin"] as const

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
    mine: (
      scope: string,
      q: { current?: number; pageSize?: number; result?: string },
    ) => ["records", "mine", scope, q] as const,
    detail: (scope: string, id: string) => ["records", "detail", scope, id] as const,
  },
  profile: {
    user: (scope: string) => ["profile", "user", scope] as const,
  },
  news: {
    list: () => ["news", "list"] as const,
    detail: (id: string) => ["news", "detail", id] as const,
  },
} as const
