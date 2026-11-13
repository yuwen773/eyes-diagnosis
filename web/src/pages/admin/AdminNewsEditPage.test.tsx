// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { ThemeProvider } from "@/components/theme-provider"
import { AdminNewsEditPage } from "./AdminNewsEditPage"
import { getNews, saveNews, uploadNewsCover } from "@/lib/adminApi"

vi.mock("@/lib/adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminApi")>()
  return {
    ...actual,
    getNews: vi.fn(),
    saveNews: vi.fn(),
    uploadNewsCover: vi.fn(),
  }
})

// 编辑器本体与样式表只在浏览器管线里有意义：单元测试用同行为的 textarea
// stub 顶上（onChange 直传），不加载真实组件，避免它自带的 CSS 自导入。
vi.mock("@uiw/react-md-editor", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="md-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

afterEach(() => {
  cleanup()
  vi.mocked(getNews).mockReset()
  vi.mocked(saveNews).mockReset()
  vi.mocked(uploadNewsCover).mockReset()
})

/** 跨过 30 字守卫的旧版 HTML 正文（可见字符 ≥ 30）。 */
const LEGACY_HTML =
  "<p>这是一段超过三十个字的旧版富文本正文，用来验证插入封面之后保存依然不会把正文写丢。</p>"

function renderPage(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/admin/news/:id/edit" element={<AdminNewsEditPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

/**
 * 以「已有文章」模式打开编辑页。getNews 用常驻实现：保存后 invalidateQueries
 * 会再次取详情，once 值会被第二次调用消费掉。
 */
async function openEditor(content: string, coverImage?: string) {
  vi.mocked(getNews).mockResolvedValue({
    id: "9001",
    title: "旧文",
    content,
    coverImage,
    status: 1,
  })
  renderPage("/admin/news/9001/edit")
  return await screen.findByRole("button", { name: "保存" })
}

describe("AdminNewsEditPage 保存守卫", () => {
  it("旧 HTML 文章点「插入正文」后再保存，插入的封面不能被丢（P1-1 回归）", async () => {
    vi.mocked(saveNews).mockResolvedValueOnce("9001")
    await openEditor(LEGACY_HTML, "https://cos.test/cover.png")

    fireEvent.click(screen.getByRole("button", { name: "插入正文" }))
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(vi.mocked(saveNews)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(saveNews).mock.calls[0][0].content
    // 走的是 Markdown 渲染管线：插入的封面图在里面，而不是原样回传旧 HTML。
    expect(body).toContain("cos.test/cover.png")
    expect(body).not.toBe(LEGACY_HTML)
    expect((await screen.findAllByText("已保存")).length).toBeGreaterThan(0)
  })

  it("上传封面不得把已存在的未保存编辑抹成干净（P1-2 回归）", async () => {
    vi.mocked(uploadNewsCover).mockResolvedValueOnce("https://cos.test/new.png")
    await openEditor("普通 Markdown 正文，三十个字以上才能通过后端守卫。")

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "改后的标题" } })
    const file = new File(["a"], "cover.png", { type: "image/png" })
    fireEvent.change(screen.getByLabelText("选择封面图片"), { target: { files: [file] } })

    await waitFor(() => expect(vi.mocked(uploadNewsCover)).toHaveBeenCalledTimes(1))
    // 封面已即时写库，但标题的修改仍未保存：保存状态不能翻成「已保存」。
    await screen.findByText("封面已更新")
    expect(screen.getAllByText("未保存").length).toBeGreaterThan(0)
  })

  it("保存请求在途时继续编辑，成功提示不得宣称已全部保存（P1-2 回归）", async () => {
    let resolveSave!: (id: string) => void
    vi.mocked(saveNews).mockImplementation(
      () => new Promise<string>((resolve) => { resolveSave = resolve }),
    )
    await openEditor("普通 Markdown 正文，三十个字以上才能通过后端守卫。")

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "第一稿" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(vi.mocked(saveNews)).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "第一稿再加几个字" } })
    resolveSave("9001")

    await screen.findByText(/保存期间的新修改尚未保存/)
    expect(screen.getAllByText("未保存").length).toBeGreaterThan(0)
  })

  it("正文字符与摘要长度按后端口径：代码块内容计入（P2-3 回归）", async () => {
    const content =
      "<p>导语足够长，用来跨过三十字守卫线，并且</p>" +
      `<pre><code>${"b".repeat(40)}</code></pre>`
    await openEditor(content)

    // 代码块内容后端计入可见文本：摘要长度应显示「30 字」而非「不足 30 字」。
    await screen.findByText("30 字")
    expect(screen.queryByText("不足 30 字")).toBeNull()
  })

  it("Markdown 记号本身不计入正文字符", async () => {
    const markup = "# 标题\n\n> 引用一行\n\n- 条目一\n- 条目二"
    await openEditor(markup)

    await screen.findByText("不足 30 字")
  })
})
