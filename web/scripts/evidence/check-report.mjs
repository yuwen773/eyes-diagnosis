// Iris 2.1 · R3.3 · 验收报告与证据树的一致性检查
//
// 用法：
//   node web/scripts/evidence/check-report.mjs [--dir docs/design/admin-pages-polish]
//   （或在 web/ 下 `npm run check:report`）
//
// 为什么有它：报告里的「共 N 张」、被引用的截图路径、钉住的 commit 全靠手改，
// 本任务里已经漂过两次（after/ 82 → 85、HEAD 引用过期）。这些是机械事实，
// 不该靠评审者的眼睛去对。
//
// 检查三类，严格程度不同——别把它们说成同一个门禁：
//   1. 计数（严格）：证据目录里的真实 PNG 数 == 报告表格里写的「共 **N 张**」；
//   2. 路径（严格）：报告里反引号引用的证据文件（支持 * 与 {a,b}）必须至少命中一个；
//   3. commit/tree 引用（有条件严格）：反引号里的 7–40 位十六进制串要能在对象库里解析。
//      - 完整克隆里解析不到 → 失败；
//      - 浅克隆（CI 默认 fetch-depth: 1）里无从判定 → 只告警，不误判历史 SHA；
//      - 确实属于外部仓库 / 其他分支历史的引用 → 登记进 sha-allowlist.json 并写明原因。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DOCS = ["README.md", "pr-body.md"]
const EVIDENCE_DIRS = ["after", "after-nodata", "before", "before-nodata", "compare", "acceptance"]

const args = process.argv.slice(2)
const dirArg = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "docs/design/admin-pages-polish"
const reportDir = resolve(REPO_ROOT, dirArg)

const problems = []
const warnings = []

function countFiles(sub) {
  const p = join(reportDir, sub)
  if (!existsSync(p) || !statSync(p).isDirectory()) return 0
  return readdirSync(p).filter((f) => f.endsWith(".png")).length
}

/** 反引号里的行内代码片段。 */
function inlineCode(text) {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim())
}

/** `{a,b}` 展开成多条模式。 */
function expandBraces(pattern) {
  const m = pattern.match(/\{([^{}]+)\}/)
  if (!m) return [pattern]
  return m[1]
    .split(",")
    .flatMap((alt) => expandBraces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)))
}

/** 模式 → 正则（只支持 `*`，不跨目录）。 */
function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
  return new RegExp(`^${escaped}$`)
}

/** 证据路径是否至少命中一个真实文件。 */
function matchesEvidence(pattern) {
  if (!pattern.includes("*") && !pattern.includes("{")) {
    return existsSync(join(reportDir, pattern))
  }
  const candidates = expandBraces(pattern).map(patternToRegExp)
  // 模式都带目录前缀，逐个目录列文件名再匹配。
  for (const sub of EVIDENCE_DIRS) {
    const dir = join(reportDir, sub)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      const rel = `${sub}/${file}`
      if (candidates.some((re) => re.test(rel))) return true
    }
  }
  return false
}

/** 对象库里有没有这个对象：先按 commit，再按 tree（报告会引用合并树的 sha）。 */
function isKnownObject(sha) {
  for (const kind of ["commit", "tree"]) {
    try {
      execFileSync("git", ["-C", REPO_ROOT, "cat-file", "-e", `${sha}^{${kind}}`], { stdio: "ignore" })
      return true
    } catch {
      // 试下一种
    }
  }
  return false
}

/** 浅克隆里历史对象本来就不在本地，找不到不能算错。 */
function isShallowRepo() {
  try {
    const out = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--is-shallow-repository"], {
      encoding: "utf8",
    })
    return out.trim() === "true"
  } catch {
    return false
  }
}

/** 合法的外部 / 其他分支历史引用，由报告目录下的 sha-allowlist.json 声明。 */
function loadShaAllowlist() {
  const p = join(reportDir, "sha-allowlist.json")
  if (!existsSync(p)) return []
  try {
    const list = JSON.parse(readFileSync(p, "utf8")).entries
    if (!Array.isArray(list)) throw new Error("entries 必须是数组")
    return list.filter((e) => {
      if (
        !e ||
        typeof e.sha !== "string" ||
        !/^[a-f0-9]{7,40}$/.test(e.sha) ||
        typeof e.reason !== "string" ||
        !e.reason.trim()
      ) {
        problems.push(
          "sha-allowlist.json: 每条必须包含合法的 7–40 位十六进制 sha 与非空 reason"
        )
        return false
      }
      return true
    })
  } catch (e) {
    problems.push(`sha-allowlist.json 解析失败：${e.message}`)
    return []
  }
}

