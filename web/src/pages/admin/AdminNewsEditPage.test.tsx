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
async function openEditor(
  content: string,
  coverImage?: string,
  status = 0,
  publishTime?: string,
  summary?: string,
) {
  vi.mocked(getNews).mockResolvedValue({
    id: "9001",
    title: "旧文",
    content,
    coverImage,
    status,
    publishTime,
    summary,
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

    // 代码块内容后端计入可见文本：摘要长度应显示「30 字符」而非「不足 30 字符」。
    await screen.findByText("30 字符")
    expect(screen.queryByText("不足 30 字符")).toBeNull()
  })

  it("Markdown 记号本身不计入正文字符", async () => {
    const markup = "# 标题\n\n> 引用一行\n\n- 条目一\n- 条目二"
    await openEditor(markup)

    await screen.findByText("不足 30 字符")
  })
})

describe("AdminNewsEditPage 完整文章预览", () => {
  it("预览反映未保存的标题与正文，且不触发保存", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "还没保存的标题" } })
    fireEvent.change(screen.getByTestId("md-editor"), {
      target: { value: "## 第一节\n\n这是预览里应该出现的正文。" },
    })
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))

    const article = screen.getByRole("heading", { level: 2, name: "还没保存的标题" })
    expect(article.closest(".news-article")).toBeTruthy()
    expect(screen.getByText("这是预览里应该出现的正文。")).toBeTruthy()
    expect(saveNews).not.toHaveBeenCalled()
    // 未发布信息的预览稿不编造发布时间。
    expect(screen.getByText(/预览稿 · 尚未发布/)).toBeTruthy()
  })

  it("预览里的文章标题是 h2，同一页不出现两个 h1", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))

    // 编辑页自己的 h1（「编辑资讯」）+ 预览里的文章标题（h2）= 一个 h1。
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0)
  })

  it("发布设置栏在预览里无条件收起，未保存修改另行提示", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    // 收起右栏是「切到预览」的结果，与有没有未保存修改无关——
    // 提示语不能写成「有未保存修改所以收起了右栏」这种不存在的因果。
    expect(screen.getByText(/预览时收起发布设置栏/)).toBeTruthy()
    expect(screen.queryByText(/当前有未保存修改/)).toBeNull()

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "改了标题" } })
    expect(screen.getByText(/当前有未保存修改/)).toBeTruthy()
  })

  it("预览条报出当前模拟的视口宽度", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))

    // 宽度读数摆在预览条上：管理员窗口窄一点，预览就换一档版式。
    expect(screen.getByText(/模拟视口/)).toBeTruthy()
  })

  it("已发布文章不摆「预览稿」眉线，待审核 / 下架 / 草稿才摆", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    // status: 0（草稿）fixture：眉线必须存在。
    expect(screen.getByText(/预览稿 · 尚未发布/)).toBeTruthy()
  })

  it("status=1 已发布才走真实发布时间；待审核 / 下架一律不冒充已上线", async () => {
    // 已发布：摆真实发布时间，不摆「预览稿」眉线。
    await openEditor(LEGACY_HTML, undefined, 1, "2026-11-01 09:30:00")
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    expect(screen.queryByText(/预览稿 · 尚未发布/)).toBeNull()
    expect(screen.getByText(/2026-11-01/)).toBeTruthy()
    cleanup()

    // 待审核（3）：公开页看不到，却带着 publishTime——不能显示成已上线。
    await openEditor(LEGACY_HTML, undefined, 3, "2026-11-01 09:30:00")
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    expect(screen.getByText(/预览稿 · 尚未发布/)).toBeTruthy()
    expect(screen.queryByText(/2026-11-01/)).toBeNull()
    cleanup()

    // 下架（2）：同上。
    await openEditor(LEGACY_HTML, undefined, 2, "2026-11-01 09:30:00")
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    expect(screen.getByText(/预览稿 · 尚未发布/)).toBeTruthy()
    expect(screen.queryByText(/2026-11-01/)).toBeNull()
  })

  it("桌面 / 手机切换只改设备框，文章组件还是同一个", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))

    expect(document.querySelector(".admin-newsedit__device--desktop")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "手机" }))

    expect(document.querySelector(".admin-newsedit__device--mobile")).toBeTruthy()
    expect(document.querySelectorAll(".news-article")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "手机" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("保存后摘要按后端口径显示正文前 30 字，不足时如实说保存会被拒绝", async () => {
    await openEditor("<p>短正文。</p>")
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    expect(screen.getByText("正文不足 30 个字符，保存会被拒绝")).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "编辑" }))
    fireEvent.change(screen.getByTestId("md-editor"), {
      target: { value: "一".repeat(40) },
    })
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))
    // 后端落库的是刚好 30 个字、不带省略号：预览读数必须同形。
    expect(screen.getByText(/^一{30}$/)).toBeTruthy()
  })

  it("库里旧摘要与保存后摘要不同时，两者并列显示", async () => {
    await openEditor(LEGACY_HTML, undefined, 0, undefined, "旧文章手写的九字摘要")
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))

    expect(screen.getByText(/库里当前摘要：旧文章手写的九字摘要/)).toBeTruthy()
    expect(screen.getByText(/保存后摘要（前 30 字符）/)).toBeTruthy()
  })
})

describe("AdminNewsEditPage 旧版 HTML 预览", () => {
  it("保存后摘要剥掉标签，不把 <p> 当正文显示", async () => {
    await openEditor(LEGACY_HTML)
    fireEvent.click(screen.getByRole("tab", { name: "预览" }))

    expect(screen.queryByText(/<p>/)).toBeNull()
    const summary = screen.getByText("保存后摘要（前 30 字符）").parentElement?.textContent ?? ""
    expect(summary).toContain("这是一段超过三十个字的旧版富文本正文")
    expect(summary).not.toContain("<p>")
  })
})
