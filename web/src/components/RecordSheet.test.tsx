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
      humanReviewStatus: "APPROVED",
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
