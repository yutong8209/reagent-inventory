$ErrorActionPreference = 'Stop'

$backupTaskName = 'ReagentInventory_DailyBackup'
$startupShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Reagent Inventory Auto Start.lnk'

if (Test-Path $startupShortcutPath) {
    Remove-Item -LiteralPath $startupShortcutPath -Force
}

schtasks /Delete /F /TN $backupTaskName | Out-Null

Write-Host "Removed startup shortcut: $startupShortcutPath"
Write-Host "Removed task: $backupTaskName"
