# SIH 2026 Unified Evaluation Script
# Runs all 5 metrics and generates sih_scorecard.md

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReportsDir = Join-Path $RepoRoot "reports\latest"
New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "   SIH 2026 - BrowseShield Evaluation      " -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

# 1. Start Mock Site
Write-Host "Starting Mock Site (Port 3000)..." -ForegroundColor Magenta
$MockSiteJob = Start-Job -ScriptBlock {
    Set-Location $args[0]
    npm run dev
} -ArgumentList (Join-Path $RepoRoot "mock-site")
Start-Sleep -Seconds 5

# 2. Start Mock VLM Server
Write-Host "Starting Mock VLM Server (Port 8000)..." -ForegroundColor Magenta
$MockVLMJob = Start-Job -ScriptBlock {
    Set-Location $args[0]
    python eval/mock_vlm_server.py
} -ArgumentList (Join-Path $RepoRoot "benchmark")
Start-Sleep -Seconds 5

try {
    # [1/5] Visual Context Accuracy
    Write-Host ""
    Write-Host "[1/5] Visual Context Accuracy (25%)..." -ForegroundColor Yellow
    Write-Host "Capturing screenshots and extracting real DOM ground truth..." -ForegroundColor Gray
    node (Join-Path $RepoRoot "benchmark\accuracy\capture_screenshots.js")
    Write-Host "Evaluating YOLO vs DOM Fusion..." -ForegroundColor Gray
    $Metric1Out = python (Join-Path $RepoRoot "benchmark\accuracy\score_accuracy.py") --ground-truth (Join-Path $RepoRoot "benchmark\accuracy\ground_truth") | Out-String
    Write-Host $Metric1Out

    # [2/5] PII Detection Precision/Recall
    Write-Host ""
    Write-Host "[2/5] PII Detection Precision/Recall (20%)..." -ForegroundColor Yellow
    node (Join-Path $RepoRoot "benchmark\eval\metric2_pii_accuracy.js") | Tee-Object -FilePath (Join-Path $ReportsDir "metric2_stdout.txt")

    # [3/5] Redaction Precision
    Write-Host ""
    Write-Host "[3/5] Redaction Precision (20%)..." -ForegroundColor Yellow
    node (Join-Path $RepoRoot "benchmark\eval\metric3_redaction_precision.js") | Tee-Object -FilePath (Join-Path $ReportsDir "metric3_stdout.txt")

    # [4/5] Resource Utilization
    # Run the E2E benchmark first to generate E2E report that Metric 4 uses for heap MB
    Write-Host ""
    Write-Host "[4/5] Running E2E Harness to collect heap usage..." -ForegroundColor Yellow
    node (Join-Path $RepoRoot "benchmark\js\run_e2e.js") "http://localhost:3000/healthcare.html"
    
    Write-Host "Generating Resource Report..." -ForegroundColor Yellow
    node (Join-Path $RepoRoot "benchmark\eval\metric4_resource_report.js") | Tee-Object -FilePath (Join-Path $ReportsDir "metric4_stdout.txt")

    # [5/5] E2E Latency
    Write-Host ""
    Write-Host "[5/5] End-to-End Latency (15%)..." -ForegroundColor Yellow
    node (Join-Path $RepoRoot "benchmark\eval\metric5_e2e_latency.js") | Tee-Object -FilePath (Join-Path $ReportsDir "metric5_stdout.txt")

    # Generate Scorecard
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "   Generating SIH Scorecard...              " -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan

    node (Join-Path $RepoRoot "benchmark\eval\generate_scorecard.js")
    
} finally {
    Write-Host "Cleaning up background jobs..." -ForegroundColor Magenta
    Stop-Job -Job $MockSiteJob
    Stop-Job -Job $MockVLMJob
    Remove-Job -Job $MockSiteJob
    Remove-Job -Job $MockVLMJob
}
