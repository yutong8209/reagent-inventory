param(
    [int]$RetentionDays = 30
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDb = Join-Path $projectRoot 'data\reagent.db'
$backupRoot = Join-Path $projectRoot 'backups\db'

function Resolve-PythonExe {
    $candidates = @(
        'C:\Users\lenovo\AppData\Local\Python\pythoncore-3.14-64\python.exe',
        'C:\Users\lenovo\AppData\Local\Python\bin\python.exe'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($command -and $command.Path) {
        return $command.Path
    }

    throw 'Python executable not found.'
}

if (-not (Test-Path $sourceDb)) {
    throw "Database file not found: $sourceDb"
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupFile = Join-Path $backupRoot ("reagent_{0}.db" -f $timestamp)
$pythonExe = Resolve-PythonExe

$pythonCode = @'
import pathlib
import sqlite3
import sys

source_path = pathlib.Path(sys.argv[1])
backup_path = pathlib.Path(sys.argv[2])
backup_path.parent.mkdir(parents=True, exist_ok=True)

source = sqlite3.connect(source_path)
target = sqlite3.connect(backup_path)
try:
    source.backup(target)
finally:
    target.close()
    source.close()
'@

$pythonCode | & $pythonExe - $sourceDb $backupFile

Get-ChildItem -Path $backupRoot -Filter 'reagent_*.db' -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Backup created: $backupFile"
