$ErrorActionPreference = 'SilentlyContinue'

$connections = Get-NetTCPConnection -LocalPort 8000 -State Listen
if (-not $connections) {
    Write-Host 'No running service found on port 8000.'
    exit 0
}

$stopped = @()
foreach ($connection in $connections) {
    if ($connection.OwningProcess -and $stopped -notcontains $connection.OwningProcess) {
        Stop-Process -Id $connection.OwningProcess -Force
        $stopped += $connection.OwningProcess
    }
}

if ($stopped.Count -gt 0) {
    Write-Host ('Stopped service process: ' + ($stopped -join ', '))
}
