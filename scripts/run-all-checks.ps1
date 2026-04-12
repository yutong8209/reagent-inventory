$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Write-Step($message) {
    Write-Host ''
    Write-Host "==> $message" -ForegroundColor Cyan
}

try {
    Write-Step 'Checking Python environment'
    python --version
    if ($LASTEXITCODE -ne 0) { throw 'Python version check failed' }

    Write-Step 'Checking Node environment'
    & 'C:\Program Files\nodejs\node.exe' --version
    if ($LASTEXITCODE -ne 0) { throw 'Node version check failed' }
    & 'C:\Program Files\nodejs\npm.cmd' --version
    if ($LASTEXITCODE -ne 0) { throw 'npm version check failed' }

    if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
        Write-Step 'Installing frontend test dependencies'
        & 'C:\Program Files\nodejs\npm.cmd' install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    }

    Write-Step 'Running backend tests'
    python -m pytest tests/test_barcode_learning.py tests/test_inventory_and_inbound.py tests/test_calibration.py
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }

    Write-Step 'Running Playwright tests on isolated test database'
    & 'C:\Program Files\nodejs\npx.cmd' playwright test
    if ($LASTEXITCODE -ne 0) { throw 'Playwright tests failed' }

    Write-Step 'All checks passed'
    Write-Host 'Backend and browser tests completed successfully.' -ForegroundColor Green
}
catch {
    Write-Host ''
    Write-Host "Checks failed: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
