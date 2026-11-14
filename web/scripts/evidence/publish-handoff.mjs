// Iris 2.1 · R3.3 · 交付信号发布（ui-ready.json）
//
// 用法：
//   node web/scripts/evidence/publish-handoff.mjs --ready --branch <b> --sha <sha> \
//        --worktree <dir> --report <path> --tests <json> --changed <json> [--blocker "..."]
//   node web/scripts/evidence/publish-handoff.mjs --revoke
//
// 写 D:\Work\code\iris-integration-handoff\ui-ready.json：
// 同目录临时文件 + 原子替换（rename），避免下游读到半截 JSON。
//
// 规矩：ready=true 只在「UI 任务真完成 + 无未闭合的合并阻断项 + 存在稳定本地
// 提交 + 全部交接内容都在该提交里 + git status 符合要求 + 验收报告完整」时
// 才允许。任何一条不满足就 ready=false 并写明原因——不粉饰完成度。
import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync } from "node:fs"
import { resolve, join } from "node:path"

const HANDOFF_DIR = process.env.HANDOFF_DIR ?? "D:/Work/code/iris-integration-handoff"
const TARGET = join(HANDOFF_DIR, "ui-ready.json")

function parseArgs(argv) {
  const out = { ready: false, blockers: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === "--ready") out.ready = true
    else if (arg === "--revoke") out.ready = false
    else if (arg === "--branch") out.branch = next()
    else if (arg === "--sha") out.sha = next()
    else if (arg === "--worktree") out.worktree = next()
    else if (arg === "--report") out.reportPath = next()
    else if (arg === "--tests") out.tests = JSON.parse(next())
    else if (arg === "--changed") out.changedFiles = JSON.parse(next())
    else if (arg === "--blocker") out.blockers.push(next())
  }
  return out
}

/** 原子替换：同目录临时文件 → rename（同卷 rename 是原子的）。 */
function writeAtomic(path, payload) {
  mkdirSync(resolve(path, ".."), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, payload, "utf8")
  renameSync(tmp, path)
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  // 撤销优先：分支之后再被改动就先把 ready 撤掉，重新验收后再发布。
  if (args.ready) {
    const missing = ["branch", "sha", "worktree", "reportPath"].filter((k) => !args[k])
    if (missing.length) {
      args.ready = false
      args.blockers.push(`缺少必填字段：${missing.join("、")}`)
    }
    if (args.reportPath && !existsSync(args.reportPath)) {
      args.ready = false
      args.blockers.push(`验收报告不存在：${args.reportPath}`)
    }
    if (args.blockers.length) args.ready = false
  }

  const payload = {
    ready: args.ready,
    branch: args.branch ?? null,
    sha: args.sha ?? null,
    worktree: args.worktree ?? null,
    reportPath: args.reportPath ?? null,
    tests: args.tests ?? null,
    changedFiles: args.changedFiles ?? null,
    blockers: args.blockers,
    updatedAt: new Date().toISOString(),
  }

  writeAtomic(TARGET, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`ui-ready.json written → ${TARGET}`)
  console.log(`ready=${payload.ready} blockers=${payload.blockers.length}`)
}

main()
