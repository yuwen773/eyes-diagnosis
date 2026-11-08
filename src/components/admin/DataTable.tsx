import type { ReactElement, ReactNode } from "react"

/**
 * 管理后台表格的列定义。
 *
 * - `key`：列的稳定标识，同时作为未提供 `render` 时的取值键（见下方 cell 读取）。
 * - `width`：直接落到 <th> 的 width，调用方给字符串（如 "120px" / "18%"）。
 * - `align`：单元格文本对齐。
 * - `mono`：该列读数用全站 `.num`（等宽 + tabular-nums）。
 * - `render`：自定义单元格内容；不传时按 `key` 从行对象取值。
 */
export type Column<T> = {
  key: string
  title: string
  width?: string
  align?: "left" | "right" | "center"
  mono?: boolean
  render?: (row: T) => ReactNode
}

/**
 * 无 render 时，按列 key 从行对象上读一个值并转成可渲染节点。
 * 管理域行都是对象（User / News / Diagnosis…），这里做一次宽松读取，
 * 避免把 T 约束成 Record 破坏调用方的具体类型。
 */
function defaultCell<T>(row: T, key: string): ReactNode {
  const value = (row as unknown as Record<string, unknown>)[key]
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "boolean") return value ? "是" : "否"
  return String(value)
}

/**
 * 语义化表格 + 受控分页。
 *
 * 三态优先级：loading（rows === undefined 也算 loading）> error > empty > 数据行。
 * 三态都占一整行（td colSpan=columns.length），不画表体之外的浮层。
 * 分页条数字全部 mono：第 X / Y 页 · 共 N 条 + 上一页/下一页 + 每页条数。
 */
export function DataTable<T>(props: {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  loading?: boolean
  error?: string | null
  emptyText?: string
  page: { current: number; pageSize: number; total: number }
  onPageChange: (next: { current: number; pageSize: number }) => void
}): ReactElement {
  const {
    columns,
    rows,
    rowKey,
    loading,
    error,
    emptyText = "暂无数据",
    page,
    onPageChange,
  } = props

  const isLoading = loading === true || rows === undefined
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize))
  const current = Math.min(Math.max(1, page.current), totalPages)

  let body: ReactNode
  if (isLoading) {
    body = (
      <tr className="admin-dt__state-row">
        <td className="admin-dt__state" colSpan={columns.length}>
          读取中…
        </td>
      </tr>
    )
  } else if (error) {
    body = (
      <tr className="admin-dt__state-row">
        <td className="admin-dt__state admin-dt__state--error" colSpan={columns.length}>
          {error}
        </td>
      </tr>
    )
  } else if (rows.length === 0) {
    body = (
      <tr className="admin-dt__state-row">
        <td className="admin-dt__state" colSpan={columns.length}>
          {emptyText}
        </td>
      </tr>
    )
  } else {
    body = rows.map((row) => (
      <tr key={rowKey(row)} className="admin-dt__row">
        {columns.map((column) => (
          <td
            key={column.key}
            className={
              "admin-dt__cell" +
              (column.mono ? " num" : "") +
              (column.align ? ` admin-dt__cell--${column.align}` : "")
            }
          >
            {column.render ? column.render(row) : defaultCell(row, column.key)}
          </td>
        ))}
      </tr>
    ))
  }

  const goPrev = () => {
    if (current > 1) onPageChange({ current: current - 1, pageSize: page.pageSize })
  }
  const goNext = () => {
    if (current < totalPages) onPageChange({ current: current + 1, pageSize: page.pageSize })
  }
  const changeSize = (nextSize: number) => {
    onPageChange({ current: 1, pageSize: nextSize })
  }

  return (
    <div className="admin-dt">
      <div className="admin-dt__scroll">
        <table className="admin-dt__table">
          <thead>
            <tr className="admin-dt__head-row">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={
                    "admin-dt__head num" +
                    (column.align ? ` admin-dt__cell--${column.align}` : "")
                  }
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      <div className="admin-dt__pager num">
        <span className="admin-dt__pager-info">
          第 {current} / {totalPages} 页 · 共 {page.total} 条
        </span>
        <div className="admin-dt__pager-controls">
          <button
            type="button"
            className="admin-dt__pager-btn"
            onClick={goPrev}
            disabled={current <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="admin-dt__pager-btn"
            onClick={goNext}
            disabled={current >= totalPages}
          >
            下一页
          </button>
          <label className="admin-dt__pager-size">
            <span className="admin-dt__pager-size-label">每页条数</span>
            <select
              className="admin-dt__pager-select"
              value={page.pageSize}
              onChange={(event) => changeSize(Number(event.target.value))}
              aria-label="每页条数"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}
