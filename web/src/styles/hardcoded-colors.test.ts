// 硬编码色的护栏：挡住「新债」，不清扫旧债。
//
// 设计令牌在 tokens.css；页面样式应该消费令牌，而不是写死颜色。历史上确实
// 积了一批字面色（mask 的 #000、SVG 的 stop-color、print 样式、color-mix 的
// #fff/#000 —— 多数正当），一次性清扫风险大于收益，所以这里只做棘轮：
// 每个文件允许的字面色数量不得高于登记值，想加新的先减旧的，或者改用令牌。
//
// 为什么按文件计数而不是逐条白名单：白名单要维护近 200 条字面值，改一行
// 注释就会误报；计数棘轮足够挡住「顺手又写了一个 #fff」。
import { readFileSync, readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

const DIR = new URL("./", import.meta.url)

/** 登记基线（2026-11-16）。tokens.css 是令牌真源，不在此列。 */
const BASELINE: Record<string, number> = {
  "admin-document.css": 0,
  "admin-news-preview.css": 0,
  "admin-polish-analysis.css": 0,
  "admin-polish-cms.css": 0,
  "admin-polish-ledger.css": 0,
  "disclaimer.css": 0,
  "markdown.css": 0,
  "records.css": 0,
  "admin-redesign.css": 5,
  "admin.css": 13,
  "agent.css": 3,
  "app.css": 97,
  "auth.css": 24,
  // 47 → 67（E-09，2026-11-18）：新增的 20 条全部来自 `OpticFlow` 的光学带调色板，
  // 且是从 `feat/iris21-multiagent-integration@9a6dbcb6` **逐字**取回的——SVG
  // `stop-color` 与 mask 的 `#000` / `transparent` 属本棘轮明确允许的写死类别，
  // 本轮没有新写任何一个字面色。此处只登记，不放松其他文件。
  "brand.css": 67,
  "fault.css": 1,
  "news.css": 2,
  // 协作四角色的 CRITIC 金（浅/深两版）：现有令牌里没有对应色，
  // 又不属于 mask / SVG / print 这类"必须写死"。登记为待办，等设计层决定是否
  // 升成正式令牌；在此之前不新增第三条字面色。
  "roundtable.css": 2,
  "shell.css": 2,
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g

function countColors(file: string) {
  return readFileSync(new URL(file, DIR), "utf8").match(COLOR)?.length ?? 0
}

describe("硬编码色棘轮", () => {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".css") && name !== "tokens.css")
    .sort()

  it("新增样式文件默认零字面色（要写死就登记）", () => {
    for (const file of files) {
      if (file in BASELINE) continue
      expect(countColors(file), `${file} 不在登记表里，却含硬编码色`).toBe(0)
    }
  })

  it.each(files)("%s 的字面色不超过登记值", (file) => {
    expect(
      countColors(file),
      `${file} 新增了硬编码色。改用 tokens.css 里的令牌；确实必须写死（mask / SVG / print），把登记值加一并在提交信息里说明。`,
    ).toBeLessThanOrEqual(BASELINE[file] ?? 0)
  })
})
