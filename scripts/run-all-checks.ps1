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

    Write-Step 'Checking Node environment'
    & 'C:\Program Files\nodejs\node.exe' --version
    & 'C:\Program Files\nodejs\npm.cmd' --version

    if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
        Write-Step 'Installing frontend test dependencies'
        & 'C:\Program Files\nodejs\npm.cmd' install
    }

    Write-Step 'Running backend tests'
    python -m pytest tests/test_barcode_learning.py tests/test_inventory_and_inbound.py

    Write-Step 'Running Playwright tests on isolated test database'
    & 'C:\Program Files\nodejs\npx.cmd' playwright test

    Write-Step 'All checks passed'
    Write-Host 'Backend and browser tests completed successfully.' -ForegroundColor Green
}
