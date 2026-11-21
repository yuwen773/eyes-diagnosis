param([string]$OutputDirectory = 'target/rc-final/rag')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repoRoot
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$runId = [guid]::NewGuid().ToString('N').Substring(0, 10)
$mysqlName = "iris-rag-probe-mysql-$runId"
$chromaName = "iris-rag-probe-chroma-$runId"
$javaCommand = Join-Path $env:JAVA_HOME 'bin/java.exe'
if (!(Test-Path -LiteralPath $javaCommand)) { throw 'Set JAVA_HOME to JDK 21 first' }
$report = Get-ChildItem target/surefire-reports -Filter 'TEST-*.xml' | Select-Object -First 1
if (!$report) { throw 'Run mvn test first to compile the candidate and record its classpath' }
$classpath = (([xml](Get-Content -LiteralPath $report.FullName -Raw)).testsuite.properties.property |
        Where-Object name -eq 'java.class.path').value
if (!$classpath) { throw 'Surefire classpath missing' }
try {
    & docker run -d --name $mysqlName -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=iris_audit -p '127.0.0.1::3306' mysql:8.0.26 | Out-Null
    if ($LASTEXITCODE) { throw 'MySQL container failed' }
    & docker run -d --name $chromaName -p '127.0.0.1::8000' chromadb/chroma:1.0.0 | Out-Null
    if ($LASTEXITCODE) { throw 'Chroma container failed' }
    $mysqlPort = (& docker port $mysqlName 3306/tcp).Split(':')[-1]
    $chromaPort = (& docker port $chromaName 8000/tcp).Split(':')[-1]
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        & docker exec $mysqlName mysqladmin ping '--host=127.0.0.1' -uroot *> $null
        if (!$LASTEXITCODE) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'MySQL readiness timeout' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-WebRequest "http://127.0.0.1:$chromaPort/api/v2/heartbeat" -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { throw 'Chroma readiness timeout' }
    & git rev-parse HEAD | Set-Content (Join-Path $OutputDirectory 'source-sha.txt')
    & git diff -- src/main scripts/tests/IrisRagGenerationProbe.java | Set-Content (Join-Path $OutputDirectory 'source-diff.patch')
    Get-FileHash -Algorithm SHA256 -LiteralPath @(
        'scripts/tests/IrisRagGenerationProbe.java',
        'src/main/resources/db/migration/V29__knowledge_index_version.sql',
        'src/main/java/com/csust/eyediagnosis/service/impl/DocumentProcessingService.java',
        'src/main/java/com/csust/eyediagnosis/service/impl/KnowledgeBaseServiceImpl.java',
        'src/main/java/com/csust/eyediagnosis/agent/tools/DocumentSearchTool.java',
        'src/main/java/com/csust/eyediagnosis/model/dto/agent/ResourceRef.java',
        'src/main/java/com/csust/eyediagnosis/mapper/KnowledgeDocumentMapper.java'
    ) | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'source-hashes.json')
    & $javaCommand -cp $classpath scripts/tests/IrisRagGenerationProbe.java $mysqlPort $chromaPort src/main/resources/db/migration/V15__baseline_legacy_tables.sql *> (Join-Path $OutputDirectory 'storage-probe.log')
    $probeExit = $LASTEXITCODE
    Get-Content (Join-Path $OutputDirectory 'storage-probe.log') | Select-String 'PROBE|AssertionError|error:'
    if ($probeExit) { throw "RAG generation probe failed: $probeExit" }
} finally {
    # These names are generated above and belong only to this disposable run.
    & docker rm -f $mysqlName $chromaName *> $null
}
