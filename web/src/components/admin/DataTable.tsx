import { useMemo, type ReactElement, type ReactNode } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import {
  functionalUpdate,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table"

/**
 * 管理后台表格的列定义。
 *
 * - `key`：列的稳定标识，同时作为未提供 `render` 时的取值键（见下方 cell 读取），
 *   也是服务端排序的字段名。
 * - `width`：直接落到 <th> 的 width，调用方给字符串（如 "120px" / "18%"）。
 * - `align`：单元格文本对齐。
 * - `mono`：该列读数用全站 `.num`（等宽 + tabular-nums）。
 * - `render`：自定义单元格内容；不传时按 `key` 从行对象取值。
 * - `sortable`：只有服务端白名单支持的列才开；开了且调用方给了 onSortChange
 *   才渲染排序按钮——不做「只排当前页」的假排序。
 */
export type Column<T> = {
  key: string
  title: string
  width?: string
  align?: "left" | "right" | "center"
  mono?: boolean
  sortable?: boolean
  render?: (row: T) => ReactNode
}

/** 服务端排序状态；字段名与后端白名单一致。 */
export type SortState = { field: string; order: "ascend" | "descend" } | null

/** 行模型要求 data 引用稳定；空表用同一个空数组，别每次渲染新建。 */
const EMPTY_ROWS: never[] = []

/**
 * 页码窗口：当前页附近两页，首尾页常驻，中间用省略号。
 * 只画可点的真实页码，不做「省略号也能点」的假交互。
 */
function pageWindow(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set<number>([1, total, current - 1, current, current + 1])
  const list = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)
  const result: Array<number | "gap"> = []
  list.forEach((page, index) => {
    if (index > 0 && page - list[index - 1] > 1) result.push("gap")
    result.push(page)
  })
  return result
}

