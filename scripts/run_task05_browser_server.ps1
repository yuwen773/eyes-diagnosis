$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:JAVA_HOME = 'C:/Users/yuwen/.jdks/corretto-21.0.7'
$env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
if (-not $env:COLLABORATION_TEST_URL) { throw 'Set the isolated COLLABORATION_TEST_URL first.' }
& mvn -o -B test-compile *> target/task05-browser-compile.log
if ($LASTEXITCODE -ne 0) { throw 'Browser harness compilation failed; inspect target/task05-browser-compile.log.' }
$report = 'target/surefire-reports/TEST-com.csust.eyediagnosis.collaboration.CollaborationRunTest.xml'
if (-not (Test-Path -LiteralPath $report)) { throw 'Run CollaborationRunTest first to resolve the test classpath.' }
[xml]$xml = Get-Content -LiteralPath $report
$classpath = ($xml.testsuite.properties.property | Where-Object name -eq 'java.class.path').value
& "$env:JAVA_HOME/bin/java.exe" -cp $classpath com.csust.eyediagnosis.collaboration.CollaborationBrowserServer *> target/task05-browser-server.log
exit $LASTEXITCODE
