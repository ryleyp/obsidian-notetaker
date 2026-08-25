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

# The dev server runs in a minimised window, so check the version out here where
# the message is actually visible.
$nodeVersion = (& node --version).TrimStart("v")
if ([version]$nodeVersion -lt [version]"20.9.0") {
    Write-Host "ERROR: Node.js 20.9.0 or newer is required - this is Node.js $nodeVersion." -ForegroundColor Red
    Write-Host "Install the current LTS build from https://nodejs.org, then open a new terminal and run 'npm install' again."
    exit 1
}

if (-not (Test-Path (Join-Path $projectDir "node_modules"))) {
    Write-Host "Installing dependencies (first run only)..."
    cmd.exe /c "npm install"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: npm install failed." -ForegroundColor Red
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
