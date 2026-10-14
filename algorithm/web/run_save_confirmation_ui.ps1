param([ValidateSet('All', 'Api', 'Frontend')][string]$Mode = 'All')
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path (Split-Path $PSScriptRoot)
$algorithmPath = Join-Path $repoPath 'algorithm'
$pythonPath = Join-Path $algorithmPath '.venv-baseline/Scripts/python.exe'
$outputPath = Join-Path $repoPath '.scratch/python-agent-migration/evidence/issue11'
New-Item -ItemType Directory -Force $outputPath | Out-Null
$env:PYTHONIOENCODING = 'utf-8'
if ($Mode -eq 'Api') {
    Set-Location $algorithmPath
    & $pythonPath -u -m web.tests.save_confirmation_ui_server *> (Join-Path $outputPath 'api.log')
    exit $LASTEXITCODE
}
if ($Mode -eq 'Frontend') {
    Set-Location (Join-Path $repoPath 'frontend')
    $env:VITE_API_BASE_URL = 'http://127.0.0.1:15281/api'
    & npm.cmd run dev -- --host 127.0.0.1 --port 15282 --strictPort *> (Join-Path $outputPath 'frontend.log')
    exit $LASTEXITCODE
}
Set-Location $algorithmPath
$helperPath = 'C:/Users/yuwen/.agents/skills/webapp-testing/scripts/with_server.py'
$runnerPath = $PSCommandPath
if (Get-NetTCPConnection -State Listen -LocalPort 15281,15282 -ErrorAction SilentlyContinue) {
    throw 'Test ports 15281/15282 are occupied.'
}
try {
    & $pythonPath $helperPath --server "pwsh.exe -NoLogo -NoProfile -File `"$runnerPath`" -Mode Api" --port 15281 --server "pwsh.exe -NoLogo -NoProfile -File `"$runnerPath`" -Mode Frontend" --port 15282 --timeout 60 -- $pythonPath -m web.verify_save_confirmation_ui --output-dir $outputPath
    $verificationExit = $LASTEXITCODE
} finally {
    # The generic helper terminates its shell, so verify and close its children.
    foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort 15281,15282 -ErrorAction SilentlyContinue)) {
        $ownedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        $isApi = $listener.LocalPort -eq 15281 -and $ownedProcess.Name -eq 'python.exe' -and $ownedProcess.CommandLine -like '*-m web.tests.save_confirmation_ui_server*'
        $isFrontend = $listener.LocalPort -eq 15282 -and $ownedProcess.Name -eq 'node.exe' -and $ownedProcess.CommandLine.Contains($repoPath) -and $ownedProcess.CommandLine -like '*--port 15282 --strictPort*'
        if ($isApi -or $isFrontend) { Stop-Process -Id $ownedProcess.ProcessId }
    }
}
exit $verificationExit
