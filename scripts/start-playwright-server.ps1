$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$playwrightDbPath = Join-Path $projectRoot 'data\reagent-playwright.db'
if (Test-Path $playwrightDbPath) {
    Remove-Item -LiteralPath $playwrightDbPath -Force
}

$env:DATABASE_URL = "sqlite:///$playwrightDbPath"
python -m uvicorn main:app --host 127.0.0.1 --port 8123
