// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"

import { DataTable, type Column, type SortState } from "./DataTable"

afterEach(() => {
  cleanup()
})

type Row = { id: string; name: string }

const rows: Row[] = [
  { id: "1", name: "甲" },
  { id: "2", name: "乙" },
]

const columns: Column<Row>[] = [
  { key: "id", title: "ID", mono: true },
  { key: "name", title: "名称", sortable: true },
]

function Harness(props: { onChange?: (sort: SortState) => void }) {
  const [sort, setSort] = useState<SortState>(null)
  return (
    <DataTable<Row>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      page={{ current: 1, pageSize: 10, total: rows.length }}
      onPageChange={() => {}}
      sort={sort}
      onSortChange={(next) => {
        setSort(next)
        props.onChange?.(next)
      }}
    />
  )
}

describe("DataTable 排序", () => {
  it("可排序列按 无 → 升 → 降 → 无 循环，并把服务端排序状态报上去", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const header = () => screen.getByRole("columnheader", { name: "名称" })
    const button = screen.getByRole("button", { name: "名称" })

    expect(header().getAttribute("aria-sort")).toBe("none")

    fireEvent.click(button)
    expect(header().getAttribute("aria-sort")).toBe("ascending")
    expect(onChange).toHaveBeenLastCalledWith({ field: "name", order: "ascend" })

    fireEvent.click(button)
    expect(header().getAttribute("aria-sort")).toBe("descending")
    expect(onChange).toHaveBeenLastCalledWith({ field: "name", order: "descend" })

    fireEvent.click(button)
    expect(header().getAttribute("aria-sort")).toBe("none")
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it("没有 onSortChange 时不渲染排序按钮，也不谎报可排序", () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        page={{ current: 1, pageSize: 10, total: rows.length }}
        onPageChange={() => {}}
      />,
    )

    expect(screen.queryByRole("button", { name: "名称" })).toBeNull()
    expect(
      screen.getByRole("columnheader", { name: "名称" }).getAttribute("aria-sort"),
    ).toBeNull()
  })
})

describe("DataTable 三态优先级", () => {
  it("error 优先于空态", () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        error="接口挂了"
        page={{ current: 1, pageSize: 10, total: 0 }}
        onPageChange={() => {}}
      />,
    )

    expect(screen.getByText("接口挂了")).toBeTruthy()
    expect(screen.queryByText("暂无数据")).toBeNull()
  })

  it("rows 未给且无 error 时按 loading 处理", () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={undefined}
        rowKey={(row) => row.id}
        page={{ current: 1, pageSize: 10, total: 0 }}
        onPageChange={() => {}}
      />,
    )

    expect(screen.getByText("读取中…")).toBeTruthy()
  })
})
