#!/usr/bin/env node
/** Regenerate eslint-baseline.txt from `eslint . -f json` output (or stdin with -). */
const fs = require('fs');
const path = require('path');

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('usage: node write-eslint-baseline.cjs <eslint-report.json> <baseline.txt>');
  process.exit(2);
}
const raw = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(source, 'utf8');
const reports = JSON.parse(raw);
const root = process.cwd();
const rows = [];
for (const report of reports) {
  const relative = path.relative(root, report.filePath).split(path.sep).join('/');
  for (const message of report.messages) {
    if ((message.severity ?? 2) < 2) continue;
    rows.push(`${relative}:${message.line}:${message.column} ${message.ruleId || 'unknown'}`);
  }
}
rows.sort();
const header = [
  '# ESLint baseline — pre-existing debt, do not grow.',
  '# Regenerate: npm run lint:baseline',
  '# Format: relative/path:line:column ruleId',
  '',
];
fs.writeFileSync(target, header.concat(rows).join('\n') + '\n', 'utf8');
console.log(`wrote ${rows.length} baseline entries to ${target}`);
