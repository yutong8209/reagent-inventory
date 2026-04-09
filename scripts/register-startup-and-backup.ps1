param(
    [string]$BackupTime = '02:30',
    [int]$RetentionDays = 30
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupScript = Join-Path $PSScriptRoot 'start-server-background.ps1'
$startupVbs = Join-Path $PSScriptRoot 'start-server-background.vbs'
$backupScript = Join-Path $PSScriptRoot 'backup-database.ps1'
$backupTaskName = 'ReagentInventory_DailyBackup'
$startupShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Reagent Inventory Auto Start.lnk'

if (-not ($BackupTime -match '^\d{2}:\d{2}$')) {
    throw 'BackupTime must be in HH:mm format.'
}

$backupTaskCommand = "`"$powershellExe`" -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$backupScript`" -RetentionDays $RetentionDays"

$wshShell = New-Object -ComObject WScript.Shell
if (Test-Path $startupShortcutPath) {
    Remove-Item -LiteralPath $startupShortcutPath -Force
}
$shortcut = $wshShell.CreateShortcut($startupShortcutPath)
$shortcut.TargetPath = 'C:\Windows\System32\wscript.exe'
$shortcut.Arguments = "`"$startupVbs`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = 'C:\Windows\System32\wscript.exe,0'
$shortcut.Save()

schtasks /Create /F /TN $backupTaskName /SC DAILY /ST $BackupTime /TR $backupTaskCommand | Out-Null

Write-Host "Created startup shortcut: $startupShortcutPath"
Write-Host "Registered backup task: $backupTaskName at $BackupTime"
