import { defineConfig, devices } from "@playwright/test"

/**
 * 验收冒烟。后端不在这里起：登录、判读、Agent 都需要 :8081 + MySQL + Redis
 * + 算法服务，起法与账密见 e2e/README.md。
 */
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
