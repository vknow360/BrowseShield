# run_all.ps1
# Unified benchmark harness to reproduce claims on Windows PowerShell

[CmdletBinding()]
param(
    [string]$PythonExe = ""
)

# Resolve repo root directory (one level up from benchmark folder)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoRoot

# Ensure reports directory exists
$ReportsDir = Join-Path $RepoRoot "reports"
if (-not (Test-Path $ReportsDir)) {
    New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null
}

# Resolve Python executable
if (-not $PythonExe) {
    if (Test-Path (Join-Path $RepoRoot "server\venv\Scripts\python.exe")) {
        $PythonExe = (Join-Path $RepoRoot "server\venv\Scripts\python.exe")
    } elseif (Test-Path (Join-Path $RepoRoot "benchmark\.venv\Scripts\python.exe")) {
        $PythonExe = (Join-Path $RepoRoot "benchmark\.venv\Scripts\python.exe")
    } else {
        $PythonExe = "python"
    }
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "    BrowseShield Benchmark Harness    " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Working Directory : $RepoRoot"
Write-Host "Python Executable : $PythonExe"
Write-Host ""

# [1/3] Measuring DOM Detection Latency
Write-Host "[1/3] Measuring DOM Detection Latency..." -ForegroundColor Yellow
$LatencyReport = Join-Path $ReportsDir "latency_report.txt"
& node "benchmark/js/measure_latency.js" | Tee-Object -FilePath $LatencyReport

Write-Host ""

# [2/3] Evaluating YOLO Accuracy (IoU)
Write-Host "[2/3] Evaluating YOLO Accuracy (IoU)..." -ForegroundColor Yellow
$YoloReport = Join-Path $ReportsDir "yolo_accuracy_report.txt"
& $PythonExe "benchmark/accuracy/score_accuracy.py" --ground-truth "benchmark/accuracy/ground_truth.json" | Tee-Object -FilePath $YoloReport

Write-Host ""

# [3/3] Evaluating PII Tokenizer Scoring
Write-Host "[3/3] Evaluating PII Tokenizer Scoring..." -ForegroundColor Yellow
$PiiReport = Join-Path $ReportsDir "pii_score_report.txt"
& $PythonExe "benchmark/py/piibench/cli.py" | Tee-Object -FilePath $PiiReport

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "          Unified Results             " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

Write-Host "`n--- [1] DOM Latency Summary ---" -ForegroundColor Green
if (Test-Path $LatencyReport) {
    $latencyLines = Get-Content $LatencyReport | Select-String -Pattern "Init Time|Avg Latency"
    if ($latencyLines) {
        $latencyLines | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    } else {
        Write-Host "  (See full report: $LatencyReport)" -ForegroundColor Gray
    }
}

Write-Host "`n--- [2] YOLO Accuracy Summary ---" -ForegroundColor Green
if (Test-Path $YoloReport) {
    $yoloLines = Get-Content $YoloReport | Select-String -Pattern "mAP@0.5|Macro Recall|Macro F1|Localization Precision|Localization Recall|Localization F1"
    if ($yoloLines) {
        $yoloLines | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    } else {
        Write-Host "  (See full report: $YoloReport)" -ForegroundColor Gray
    }
}

Write-Host "`n--- [3] PII Tokenizer Summary ---" -ForegroundColor Green
if (Test-Path $PiiReport) {
    $piiLines = Get-Content $PiiReport | Select-String -Pattern "Smoke test|predictions"
    if ($piiLines) {
        $piiLines | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    } else {
        Write-Host "  (See full report: $PiiReport)" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "--------------------------------------" -ForegroundColor DarkGray
Write-Host "Reports saved to:" -ForegroundColor DarkGray
Write-Host "  - reports/latency_report.txt" -ForegroundColor DarkGray
Write-Host "  - reports/yolo_accuracy_report.txt" -ForegroundColor DarkGray
Write-Host "  - reports/pii_score_report.txt" -ForegroundColor DarkGray
Write-Host "Done." -ForegroundColor Green
