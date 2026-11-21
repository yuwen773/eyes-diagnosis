// @vitest-environment jsdom
// 渐进式 Markdown：流式期间就要成形，收口时不能跳变，危险内容一律净化。
import { beforeEach, describe, expect, it } from "vitest"

import {
  createIncrementalMarkdownRenderer,
  getMarkdownRenderStats,
  renderMarkdown,
  renderNewsHtml,
  resetMarkdownRenderStats,
  stableBoundary,
} from "./markdown"

beforeEach(() => {
  resetMarkdownRenderStats()
})

describe("renderMarkdown 基础排版", () => {
  it("标题、粗体、列表、引用、表格、代码都渲染成结构", () => {
    const html = renderMarkdown(
      [
        "## 判读要点",
        "",
        "这是**重点**，另有 *补充*。",
        "",
        "- 第一项",
        "- 第二项",
        "",
        "> 引用一句",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        "| 视力 | 1.0 |",
        "",
        "```python",
        "print(1)",
        "```",
      ].join("\n"),
    )
    expect(html).toContain("<h2")
    expect(html).toContain("<strong>重点</strong>")
    expect(html).toContain("<ul>")
    expect(html).toContain("<blockquote>")
    expect(html).toContain("<table>")
    expect(html).toContain("<th>项目</th>")
    expect(html).toContain('class="copy-btn"')
    expect(html).toContain("data-code")
  })

  it("危险内容过不了净化：脚本、事件属性、javascript: 链接", () => {
    const html = renderMarkdown(
      '<img src=x onerror="alert(1)"> [点我](javascript:alert(1)) <script>alert(1)</script>',
    )
    const host = document.createElement("div")
    host.innerHTML = html

    // 原始 HTML 已被 markdown-it 转义成文字，净化层再兜一道：没有任何活动内容。
    expect(host.querySelector("script")).toBeNull()
    expect(host.querySelector("[onerror]")).toBeNull()
    for (const a of Array.from(host.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i)
    }
    expect(html).toContain("&lt;script&gt;")
  })

  it("外链新开窗口并带 noopener", () => {
    const html = renderMarkdown("[文献](https://example.org/a)")
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it("空内容返回空串", () => {
    expect(renderMarkdown("")).toBe("")
  })
})

describe("流式过程中的结构成形", () => {
  it("标题与段落在第一片就已成形，不用等整段收口", () => {
    const r = createIncrementalMarkdownRenderer()
    const html = r.render("## 小标题\n\n第一段内容还在", true)
    expect(html).toContain("<h2")
    expect(html).toContain("第一段内容还在")
  })

  it("未闭合的粗体不报错，闭合后收敛成 strong", () => {
    const r = createIncrementalMarkdownRenderer()
    const partial = r.render("这是**重点", true)
    expect(partial).toContain("重点")
    expect(partial).not.toContain("<strong>")
    const closed = r.render("这是**重点**。", true)
    expect(closed).toContain("<strong>重点</strong>")
  })

  it("未闭合的代码围栏先成形为代码块，且暂不做语法高亮", () => {
    const r = createIncrementalMarkdownRenderer()
    const html = r.render("```python\nprint(1)\nprint(2", true)
    expect(html).toContain("<pre")
    expect(html).toContain('class="copy-btn"')
    expect(html).toContain("print(2")
    // 围栏还没闭合：跳过 hljs，避免每 60ms 重跑一遍越来越长的代码。
    expect(html).not.toContain("hljs-keyword")
  })

  it("围栏闭合后进入稳定段，恢复语法高亮", () => {
    const r = createIncrementalMarkdownRenderer()
    r.render("```python\ndef f(", true)
    r.render("```python\ndef f():\n    return 1\n```\n\n后面的话", true)
    const final = r.render("```python\ndef f():\n    return 1\n```\n\n后面的话", false)
    expect(final).toContain("hljs-keyword")
    expect(final).toContain("后面的话")
  })

  it("表格只到表头与分隔行时也已成表格，不会先显示成一堆竖线", () => {
    const r = createIncrementalMarkdownRenderer()
    const html = r.render("| 项目 | 值 |\n| --- | --- |\n", true)
    expect(html).toContain("<table>")
    expect(html).toContain("<th>项目</th>")
  })

  it("收口渲染与一次性渲染结果一致（不留分段差异）", () => {
    const content = [
      "### 结论",
      "",
      "建议**复查**。",
      "",
      "1. 先看视力",
      "2. 再看眼压",
      "",
      "> 仅供医生参考",
      "",
      "| 项目 | 值 |",
      "| --- | --- |",
      "| 眼压 | 18 |",
    ].join("\n")
    const r = createIncrementalMarkdownRenderer()
    for (let i = 1; i <= content.length; i += 7) r.render(content.slice(0, i), true)
    const streamed = r.render(content, false)
    expect(streamed).toBe(renderMarkdown(content))
  })

  it("引用式链接定义是全文作用域：分段渲染也不丢引用", () => {
    const content = "见[指南][g]。\n\n[g]: https://example.org/g"
    const r = createIncrementalMarkdownRenderer()
    const html = r.render(content, true)
    expect(html).toContain('href="https://example.org/g"')
  })

  it("内容被整体替换（重新生成）时从头渲染，不残留旧内容", () => {
    const r = createIncrementalMarkdownRenderer()
    r.render("## 旧标题\n\n旧内容", true)
    const html = r.render("## 新标题\n\n新内容", true)
    expect(html).toContain("新标题")
    expect(html).not.toContain("旧标题")
  })

  it("同一份已收口内容重复请求直接复用，不重复解析", () => {
    const r = createIncrementalMarkdownRenderer()
    r.render("## 结论\n\n正文", false)
    const before = getMarkdownRenderStats().renders
    r.render("## 结论\n\n正文", false)
    expect(getMarkdownRenderStats().renders).toBe(before)
  })
})

describe("stableBoundary", () => {
  it("在顶层空行处切分", () => {
    expect(stableBoundary("a\n\nb\n")).toBe(3)
  })

  it("不切在代码围栏里面", () => {
    const text = "```\ncode\n\nmore\n```\n\ntail\n"
    const cut = stableBoundary(text)
    // 切点必须在围栏闭合之后
    expect(text.slice(0, cut)).toContain("```")
    expect(text.slice(0, cut).split("```").length % 2).toBe(1)
  })

  it("空行后面接列表/引用/表格时不切：这些结构会跨空行延续", () => {
    expect(stableBoundary("段落\n\n- 项\n")).toBe(0)
    expect(stableBoundary("段落\n\n> 引用\n")).toBe(0)
    expect(stableBoundary("段落\n\n| a |\n")).toBe(0)
  })

  it("空行前面是列表项时不切：松散列表会被切成两个列表", () => {
    expect(stableBoundary("- 一\n\n- 二\n")).toBe(0)
    expect(stableBoundary("1. 一\n\n2. 二\n")).toBe(0)
  })

  it("空行后面是缩进代码块时不切", () => {
    expect(stableBoundary("段落\n\n    code\n")).toBe(0)
  })

  it("空行后面是 setext 下划线时不切（上一行会被改写标题）", () => {
    expect(stableBoundary("段落\n\n===\n")).toBe(0)
  })
})

describe("长文本的渲染工作量", () => {
  it("稳定段只渲染一次：总解析字符量远小于逐片全量重渲", () => {
    const paragraph = (i: number) => `第 ${i} 段：建议定期复查眼压与视野，必要时补充 OCT。`
    const chunks: string[] = []
    for (let i = 0; i < 120; i += 1) chunks.push(`${paragraph(i)}\n\n`)
    const full = chunks.join("")

    const r = createIncrementalMarkdownRenderer()
    let acc = ""
    for (const chunk of chunks) {
      acc += chunk
      r.render(acc, true)
    }

    const stats = getMarkdownRenderStats()
    // 逐片全量重渲会处理 O(n²) 字符；稳定段缓存后应接近线性。
    const quadratic = (full.length * chunks.length) / 2
    expect(stats.chars).toBeLessThan(quadratic / 4)
    expect(stats.chars).toBeLessThan(full.length * 8)
    // 每次追加只新增常数级解析（一次尾段 + 偶尔一次稳定段），不随长度增长。
    expect(stats.renders).toBeLessThan(chunks.length * 3)
  })
})

describe("renderNewsHtml", () => {
  it("资讯正文不带仪器外壳：没有复制按钮与高亮脚本", () => {
    const html = renderNewsHtml("## 标题\n\n```js\nconst a = 1\n```")
    expect(html).toContain("<h2")
    expect(html).not.toContain("copy-btn")
  })

  it("文档预览可以禁掉远程图片", () => {
    const html = renderNewsHtml("![图](https://third-party.example/t.gif)", {
      allowRemoteImages: false,
    })
    expect(html).not.toContain("third-party.example")
  })
})
