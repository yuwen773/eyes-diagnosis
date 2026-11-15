import { defineConfig, devices } from "@playwright/test"

/**
 * 验收冒烟。后端不在这里起：登录、判读、Agent 都需要 :8081 + MySQL + Redis
 * + 算法服务，起法与账密见 e2e/README.md。
 */
// 本机只装了旧一版 Chromium 时，用 E2E_CHROMIUM_PATH 指向它；
// CI / 标准环境不设该变量，仍走 Playwright 自带的浏览器。
const executablePath = process.env.E2E_CHROMIUM_PATH

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 本机 Chromium 未随 Playwright 版本下载时显式指向已有安装（报告须记录实际版本）。
    launchOptions: process.env.E2E_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
})
