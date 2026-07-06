$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$Requirements = Join-Path $Backend "requirements.txt"
$InstallStamp = Join-Path $Backend ".venv\requirements-installed"

Write-Host ""
Write-Host "Nifty Probability Terminal" -ForegroundColor Green
Write-Host "Starting without Docker or WSL..." -ForegroundColor DarkGray

if (-not (Test-Path $VenvPython)) {
    $Launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($Launcher) {
        Write-Host "Creating the local Python environment (first run only)..."
        & py -3 -m venv (Join-Path $Backend ".venv")
    } else {
        $Python = Get-Command python -ErrorAction SilentlyContinue
        if (-not $Python) {
            Write-Host "Python 3.11 or newer is required." -ForegroundColor Red
            Write-Host "Install it from https://www.python.org/downloads/ and select 'Add Python to PATH'."
            exit 1
        }
        Write-Host "Creating the local Python environment (first run only)..."
        & python -m venv (Join-Path $Backend ".venv")
    }
}

$NeedsInstall = -not (Test-Path $InstallStamp)
if (-not $NeedsInstall) {
    $NeedsInstall = (Get-Item $Requirements).LastWriteTimeUtc -gt (Get-Item $InstallStamp).LastWriteTimeUtc
}
if ($NeedsInstall) {
    Write-Host "Installing Python packages (first run can take a few minutes)..."
    & $VenvPython -m pip install --disable-pip-version-check -r $Requirements
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    New-Item -ItemType File -Path $InstallStamp -Force | Out-Null
}

$BackendEnv = Join-Path $Backend ".env"
if (-not (Test-Path $BackendEnv)) {
    Copy-Item (Join-Path $Root ".env.example") $BackendEnv
}

try {
    $Health = Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2
    if ($Health.status -eq "ok") {
        Write-Host "The terminal is already running." -ForegroundColor Yellow
        Start-Process "http://127.0.0.1:8000"
        exit 0
    }
} catch { }

Write-Host ""
Write-Host "Refreshing verified data and checking the deployed model..." -ForegroundColor Cyan
Push-Location $Backend
try {
    & $VenvPython -m app.bootstrap
    $BootstrapExit = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($BootstrapExit -ne 0) {
    Write-Host "Data/model bootstrap failed. The dashboard was not started with stale data." -ForegroundColor Red
    exit $BootstrapExit
}

Write-Host ""
Write-Host "Opening http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host "Admin key on a fresh install: change-me" -ForegroundColor Yellow
Write-Host "Keep this window open. Press Ctrl+C to stop the app." -ForegroundColor DarkGray

$Server = Start-Process -FilePath $VenvPython `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $Backend -NoNewWindow -PassThru

try {
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $Health = Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2
            if ($Health.status -eq "ok") { $Ready = $true; break }
        } catch { }
        if ($Server.HasExited) { break }
    }
    if (-not $Ready) { throw "The local server did not start. Review the message above." }
    Start-Process "http://127.0.0.1:8000"
    Wait-Process -Id $Server.Id
} finally {
    if (-not $Server.HasExited) {
        Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
    }
}
