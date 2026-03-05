# MeterAI Dev Launcher (Windows / VS Code)

## Purpose

`scripts/start_dev.ps1` starts MeterAI in desktop development mode with Tauri:

- validates prerequisites (Node.js, npm, Rust toolchain),
- installs npm dependencies when needed,
- launches `npm run tauri:dev`.

No Django, Python virtualenv, migrations, or Docker are used.

## Prerequisites

- PowerShell 7 (`pwsh`)
- Node.js + npm
- Rust toolchain (`rustc`, `cargo`)

## Run manually

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_dev.ps1
```

## Options

- `-FrontendPort 1420`  
  Port check for the Vite dev server (warning only if already used).
- `-InstallDependencies`  
  Force `npm install` even if `node_modules` already exists.
- `-SkipLaunch`  
  Validate setup without launching `tauri:dev`.

## VS Code auto-start

The workspace task `Start Dev Bootstrap` in `.vscode/tasks.json` runs this script on folder open.

## Troubleshooting

- If prerequisites are missing, install the tool and rerun.
- If Tauri starts but no window appears, check the system tray icon and rerun from the task terminal to inspect logs.
- If port `1420` is already used, stop the conflicting process.
