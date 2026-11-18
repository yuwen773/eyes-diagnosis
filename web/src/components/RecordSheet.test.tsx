// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { DiagnosisResult } from "@/lib/api"
import { RecordSheet } from "./RecordSheet"

afterEach(() => {
  cleanup()
})

describe("RecordSheet 人工复核结论", () => {
  it("有复核结论时同时展示 AI 初判与人工结论", () => {
    const result = {
      result: "糖尿病视网膜病变",
      humanResult: "复核：中度非增殖期，建议 6 个月复查",
      humanSeverity: "MODERATE",
      humanRecommendations: "控制血糖\n6 个月后复查",
      humanReviewStatus: "REVIEWED",
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText(/AI 判读结果/)).toBeTruthy()
    expect(screen.getByText("复核：中度非增殖期，建议 6 个月复查")).toBeTruthy()
    expect(screen.getByText("人工复核结论 · HUMAN REVIEW")).toBeTruthy()
    expect(screen.getByText("控制血糖")).toBeTruthy()
  })

  it("没有复核结论时不渲染该区块", () => {
    render(<RecordSheet result={{ result: "正常" } as DiagnosisResult} />)

    expect(screen.queryByText(/人工复核结论/)).toBeNull()
  })
})

describe("RecordSheet 人工复核状态的措辞", () => {
  it("AI_ONLY 不写成「待复核」：没进队列就不能替系统承诺在排队", () => {
    render(<RecordSheet result={{ result: "正常", humanReviewStatus: "AI_ONLY" } as DiagnosisResult} />)

    expect(screen.getAllByText("仅 AI 结论 · 未进入复核队列").length).toBeGreaterThan(0)
    expect(screen.queryByText("待复核")).toBeNull()
    expect(screen.queryByText(/医生/)).toBeNull()
  })

  it("AWAITING_REVIEW 才说「已进入复核队列」", () => {
    render(
      <RecordSheet
        result={{ result: "正常", humanReviewStatus: "AWAITING_REVIEW" } as DiagnosisResult}
      />,
    )

    expect(screen.getAllByText("已进入复核队列 · 待复核").length).toBeGreaterThan(0)
  })

  it("REVIEWED 只说「人工复核已记录」，不冒充医生复核", () => {
    render(<RecordSheet result={{ result: "正常", humanReviewStatus: "REVIEWED" } as DiagnosisResult} />)

    expect(screen.getAllByText("人工复核已记录").length).toBeGreaterThan(0)
    expect(screen.queryByText(/医生复核/)).toBeNull()
  })
})

describe("RecordSheet 来源与授权投影", () => {
  it("协作记录把四个事实分开说：来源 / 草稿 / 授权 / 影像", () => {
    const result = {
      result: "正常",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: "COLLABORATION_DRAFT",
        patientTaskId: "task-1",
        draftReviewState: "APPROVED",
        authorizationState: "APPROVED",
        authorizedAt: "2026-11-17 22:10:00",
        authorizationReceipt: "abcdef12…",
        reviewerRole: "doctor",
        imageArchivalState: "ARCHIVED_NOT_PUBLIC",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("来源与授权 · PROVENANCE")).toBeTruthy()
    expect(screen.getByText("协作任务 · 由草稿生成")).toBeTruthy()
    expect(screen.getByText("草稿已审核通过")).toBeTruthy()
    // 授权 ≠ 临床复核：这一行必须带着时间与回执前缀，且不写成「已复核」
    expect(screen.getByText(/患者已授权保存 · 2026-11-17 22:10:00 · 回执 abcdef12…/)).toBeTruthy()
    expect(screen.getByText("医生（doctor）")).toBeTruthy()
    // 协作影像按隐私策略不公开，但确实归档了——不能说「未保存」
    expect(screen.getByText("已归档 · 按隐私策略不公开")).toBeTruthy()
    expect(screen.queryByText("未留存影像")).toBeNull()
  })

  it("直接判读没有授权记录时说明「无需授权」，不显示成缺失", () => {
    const result = {
      result: "正常",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: "DIRECT",
        imageArchivalState: "ARCHIVED",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("本人上传 · 直接判读")).toBeTruthy()
    expect(screen.getByText("本人上传，无需授权")).toBeTruthy()
    expect(screen.getByText("已归档 · 有公开地址")).toBeTruthy()
    // 没有复核记录就老实说未记录，不编一个角色
    expect(screen.getByText("未记录")).toBeTruthy()
  })

  it("归档状态未知时明确说「无法确认」，不退化成「未留存」", () => {
    const result = {
      result: "正常",
      source: { recordSource: "DIRECT", imageArchivalState: "UNKNOWN" },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("归档状态无法确认")).toBeTruthy()
    expect(screen.queryByText("未留存影像")).toBeNull()
  })

  it("管理员做的复核显示为管理员，绝不写成医生", () => {
    const result = {
      result: "正常",
      humanReviewStatus: "REVIEWED",
      humanResult: "复核：正常",
      source: {
        recordSource: "DIRECT",
        reviewerRole: "admin",
        imageArchivalState: "ARCHIVED",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("管理员（admin）")).toBeTruthy()
    expect(screen.queryByText(/医生（doctor）/)).toBeNull()
    expect(screen.queryByText(/医生复核/)).toBeNull()
  })

  it("历史记录没有投影字段时整段不渲染，也不崩", () => {
    render(<RecordSheet result={{ result: "正常" } as DiagnosisResult} />)

    expect(screen.queryByText("来源与授权 · PROVENANCE")).toBeNull()
    // 老记录仍然要有报告本体
    expect(screen.getByText(/AI 判读结果/)).toBeTruthy()
  })
})
