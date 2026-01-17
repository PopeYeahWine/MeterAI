@echo off
REM Build script for MeterAI on Windows
REM This script sets up the correct environment for building with MSVC

set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"
set "MSVC_VERSION=14.44.35207"
set "SDK_VERSION=10.0.22621.0"

REM Set LIB paths (use onecore libraries since that's what's installed)
set "LIB=%VS_PATH%\VC\Tools\MSVC\%MSVC_VERSION%\lib\onecore\x64;C:\Program Files (x86)\Windows Kits\10\Lib\%SDK_VERSION%\ucrt\x64;C:\Program Files (x86)\Windows Kits\10\Lib\%SDK_VERSION%\um\x64"

REM Set INCLUDE paths
set "INCLUDE=%VS_PATH%\VC\Tools\MSVC\%MSVC_VERSION%\include;C:\Program Files (x86)\Windows Kits\10\Include\%SDK_VERSION%\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\%SDK_VERSION%\um;C:\Program Files (x86)\Windows Kits\10\Include\%SDK_VERSION%\shared"

REM Add MSVC and SDK tools to PATH
set "PATH=%VS_PATH%\VC\Tools\MSVC\%MSVC_VERSION%\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\%SDK_VERSION%\x64;%PATH%"

echo Building MeterAI...
echo LIB=%LIB%
echo.

cd /d "%~dp0"
npm run tauri:build
