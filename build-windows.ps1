# Build script for MeterAI on Windows
# This script uses the Visual Studio Developer PowerShell environment

$ErrorActionPreference = "Stop"

# Import Visual Studio Developer environment
$vsInstallPath = "C:\Program Files\Microsoft Visual Studio\2022\Community"
$vsvarsPath = Join-Path $vsInstallPath "Common7\Tools\Launch-VsDevShell.ps1"

if (Test-Path $vsvarsPath) {
    Write-Host "Loading Visual Studio Developer environment..."
    & $vsvarsPath -Arch amd64 -SkipAutomaticLocation
} else {
    Write-Error "Visual Studio 2022 not found at expected location"
    exit 1
}

# Navigate to project directory
Set-Location $PSScriptRoot

Write-Host "Environment set up. Building MeterAI..."
Write-Host "LIB: $env:LIB"
Write-Host "INCLUDE: $env:INCLUDE"
Write-Host ""

# Add Rust to PATH (at the end so VS tools take precedence)
$env:PATH = "$env:PATH;$env:USERPROFILE\.cargo\bin"

# Remove Git's /usr/bin from PATH to avoid conflict with VS's link.exe
$pathParts = $env:PATH -split ';' | Where-Object { $_ -notmatch 'Git\\usr\\bin' }
$env:PATH = $pathParts -join ';'

# Add MSVC libraries and includes (onecore since that's what's installed)
$msvcVersion = "14.44.35207"
$msvcBase = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\$msvcVersion"

$msvcLibPath = "$msvcBase\lib\onecore\x64"
if (Test-Path $msvcLibPath) {
    $env:LIB = "$msvcLibPath;$env:LIB"
    Write-Host "Added MSVC onecore libs to LIB path"
}

$msvcIncludePath = "$msvcBase\include"
if (Test-Path $msvcIncludePath) {
    $env:INCLUDE = "$msvcIncludePath;$env:INCLUDE"
    Write-Host "Added MSVC includes to INCLUDE path"
}

Write-Host "Cargo path: $(Get-Command cargo -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"
Write-Host "Link.exe path: $(Get-Command link.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"

# Build the app
npm run tauri:build
