// src/utils/exportUtil.ts
import { jsPDF } from 'jspdf'
import * as Papa from 'papaparse'
import  { applyPlugin } from 'jspdf-autotable'
applyPlugin(jsPDF)

// Extend jsPDF type to include autoTable plugin
declare module 'jspdf' {
  interface jsPDF {
    autoTable(options: Record<string, unknown>): { finalY: number }
  }
}

export const exportToPDF = (report: API.DiagnosisResultVO) => {
  const doc = new jsPDF()

  // 标题
  doc.setFontSize(18)
  doc.text(`${report.result}诊断报告`, 105, 20, { align: 'center' })

  // 基本信息表格
  doc.setFontSize(12)
  doc.text('基本信息', 14, 40)

  // 保存autoTable结果
  const tableResult = doc.autoTable({
    startY: 45,
    head: [['项目', '内容']],
    body: [
      ['诊断ID', report.id],
      ['诊断日期', report.createTime],
      ['诊断结果', report.result],
      ['置信度', report.confidence],
      ['严重程度', report.severity],
      ['概率', report.probability]
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [64, 169, 255] // antd primary color
    }
  })

  // 安全获取表格结束位置
  const tableEndY = tableResult?.finalY || 45 + 30 // 默认值：开始位置+估计高度

  // 诊断详情
  doc.setFontSize(12)
  doc.text('诊断详情', 14, tableEndY + 15)
  doc.setFontSize(10)

  // 处理多行文本
  const detailsLines = doc.splitTextToSize(report.details ?? '', 180)
  doc.text(detailsLines, 14, tableEndY + 25)

  // 诊断建议
  doc.setFontSize(12)
  doc.text('诊断建议', 14, tableEndY + 15 + detailsLines.length * 7 + 10) // 根据行数计算位置
  doc.setFontSize(10)

  const suggestionsLines = doc.splitTextToSize(report.recommendations ?? '', 180)
  doc.text(suggestionsLines, 14, tableEndY + 15 + detailsLines.length * 7 + 20)

  // 页脚
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(
      `页 ${i} / ${pageCount}`,
      105,
      doc.internal.pageSize.height - 10,
      { align: 'center' }
    )
  }

  doc.save(`诊断报告_${report.id}.pdf`)
}

export const exportToCSV = (report: API.DiagnosisResultVO) => {
  const csvData = [
    { field: '诊断ID', value: report.id },
    { field: '诊断日期', value: report.createTime },
    { field: '诊断结果', value: report.result },
    // { field: '诊断结果', value: report.otherDisease },
    { field: '置信度', value: report.confidence },
    { field: '严重程度', value: report.severity },
    { field: '概率', value: report.probability },
    { field: '诊断详情', value: report.details },
    { field: '诊断建议', value: report.recommendations }
  ]

  const csv = Papa.unparse(csvData)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', `诊断报告_${report.id}.csv`)
  link.style.visibility = 'hidden'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
