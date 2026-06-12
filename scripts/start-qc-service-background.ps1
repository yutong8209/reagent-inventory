$ErrorActionPreference = 'Stop'

$projectRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('Rjpc5ZGo6Zuo5qGQXOWupOWGhei0qOaOp+WkhOeQhg=='))
$healthUrl = 'http://127.0.0.1:5001/'
$stdoutLog = Join-Path $projectRoot 'server-autostart.out.log'
$stderrLog = Join-Path $projectRoot 'server-autostart.err.log'

function Get-LanHealthUrl {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -like '192.168.*' -or
                $_.IPAddress -like '10.*' -or
                $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
            } |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return "http://$ip`:5001/" }
    } catch {
        return $null
    }
    return $null
}

function Resolve-PythonExe {
    $candidates = @(
        (Join-Path $projectRoot '.venv-win\Scripts\python.exe'),
        'C:\Users\lenovo\AppData\Local\Python\pythoncore-3.14-64\python.exe',
        (Join-Path $projectRoot '.venv\Scripts\python.exe'),
        (Join-Path $projectRoot '.venv2\Scripts\python.exe')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
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
    param([string]$Url = $healthUrl)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Stop-WslQcService {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wsl) { return }

    & $wsl.Source sh -lc "systemctl --user disable --now qc-webapp.service qc-web.service >/dev/null 2>&1 || true" | Out-Null
}

$lanHealthUrl = Get-LanHealthUrl
if ((Test-Health) -and (-not $lanHealthUrl -or (Test-Health $lanHealthUrl))) {
    exit 0
}

Stop-WslQcService

$pythonExe = Resolve-PythonExe

Start-Process -FilePath $pythonExe `
    -ArgumentList 'app.py' `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden
