import { message } from 'ant-design-vue'
import dayjs from 'dayjs'

/**
 * Diagnosis Export Composable
 * Extracts CSV and PDF export logic from DiagnosisHistory component.
 */
export function useDiagnosisExport() {
  const formatDate = (date: string) => dayjs(Number(date)).format('YYYY-MM-DD HH:mm')

  const exportToCSV = (records: any[]) => {
    if (records.length === 0) return
    const headers = ['诊断单号', '诊断日期', '诊断结果', '置信度', '状态']
    const csvContent = [
      headers.join(','),
      ...records.map((record: any) => [
        record.id,
        formatDate(record.createTime),
        `"${record.result || ''}"`,
        record.confidence ? `${record.confidence}%` : '',
        record.status || ''
      ].join(','))
    ].join('\n')
    const BOM = '﻿'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `诊断记录_${dayjs().format('YYYYMMDD_HHmmss')}.csv`
    link.click()
    URL.revokeObjectURL(url)
    message.success(`成功导出 ${records.length} 条记录`)
  }

  const exportToPDF = (records: any[]) => {
    if (records.length === 0) return
    const printContent = `
    <html><head><meta charset="utf-8"><title>诊断记录</title><style>
      body { font-family: -apple-system, sans-serif; padding: 24px; }
      h1 { text-align: center; color: #141413; margin-bottom: 8px; }
      .subtitle { text-align: center; color: #87867f; margin-bottom: 24px; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #e8e6dc; padding: 10px 12px; text-align: left; }
      th { background: #faf9f5; font-weight: 600; color: #141413; }
      .header-row { background: #c96442; color: white; }
      .header-row th { background: #c96442; color: white; border-color: #a34f2f; }
    </style></head><body>
    <h1>眼科诊断记录</h1>
    <p class="subtitle">导出时间: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}</p>
    <table><thead><tr class="header-row"><th>诊断单号</th><th>日期</th><th>结果</th><th>置信度</th><th>状态</th></tr></thead><tbody>
    ${records.map((r: any) => `<tr><td>${r.id}</td><td>${formatDate(r.createTime)}</td><td>${r.result || ''}</td><td>${r.confidence || 0}%</td><td>${r.status || ''}</td></tr>`).join('')}
    </tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (w) {
      w.document.write(printContent)
      w.document.close()
      w.print()
    }
  }

  return { exportToCSV, exportToPDF }
}
