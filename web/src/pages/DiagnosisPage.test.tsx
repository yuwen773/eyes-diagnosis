// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { DiagnosisPage } from "./DiagnosisPage"

const sessionState = vi.hoisted(() => ({
  status: "authed" as "authed" | "anon" | "loading",
}))

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    status: sessionState.status,
    user: null,
    scope: "u1",
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  runDiagnosis: vi.fn(),
}))

vi.mock("@/lib/pendingUpload", () => ({
  takePendingUpload: () => null,
  rememberPendingUpload: vi.fn(),
}))

import { runDiagnosis } from "@/lib/api"

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function renderPage() {
  stubMatchMedia()
  render(
    <ThemeProvider>
      <MemoryRouter>
        <DiagnosisPage />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

/** 造一个指定体积的文件（内容不用真填，只用 size）。 */
function fileOfSize(name: string, bytes: number) {
  const file = new File(["x"], name, { type: "image/jpeg" })
  Object.defineProperty(file, "size", { value: bytes })
  return file
}

beforeEach(() => {
  sessionState.status = "authed"
})

afterEach(() => {
  cleanup()
  vi.mocked(runDiagnosis).mockReset()
})

describe("DiagnosisPage 影像上限", () => {
  it("超过服务端上限（2 MB）的影像在本地就被拦下并说清原因", async () => {
    renderPage()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = fileOfSize("big.jpg", 3 * 1024 * 1024)
    await import("@testing-library/react").then(({ fireEvent }) =>
      fireEvent.change(input, { target: { files: [file] } }),
    )

    expect(await screen.findByText(/影像超过 2 MB/)).toBeTruthy()
    // 没通过本地校验就不该发起判读。
    expect(runDiagnosis).not.toHaveBeenCalled()
  })

  it("上限内的影像可以进入判读", async () => {
    renderPage()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = fileOfSize("ok.jpg", 1024 * 1024)
    const { fireEvent } = await import("@testing-library/react")
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole("button", { name: "开始判读" })).toBeTruthy()
  })
})
