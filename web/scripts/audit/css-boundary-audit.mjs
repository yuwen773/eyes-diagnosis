// Iris · CSS / Tailwind 职责边界审计（只读）
//
// 用法：
//   node web/scripts/audit/css-boundary-audit.mjs [srcDir] [--json] [--top N]
//   （或在 web/ 下 `npm run check:css-boundary`）
//
//   srcDir 默认 `web/src`。审计 origin/ui 基线时不要用工作树的过期副本，先取一份：
//     git archive origin/ui web/src | tar -x -C /tmp/iris-ui-baseline
//     node web/scripts/audit/css-boundary-audit.mjs /tmp/iris-ui-baseline/web/src
//
// 为什么有它：考古报告 §4.4 里「utility 只有 sr-only 7 处」「25 个 CSS / 20,975 行」
// 「全仓无 @layer」是手数出来的，改一次代码就漂。这里把它们变成可重复的机械事实，
// 让「要不要继续混用 utility」这种判断有数可依，而不是靠评审者的记忆。
//
// 它回答三个问题，严格程度不同——别把它们说成同一个门禁：
//   1. 业务代码用了多少 Tailwind utility（启发式分类，令牌少时会有误判）；
//   2. 有没有「同一个 className 里手写类 + utility 混用」——这是唯一会真出视觉问题的形态，
//      因为未分层的手写声明优先于 @layer utilities 里的同名声明；
//   3. CSS 侧有没有分层（@layer / @theme / @custom-variant）。
//
// 边界：这是静态文本扫描，不是 CSS 层叠求解器。它能证明「混用存在」，
// 不能证明「视觉已经错了」——后者要渲染截图。误判方向请按「宁漏勿错」理解：
// 只统计能被明确归类的 utility，认不出的单 token 进 unknown 列表供人看。
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const positional = args.filter((a) => !a.startsWith("--"))
const topN = flags.has("--top") ? Number(args[args.indexOf("--top") + 1]) || 20 : 20
// 默认扫 `web/src`，与从哪个目录调用无关（`npm run` 的 cwd 是 web/）。
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const srcDir = resolve(positional[0] ?? join(WEB_ROOT, "src"))
const asJson = flags.has("--json")

// ── 遍历 ────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".r2-baseline") continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(entry)) out.push(p)
  }
  return out
}

// ── 分类 ────────────────────────────────────────────────────────────────
// BEM / 状态类：手写语义类的确定性特征。
const SEMANTIC_RE = /(__|--|^(?:is|has|js)-)/
// 结构类 utility（无前缀，必须逐一列出，否则 `block`/`content` 这类会和语义词混淆）。
const STRUCTURAL = new Set([
  "flex", "grid", "block", "inline", "inline-block", "inline-flex", "inline-grid",
  "hidden", "contents", "table", "relative", "absolute", "fixed", "sticky",
  "static", "truncate", "sr-only", "not-sr-only", "container", "isolate",
  "uppercase", "lowercase", "capitalize", "italic", "underline", "antialiased",
])
// 带前缀的 utility。前缀后面必须跟 `-`，避免把 `text` 这种裸词算进来。
const PREFIXED_RE = new RegExp(
  "^-?(?:" +
    [
      "p", "px", "py", "pt", "pb", "pl", "pr",
      "m", "mx", "my", "mt", "mb", "ml", "mr",
      "w", "h", "min-w", "min-h", "max-w", "max-h", "size",
      "gap", "space-x", "space-y", "inset", "inset-x", "inset-y",
      "top", "right", "bottom", "left", "z", "order",
      "col", "row", "grid-cols", "grid-rows", "col-span", "row-span",
      "basis", "grow", "shrink", "translate-x", "translate-y", "scale", "rotate", "skew-x", "skew-y",
      "transition", "duration", "delay", "ease", "animate",
      "opacity", "shadow", "rounded", "border", "divide-x", "divide-y", "ring", "outline",
      "font", "text", "leading", "tracking", "indent", "line-clamp",
      "list", "align", "justify", "items", "self", "place", "content",
      "overflow", "object", "aspect", "columns", "whitespace", "break",
      "cursor", "select", "pointer-events", "resize", "touch", "scroll",
      "fill", "stroke", "bg", "from", "via", "to", "decoration",
      "backdrop-blur", "blur", "drop-shadow", "accent", "caret",
    ].join("|") +
    ")-",
)
// 变体前缀：`md:flex`、`hover:bg-x`、`dark:text-y`。
const VARIANT_RE = /^(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|focus-within|active|visited|disabled|group|peer|dark|aria|data|motion-safe|motion-reduce|print):/
// 任意值：`bg-[--surface]`、`w-[42px]`。
const ARBITRARY_RE = /\[[^\]]+\]/

