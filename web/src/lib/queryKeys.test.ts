import { describe, expect, it } from "vitest"

import { PRIVATE_QUERY_ROOTS, queryKeys } from "./queryKeys"

/**
 * 缓存键是「换账号不串数据」的第一层保险：只要个人域的键带着 scope，
 * B 的查询就不可能命中 A 的缓存。这里直接断言键的形状——
 * 光靠「切换时整域清缓存」的集成测试证明不了这一点（整域清空会掩盖漏掉 scope 的键）。
 */
describe("queryKeys · 个人域按账号分键", () => {
  it("同一查询在两个账号下是不同的键", () => {
    const q = { current: 1, pageSize: 10 }

    expect(queryKeys.records.mine("A", q)).not.toEqual(queryKeys.records.mine("B", q))
    expect(queryKeys.records.detail("A", "r1")).not.toEqual(queryKeys.records.detail("B", "r1"))
    expect(queryKeys.profile.user("A")).not.toEqual(queryKeys.profile.user("B"))
  })

  it("scope 落在键里，且整域前缀能覆盖所有账号", () => {
    expect(queryKeys.records.mine("A", {}).slice(0, 3)).toEqual(["records", "mine", "A"])
    expect(queryKeys.records.detail("A", "r1").slice(0, 3)).toEqual(["records", "detail", "A"])
    expect(queryKeys.profile.user("A").slice(0, 3)).toEqual(["profile", "user", "A"])
  })

  it("匿名与登录态是两把不同的钥匙", () => {
    expect(queryKeys.profile.user("anonymous")).not.toEqual(queryKeys.profile.user("A"))
  })

  it("公开资讯不按账号分键（换账号不必重取）", () => {
    expect(queryKeys.news.list()).toEqual(["news", "list"])
    expect(queryKeys.news.detail("n1")).toEqual(["news", "detail", "n1"])
  })

  it("私域根前缀就是身份变化时要作废的那几个域", () => {
    expect([...PRIVATE_QUERY_ROOTS]).toEqual(["records", "profile", "admin"])
    for (const root of PRIVATE_QUERY_ROOTS) {
      expect(queryKeys.news.list()[0]).not.toBe(root)
    }
  })
})