/** 显式特性树：只有排序需要额外注册，其余用核心能力。 */
const features = tableFeatures({ rowSortingFeature })

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
export function DataTable<T extends RowData>(props: {
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
  /** 服务端排序状态（受控）。只有传了 onSortChange，sortable 列才可点。 */
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  /** 自定义空态（图标 + 说明 + 动作）；不传时退回一行文字。 */
  emptyContent?: ReactNode
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
    sort = null,
    onSortChange,
    emptyContent,
  } = props

  // 列定义映射到 TanStack 的列模型：key 同时是服务端排序字段。
  const tableColumns = useMemo<ColumnDef<typeof features, T>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: (row: T) => (row as unknown as Record<string, unknown>)[column.key],
        header: column.title,
        enableSorting: Boolean(column.sortable && onSortChange),
      })),
    [columns, onSortChange],
  )

  const sorting = useMemo<SortingState>(
    () => (sort ? [{ id: sort.field, desc: sort.order === "descend" }] : []),
    [sort],
  )

  const table = useTable({
    features,
    columns: tableColumns,
    data: rows ?? EMPTY_ROWS,
    state: { sorting },
    // 数据已经由服务端按 sortField/sortOrder 排好，本地不再二次排序。
    manualSorting: true,
    getRowId: rowKey,
    onSortingChange: (updater) => {
      if (!onSortChange) return
      const next = functionalUpdate(updater, sorting)
      const first = next[0]
      onSortChange(first ? { field: first.id, order: first.desc ? "descend" : "ascend" } : null)
    },
  })

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
    // 骨架行：形状与真实行一致，读者先看到「表正在读」，不是一句孤立文案。
    body = Array.from({ length: 4 }, (_, index) => (
      <tr key={`skeleton-${index}`} className="admin-dt__row admin-dt__row--skeleton" aria-hidden="true">
        {selectable ? (
          <td className="admin-dt__cell admin-dt__cell--pick">
            <span className="admin-dt__skeleton admin-dt__skeleton--check" />
          </td>
        ) : null}
        {columns.map((column) => (
          <td key={column.key} className="admin-dt__cell">
            <span className="admin-dt__skeleton" />
          </td>
        ))}
      </tr>
    ))
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
        <td className="admin-dt__state admin-dt__state--empty" colSpan={columnCount}>
          {emptyContent ?? emptyText}
        </td>
      </tr>
    )
  } else {
    body = table.getRowModel().rows.map((tableRow) => {
      const row = tableRow.original
      const key = tableRow.id
      const selectableRow = selectable && (isRowSelectable ? isRowSelectable(row) : true)
      const checked = selectedKeys.includes(key)
      return (
        <tr key={key} className="admin-dt__row">
          {selectable ? (
            <td className="admin-dt__cell admin-dt__cell--pick">
              {/* label 铺满单元格：15px 的视觉盒仍小，但 40px 高的整格都是热区 */}
              <label className="admin-dt__pick">
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
              </label>
            </td>
          ) : null}
          {columns.map((column, columnIndex) => (
            <td
              key={column.key}
              className={
                "admin-dt__cell" +
                (column.mono ? " num" : "") +
                (column.align ? ` admin-dt__cell--${column.align}` : "") +
                // 末列约定为操作列：窄屏钉住列宽与渐隐提示都按它定位。
                (columnIndex === columns.length - 1 ? " admin-dt__cell--action" : "")
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
        <table className="admin-dt__table" aria-busy={isLoading}>
          {isLoading ? <caption className="sr-only">读取中…</caption> : null}
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="admin-dt__head-row">
                {selectable ? (
                  <th scope="col" className="admin-dt__head admin-dt__head--pick">
                    <label className="admin-dt__pick">
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
                    </label>
                  </th>
                ) : null}
                {group.headers.map((header) => {
                  const column = columns.find((item) => item.key === header.column.id)
                  if (!column) return null
                  // 排序状态挂在 th 上：读屏用户不依赖箭头方向也能知道当前排序列。
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={
                        "admin-dt__head num" +
                        (column.align ? ` admin-dt__cell--${column.align}` : "") +
                        // 末列约定为操作列：窄屏钉住列宽与渐隐提示都按它定位。
                        (header.column.id === columns[columns.length - 1].key
                          ? " admin-dt__head--action"
                          : "")
                      }
                      style={column.width ? { width: column.width } : undefined}
                      aria-sort={
                        !header.column.getCanSort()
                          ? undefined
                          : sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                      }
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="admin-dt__sort"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {column.title}
                          <span className="admin-dt__sort-mark" aria-hidden="true">
                            {sorted === "asc" ? (
                              <ChevronUp size={12} strokeWidth={2} />
                            ) : sorted === "desc" ? (
                              <ChevronDown size={12} strokeWidth={2} />
                            ) : (
                              <ChevronsUpDown size={12} strokeWidth={2} />
                            )}
                          </span>
                        </button>
                      ) : (
                        column.title
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      {hidePager ? null : (
      <div className="admin-dt__pager num">
        <span className="admin-dt__pager-info">
          共 <b>{page.total}</b> 条 · 第 {current} / {totalPages} 页
        </span>
        <div className="admin-dt__pager-controls">
          <button
            type="button"
            className="admin-dt__pager-btn admin-dt__pager-btn--step"
            onClick={goPrev}
            disabled={current <= 1}
            aria-label="上一页"
          >
            上一页
          </button>
          <div className="admin-dt__pager-pages" role="group" aria-label="页码">
            {pageWindow(current, totalPages).map((entry, index) =>
              entry === "gap" ? (
                <span key={`gap-${index}`} className="admin-dt__pager-gap" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  className="admin-dt__pager-page"
                  aria-current={entry === current ? "page" : undefined}
                  onClick={() => onPageChange({ current: entry, pageSize: page.pageSize })}
                >
                  {entry}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            className="admin-dt__pager-btn admin-dt__pager-btn--step"
            onClick={goNext}
            disabled={current >= totalPages}
            aria-label="下一页"
          >
            下一页
          </button>
          <label className="admin-dt__pager-size">
            <span className="admin-dt__pager-size-label">每页</span>
            <select
              className="admin-dt__pager-select"
              value={page.pageSize}
              onChange={(event) => changeSize(Number(event.target.value))}
              aria-label="每页条数"
            >
              <option value={10}>10 条</option>
              <option value={20}>20 条</option>
              <option value={50}>50 条</option>
            </select>
          </label>
        </div>
      </div>
      )}
    </div>
  )
}