function classify(token) {
  if (SEMANTIC_RE.test(token)) return "semantic"
  if (VARIANT_RE.test(token)) return "utility"
  if (STRUCTURAL.has(token) || PREFIXED_RE.test(token) || ARBITRARY_RE.test(token)) return "utility"
  return "unknown"
}

// ── 抽取 className 字面量 ────────────────────────────────────────────────
/** `cn(...)` / `clsx(...)` 调用里的字符串字面量（括号配平扫描，够用即可）。 */
function cnLiterals(code) {
  const out = []
  const callRe = /\b(?:cn|clsx|classNames)\s*\(/g
  let m
  while ((m = callRe.exec(code))) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < code.length && depth > 0) {
      const ch = code[i]
      if (ch === "(") depth++
      else if (ch === ")") depth--
      i++
    }
    const inner = code.slice(start, i - 1)
    // 只取简单字符串字面量；条件表达式里的变量不参与分类。
    for (const lit of inner.matchAll(/["'`]([^"'`$]*)["'`]/g)) out.push(lit[1])
  }
  return out
}

const CLASSNAME_RES = [
  /className\s*=\s*"([^"]*)"/g,
  /className\s*=\s*'([^']*)'/g,
  /className\s*=\s*\{`([^`$]*)`\}/g,
]

// ── 主流程 ──────────────────────────────────────────────────────────────
const files = walk(srcDir)
const tsxFiles = files.filter((f) => /\.tsx?$/.test(f))
const cssFiles = files.filter((f) => f.endsWith(".css"))

const classFreq = new Map() // token → count
const kind = new Map() // token → kind
const mixed = [] // { file, line, text, utilities, semantics }
let literalCount = 0

for (const file of tsxFiles) {
  const code = readFileSync(file, "utf-8")
  const hits = []
  for (const re of CLASSNAME_RES) {
    for (const m of code.matchAll(re)) hits.push({ text: m[1], index: m.index })
  }
  for (const text of cnLiterals(code)) hits.push({ text, index: -1 })

  for (const hit of hits) {
    literalCount++
    const tokens = hit.text.split(/\s+/).filter((t) => t && !t.includes("${"))
    if (!tokens.length) continue
    const utils = []
    const sems = []
    for (const t of tokens) {
      const k = classify(t)
      classFreq.set(t, (classFreq.get(t) ?? 0) + 1)
      kind.set(t, k)
      if (k === "utility") utils.push(t)
      else if (k === "semantic") sems.push(t)
    }
    if (utils.length && sems.length) {
      const line = hit.index >= 0 ? code.slice(0, hit.index).split("\n").length : 0
      mixed.push({ file: relative(srcDir, file), line, text: hit.text, utilities: utils, semantics: sems })
    }
  }
}

const cssStats = cssFiles.map((f) => {
  const code = readFileSync(f, "utf-8")
  return {
    file: relative(srcDir, f),
    // 与 `wc -l` / 编辑器行号一致：末尾换行不额外算一行。
    lines: code.split("\n").length - (code.endsWith("\n") ? 1 : 0),
    layer: (code.match(/@layer\s/g) ?? []).length,
    theme: (code.match(/@theme\b/g) ?? []).length,
    variant: (code.match(/@custom-variant\s/g) ?? []).length,
    important: (code.match(/!important/g) ?? []).length,
  }
})

const byKind = (k) => [...classFreq].filter(([t]) => kind.get(t) === k)
const utilities = byKind("utility").sort((a, b) => b[1] - a[1])
const unknowns = byKind("unknown").sort((a, b) => b[1] - a[1])
const sum = (rows) => rows.reduce((s, [, n]) => s + n, 0)

const result = {
  srcDir,
  files: { tsx: tsxFiles.length, css: cssFiles.length },
  classNameLiterals: literalCount,
  distinctTokens: classFreq.size,
  utility: { occurrences: sum(utilities), distinct: utilities.length, top: utilities.slice(0, topN) },
  unknown: { occurrences: sum(unknowns), distinct: unknowns.length, top: unknowns.slice(0, topN) },
  css: {
    lines: cssStats.reduce((s, f) => s + f.lines, 0),
    layerDeclarations: cssStats.reduce((s, f) => s + f.layer, 0),
    themeBlocks: cssStats.reduce((s, f) => s + f.theme, 0),
    darkVariants: cssStats.reduce((s, f) => s + f.variant, 0),
    important: cssStats.reduce((s, f) => s + f.important, 0),
    top: cssStats.sort((a, b) => b.lines - a.lines).slice(0, 10),
  },
  mixed,
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(2) : "0.00")
const fmt = (rows) => (rows.length ? rows.map(([t, n]) => `\`${t}\`×${n}`).join(" · ") : "（无）")

console.log(`# CSS / Tailwind 边界审计
`)
console.log(`基线目录：\`${srcDir}\`
`)
console.log(`## 汇总
`)
console.log(`| 指标 | 数值 |
|---|---|
| TS/TSX 文件 | ${tsxFiles.length} |
| CSS 文件 | ${cssFiles.length} |
| className 字面量 | ${literalCount} |
| 去重类名 | ${classFreq.size} |
| utility 出现次数 | ${result.utility.occurrences}（去重 ${result.utility.distinct}），占比 ${pct(result.utility.occurrences, literalCount)} 个/字面量 |
| 无法归类 token | ${result.unknown.occurrences}（去重 ${result.unknown.distinct}） |
| **同一 className 内 utility + 手写类混用** | **${mixed.length}** |
| 手写 CSS 行数 | ${result.css.lines} |
| \`@layer\` 声明 | ${result.css.layerDeclarations} |
| \`@theme\` 块 | ${result.css.themeBlocks} |
| \`@custom-variant\` | ${result.css.darkVariants} |
| \`!important\` | ${result.css.important} |
`)
console.log(`## utility 明细（前 ${topN}）
`)
console.log(`${fmt(result.utility.top)}
`)
if (mixed.length) {
  console.log(`## 混用明细（前 ${topN}）—— 这些是「一旦真混用就会踩层叠」的位置
`)
  for (const m of mixed.slice(0, topN)) {
    console.log(`- \`${m.file}:${m.line}\` utility=${m.utilities.map((t) => `\`${t}\``).join(",")} 手写=${m.semantics.map((t) => `\`${t}\``).join(",")}`)
  }
  console.log()
} else {
  console.log(`## 混用明细

没有发现同一 className 字面量里同时含 utility 与手写语义类。
这意味着层叠冲突目前是**结构性风险，不是已发生的故障**；引入更多 utility 时才会触发。
`)
}
console.log(`## CSS 体量分布（前 10）
`)
console.log(`| 文件 | 行数 | @layer | !important |`)
console.log(`|---|---|---|---|`)
for (const f of result.css.top) console.log(`| \`${f.file}\` | ${f.lines} | ${f.layer} | ${f.important} |`)
console.log()
if (unknowns.length) {
  console.log(`## 未归类 token（前 ${topN}，供人工判断）
`)
  console.log(`${fmt(result.unknown.top)}
`)
}
