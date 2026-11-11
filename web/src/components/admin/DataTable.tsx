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
 *
 * 多选是可选能力（selectable）：勾选列只在开启时出现，选中态由调用方持有
 * （受控），表格只负责画复选框并把变化报上去。不可选的行（如管理员账号）
 * 由 isRowSelectable 逐行裁决。
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
  /** 开启多选列 */
  selectable?: boolean
  /** 已选中的行 key（受控） */
  selectedKeys?: string[]
  /** 选中集合变化 */
  onSelectionChange?: (keys: string[]) => void
  /** 某一行是否允许被勾选 */
  isRowSelectable?: (row: T) => boolean
  /** 不画分页条：表格只是列表的一小块（例如仪表盘的「最近几条」） */
  hidePager?: boolean
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
    selectable = false,
    selectedKeys = [],
    onSelectionChange,
    isRowSelectable,
    hidePager = false,
  } = props

  // error 优先于「rows === undefined 的隐式 loading」：自然接线
  // rows={query.data} + error={describeError(...)} 下出错时 data 是
  // undefined，若让隐式 loading 前置，错误文案将永远不可达。
  const isLoading = loading === true || (rows === undefined && !error)
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize))
  const current = Math.min(Math.max(1, page.current), totalPages)
  // isLoading 的表达式让 TS 无法在后续分支里把 rows 收窄成 T[]，这里显式
  // 归一化供「空态 / 数据行」消费；loading / error 判定仍用原始 rows。
  const resolvedRows: T[] = rows ?? []

  // 勾选列也算一列：状态行要跨过它，否则三态行会比表头窄一格。
  const columnCount = columns.length + (selectable ? 1 : 0)

  let body: ReactNode
  if (isLoading) {
    body = (
      <tr className="admin-dt__state-row">
        <td className="admin-dt__state" colSpan={columnCount}>
          读取中…
        </td>
      </tr>
    )
  } else if (error) {
    body = (
      <tr className="admin-dt__state-row">
        <td className="admin-dt__state admin-dt__state--error" colSpan={columnCount}>
          {error}
        </td>
      </tr>
    )
  } else if (resolvedRows.length === 0) {
    body = (
      <tr className="admin-dt__state-row">
        <td className="admin-dt__state" colSpan={columnCount}>
          {emptyText}
        </td>
      </tr>
    )
  } else {
    body = resolvedRows.map((row) => {
      const key = rowKey(row)
      const selectableRow = selectable && (isRowSelectable ? isRowSelectable(row) : true)
      const checked = selectedKeys.includes(key)
      return (
        <tr key={key} className="admin-dt__row">
          {selectable ? (
            <td className="admin-dt__cell admin-dt__cell--pick">
              <input
                type="checkbox"
                className="admin-dt__check"
                checked={checked}
                disabled={!selectableRow}
                onChange={() => {
                  if (!onSelectionChange) return
                  onSelectionChange(
                    checked
                      ? selectedKeys.filter((item) => item !== key)
                      : [...selectedKeys, key],
                  )
                }}
                aria-label={`选择该行 ${key}`}
              />
            </td>
          ) : null}
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
      )
    })
  }

  /**
   * 全选 / 取消全选：只作用于「当前页里可选的行」。
   * 不可选的行（例如管理员账号）不参与全选，否则会把不可操作的行塞进选中集。
   */
  const selectableKeys = selectable
    ? (rows ?? [])
        .filter((row) => (isRowSelectable ? isRowSelectable(row) : true))
        .map((row) => rowKey(row))
    : []
  const allChecked =
    selectableKeys.length > 0 && selectableKeys.every((key) => selectedKeys.includes(key))
  const someChecked = selectableKeys.some((key) => selectedKeys.includes(key))

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
              {selectable ? (
                <th scope="col" className="admin-dt__head admin-dt__head--pick">
                  <input
                    type="checkbox"
                    className="admin-dt__check"
                    checked={allChecked}
                    ref={(node) => {
                      // 半选态（部分选中）用 indeterminate 表达，不能只靠 checked。
                      if (node) node.indeterminate = !allChecked && someChecked
                    }}
                    disabled={selectableKeys.length === 0}
                    onChange={() => {
                      if (!onSelectionChange) return
                      onSelectionChange(allChecked ? [] : selectableKeys)
                    }}
                    aria-label="全选本页"
                  />
                </th>
              ) : null}
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

      {hidePager ? null : (
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
      )}
    </div>
  )
}
