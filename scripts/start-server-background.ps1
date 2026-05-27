$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$healthUrl = 'http://127.0.0.1:8000/api/health'
$stdoutLog = Join-Path $projectRoot 'server-autostart.out.log'
$stderrLog = Join-Path $projectRoot 'server-autostart.err.log'

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

if (Test-Health) {
    exit 0
}

$pythonExe = Resolve-PythonExe

Start-Process -FilePath $pythonExe `
    -ArgumentList '-m','uvicorn','main:app','--host','0.0.0.0','--port','8000','--reload' `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden
