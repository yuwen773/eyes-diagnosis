# P2-02A T3 real-GPU matrix rerun (v3) — after the probe autocast fix.
# Frozen inputs live in the MAIN repo's algorithm/artifacts/p1_v1; code runs
# from this worktree. Absolute paths avoid the relative-path failures from
# the previous session.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = "D:\programe\Anaconda\envs\eye-p1-bench\python.exe"
$main = "D:\Work\code\eye-diagnosis\algorithm"

& $py -m p1.stability.matrix_cli `
    --protocol "$PSScriptRoot\p1\protocol_p2_02a_v1.json" `
    --manifest "$main\artifacts\p1_v1\patient_manifest_v1.parquet" `
    --split-assignment "$main\artifacts\p1_v1\split_assignment_v1.csv" `
    --fold-assignment "$main\artifacts\p1_v1\fold_assignment_v1.csv" `
    --image-root "$main\datasets\DataSet\Training_Dataset\Training_Dataset" `
    --out-dir "$main\artifacts\p2_02a_t3_real_v3"

Write-Host "matrix_cli exit code: $LASTEXITCODE"
exit $LASTEXITCODE
