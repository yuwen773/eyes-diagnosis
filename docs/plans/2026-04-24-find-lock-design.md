# find-lock Design Document

> A CLI tool to find and optionally kill processes locking a file or directory on Windows.

## Problem

On Windows, files and directories can be locked by running processes (esbuild, node, Vite dev servers). Attempting to delete or move them results in "Device or resource busy" errors. Manually finding the culprit requires complex PowerShell commands.

## Solution

A lightweight TypeScript CLI tool: `find-lock`. Point it at a path, it finds what's holding it, and optionally kills those processes.

## CLI Interface

```bash
# Find processes locking a path
find-lock ./some-directory
find-lock ./file.txt

# Kill the locking processes (with confirmation)
find-lock ./some-directory --kill

# Skip confirmation
find-lock ./some-directory --kill --force

# Use handle.exe for exact handle-based scanning
find-lock ./some-directory --exact

# JSON output for scripting
find-lock ./some-directory --json
```

### Output Example

```
find-lock ./frontend

  2 processes locking this path:

  PID    Name       Type     Detail
  4052   esbuild    module   node_modules/@esbuild/win32-x64/esbuild.exe
  5628   node       module   node_modules/@rollup/rollup-win32-x64-msvc/rollup.node

  Run with --kill to terminate these processes.
```

## Architecture

```
find-lock/
├── src/
│   ├── index.ts          # CLI entry, argument parsing (commander)
│   ├── scanner.ts        # Scanner interface
│   ├── powershell.ts     # Approach A: PowerShell module scan
│   ├── handle.ts         # Approach B: handle.exe exact scan
│   └── formatters.ts     # Output formatting (table / JSON)
├── package.json
└── tsconfig.json
```

### Dependencies

- `commander` — argument parsing
- `chalk` — colored output
- `cli-table3` — table formatting

All pure JS, no native modules.

## Scanning Strategy

### Approach A: PowerShell Module Scan (default)

Scans all running processes' loaded modules for paths matching the target.

```powershell
Get-Process | ForEach-Object {
    $p = $_
    $p.Modules | Where-Object { $_.FileName -like '*<target>*' }
}
```

**Covers**: esbuild, node, Vite — processes that load `.node` native modules from `node_modules`.

**Limitation**: Misses processes that only open files for I/O without loading them as modules (e.g., a text editor with the file open).

### Approach B: handle.exe Exact Scan (--exact flag)

Uses Sysinternals `handle.exe` for precise file handle enumeration.

```
handle.exe -a <target-path>
```

**Covers**: All scenarios, 100% accurate.

**Trade-off**: Requires downloading handle.exe (~1MB) from Microsoft Sysinternals. First run requires EULA acceptance. Not bundled — user downloads on demand when `--exact` is used.

### Fallback Flow

1. Default: PowerShell scan (fast, zero-dependency)
2. If no results found: suggest trying `--exact` mode
3. `--exact` mode: check for handle.exe, prompt download if missing

## Kill Flow (--kill)

1. Display found processes
2. For each process: prompt `Kill process <name> (PID <pid>)? [y/N]`
3. Execute `Stop-Process -Id <pid> -Force` on confirmation
4. After all kills: re-scan to verify path is freed
5. If still locked: display remaining processes
6. `--force` flag: skip all confirmation prompts

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Path does not exist | Print "Path not found" and exit 1 |
| No processes found | Print "No processes locking this path" and exit 0 |
| Not on Windows | Print "find-lock only supports Windows" and exit 1 |
| `--exact` but no handle.exe | Print download URL (Sysinternals) and exit 1 |
| Kill requires admin | Print "Run as administrator" and exit 1 |

## Distribution

- npm global package: `npm i -g find-lock`
- Requires Node.js runtime
- Windows only (v1)
- Future: macOS/Linux support via `lsof` (not in v1 scope)

## Scope (v1)

- In scope: find processes, display results, optional kill, JSON output, handle.exe enhancement
- Out of scope: auto-delete after unlock, file watcher mode, macOS/Linux support, GUI
