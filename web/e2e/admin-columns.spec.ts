// 管理端宽表的列几何断言。
//
// 为什么要有这条：`77e43f6c` 修过一次真实回归——列宽规则
// `width: var(--col-w, auto)` 把没声明列宽的勾选列也改了，勾选列变 `auto`
// 后在 `table-layout: fixed` 下吸走整表富余宽度（实测 1200/1440/1600 视口下
// 勾选列 376/616/776px），宽表整张向右歪。截图比对能看出来，但它只在某几个
// 断点、某几张图上跑；几何断言能在每次改动后重复跑。
//
// **断言的是份额，不是绝对像素。** 表格是 `table-layout: fixed` 且宽度 100%：
// 富余宽度由浏览器按各列声明宽度**等比分摊**，所以列宽本来就随容器变
// （勾选列声明 40px，容器 1266px 时它分到 68.8px = 40/736 的份额）。
// 回归的特征不是「勾选列超过 40px」，而是**某列的份额偏离声明份额**：
// 勾选列声明 40px 却拿到 40%+ 的宽度，且份额随视口漂移。
//
// 这条用例**不需要后端**：会话与列表都用合成夹具拦截，只测布局。
// 它测的是「表格怎么排」，不是「接口返回什么」。

import { expect, test, type Page } from "@playwright/test"

/** 勾选列的声明宽度：与 admin.css 的 `.admin-dt__cell--pick, .admin-dt__head--pick { width: 40px }` 对齐。 */
const PICK_DECLARED = 40
/** 份额允许的偏差（百分点）。实测健康态是 0.0——各列份额与声明份额完全一致。 */
const SHARE_TOLERANCE = 0.015
/** 操作列右边缘与表格右边缘的允许偏差（px）。 */
const EDGE_TOLERANCE = 2

const ADMIN_SESSION = {
  code: 0,
  msg: "",
  data: {
    id: "9001",
    userAccount: "admin",
    userName: "验收管理员",
    userRole: "admin",
    createTime: "2026-01-01 08:00:00",
  },
}

function userRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `922337203685${String(index).padStart(4, "0")}`,
    userAccount: `patient_${String(index).padStart(2, "0")}`,
    userName: `患者${String(index).padStart(2, "0")}`,
    userRole: index % 5 === 0 ? "admin" : "user",
    createTime: "2026-11-13 10:20:30",
  }))
}

function diagnosisRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `811337203685${String(index).padStart(4, "0")}`,
    url: "",
    username: `patient_${String(index).padStart(2, "0")}`,
    result: index % 4 === 0 ? "青光眼" : "白内障",
    confidence: 60 + index,
    severity: index % 3 === 0 ? "severe" : "mild",
    reexamineStatus: 0,
    createTime: "2026-11-13 10:20:30",
    aiRejected: false,
    requiresReview: false,
  }))
}

/** 会话 + 列表都拦住：这条用例不需要后端，也不依赖任何真实患者数据。 */
async function stubAdmin(page: Page, kind: "users" | "diagnosis") {
  await page.route("**/api/user/get/login", (route) =>
    route.fulfill({ json: ADMIN_SESSION }),
  )
  const rows = kind === "users" ? userRows(20) : diagnosisRows(20)
  await page.route(
    kind === "users" ? "**/api/user/list/page/vo" : "**/api/diagnosis/list/page/vo",
    (route) =>
      route.fulfill({
        json: {
          code: 0,
          msg: "",
          data: {
            records: rows,
            total: rows.length,
            size: rows.length,
            current: 1,
            pages: 1,
          },
        },
      }),
  )
}

type Column = {
  /** 列身份（data-col）。 */
  key: string
  /** 实际宽度（px）。 */
  width: number
  /** 声明宽度（px）：写在 --col-w 上的值；勾选列取 admin.css 的定宽。 */
  declared: number
}

type Geometry = {
  columns: Column[]
  tableWidth: number
  /** 最后一列（操作列）右边缘与表格右边缘的间距。 */
  actionGap: number
}

