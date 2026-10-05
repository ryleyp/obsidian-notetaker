# Windows launcher for the local Notetaker app.
# Starts the Next.js dev server on 127.0.0.1 (default port 3000) in its own
# minimised window, then opens the browser once the server answers.
# Stop the app later by closing that server window.

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$port = if ($env:NOTETAKER_PORT) { $env:NOTETAKER_PORT } else { "3000" }
$url = "http://127.0.0.1:$port"

function Test-NotetakerServer {
    try {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

Set-Location $projectDir

if (Test-NotetakerServer) {
    Write-Host "Notetaker is already running - opening the browser..."
    Start-Process $url
    exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js was not found. Install the LTS build from https://nodejs.org and try again." -ForegroundColor Red
    exit 1
}

# npm ships with Node but a broken PATH entry can leave one without the other,
# and the failure then looks like an install error rather than a missing tool.
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm was not found even though Node.js is installed." -ForegroundColor Red
    Write-Host "Reinstall Node.js from https://nodejs.org (the installer adds npm to PATH), then open a new window." -ForegroundColor Yellow
    exit 1
}

# What a failing install usually means on a managed Windows laptop. The npm
# output says the same thing, but buried in a wall of text most people will
# not read, so the launcher names it.
function Get-InstallHint($logPath) {
    if (-not (Test-Path $logPath)) { return $null }
    $log = Get-Content $logPath -Raw

    if ($log -match "ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|tunneling socket|407|EPROXY") {
        return "Looks like the network blocked npm. On a work laptop this is usually the corporate proxy. Try a different network (phone hotspot) to confirm, or ask IT for the npm proxy settings and set them with:`n  npm config set proxy http://your-proxy:port`n  npm config set https-proxy http://your-proxy:port"
    }
    if ($log -match "self[- ]signed certificate|SELF_SIGNED_CERT|unable to get local issuer|CERT_") {
        return "The network is inspecting TLS and npm does not trust the certificate — normal on a corporate laptop. Ask IT for the company root certificate and point npm at it:`n  npm config set cafile C:\path\to\company-root.pem`n(Turning off strict-ssl also works but weakens every future install.)"
    }
    if ($log -match "ENAMETOOLONG|path too long|exceeds the maximum|filename too long") {
        return "A path got too long for Windows. Move the project somewhere short, like C:\dev\notetaker, and run the launcher again."
    }
    if ($log -match "EPERM|EBUSY|operation not permitted|resource busy|being used by another process") {
        return "A file was locked mid-install — usually OneDrive syncing or antivirus scanning node_modules. Pause OneDrive (or move the project out of the OneDrive folder), then delete node_modules and run the launcher again."
    }
    if ($log -match "EACCES|Access is denied") {
        return "Windows refused access to a file. Make sure the project is somewhere you own, like C:\Users\<you>\dev, not Program Files."
    }
    if ($log -match "Unsupported engine|engine `"node`"|EBADENGINE") {
        return "The installed Node.js is too old for this app. Install the current LTS from https://nodejs.org, open a new window, and try again."
    }
    return $null
}

# A failed install leaves node_modules behind half-built, and checking only
# that the folder exists would skip the retry and fail later at `npm run dev`
# with something far less obvious. Check for the main dependency instead.
$nodeModules = Join-Path $projectDir "node_modules"
$installed = (Test-Path $nodeModules) -and (Test-Path (Join-Path $nodeModules "next"))

if (-not $installed) {
    if (Test-Path $nodeModules) {
        Write-Host "The last install did not finish; starting it again from scratch..."
        Remove-Item -Recurse -Force $nodeModules -ErrorAction SilentlyContinue
    }
    Write-Host "Installing dependencies (first run only)..."
    $installLog = Join-Path $projectDir "npm-install.log"
    # Tee so the log keeps the whole story even though the console scrolls.
    cmd.exe /c "npm install --no-audit --no-fund 2>&1" | Tee-Object -FilePath $installLog
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ERROR: npm install failed." -ForegroundColor Red
        $hint = Get-InstallHint $installLog
        if ($hint) {
            Write-Host ""
            Write-Host $hint -ForegroundColor Yellow
        } else {
            Write-Host "The last few lines of npm's output:" -ForegroundColor Yellow
            Get-Content $installLog -Tail 20 | ForEach-Object { Write-Host "  $_" }
        }
        Write-Host ""
        Write-Host "Full log: $installLog" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Starting Notetaker..."
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev -- --port $port" `
    -WorkingDirectory $projectDir `
    -WindowStyle Minimized

Write-Host "Waiting for the server..."
for ($i = 0; $i -lt 60; $i++) {
    if (Test-NotetakerServer) { break }
    Start-Sleep -Seconds 1
}

if (-not (Test-NotetakerServer)) {
    Write-Host "The server did not answer on $url yet. Check the minimised Notetaker window for errors." -ForegroundColor Yellow
}

Start-Process $url
Write-Host "Done - Notetaker keeps running in the minimised window."