/** 允许写全 40 位，也允许写 7 位前缀。 */
function isAllowlisted(sha, allowlist) {
  return allowlist.some((e) => e.sha.startsWith(sha) || sha.startsWith(e.sha))
}

const docs = DOCS.filter((f) => existsSync(join(reportDir, f))).map((f) => ({
  name: f,
  text: readFileSync(join(reportDir, f), "utf8"),
}))
if (docs.length === 0) {
  console.error(`没有找到报告文件：${reportDir}`)
  process.exit(1)
}

// ── 1. 计数 ────────────────────────────────────────────────
const actual = Object.fromEntries(EVIDENCE_DIRS.map((d) => [d, countFiles(d)]))
for (const { name, text } of docs) {
  for (const sub of EVIDENCE_DIRS) {
    // 只认表格行：| `after/` | … 共 **85 张** …
    const row = text.split("\n").find((l) => l.startsWith(`| \`${sub}/\``))
    if (!row) continue
    // 这一行不按「张」计数（如 acceptance/ 只有 JSON）就不核对。
    if (!row.includes("张")) continue
    // 两种写法都认：「共 **18 张**」与「**18 张**」。
    const stated = row.match(/共 \*\*(\d+) 张\*\*/) ?? row.match(/\*\*(\d+) 张\*\*/)
    if (!stated) {
      problems.push(`${name}: 「${sub}/」行没有写「共 **N 张**」，无法核对`)
      continue
    }
    const n = Number(stated[1])
    if (n !== actual[sub]) {
      problems.push(`${name}: 「${sub}/」写共 ${n} 张，实际 ${actual[sub]} 张`)
    }
  }
}

// ── 2. 被引用的证据路径 ────────────────────────────────────
const pathRe = new RegExp(`^(${EVIDENCE_DIRS.join("|")})/`)
for (const { name, text } of docs) {
  for (const code of inlineCode(text)) {
    if (!pathRe.test(code) || /\s/.test(code)) continue
    if (!matchesEvidence(code)) problems.push(`${name}: 引用的证据路径不存在 → \`${code}\``)
  }
}

// ── 3. 被引用的 commit / tree ──────────────────────────────
// 严格程度取决于环境：完整克隆里找不到就是真错；浅克隆里只告警。
const shallow = isShallowRepo()
const allowlist = loadShaAllowlist()
const seen = new Set()
for (const { name, text } of docs) {
  for (const code of inlineCode(text)) {
    // 至少含一个 a–f：纯数字是工单号 / workflow run id / 数据库 id，不是 sha。
    if (!/^[0-9a-f]{7,40}$/.test(code) || !/[a-f]/.test(code) || seen.has(code)) continue
    seen.add(code)
    if (isAllowlisted(code, allowlist) || isKnownObject(code)) continue
    if (shallow) {
      warnings.push(`${name}: 浅克隆无法判定 \`${code}\` 是否存在（需要完整历史时用 fetch-depth: 0）`)
    } else {
      problems.push(
        `${name}: 引用的 commit/tree 不在本仓库对象库 → \`${code}\`` +
          `（确属外部仓库或其他分支历史的话，登记进 sha-allowlist.json）`,
      )
    }
  }
}

// ── 输出 ───────────────────────────────────────────────────
const summary = EVIDENCE_DIRS.map((d) => `${d}=${actual[d]}`).join("  ")
console.log(`证据计数：${summary}`)
for (const w of warnings) console.log(`  warn  ${w}`)
if (problems.length) {
  console.error(`\n报告与证据树不一致（${problems.length} 条）：`)
  for (const p of problems) console.error(`  FAIL  ${p}`)
  process.exit(1)
}
const shaVerdict = shallow ? "commit 引用只做了告警级检查（浅克隆）" : "commit 引用均可在对象库解析"
console.log(`\nOK：${relative(REPO_ROOT, reportDir)} 的计数与引用路径一致；${shaVerdict}`)
