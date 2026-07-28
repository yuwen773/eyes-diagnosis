#!/usr/bin/env node
// scripts/exposure-scan.mjs
//
// RELEASE-001 最终安全扫描 —— 静态暴露门禁（纯新增，零侵入业务代码）
//
// 作用：扫描生产代码，拦截 PR-12 冻结清单禁止「新增」的标识符
//      （nextNode / nextSegment / routeCondition / internal.Edge / rawPrediction /
//       topK / modelScore / abstainReason）。
// 机制：
//   - 冻结核心 / 存量文件中的既有匹配进入 exceptions（grandfathered），不失败；
//   - 任何出现在「非豁免路径」的禁止标识符都会被判为违规并导致 CI 失败（error 级）。
// 退出码：
//   0 = 未发现违规（含已豁免存量）；
//   1 = 发现 error 级违规（即有人在新代码里新增了禁止标识符）；
//   2 = 配置无法读取。
// 用法：node scripts/exposure-scan.mjs [--strict] [--json] [--config <path>] [--root <path>]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = pathResolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    config: join(repoRoot, '.exposure-scan.json'),
    root: repoRoot,
    strict: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--config') args.config = pathResolve(argv[++i]);
    else if (a === '--root') args.root = pathResolve(argv[++i]);
  }
  return args;
}

function loadConfig(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[exposure-scan] 无法读取配置文件 ${p}: ${e.message}`);
    process.exit(2);
  }
}

// 基于 .exposure-scan.json 中的 exclude 模式判断是否跳过该相对路径
function isExcluded(relPath, excludePatterns) {
  const p = relPath.split(sep).join('/');
  for (const pat of excludePatterns) {
    if (pat === '**/node_modules/**') {
      if (p.includes('/node_modules/') || p.startsWith('node_modules/')) return true;
    } else if (pat === '**/target/**') {
      if (p.includes('/target/') || p.startsWith('target/')) return true;
    } else if (pat === '**/dist/**') {
      if (p.includes('/dist/') || p.startsWith('dist/')) return true;
    } else if (pat === '**/__tests__/**') {
      if (p.includes('/__tests__/') || p.startsWith('__tests__/')) return true;
    } else if (pat === '**/*.test.ts') {
      if (p.endsWith('.test.ts')) return true;
    } else if (pat === '**/*.test.tsx') {
      if (p.endsWith('.test.tsx')) return true;
    } else if (pat === '**/*.spec.ts') {
      if (p.endsWith('.spec.ts')) return true;
    } else if (pat === '**/*.spec.tsx') {
      if (p.endsWith('.spec.tsx')) return true;
    } else if (pat.includes('**')) {
      const sub = pat.replace(/\*\*/g, '').replace(/^\//, '');
      if (p.includes(sub)) return true;
    }
  }
  return false;
}

function walk(dir, relBase, excludePatterns, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const rel = relBase ? relBase + '/' + name : name;
    if (st.isDirectory()) {
      if (isExcluded(rel, excludePatterns)) continue;
      walk(abs, rel, excludePatterns, out);
    } else if (st.isFile()) {
      if (isExcluded(rel, excludePatterns)) continue;
      out.push(rel);
    }
  }
}

// 判断某次匹配是否被 exceptions 覆盖（路径命中且 id 在豁免列表中）
function exceptionCovers(exceptions, relPath, id) {
  const p = relPath.split(sep).join('/');
  for (const exc of exceptions) {
    const ep = exc.path;
    const match =
      p === ep ||
      p.startsWith(ep) ||
      p.endsWith(ep) ||
      p.includes('/' + ep) ||
      p.includes(ep + '/');
    if (match && Array.isArray(exc.ids) && exc.ids.includes(id)) {
      return exc;
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  const cfg = loadConfig(args.config);
  const roots = cfg.roots || [];
  const exclude = cfg.exclude || [];
  const forbidden = cfg.forbidden || [];
  const exceptions = cfg.exceptions || [];

  const files = [];
  for (const r of roots) {
    const absRoot = join(args.root, r);
    walk(absRoot, r, exclude, files);
  }

  const violations = []; // 未豁免的 error 级匹配（真实问题）
  const warned = []; // 未豁免的 warning 级匹配
  const grandfathered = []; // 被 exceptions 覆盖的既有匹配

  for (const rel of files) {
    let content;
    try {
      content = readFileSync(join(args.root, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const f of forbidden) {
      // 仅当文件落在当前 forbidden 条目的适用 roots 内才检查（缺省 = 全部 roots）
      const appliesTo = f.roots && f.roots.length ? f.roots : roots;
      const inScope = appliesTo.some((r) => rel === r || rel.startsWith(r + '/'));
      if (!inScope) continue;
      let re;
      try {
        re = new RegExp(f.pattern, 'g');
      } catch (e) {
        console.error(`[exposure-scan] 非法正则 "${f.pattern}" (${f.id}): ${e.message}`);
        process.exit(2);
      }
      let m;
      while ((m = re.exec(content)) !== null) {
        const idx = m.index;
        const lineNo = content.slice(0, idx).split(/\r?\n/).length;
        const snippet = (lines[lineNo - 1] || '').trim().slice(0, 160);
        const hit = {
          id: f.id,
          file: rel,
          line: lineNo,
          snippet,
          severity: f.severity || 'error',
          reason: f.reason,
        };
        const exc = exceptionCovers(exceptions, rel, f.id);
        if (exc) {
          hit.exception = exc.reason;
          grandfathered.push(hit);
        } else if (hit.severity === 'warning') {
          warned.push(hit);
        } else {
          violations.push(hit);
        }
        if (m.index === re.lastIndex) re.lastIndex++; // 防止零宽匹配死循环
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ violations, warned, grandfathered, scannedFiles: files.length }, null, 2));
  } else {
    const printHits = (title, arr) => {
      if (!arr.length) return;
      console.log(`\n${title} (${arr.length})`);
      for (const h of arr) {
        console.log(`  - [${h.id}] ${h.file}:${h.line}  ${h.snippet}`);
        if (h.exception) console.log(`       grandfathered: ${h.exception}`);
        else if (h.reason) console.log(`       reason: ${h.reason}`);
      }
    };
    console.log('=== RELEASE-001 暴露扫描 (exposure-scan) ===');
    console.log(`扫描文件数: ${files.length}`);
    printHits('❌ 违规 (error)', violations);
    printHits('⚠️ 警告 (warning)', warned);
    printHits('✅ 存量豁免 (grandfathered)', grandfathered);
  }

  const fail = violations.length > 0 || (args.strict && warned.length > 0);
  if (fail) {
    console.log(
      `\nFAIL: 发现 ${violations.length} 个 error 违规${
        args.strict ? ` + ${warned.length} 个 warning` : ''
      }。请勿在生产代码中新增冻结清单禁止的标识符。`
    );
    process.exit(1);
  }
  console.log('\nPASS: 未发现禁止新增的标识符违规（既有存量已按 exceptions 豁免）。');
  process.exit(0);
}

main();
