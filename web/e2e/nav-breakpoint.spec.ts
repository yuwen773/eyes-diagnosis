import { expect, test, type Page } from "@playwright/test"

/**
 * 折叠导航下的管理员入口回归（PR #93 P2 修复）。
 *
 * 901–1099px 且协作开关打开时，顶栏账号区被 shell.css 收进共享抽屉；
 * 桌面唯一的 /admin 入口因此不可见。这里用真实 CSS 断点逐个视口验证
 * 抽屉里的替代入口，并覆盖普通用户/未登录不得看到它。
 *
 * 页面 API 全部合成：只验证导航可发现性与可访问性，不涉及协作数据或模型。
 */

type Role = "admin" | "user" | "anon"

async function mockSession(page: Page, role: Role) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/user/get/login")) {
      const user =
        role === "anon"
          ? null
          : {
              id: role === "admin" ? "2" : "1",
              userName: role === "admin" ? "系统管理员" : "普通用户",
              userAccount: role,
              userRole: role === "admin" ? "admin" : "user",
            }
      await route.fulfill({ json: { code: 0, data: user, msg: "ok" } })
      return
    }
    await route.fulfill({ json: { code: 0, data: [], msg: "ok" } })
  })
}

async function openDrawer(page: Page) {
  const burger = page.getByRole("button", { name: "打开导航" })
  await expect(burger).toBeVisible()
  await burger.click()
  const dialog = page.getByRole("dialog", { name: "主导航" })
  await expect(dialog).toBeVisible()
  return dialog
}

const WIDTHS = [360, 820, 900, 901, 1024, 1099, 1100]

/** 协作开关打开：在全部关键视口上，管理员抽屉里都有 /admin，其他人没有。 */
for (const width of WIDTHS) {
  test(`协作开启 · ${width}px · 管理员抽屉可见系统管理且不破坏折叠策略`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockSession(page, "admin")
    await page.goto("/agent")

    const desktopAdmin = page.locator(".product-head__actions .acct a[href='/admin']")
    const burger = page.getByRole("button", { name: "打开导航" })
    if (width <= 1099) {
      // 折叠窗口：≤900 走共享断点，901–1099 走协作专用断点。
      // 两种情况下桌面账号区都隐藏，汉堡接手导航，系统管理必须在抽屉里。
      await expect(desktopAdmin).toBeHidden()
      await expect(burger).toBeVisible()
      const drawer = await openDrawer(page)
      const adminLink = drawer.getByRole("link", { name: "系统管理" })
      await expect(adminLink).toBeVisible()
      await expect(adminLink).toHaveAttribute("href", "/admin")
      // 名称可读、可键盘聚焦，抽屉关闭后回到汉堡按钮。
      await expect(adminLink).toHaveJSProperty("tagName", "A")
      await adminLink.focus()
      await expect(adminLink).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden()
      return
    }

    // 1100px 及以上不折叠：桌面账号菜单保持可见，/admin 入口不回退。
    await expect(burger).toBeHidden()
    await page.getByRole("button", { name: /账号菜单/ }).click()
    const adminItem = page.getByRole("menuitem", { name: "系统管理" })
    await expect(adminItem).toBeVisible()
    await expect(adminItem).toHaveJSProperty("tagName", "A")
  })
}

test("协作开启 · 1024px · 普通用户与未登录都没有系统管理入口", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  for (const role of ["user", "anon"] as const) {
    await mockSession(page, role)
    await page.goto("/agent")
    const drawer = await openDrawer(page)
    await expect(drawer.getByRole("link", { name: "系统管理" })).toHaveCount(0)
    if (role === "user") {
      await expect(drawer.getByRole("link", { name: "个人中心" })).toBeVisible()
    } else {
      await expect(drawer.getByRole("link", { name: "登录" })).toBeVisible()
    }
  }
})

test("协作关闭 · 桌面账号区不被折叠，管理员入口仍在顶栏", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await mockSession(page, "admin")
  await page.goto("/agent")
  // 默认构建不带协作链接，:has 规则不命中，桌面账号菜单保持可见。
  const burger = page.getByRole("button", { name: "打开导航" })
  await expect(burger).toBeHidden()
  await page.getByRole("button", { name: /账号菜单/ }).click()
  await expect(page.getByRole("menuitem", { name: "系统管理" })).toBeVisible()
})
