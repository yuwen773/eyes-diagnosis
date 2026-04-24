# find-lock Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript CLI tool that finds (and optionally kills) processes locking a file or directory on Windows.

**Architecture:** Two-tier scanning — PowerShell module scan (default, fast, zero-dep) + Sysinternals handle.exe (optional `--exact` mode). Commander.js for CLI, cli-table3 for output, chalk for color. Published as npm global package.

**Tech Stack:** Node.js 22, TypeScript, commander, chalk, cli-table3, vitest

**Project Location:** `D:/Work/code/find-lock` (standalone project, separate from eye-diagnosis)

---

## Task 1: Scaffold Project

**Files:**
- Create: `D:/Work/code/find-lock/package.json`
- Create: `D:/Work/code/find-lock/tsconfig.json`
- Create: `D:/Work/code/find-lock/.gitignore`
- Create: `D:/Work/code/find-lock/src/index.ts`

**Step 1: Create project directory and initialize**

```bash
mkdir -p D:/Work/code/find-lock/src
cd D:/Work/code/find-lock
git init
```

**Step 2: Create package.json**

```json
{
  "name": "find-lock",
  "version": "0.1.0",
  "description": "Find and optionally kill processes locking a file or directory on Windows",
  "type": "module",
  "bin": {
    "find-lock": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["windows", "lock", "process", "handle", "unlock"],
  "license": "MIT"
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
*.tgz
```

**Step 5: Create minimal src/index.ts**

```typescript
#!/usr/bin/env node

console.log('find-lock is running');
```

**Step 6: Install dependencies**

```bash
cd D:/Work/code/find-lock
npm install commander chalk cli-table3
npm install -D typescript @types/node vitest
```

**Step 7: Build and verify**

```bash
npm run build
node dist/index.js
```

Expected: prints `find-lock is running`

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold find-lock project"
```

---

## Task 2: Scanner Interface & Types

**Files:**
- Create: `D:/Work/code/find-lock/src/scanner.ts`
- Create: `D:/Work/code/find-lock/src/__tests__/scanner.test.ts`

**Step 1: Write the test for scanner types**

```typescript
// src/__tests__/scanner.test.ts
import { describe, it, expect } from 'vitest';
import type { LockResult, Scanner } from '../scanner.js';

describe('LockResult type', () => {
  it('should accept valid LockResult', () => {
    const result: LockResult = {
      pid: 1234,
      name: 'node',
      type: 'module',
      detail: 'some-path/node.dll',
    };
    expect(result.pid).toBe(1234);
    expect(result.name).toBe('node');
  });
});

