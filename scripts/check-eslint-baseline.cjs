#!/usr/bin/env node
/**
 * ESLint ratchet: fail on new lint errors, allow pre-existing debt to shrink.
 *
 * `npm run lint` uses `--fix`, which would silently edit files in CI. This
 * gate reads `eslint . -f json` output (read-only) and compares each
 * violation's fingerprint against the checked-in baseline. Any violation not
 * in the baseline fails; a fixed baseline entry is reported but does not fail.
 *
 * Usage: node check-eslint-baseline.cjs <baseline.txt> <eslint-report.json|->
 */

const fs = require('fs');
const path = require('path');

const [baselinePath, reportPath] = process.argv.slice(2);
if (!baselinePath || !reportPath) {
  console.error('usage: node check-eslint-baseline.cjs <baseline.txt> <eslint-report.json>');
  process.exit(2);
}

function readBaseline(file) {
  const entries = new Map();
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const split = line.lastIndexOf(' ');
    const key = line.slice(0, split);
    const rule = line.slice(split + 1);
    if (split < 0 || key.split(':').length < 3) {
      throw new Error(`${file}:${index + 1}: malformed baseline line: ${line}`);
    }
    entries.set(key, rule);
  });
  return entries;
}

function readViolations(file) {
  const raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  const reports = JSON.parse(raw);
  if (!Array.isArray(reports)) throw new Error('eslint -f json must produce an array');
  const root = process.cwd();
  const violations = new Map();
  for (const report of reports) {
    const relative = path.relative(root, report.filePath).split(path.sep).join('/');
    for (const message of report.messages) {
      if ((message.severity ?? 2) < 2) continue;
      const key = `${relative}:${message.line}:${message.column}`;
      violations.set(key, message.ruleId || 'unknown');
    }
  }
  return violations;
}

let baseline;
let violations;
try {
  baseline = readBaseline(baselinePath);
  violations = readViolations(reportPath);
} catch (error) {
  console.error(`eslint ratchet failed: ${error.message}`);
  process.exit(2);
}

const fresh = [...violations.keys()].filter((key) => !baseline.has(key)).sort();
const fixed = [...baseline.keys()].filter((key) => !violations.has(key)).sort();
const changed = [...violations.keys()]
  .filter((key) => baseline.has(key) && baseline.get(key) !== violations.get(key))
  .sort();

for (const key of fixed) console.log(`fixed (baseline can be regenerated): ${key} ${baseline.get(key)}`);
for (const key of changed) {
  console.error(`rule changed: ${key} ${baseline.get(key)} -> ${violations.get(key)}`);
}
for (const key of fresh) console.error(`new lint error: ${key} ${violations.get(key)}`);

if (fresh.length || changed.length) {
  console.error(
    `eslint ratchet failed: ${fresh.length} new, ${changed.length} changed-rule violations; ${fixed.length} fixed`
  );
  process.exit(1);
}
console.log(
  `eslint ratchet passed: ${violations.size} known violations, 0 new` +
    (fixed.length ? `, ${fixed.length} fixed` : '')
);
