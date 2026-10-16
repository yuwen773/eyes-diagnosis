#requires -Version 7.0
param(
    [Parameter(Mandatory)][ValidateSet('install', 'start', 'stop', 'status')][string]$Action,
    [string]$Python = '',
    [string]$EnvFile = '',
    [ValidateSet('api', 'worker', 'all')][string]$Service = 'all'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!$Python) { $Python = Join-Path $projectRoot '.venv/Scripts/python.exe' }
$Python = [IO.Path]::GetFullPath($Python)
$launcher = Join-Path $PSScriptRoot 'run_service.py'
$runtime = Join-Path $projectRoot '.runtime'
if ($EnvFile) {
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if (!$line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') { throw 'Expected NAME=value in environment file' }
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
if ($Action -eq 'install') {
    Push-Location $projectRoot
    try {
        & uv venv --python (Get-Content (Join-Path $projectRoot '.python-version') -Raw).Trim() .venv
        if ($LASTEXITCODE) { throw 'Python environment creation failed' }
        & uv pip sync --python $Python algorithm/requirements-web.lock
        if ($LASTEXITCODE) { throw 'Locked dependency installation failed' }
        & uv pip install --python $Python --no-deps -e .
        if ($LASTEXITCODE) { throw 'Project installation failed' }
        & uv pip check --python $Python
        if ($LASTEXITCODE) { throw 'Dependency check failed' }
    } finally { Pop-Location }
    return
}
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$services = if ($Service -eq 'all') { @('api', 'worker') } else { @($Service) }
foreach ($name in $services) {
    $stateFile = Join-Path $runtime "$name.json"
    $owned = $null
    if (Test-Path -LiteralPath $stateFile) {
        $saved = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
        $owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($saved.pid)"
        if ($owned -and ($owned.ExecutablePath -ne $saved.python -or
            !$owned.CommandLine.Contains($launcher) -or !$owned.CommandLine.EndsWith(" $name") -or
            $owned.CreationDate.ToUniversalTime().Ticks -ne ([datetime]$saved.created).ToUniversalTime().Ticks)) {
            throw "PID identity changed for $name; refusing to signal it"
        }
    }
    if ($Action -eq 'status') {
        Write-Output "$name $(if ($owned) { 'running' } else { 'stopped' })"
    } elseif ($Action -eq 'stop') {
        if ($owned) {
            & taskkill.exe /PID $owned.ProcessId /T /F | Out-Null
            if ($LASTEXITCODE) { throw "Failed to stop owned $name process tree" }
        }
        if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
        Write-Output "$name stopped"
    } elseif (!$owned) {
        if ($name -eq 'api') {
            $apiPort = if ($env:WEB_PORT) { [int]$env:WEB_PORT } else { 8080 }
            if (Get-NetTCPConnection -State Listen -LocalPort $apiPort -ErrorAction SilentlyContinue) {
                throw "Port $apiPort is already owned; refusing to start API"
            }
        }
        $child = Start-Process -FilePath $Python -ArgumentList @('"' + $launcher + '"', $name) `
            -WorkingDirectory (Join-Path $projectRoot 'algorithm') -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $runtime "$name.out.log") `
            -RedirectStandardError (Join-Path $runtime "$name.err.log")
        $identity = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"
        if (!$identity) { throw "$name exited during startup; inspect .runtime logs" }
        @{ pid = $child.Id; python = $Python; created = $identity.CreationDate.ToUniversalTime().ToString('o') } |
            ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
        if ($name -eq 'api') {
            $deadline = [datetime]::UtcNow.AddSeconds(60)
            do {
                try {
                    $probe = Invoke-RestMethod "http://127.0.0.1:$apiPort/health" -TimeoutSec 2
                    if ($probe.status -eq 'up') { break }
                } catch { Start-Sleep -Milliseconds 300 }
                if ($child.HasExited) { throw 'API exited; inspect .runtime logs' }
                if ([datetime]::UtcNow -gt $deadline) { throw 'API liveness timed out; inspect .runtime logs' }
            } while ($true)
        }
        Write-Output "$name started PID $($child.Id)"
    } else {
        Write-Output "$name already running PID $($owned.ProcessId)"
    }
}