/** 量一次表头几何：实际宽度 + 声明宽度。 */
async function measure(page: Page): Promise<Geometry> {
  return page.evaluate((pickDeclared) => {
    const table = document.querySelector<HTMLTableElement>(".admin-dt__table")
    const heads = Array.from(
      document.querySelectorAll<HTMLTableCellElement>(".admin-dt__head"),
    )
    if (!table || heads.length === 0) {
      throw new Error("表头没渲染出来，测不到几何")
    }
    const tableRect = table.getBoundingClientRect()
    const last = heads[heads.length - 1].getBoundingClientRect()
    return {
      tableWidth: tableRect.width,
      actionGap: tableRect.right - last.right,
      columns: heads.map((head) => {
        const declared =
          getComputedStyle(head).getPropertyValue("--col-w").trim() ||
          (head.getAttribute("data-col") === "pick" ? String(pickDeclared) : "")
        return {
          key: head.getAttribute("data-col") ?? "",
          width: head.getBoundingClientRect().width,
          declared: Number.parseFloat(declared),
        }
      }),
    }
  }, PICK_DECLARED)
}

/** 各列份额必须等于声明份额：没有哪一列能吃掉整表富余宽度。 */
function expectDeclaredShares(geometry: Geometry) {
  const declaredTotal = geometry.columns.reduce((sum, column) => sum + column.declared, 0)
  expect(declaredTotal).toBeGreaterThan(0)

  for (const column of geometry.columns) {
    const expected = column.declared / declaredTotal
    const actual = column.width / geometry.tableWidth
    expect(
      Math.abs(actual - expected),
      `列「${column.key}」份额偏离声明份额：实际 ${(actual * 100).toFixed(1)}%，声明 ${(expected * 100).toFixed(1)}%`,
    ).toBeLessThanOrEqual(SHARE_TOLERANCE)
  }

  // 勾选列单独再兜一道：它声明 40px，就不该拿走整张表的十分之一。
  const pick = geometry.columns[0]
  expect(pick.key).toBe("pick")
  expect(
    pick.width / geometry.tableWidth,
    "勾选列不该吸走整表富余宽度",
  ).toBeLessThanOrEqual(0.1)

  // 操作列钉在表格右边缘。
  expect(
    Math.abs(geometry.actionGap),
    "操作列应贴在表格右边缘",
  ).toBeLessThanOrEqual(EDGE_TOLERANCE)
}

test.describe("管理端宽表的列几何", () => {
  test("用户管理：勾选列按声明份额分摊，操作列贴右", async ({ page }) => {
    await stubAdmin(page, "users")

    const shares: number[] = []
    for (const width of [1200, 1600]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/admin/users")
      await expect(page.locator(".admin-dt__head").first()).toBeVisible()

      const geometry = await measure(page)
      expectDeclaredShares(geometry)
      shares.push(geometry.columns[0].width / geometry.tableWidth)
    }

    // 回归的特征是份额随视口漂移（勾选列吃得越多，视口越宽歪得越狠）。
    expect(
      Math.abs(shares[0] - shares[1]),
      "勾选列份额不该随视口漂移",
    ).toBeLessThanOrEqual(SHARE_TOLERANCE)
  })

  test("诊断管理：勾选列按声明份额分摊，操作列贴右", async ({ page }) => {
    await stubAdmin(page, "diagnosis")

    const shares: number[] = []
    for (const width of [1200, 1600]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/admin/diagnosis")
      await expect(page.locator(".admin-dt__head").first()).toBeVisible()

      const geometry = await measure(page)
      expectDeclaredShares(geometry)
      shares.push(geometry.columns[0].width / geometry.tableWidth)
    }

    expect(
      Math.abs(shares[0] - shares[1]),
      "勾选列份额不该随视口漂移",
    ).toBeLessThanOrEqual(SHARE_TOLERANCE)
  })
})
