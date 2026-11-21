// e2e 的 fixme / only 预算门禁
//
// 用法：在 web/ 下 `npm run check:e2e-fixme`（CI 的 web job 也跑这一步）
//
// 为什么有它：`test.fixme` 是隔离已知失败的临时手段，不是"这条先不跑"的永久开关。
// 一旦允许随手加，冒烟套件会静默退化成"1 条真跑 + N 条跳过"，而报告里还写着"冒烟通过"。
// 所以把"哪些可以跳过、为什么、归属哪张单"落成受审的文件 web/e2e/fixme-budget.json：
//   - 新加一条 fixme 而不登记 → 失败（登记本身就是审批动作）；
//   - 登记了但测试已修好 → 失败（逼着删条目，fixme 才临时）；
//   - 总数超过 budget.max → 失败；
//   - 出现 test.only → 失败（它会让其余用例静默不跑，同一类问题）。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const E2E_DIR = join(WEB_ROOT, "e2e")
const BUDGET_FILE = join(E2E_DIR, "fixme-budget.json")

const problems = []

if (!existsSync(BUDGET_FILE)) {
  console.error("缺少 e2e/fixme-budget.json：fixme 必须登记在受审的白名单里")
  process.exit(1)
}
const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"))
const max = Number(budget.max)
if (!Number.isInteger(max) || max < 0) {
  console.error(`fixme-budget.json 的 max 必须是 >=0 的整数，当前：${budget.max}`)
  process.exit(1)
}

/** 递归收集 e2e 下的 *.spec.ts。 */
function specFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...specFiles(p))
    else if (name.endsWith(".spec.ts")) out.push(p)
  }
  return out
}

/** 声明层 `test.fixme("标题", …)`；同时抓 `test.only`。 */
function scan(text) {
  const fixmes = []
  const onlys = []
  for (const m of text.matchAll(/\btest\.fixme\s*\(/g)) {
    const rest = text.slice(m.index + m[0].length)
    const title = rest.match(/^\s*(["'`])([^"'`\n]*)\1/)
    fixmes.push(title ? title[2] : null)
  }
  for (const m of text.matchAll(/\btest\.only\s*\(/g)) onlys.push(m.index)
  return { fixmes, onlys }
}

const actual = []
for (const file of specFiles(E2E_DIR)) {
  const rel = relative(WEB_ROOT, file).replace(/\\/g, "/")
  const { fixmes, onlys } = scan(readFileSync(file, "utf8"))
  for (const title of fixmes) {
    if (title == null) {
      problems.push(
        `${rel}: 有 test.fixme 的首参不是标题字符串。声明层写法才可靠——` +
          `写在用例 body 里的 fixme 要等 beforeEach 跑完才执行，跳不掉。`,
      )
      continue
    }
    actual.push({ file: rel, title })
  }
  for (const _ of onlys) problems.push(`${rel}: 出现 test.only，其余用例会静默不跑`)
}

if (!Array.isArray(budget.entries)) {
  console.error("fixme-budget.json 的 entries 必须是数组")
  process.exit(1)
}
const entries = budget.entries.filter((entry) => {
  if (!entry || typeof entry !== "object") {
    problems.push("fixme-budget.json: 登记条目必须是对象")
    return false
  }
  return true
})
const key = (e) => `${e.file}::${e.title}`

for (const a of actual) {
  if (!entries.some((e) => key(e) === key(a))) {
    problems.push(
      `${a.file}: 未登记的 fixme →「${a.title}」` +
        `。要跳过必须先登记进 e2e/fixme-budget.json（含 issue 号），并经人审批。`,
    )
  }
}
for (const e of entries) {
  for (const field of ["file", "title", "reason"]) {
    if (typeof e[field] !== "string" || !e[field].trim()) {
      problems.push(
        `fixme-budget.json:「${e.title ?? "未命名"}」缺少非空 ${field}`
      )
    }
  }
  if (!Number.isInteger(e.issue) || e.issue <= 0) {
    problems.push(`fixme-budget.json:「${e.title}」缺少 issue 号，跳过必须有单可追`)
  }
  if (!actual.some((a) => key(a) === key(e))) {
    problems.push(
      `fixme-budget.json:「${e.title}」对应的 fixme 已不存在` +
        `。测试修好后要删掉条目，否则白名单会慢慢变成永久跳过名单。`,
    )
  }
}
if (actual.length > max) {
  problems.push(`fixme 共 ${actual.length} 条，超过预算 max=${max}`)
}

console.log(`e2e fixme: ${actual.length}/${max}`)
for (const a of actual) console.log(`  fixme  ${a.file}  ${a.title}`)

if (problems.length) {
  console.error(`\nfixme 门禁未通过（${problems.length} 条）：`)
  for (const p of problems) console.error(`  FAIL  ${p}`)
  process.exit(1)
}
console.log("OK：fixme 全部已登记，且没有 test.only")
