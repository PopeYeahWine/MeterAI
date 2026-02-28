# Local Dev Bootstrap (Windows / VS Code)

## Prerequisites

- PowerShell 7 (`pwsh`)
- Git
- Docker Desktop + Docker Compose v2 (`docker compose`)
- Python + `venv`
- Node.js + npm

## Configure `scripts/start_dev.ps1`

Edit the `$Script:Config` block and replace placeholder values:

- `{{APP_NAME}}`
- `{{PROJECT_ROOT}}` (optional, defaults to repo root)
- `{{MANAGE_OR_ENTRYPOINT}}`
- `{{DB_CONTAINER_NAME}}`
- `{{RUN_COMMAND}}`
- `{{SEED_COMMAND}}` (optional)
- `{{DJANGO_SETTINGS_MODULE}}` (optional)

Also adjust `DockerServices`, `RequirementFiles`, `UsefulUrls`, and `DevLogin` for your project.

## Run manually

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_dev.ps1
```

Options:

- `-Port 8001`
- `-NoDockerAutoStart`
- `-DockerTimeout 240`
- `-DbTimeout 90`

## VS Code auto-start

The workspace task `Start Dev Bootstrap` is configured in `.vscode/tasks.json` with `runOn: "folderOpen"`.
Automatic tasks are enabled via `.vscode/settings.json`.

## Troubleshooting

- If the script exits on prerequisites, install missing tools and reopen the terminal.
- If Docker does not become ready in time, launch Docker Desktop manually and rerun.
- If backend port is busy, stop the reported PID or run with another `-Port`.
- If migrations/seed fail, run the command manually inside the activated venv to inspect the error.
