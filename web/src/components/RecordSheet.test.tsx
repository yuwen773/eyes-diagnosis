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

describe("RecordSheet 拒识与复核独立表达", () => {
  it("拒识且需要复核：两条事实同时出现", () => {
    render(
      <RecordSheet
        result={{ aiRejected: true, requiresReview: true, humanReviewStatus: "AWAITING_REVIEW" } as DiagnosisResult}
      />,
    )
    expect(screen.getByText("本次影像未形成判读结论")).toBeTruthy()
    expect(screen.getByText("该影像已转入人工复核")).toBeTruthy()
    // 拒识分支里也要能看到复核状态读数。
    expect(screen.getAllByText("待复核").length).toBeGreaterThan(0)
  })

  it("拒识但后端没有复核要求时不凭空写待复核", () => {
    render(<RecordSheet result={{ aiRejected: true, requiresReview: false } as DiagnosisResult} />)
    expect(screen.queryByText("该影像已转入人工复核")).toBeNull()
  })
})

describe("RecordSheet 影像归档语义", () => {
  it("有影像时标已归档", () => {
    render(
      <RecordSheet
        result={{ result: "正常" } as DiagnosisResult}
        imageSrc="https://cdn.example/x.jpg"
      />,
    )
    expect(screen.getByText("已归档")).toBeTruthy()
    expect(screen.queryByText("未归档")).toBeNull()
  })

  it("没有影像时不声称可回放，并明确未归档", () => {
    render(<RecordSheet result={{ result: "正常" } as DiagnosisResult} />)
    expect(screen.getByText("未归档")).toBeTruthy()
    expect(screen.getByText(/无法回放原图/)).toBeTruthy()
  })

  it("示例记录不显示归档印章", () => {
    render(<RecordSheet result={{ result: "正常" } as DiagnosisResult} specimen />)
    expect(screen.queryByText("未归档")).toBeNull()
    expect(screen.queryByText("已归档")).toBeNull()
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

  it("REVIEWED 不冒充医生复核：没有角色信息时也标「资质未核验」", () => {
    render(<RecordSheet result={{ result: "正常", humanReviewStatus: "REVIEWED" } as DiagnosisResult} />)

    expect(screen.getAllByText("人工复核已记录 · 资质未核验").length).toBeGreaterThan(0)
    expect(screen.queryByText(/医生复核/)).toBeNull()
  })

  it("REVIEWED 一律标「资质未核验」：账号角色不是资质证明", () => {
    const result = {
      result: "正常",
      humanReviewStatus: "REVIEWED",
      source: { recordSource: "DIRECT", reviewerRole: "doctor", imageArchivalState: "ARCHIVED" },
    } as DiagnosisResult
    render(<RecordSheet result={result} />)

    expect(screen.getAllByText("人工复核已记录 · 资质未核验").length).toBeGreaterThan(0)
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
        authorizedAt: "2026-11-17T14:10:00Z",
        authorizationReceipt: "abcdef12…",
        reviewerRole: "doctor",
        imageArchivalState: "ARCHIVED_NOT_PUBLIC",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("来源与授权 · PROVENANCE")).toBeTruthy()
    expect(screen.getByText("协作任务 · 由草稿生成")).toBeTruthy()
    expect(screen.getByText("草稿已审核通过")).toBeTruthy()
    // 授权 ≠ 临床复核：这一行必须带着时间（含时区）与回执前缀，且不写成「已复核」。
    // 具体本地时间随运行环境时区变化，这里只钉「有日期 + 有时区标注 + 有回执」。
    expect(screen.getByText(/患者已授权保存 · .*(GMT|UTC).* · 回执 abcdef12…/)).toBeTruthy()
    // 不再把 UTC 时间当成北京时间原样展示（旧口径差 8 小时）。
    expect(screen.queryByText(/2026-11-17T14:10:00Z/)).toBeNull()
    expect(screen.getByText("医生（doctor）")).toBeTruthy()
    // 协作影像按隐私策略不公开，但确实归档了——不能说「未保存」
    expect(screen.getByText("已归档 · 按隐私策略不公开")).toBeTruthy()
    expect(screen.queryByText("未留存影像")).toBeNull()
  })

  it("协作记录没有公开地址，整张纸也不能一边说已归档一边说未归档", () => {
    // 回归：`t_diagnosis.url` 恒为 ''（PatientAuthorizationService 保存授权时只写空串），
    // RecordDetailPage 传下来的 imageSrc 因此是 undefined。合并前投影行说「已归档」、
    // 印章与免责说「未归档 / 无法回放」，同一张报告自相矛盾。
    const result = {
      result: "正常",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: "COLLABORATION_DRAFT",
        patientTaskId: "task-1",
        draftReviewState: "APPROVED",
        authorizationState: "APPROVED",
        authorizedAt: "2026-11-17T14:10:00Z",
        authorizationReceipt: "abcdef12…",
        reviewerRole: null,
        imageArchivalState: "ARCHIVED_NOT_PUBLIC",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.queryByText("未归档")).toBeNull()
    expect(screen.queryByText(/未成功归档/)).toBeNull()
    expect(screen.queryByText(/无法回放原图/)).toBeNull()
    expect(screen.getByText("已归档 · 不公开地址")).toBeTruthy()
  })

  it("授权细节按最小权限隐去时说「不展示」，不说「无授权记录」", () => {
    // 非本人查看（管理端复核视角）：服务端不下发回执前缀、授权时间与任务 id。
    // 粗粒度状态仍然下发——「不给看细节」与「没有授权」是两件事。
    const result = {
      result: "正常",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: "COLLABORATION_DRAFT",
        draftReviewState: "APPROVED",
        authorizationState: "APPROVED",
        authorizationDetailsRestricted: true,
        imageArchivalState: "ARCHIVED_NOT_PUBLIC",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("患者已授权保存 · 详情按最小权限不展示")).toBeTruthy()
    expect(screen.queryByText(/无授权记录/)).toBeNull()
  })

  it("授权状态本身也没下发时，只说不展示，不猜有没有授权", () => {
    const result = {
      result: "正常",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: "COLLABORATION_DRAFT",
        authorizationDetailsRestricted: true,
        imageArchivalState: "ARCHIVED_NOT_PUBLIC",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText("授权详情按最小权限不展示")).toBeTruthy()
    expect(screen.queryByText(/无授权记录/)).toBeNull()
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
    // 印章与免责同样不能把「不知道」说成「没有」。
    expect(screen.getByText("无法确认")).toBeTruthy()
    expect(screen.queryByText("未归档")).toBeNull()
    expect(screen.getByText(/归档状态暂时无法确认/)).toBeTruthy()
  })

  it("投影读失败时（source 在但内容全空）说读不到，不说「无授权记录」", () => {
    // 后端在投影查询失败时下发 recordSource=null + UNKNOWN 的 source
    // （DiagnosisController#getDiagnosisResultVO）。前端把 null 落成「未记录 / 无授权记录」
    // 就等于把「查不到」写成「没有」——这正是服务自己立的规矩要避免的事。
    const result = {
      result: "正常",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: null,
        imageArchivalState: "UNKNOWN",
      },
    } as DiagnosisResult

    render(<RecordSheet result={result} />)

    expect(screen.getByText(/来源与授权这次没有读到/)).toBeTruthy()
    expect(screen.queryByText(/无授权记录/)).toBeNull()
    expect(screen.queryByText("未记录")).toBeNull()
    expect(screen.queryByText("本人上传，无需授权")).toBeNull()
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
