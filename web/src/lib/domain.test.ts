import { describe, expect, it } from "vitest"
import {
  canonicalClassName,
  classCode,
  confidenceBand,
  confidencePercent,
  isUrgentAdvice,
  normalizeConfidence,
  rankClasses,
} from "./domain"

describe("normalizeConfidence", () => {
  it("0–1 的概率原样返回", () => {
    expect(normalizeConfidence(0.78)).toBeCloseTo(0.78)
  })

  it("0–100 的百分数除以 100", () => {
    expect(normalizeConfidence(78)).toBeCloseTo(0.78)
  })

  it("缺省与 NaN 读作 0（没有结论时不要抛）", () => {
    expect(normalizeConfidence(undefined)).toBe(0)
    expect(normalizeConfidence(null)).toBe(0)
    expect(normalizeConfidence(NaN)).toBe(0)
  })

  it("越界值夹紧到 0–1", () => {
    expect(normalizeConfidence(-3)).toBe(0)
    expect(normalizeConfidence(250)).toBe(1)
  })
})

describe("confidencePercent", () => {
  it("两种量纲读同一个数——这是全站唯一的置信度口径", () => {
    expect(confidencePercent(0.78)).toBe("78.0%")
    expect(confidencePercent(78)).toBe("78.0%")
  })

  it("没有结论显示破折号，不显示 0.0%", () => {
    expect(confidencePercent(undefined)).toBe("—")
    expect(confidencePercent(null)).toBe("—")
    expect(confidencePercent(NaN)).toBe("—")
  })

  it("0 是一个结论，不是缺失", () => {
    expect(confidencePercent(0)).toBe("0.0%")
  })
})

describe("confidenceBand", () => {
  it("三档不折叠：0.40 与 0.65 不是同一个标签", () => {
    expect(confidenceBand(0.9).label).toBe("可信")
    expect(confidenceBand(0.65).label).toBe("偏低")
    expect(confidenceBand(0.4).label).toBe("低")
  })

  it("边界值落在较高一档", () => {
    expect(confidenceBand(0.75).label).toBe("可信")
    expect(confidenceBand(0.6).label).toBe("偏低")
  })

  it("百分数量纲也分对档", () => {
    expect(confidenceBand(90).label).toBe("可信")
    expect(confidenceBand(65).label).toBe("偏低")
    expect(confidenceBand(40).label).toBe("低")
  })

  it("档位带风险色，低置信不是「正常」", () => {
    expect(confidenceBand(0.9).risk).toBe("normal")
    expect(confidenceBand(0.65).risk).toBe("attention")
    expect(confidenceBand(0.4).risk).toBe("critical")
  })

  it("缺失读作未评估，不猜", () => {
    expect(confidenceBand(undefined)).toEqual({ label: "未评估", risk: "unknown" })
    expect(confidenceBand(null)).toEqual({ label: "未评估", risk: "unknown" })
    expect(confidenceBand(NaN)).toEqual({ label: "未评估", risk: "unknown" })
  })
})

describe("isUrgentAdvice", () => {
  it("急性表现算急症", () => {
    expect(isUrgentAdvice("如视力骤降请立即就医")).toBe(true)
    expect(isUrgentAdvice("出现飞蚊骤增要尽快就医")).toBe(true)
    expect(isUrgentAdvice("视野缺损请前往急诊")).toBe(true)
  })

  it("泛化建议不算急症——标红一旦泛滥就等于没标", () => {
    expect(isUrgentAdvice("注意用眼休息")).toBe(false)
    expect(isUrgentAdvice("建议定期复查")).toBe(false)
    expect(isUrgentAdvice("控制血糖与血压")).toBe(false)
    expect(isUrgentAdvice("视力下降")).toBe(false)
  })
})

describe("canonicalClassName", () => {
  it("算法侧的英文标签归到记录纸上的规范名", () => {
    expect(canonicalClassName("diabetes")).toBe("糖尿病视网膜病变")
    expect(canonicalClassName("hypertension")).toBe("高血压性视网膜病变")
    expect(canonicalClassName("myopia")).toBe("病理性近视")
    expect(canonicalClassName("glaucoma")).toBe("青光眼")
  })

  it("后端枚举的中文短名也归到同一类", () => {
    expect(canonicalClassName("糖尿病")).toBe("糖尿病视网膜病变")
    expect(canonicalClassName("近视")).toBe("病理性近视")
  })

  it("规范名原样返回", () => {
    expect(canonicalClassName("白内障")).toBe("白内障")
    expect(canonicalClassName("正常")).toBe("正常")
  })

  it("认不出的写法不猜——返回 null，由调用方按未知处理", () => {
    expect(canonicalClassName("视网膜脱离")).toBeNull()
    expect(canonicalClassName("")).toBeNull()
    expect(canonicalClassName(undefined)).toBeNull()
  })
})

describe("classCode", () => {
  it("英文标签也能给出短码", () => {
    expect(classCode("diabetes")).toBe("DR")
    expect(classCode("glaucoma")).toBe("GLA")
    expect(classCode("normal")).toBe("N")
  })

  it("后端短名也能给出短码", () => {
    expect(classCode("糖尿病")).toBe("DR")
  })

  it("认不出的类别读作破折号，不给错短码", () => {
    expect(classCode("视网膜脱离")).toBe("—")
    expect(classCode(undefined)).toBe("—")
  })
})

describe("rankClasses", () => {
  it("真实响应形状：主诊断中文短名 + 英文候选，归一后不重复、不出英文行", () => {
    const rows = rankClasses({
      result: "糖尿病",
      probability: 91.2,
      confidence: 91.2,
      otherDisease: [
        { name: "diabetes", probability: 91.2 },
        { name: "glaucoma", probability: 5.1 },
        { name: "normal", probability: 2.3 },
      ],
    })
    expect(rows.map((r) => r.name)).toEqual([
      "糖尿病视网膜病变",
      "青光眼",
      "正常",
    ])
    expect(rows.map((r) => r.code)).toEqual(["DR", "GLA", "N"])
  })

  it("主诊断与 top-1 指同一类时只列一行", () => {
    const rows = rankClasses({
      result: "糖尿病视网膜病变",
      probability: 91.2,
      otherDisease: [{ name: "diabetes", probability: 91.2 }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("糖尿病视网膜病变")
  })

  it("按概率降序，top 标记落在最高的那一类", () => {
    const rows = rankClasses({
      result: "青光眼",
      probability: 60,
      otherDisease: [{ name: "normal", probability: 30 }],
    })
    expect(rows[0].name).toBe("青光眼")
    expect(rows[0].top).toBe(true)
    expect(rows[1].top).toBe(false)
  })

  it("认不出的候选保留原样，不丢信息", () => {
    const rows = rankClasses({
      result: "视网膜脱离",
      probability: 70,
      otherDisease: [{ name: "unknown_class", probability: 10 }],
    })
    expect(rows.map((r) => r.name)).toEqual(["视网膜脱离", "unknown_class"])
    expect(rows[0].code).toBe("—")
  })

  it("没有结果就没有行", () => {
    expect(rankClasses(undefined)).toEqual([])
    expect(rankClasses({})).toEqual([])
  })
})
