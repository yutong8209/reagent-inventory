$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$healthUrl = 'http://127.0.0.1:8000/api/health'
$stdoutLog = Join-Path $projectRoot 'server-autostart.out.log'
$stderrLog = Join-Path $projectRoot 'server-autostart.err.log'
$mutexName = 'Global\ReagentInventoryServerWatchdog'

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

function Test-Health {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
        return $response.status -eq 'ok'
    } catch {
        return $false
    }
}

function Stop-ListeningServer {
    $connections = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        return
    }

    $stopped = @()
    foreach ($connection in $connections) {
        if ($connection.OwningProcess -and $stopped -notcontains $connection.OwningProcess) {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
            $stopped += $connection.OwningProcess
        }
    }
}

$pythonExe = Resolve-PythonExe

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

try {
    while ($true) {
        if (-not (Test-Health)) {
            Stop-ListeningServer
            Start-Process -FilePath $pythonExe `
                -ArgumentList '-m','uvicorn','main:app','--host','0.0.0.0','--port','8000' `
                -WorkingDirectory $projectRoot `
                -RedirectStandardOutput $stdoutLog `
                -RedirectStandardError $stderrLog `
                -WindowStyle Hidden
            Start-Sleep -Seconds 10
        }

        Start-Sleep -Seconds 30
    }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