describe('Scanner interface', () => {
  it('should accept a valid scanner implementation', async () => {
    const mockScanner: Scanner = {
      scan: async (targetPath: string) => [
        { pid: 1, name: 'test', type: 'module', detail: 'test.dll' },
      ],
    };
    const results = await mockScanner.scan('/some/path');
    expect(results).toHaveLength(1);
    expect(results[0].pid).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/scanner.test.ts
```

Expected: FAIL — cannot resolve `../scanner.js`

**Step 3: Write scanner.ts**

```typescript
// src/scanner.ts

export interface LockResult {
  pid: number;
  name: string;
  /** How this process was detected: 'module' (PowerShell) or 'handle' (handle.exe) */
  type: 'module' | 'handle';
  /** The specific file/module that matched the target path */
  detail: string;
}

export interface Scanner {
  scan(targetPath: string): Promise<LockResult[]>;
}
```

**Step 4: Run test to verify it passes**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/scanner.test.ts
```

Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Scanner interface and LockResult type"
```

---

## Task 3: PowerShell Scanner

**Files:**
- Create: `D:/Work/code/find-lock/src/powershell.ts`
- Create: `D:/Work/code/find-lock/src/__tests__/powershell.test.ts`

**Step 1: Write the test**

```typescript
// src/__tests__/powershell.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PowerShellScanner } from '../powershell.js';
import type { LockResult } from '../scanner.js';

// Mock child_process.exec
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'node:child_process';

const mockExec = vi.mocked(exec);

function mockExecOutput(stdout: string, stderr = '') {
  mockExec.mockImplementation(((_cmd: string, _opts: unknown, callback: any) => {
    callback(null, { stdout, stderr });
  }) as any);
}

describe('PowerShellScanner', () => {
  let scanner: PowerShellScanner;

  beforeEach(() => {
    scanner = new PowerShellScanner();
    vi.clearAllMocks();
  });

  it('should parse module scan output correctly', async () => {
    // Simulate PowerShell JSON output for a single process with multiple modules
    const output = JSON.stringify([
      {
        ProcessId: 4052,
        ProcessName: 'esbuild',
        FileName: 'D:\\project\\node_modules\\@esbuild\\win32-x64\\esbuild.exe',
      },
    ]);
    mockExecOutput(output);

    const results = await scanner.scan('D:\\project');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      pid: 4052,
      name: 'esbuild',
      type: 'module',
      detail: 'D:\\project\\node_modules\\@esbuild\\win32-x64\\esbuild.exe',
    });
  });

  it('should return empty array when no processes match', async () => {
    mockExecOutput('[]');
    const results = await scanner.scan('C:\\nonexistent');
    expect(results).toHaveLength(0);
  });

  it('should deduplicate processes by PID', async () => {
    const output = JSON.stringify([
      { ProcessId: 5628, ProcessName: 'node', FileName: 'D:\\project\\rollup.node' },
      { ProcessId: 5628, ProcessName: 'node', FileName: 'D:\\project\\tailwind.node' },
    ]);
    mockExecOutput(output);

    const results = await scanner.scan('D:\\project');
    expect(results).toHaveLength(1);
    expect(results[0].pid).toBe(5628);
    expect(results[0].detail).toBe('D:\\project\\rollup.node');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/powershell.test.ts
```

Expected: FAIL — cannot resolve `../powershell.js`

**Step 3: Write powershell.ts**

```typescript
// src/powershell.ts
import { exec } from 'node:child_process';
import * as path from 'node:path';
import type { Scanner, LockResult } from './scanner.js';

export class PowerShellScanner implements Scanner {
  async scan(targetPath: string): Promise<LockResult[]> {
    const absolutePath = path.resolve(targetPath).replace(/\\/g, '\\\\');
    const cmd = this.buildCommand(absolutePath);
    const stdout = await this.execPowerShell(cmd);
    return this.parseOutput(stdout);
  }

  private buildCommand(absolutePath: string): string {
    // Output JSON for easy parsing. Get unique processes with their first matching module.
    return [
      'powershell -NoProfile -Command "',
      'Get-Process | ForEach-Object {',
      '  $p = $_',
      '  $p.Modules | Where-Object { $_.FileName -like \\'*' + absolutePath + '*\\' } |',
      '  Select-Object -First 1 |',
      '  ForEach-Object {',
      '    [PSCustomObject]@{ ProcessId=$p.Id; ProcessName=$p.ProcessName; FileName=$_.FileName }',
      '  }',
      '} | ConvertTo-Json -Compress"',
    ].join(' ');
  }

  private execPowerShell(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`PowerShell scan failed: ${error.message}\n${stderr}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private parseOutput(stdout: string): LockResult[] {
    if (!stdout) return [];

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return [];
    }

    // PowerShell ConvertTo-Json returns a single object (not array) when only 1 result
    const items = Array.isArray(parsed) ? parsed : [parsed];

    // Deduplicate by PID — keep first module per process
    const seen = new Set<number>();
    const results: LockResult[] = [];

    for (const item of items) {
      if (!item.ProcessId || !item.ProcessName || !item.FileName) continue;
      if (seen.has(item.ProcessId)) continue;
      seen.add(item.ProcessId);
      results.push({
        pid: item.ProcessId,
        name: item.ProcessName,
        type: 'module',
        detail: item.FileName,
      });
    }

    return results;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/powershell.test.ts
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement PowerShell module scanner"
```

---

## Task 4: Output Formatters

**Files:**
- Create: `D:/Work/code/find-lock/src/formatters.ts`
- Create: `D:/Work/code/find-lock/src/__tests__/formatters.test.ts`

**Step 1: Write the test**

```typescript
// src/__tests__/formatters.test.ts
import { describe, it, expect } from 'vitest';
import { formatTable, formatJson } from '../formatters.js';
import type { LockResult } from '../scanner.js';

const sampleResults: LockResult[] = [
  { pid: 4052, name: 'esbuild', type: 'module', detail: 'node_modules/@esbuild/esbuild.exe' },
  { pid: 5628, name: 'node', type: 'module', detail: 'node_modules/rollup.node' },
];

describe('formatTable', () => {
  it('should render a table with header and rows', () => {
    const output = formatTable(sampleResults);
    expect(output).toContain('PID');
    expect(output).toContain('Name');
    expect(output).toContain('4052');
    expect(output).toContain('esbuild');
    expect(output).toContain('5628');
    expect(output).toContain('node');
  });

  it('should show "no processes" message for empty results', () => {
    const output = formatTable([]);
    expect(output).toContain('No processes locking this path');
  });
});

describe('formatJson', () => {
  it('should produce valid JSON array', () => {
    const output = formatJson(sampleResults);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].pid).toBe(4052);
  });

  it('should produce empty array for no results', () => {
    const output = formatJson([]);
    expect(JSON.parse(output)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/formatters.test.ts
```

Expected: FAIL — cannot resolve `../formatters.js`

**Step 3: Write formatters.ts**

```typescript
// src/formatters.ts
import Table from 'cli-table3';
import chalk from 'chalk';
import type { LockResult } from './scanner.js';

export function formatTable(results: LockResult[]): string {
  if (results.length === 0) {
    return chalk.green('  No processes locking this path.');
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.yellow(`  ${results.length} process${results.length > 1 ? 'es' : ''} locking this path:`));
  lines.push('');

  const table = new Table({
    head: ['PID', 'Name', 'Type', 'Detail'],
    style: { head: ['cyan'] },
    colWidths: [8, 12, 10, 60],
  });

  for (const r of results) {
    table.push([String(r.pid), r.name, r.type, r.detail]);
  }

  lines.push(table.toString());
  lines.push('');
  lines.push(chalk.gray('  Run with --kill to terminate these processes.'));
  return lines.join('\n');
}

export function formatJson(results: LockResult[]): string {
  return JSON.stringify(results, null, 2);
}
```

**Step 4: Run test to verify it passes**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/formatters.test.ts
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add table and JSON output formatters"
```

---

## Task 5: CLI Entry Point (find + display only)

**Files:**
- Modify: `D:/Work/code/find-lock/src/index.ts`

**Step 1: Rewrite src/index.ts with commander**

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PowerShellScanner } from './powershell.js';
import { formatTable, formatJson } from './formatters.js';

const program = new Command();

program
  .name('find-lock')
  .description('Find processes locking a file or directory on Windows')
  .argument('<path>', 'file or directory to check')
  .option('--kill', 'kill the locking processes (with confirmation)')
  .option('--force', 'skip confirmation when used with --kill')
  .option('--exact', 'use handle.exe for exact file handle scanning')
  .option('--json', 'output results as JSON')
  .action(async (targetPath: string, options: {
    kill?: boolean;
    force?: boolean;
    exact?: boolean;
    json?: boolean;
  }) => {
    // Validate platform
    if (process.platform !== 'win32') {
      console.error('Error: find-lock only supports Windows.');
      process.exit(1);
    }

    // Resolve and validate path
    const absolutePath = path.resolve(targetPath);
    if (!fs.existsSync(absolutePath)) {
      console.error(`Error: Path not found: ${absolutePath}`);
      process.exit(1);
    }

    // Select scanner
    if (options.exact) {
      console.error('Error: --exact mode requires handle.exe (not yet implemented).');
      console.error('Download from: https://learn.microsoft.com/en-us/sysinternals/downloads/handle');
      process.exit(1);
    }

    const scanner = new PowerShellScanner();

    // Scan
    try {
      const results = await scanner.scan(absolutePath);

      // Output
      if (options.json) {
        console.log(formatJson(results));
      } else {
        console.log(formatTable(results));
        if (results.length === 0) {
          process.exit(0);
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
```

**Step 2: Build and test manually**

```bash
cd D:/Work/code/find-lock
npm run build
node dist/index.js ./src
```

Expected: shows "No processes locking this path" (since no dev server is running)

```bash
node dist/index.js /nonexistent
```

Expected: `Error: Path not found: D:\nonexistent`

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: implement CLI entry point with find and display"
```

---

## Task 6: Kill Functionality

**Files:**
- Create: `D:/Work/code/find-lock/src/killer.ts`
- Create: `D:/Work/code/find-lock/src/__tests__/killer.test.ts`
- Modify: `D:/Work/code/find-lock/src/index.ts`

**Step 1: Write the test**

```typescript
// src/__tests__/killer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { killProcesses } from '../killer.js';
import type { LockResult } from '../scanner.js';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'node:child_process';
const mockExec = vi.mocked(exec);

describe('killProcesses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call Stop-Process for each PID', async () => {
    const results: LockResult[] = [
      { pid: 1234, name: 'node', type: 'module', detail: 'test' },
      { pid: 5678, name: 'esbuild', type: 'module', detail: 'test' },
    ];

    mockExec.mockImplementation(((_cmd: string, _opts: unknown, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    }) as any);

    const killed = await killProcesses(results, true);
    expect(killed).toEqual([1234, 5678]);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it('should skip PIDs that fail to kill', async () => {
    const results: LockResult[] = [
      { pid: 1111, name: 'node', type: 'module', detail: 'test' },
      { pid: 2222, name: 'esbuild', type: 'module', detail: 'test' },
    ];

    mockExec
      .mockImplementationOnce(((_cmd: string, _opts: unknown, cb: any) => {
        cb(null, { stdout: '', stderr: '' });
      }) as any)
      .mockImplementationOnce(((_cmd: string, _opts: unknown, cb: any) => {
        cb(new Error('Access denied'), { stdout: '', stderr: '' });
      }) as any);

    const killed = await killProcesses(results, true);
    expect(killed).toEqual([1111]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/killer.test.ts
```

Expected: FAIL — cannot resolve `../killer.js`

**Step 3: Write killer.ts**

```typescript
// src/killer.ts
import { exec } from 'node:child_process';
import type { LockResult } from './scanner.js';

export async function killProcesses(
  results: LockResult[],
  force: boolean,
): Promise<number[]> {
  const killed: number[] = [];

  for (const r of results) {
    try {
      await execAsync(`powershell -NoProfile -Command "Stop-Process -Id ${r.pid} -Force"`);
      killed.push(r.pid);
    } catch {
      // Process may have already exited or requires admin
    }
  }

  return killed;
}

function execAsync(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
```

**Step 4: Run test to verify it passes**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/killer.test.ts
```

Expected: PASS (2 tests)

**Step 5: Integrate kill into CLI index.ts**

Add the kill flow after scanning in `src/index.ts`. Replace the try block inside `.action()`:

```typescript
    try {
      const results = await scanner.scan(absolutePath);

      // Output
      if (options.json) {
        console.log(formatJson(results));
      } else {
        console.log(formatTable(results));
      }

      if (results.length === 0) {
        process.exit(0);
      }

      // Kill flow
      if (options.kill) {
        const { killProcesses } = await import('./killer.js');

        if (!options.force) {
          for (const r of results) {
            const readline = await import('node:readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise<string>((resolve) => {
              rl.question(`  Kill process ${r.name} (PID ${r.pid})? [y/N] `, resolve);
            });
            rl.close();
            if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
              console.log(chalk.gray(`  Skipped PID ${r.pid}`));
              continue;
            }
          }
        }

        const killed = await killProcesses(results, !!options.force);
        console.log(chalk.green(`  Killed ${killed.length} process${killed.length !== 1 ? 'es' : ''}.`));

        // Re-scan to verify
        const remaining = await scanner.scan(absolutePath);
        if (remaining.length > 0) {
          console.log(chalk.yellow(`  ${remaining.length} process${remaining.length > 1 ? 'es' : ''} still locking this path:`));
          console.log(formatTable(remaining));
        } else {
          console.log(chalk.green('  Path is now unlocked.'));
        }
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
```

Remember to add `import chalk from 'chalk';` at the top of `index.ts`.

**Step 6: Build and verify**

```bash
cd D:/Work/code/find-lock
npm run build
node dist/index.js ./src --kill
```

Expected: shows "No processes locking this path" and exits 0

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add --kill functionality with confirmation prompt"
```

---

## Task 7: handle.exe Scanner (--exact mode)

**Files:**
- Create: `D:/Work/code/find-lock/src/handle.ts`
- Create: `D:/Work/code/find-lock/src/__tests__/handle.test.ts`
- Modify: `D:/Work/code/find-lock/src/index.ts`

**Step 1: Write the test**

```typescript
// src/__tests__/handle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleScanner } from '../handle.js';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'node:child_process';
const mockExec = vi.mocked(exec);

const SAMPLE_OUTPUT = `
Nthandle v5.0 - File handle viewer
Copyright (C) 1997-2022 Mark Russinovich
Sysinternals - www.sysinternals.com

esbuild.exe           pid: 4052   type: File          8BC: D:\project\node_modules\@esbuild\esbuild.exe
node.exe              pid: 5628   type: File          8BC: D:\project\node_modules\rollup.node
`;

describe('HandleScanner', () => {
  let scanner: HandleScanner;

  beforeEach(() => {
    scanner = new HandleScanner('handle.exe');
    vi.clearAllMocks();
  });

  it('should parse handle.exe output correctly', async () => {
    mockExec.mockImplementation(((_cmd: string, _opts: unknown, cb: any) => {
      cb(null, { stdout: SAMPLE_OUTPUT, stderr: '' });
    }) as any);

    const results = await scanner.scan('D:\\project');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      pid: 4052,
      name: 'esbuild',
      type: 'handle',
      detail: 'D:\\project\\node_modules\\@esbuild\\esbuild.exe',
    });
    expect(results[1].pid).toBe(5628);
  });

  it('should return empty array when handle.exe finds nothing', async () => {
    mockExec.mockImplementation(((_cmd: string, _opts: unknown, cb: any) => {
      cb(null, { stdout: 'No matching handles found.\n', stderr: '' });
    }) as any);

    const results = await scanner.scan('C:\\nothing');
    expect(results).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/handle.test.ts
```

Expected: FAIL — cannot resolve `../handle.js`

**Step 3: Write handle.ts**

```typescript
// src/handle.ts
import { exec } from 'node:child_process';
import type { Scanner, LockResult } from './scanner.js';

export class HandleScanner implements Scanner {
  private handlePath: string;

  constructor(handlePath: string) {
    this.handlePath = handlePath;
  }

  async scan(targetPath: string): Promise<LockResult[]> {
    const cmd = `"${this.handlePath}" -a "${targetPath}" -nobanner`;
    const stdout = await this.execHandle(cmd);
    return this.parseOutput(stdout);
  }

  private execHandle(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`handle.exe failed: ${error.message}\n${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  private parseOutput(stdout: string): LockResult[] {
    const results: LockResult[] = [];
    const seen = new Set<number>();

    // Lines like: "esbuild.exe           pid: 4052   type: File          8BC: D:\project\..."
    const regex = /^(\S+)\s+pid:\s*(\d+)\s+type:\s*\w+\s+\w+:\s+(.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(stdout)) !== null) {
      const pid = parseInt(match[2], 10);
      if (seen.has(pid)) continue;
      seen.add(pid);

      const name = match[1].replace(/\.\w+$/, ''); // strip extension
      results.push({
        pid,
        name,
        type: 'handle',
        detail: match[3],
      });
    }

    return results;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd D:/Work/code/find-lock
npx vitest run src/__tests__/handle.test.ts
```

Expected: PASS (2 tests)

**Step 5: Integrate into index.ts — replace the exact-mode stub**

In `src/index.ts`, replace the `--exact` error block with:

```typescript
    // Select scanner
    let scanner: Scanner;
    if (options.exact) {
      // Check common handle.exe locations
      const handleCandidates = [
        path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'handle.exe'),
        'handle.exe', // if on PATH
      ];

      let handlePath: string | undefined;
      for (const candidate of handleCandidates) {
        if (fs.existsSync(candidate)) {
          handlePath = candidate;
          break;
        }
      }

      if (!handlePath) {
        console.error('Error: handle.exe not found.');
        console.error('Download from: https://learn.microsoft.com/en-us/sysinternals/downloads/handle');
        console.error('Place it in your SYSTEMROOT or add it to your PATH.');
        process.exit(1);
      }

      const { HandleScanner } = await import('./handle.js');
      scanner = new HandleScanner(handlePath);
    } else {
      scanner = new PowerShellScanner();
    }
```

Also add `import type { Scanner } from './scanner.js';` at the top.

**Step 6: Build and verify**

```bash
cd D:/Work/code/find-lock
npm run build
node dist/index.js ./src --exact
```

Expected: Error message about handle.exe not found (unless installed)

```bash
node dist/index.js ./src
```

Expected: "No processes locking this path"

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: implement handle.exe scanner for --exact mode"
```

---

## Task 8: Integration Test & Polish

**Files:**
- Create: `D:/Work/code/find-lock/src/__tests__/integration.test.ts`
- Modify: `D:/Work/code/find-lock/src/index.ts` (add --exact fallback hint)

**Step 1: Write integration test**

```typescript
// src/__tests__/integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';

describe('CLI integration', () => {
  it('should report error for non-existent path', () => {
    expect(() => {
      execSync('node dist/index.js /nonexistent/path', {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }).toThrow(/Path not found/);
  });

  it('should output JSON with --json flag', () => {
    const output = execSync('node dist/index.js ./src --json', {
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should show table output by default', () => {
    const output = execSync('node dist/index.js ./src', {
      encoding: 'utf-8',
    });
    expect(output).toContain('PID');
  });
});
```

**Step 2: Build and run all tests**

```bash
cd D:/Work/code/find-lock
npm run build
npx vitest run
```

Expected: ALL PASS

**Step 3: Add --exact fallback hint**

In `src/index.ts`, after PowerShell scan returns empty results (in the non-kill branch), add:

```typescript
      if (results.length === 0 && !options.exact && !options.json) {
        console.log(chalk.gray('  Tip: use --exact for handle-based scanning (requires handle.exe).'));
      }
```

**Step 4: Build, run all tests, verify**

```bash
cd D:/Work/code/find-lock
npm run build
npx vitest run
node dist/index.js ./src
```

Expected: Shows "No processes locking this path" + tip about --exact

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add integration tests and --exact fallback hint"
```

---

## Task 9: Final Wiring — bin entry & package publish prep

**Files:**
- Modify: `D:/Work/code/find-lock/package.json` (add shebang check, files field)
- Create: `D:/Work/code/find-lock/README.md`

**Step 1: Update package.json**

Add `files` field and ensure `bin` points correctly:

```json
{
  "files": ["dist"],
  "bin": {
    "find-lock": "./dist/index.js"
  }
}
```

**Step 2: Write README.md**

```markdown
# find-lock

Find (and optionally kill) processes locking a file or directory on Windows.

## Install

```bash
npm i -g find-lock
```

## Usage

```bash
# Find what's locking a directory
find-lock ./my-directory

# Kill the locking processes
find-lock ./my-directory --kill

# Skip confirmation
find-lock ./my-directory --kill --force

# Exact mode (requires handle.exe from Sysinternals)
find-lock ./my-directory --exact

# JSON output
find-lock ./my-directory --json
```

## How It Works

**Default mode**: Scans all running processes' loaded modules (via PowerShell) for paths matching the target. Fast, zero-dependency, covers node/esbuild/Vite dev servers.

**Exact mode** (`--exact`): Uses [Sysinternals handle.exe](https://learn.microsoft.com/en-us/sysinternals/downloads/handle) for 100% accurate file handle enumeration.

## Requirements

- Windows
- Node.js 18+
```

**Step 3: Build and do a dry-run pack**

```bash
cd D:/Work/code/find-lock
npm run build
npm pack --dry-run
```

Expected: Shows the files that would be included in the npm package

**Step 4: Commit**

```bash
git add -A
git commit -m "docs: add README and prepare for npm publish"
```
