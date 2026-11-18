import { expect, test, type Page } from "@playwright/test"

/**
 * 送达读数在**真实浏览器**里的对比度（R5 审查 E-1 / E-2 的运行时验收）。
 *
 * 静态检查只能证明 `agent.css` 里写的是哪个令牌；这里证明浏览器**算出来**的颜色
 * 在两种主题、三档视口下都达到 4.5:1 —— 令牌值、继承链、画布底色任何一环坏了都会红。
 *
 * 数据全部合成：登录、会话、历史、SSE 都由本文件拦截，不碰真后端、不碰真实患者数据。
 */

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
]

async function mockAgent(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith("/user/get/login")) {
      return route.fulfill({
        json: {
          code: 0,
          msg: "ok",
          data: { id: "9", userName: "合成用户", userAccount: "synthetic", userRole: "user" },
        },
      })
    }
    // 让发送走到「受理状态未知」：非 JSON 的 502，既不算受理，也不算明确拒绝。
    if (path.includes("/agent/chat/stream")) {
      return route.fulfill({ status: 502, contentType: "text/html", body: "<html>502</html>" })
    }
    if (path.startsWith("/api/agent/history")) {
      return route.fulfill({ json: { code: 0, msg: "ok", data: [] } })
    }
    if (path.startsWith("/api/agent/sessions")) {
      const created = request.method() === "POST" ? { sessionId: "synthetic-thread" } : []
      return route.fulfill({ json: { code: 0, msg: "ok", data: created } })
    }
    return route.fulfill({ json: { code: 0, msg: "ok", data: null } })
  })
}

/** 与 tokens.contrast.test.ts 同一套 WCAG 相对亮度算法，但作用在浏览器算出的 rgb() 上。 */
function contrast(a: string, b: string): number {
  const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of VIEWPORTS) {
    test(`${theme} · ${viewport.name}px · 未确认读数对画布 ≥ 4.5:1`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await mockAgent(page)
      await page.goto("/agent")

      const input = page.locator(".prompt__input")
      await expect(input).toBeVisible()
      await input.fill("合成提问：这条会不会送达？")
      await input.press("Enter")

      const readout = page.locator(".agent-msg__delivery.is-unconfirmed")
      await expect(readout).toBeVisible()
      await expect(readout).toContainText("送达未确认")

      // 取读数自身的 color 与「第一个不透明祖先背景」——只比令牌不算数，
      // 真实风险恰恰是继承链把颜色换掉了。
      const { color, background, scrolls } = await page.evaluate(() => {
        const element = document.querySelector(".agent-msg__delivery.is-unconfirmed")!
        const styles = getComputedStyle(element)
        let node: Element | null = element
        let background = "rgba(0, 0, 0, 0)"
        while (node) {
          const candidate = getComputedStyle(node).backgroundColor
          if (candidate && candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
            background = candidate
            break
          }
          node = node.parentElement
        }
        return {
          color: styles.color,
          background,
          scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })

      expect(contrast(color, background), `color=${color} bg=${background}`).toBeGreaterThanOrEqual(4.5)
      // 读数是最长的一行文案，窄屏最容易把它挤破。
      expect(scrolls).toBe(false)
    })
  }
}
