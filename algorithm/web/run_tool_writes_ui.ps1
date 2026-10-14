param([ValidateSet('All', 'Api', 'Frontend')][string]$Mode = 'All')
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path (Split-Path $PSScriptRoot)
$algorithmPath = Join-Path $repoPath 'algorithm'
$pythonPath = Join-Path $algorithmPath '.venv-baseline/Scripts/python.exe'
$outputPath = Join-Path $repoPath '.scratch/python-agent-migration/evidence/issue15'
New-Item -ItemType Directory -Force $outputPath | Out-Null
$env:PYTHONIOENCODING = 'utf-8'
if ($Mode -eq 'Api') {
    Set-Location $algorithmPath
    $env:CHAT_UI_DIRECTORY = Join-Path $outputPath ('fixture-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $env:CHAT_UI_DIRECTORY | Out-Null
    & $pythonPath -m uvicorn web.tests.tool_writes_ui_server:app --host 127.0.0.1 --port 15285 *> (Join-Path $outputPath 'api.log')
    exit $LASTEXITCODE
}
if ($Mode -eq 'Frontend') {
    Set-Location (Join-Path $repoPath 'frontend')
    $env:VITE_API_BASE_URL = 'http://127.0.0.1:15285/api'
    $env:VITE_APP_API_BASE_URL = 'http://127.0.0.1:15285'
    & npm.cmd run dev -- --host 127.0.0.1 --port 15286 --strictPort *> (Join-Path $outputPath 'frontend.log')
    exit $LASTEXITCODE
}
Set-Location $algorithmPath
if (Get-NetTCPConnection -State Listen -LocalPort 15285,15286 -ErrorAction SilentlyContinue) { throw 'Test ports 15285/15286 are occupied.' }
$runnerPath = $PSCommandPath
try {
    & $pythonPath 'C:/Users/yuwen/.agents/skills/webapp-testing/scripts/with_server.py' --server "pwsh.exe -NoLogo -NoProfile -File `"$runnerPath`" -Mode Api" --port 15285 --server "pwsh.exe -NoLogo -NoProfile -File `"$runnerPath`" -Mode Frontend" --port 15286 --timeout 60 -- $pythonPath -m web.verify_tool_writes_ui --output-dir $outputPath
    $verificationExit = $LASTEXITCODE
} finally {
    foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort 15285,15286 -ErrorAction SilentlyContinue)) {
        $ownedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        $isApi = $listener.LocalPort -eq 15285 -and $ownedProcess.Name -eq 'python.exe' -and $ownedProcess.CommandLine -like '*-m uvicorn web.tests.tool_writes_ui_server:app*'
        $isFrontend = $listener.LocalPort -eq 15286 -and $ownedProcess.Name -eq 'node.exe' -and $ownedProcess.CommandLine.Contains($repoPath) -and $ownedProcess.CommandLine -like '*--port 15286 --strictPort*'
        if ($isApi -or $isFrontend) { Stop-Process -Id $ownedProcess.ProcessId }
    }
}
exit $verificationExit
