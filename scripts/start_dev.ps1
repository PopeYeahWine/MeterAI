[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 1420,

    [Parameter()]
    [switch]$InstallDependencies,

    [Parameter()]
    [switch]$SkipLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Script:StepIndex = 0
$Script:ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Write-Log {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("OK", "WARN", "ERR", "INFO", "SKIP")]
        [string]$Level,

        [Parameter(Mandatory)]
        [string]$Message
    )

    $color = switch ($Level) {
        "OK"   { "Green" }
        "WARN" { "Yellow" }
        "ERR"  { "Red" }
        "INFO" { "Cyan" }
        "SKIP" { "DarkGray" }
    }

    Write-Host ("[{0}] {1}" -f $Level, $Message) -ForegroundColor $color
}

function Start-Step {
    param([Parameter(Mandatory)][string]$Title)
    $Script:StepIndex++
    Write-Host ""
    Write-Host ("[{0:00}] {1}" -f $Script:StepIndex, $Title) -ForegroundColor Magenta
}

function Test-CommandAvailable {
    param([Parameter(Mandatory)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter()][string[]]$Arguments = @(),
        [Parameter()][string]$WorkingDirectory = (Get-Location).Path
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        $argString = ($Arguments -join " ")
        throw "Command failed ($exitCode): $FilePath $argString"
    }
}

function Assert-ProjectFile {
    param([Parameter(Mandatory)][string]$RelativePath)
    $path = Join-Path $Script:ProjectRoot $RelativePath
    if (-not (Test-Path $path -PathType Leaf)) {
        throw "Missing required file: $RelativePath"
    }
}

function Get-ListeningProcessOnPort {
    param([Parameter(Mandatory)][int]$Port)

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        return $null
    }

    $pid = $listener.OwningProcess
    $name = "<unknown>"
    try {
        $name = (Get-Process -Id $pid -ErrorAction Stop).ProcessName
    }
    catch {
        $name = "<not accessible>"
    }

    return [ordered]@{
        Pid  = $pid
        Name = $name
    }
}

function Main {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  MeterAI - Dev Launcher (PowerShell)" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""

    Write-Log INFO "Project root: $Script:ProjectRoot"

    Start-Step "Validate project structure"
    Assert-ProjectFile -RelativePath "package.json"
    Assert-ProjectFile -RelativePath "src-tauri/tauri.conf.json"
    Write-Log OK "Required project files found."

    Start-Step "Check prerequisites"
    $missing = @()
    foreach ($cmd in @("node", "npm", "cargo", "rustc")) {
        if (Test-CommandAvailable $cmd) {
            Write-Log OK "$cmd found."
        }
        else {
            Write-Log ERR "$cmd not found in PATH."
            $missing += $cmd
        }
    }
    if ($missing.Count -gt 0) {
        throw "Missing prerequisites: $($missing -join ', '). Install them and retry."
    }

    Start-Step "Install npm dependencies"
    $nodeModulesPath = Join-Path $Script:ProjectRoot "node_modules"
    if ($InstallDependencies -or -not (Test-Path $nodeModulesPath -PathType Container)) {
        Write-Log INFO "Running npm install..."
        Invoke-ExternalCommand -FilePath "npm" -Arguments @("install") -WorkingDirectory $Script:ProjectRoot
        Write-Log OK "npm dependencies installed."
    }
    else {
        Write-Log SKIP "node_modules already present. Use -InstallDependencies to force npm install."
    }

    Start-Step "Check Tauri CLI"
    Invoke-ExternalCommand -FilePath "npm" -Arguments @("run", "tauri", "--", "--version") -WorkingDirectory $Script:ProjectRoot
    Write-Log OK "Tauri CLI is available."

    Start-Step "Frontend port status"
    $listener = Get-ListeningProcessOnPort -Port $FrontendPort
    if ($null -eq $listener) {
        Write-Log OK "Port $FrontendPort is free."
    }
    else {
        Write-Log WARN "Port $FrontendPort is already used by PID $($listener.Pid) ($($listener.Name))."
        Write-Log WARN "If launch fails, stop this process or use another port in tauri.conf.json."
    }

    Start-Step "Launch MeterAI in dev mode"
    if ($SkipLaunch) {
        Write-Log SKIP "SkipLaunch enabled. Validation completed without starting the app."
        return
    }

    $env:METERAI_DEV_SHOW_WINDOW = "1"
    Write-Log INFO "Set METERAI_DEV_SHOW_WINDOW=1"
    Write-Log INFO "Starting: npm run tauri:dev"
    Write-Host ""
    Invoke-ExternalCommand -FilePath "npm" -Arguments @("run", "tauri:dev") -WorkingDirectory $Script:ProjectRoot
}

try {
    Main
}
catch {
    Write-Host ""
    Write-Log ERR $_.Exception.Message
    Write-Log INFO "Troubleshooting: verify Node.js, Rust, and npm dependencies."
    exit 1
}
