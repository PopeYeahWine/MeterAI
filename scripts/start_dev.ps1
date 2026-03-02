[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$Port = 4000,

    [Parameter()]
    [switch]$NoDockerAutoStart,

    [Parameter()]
    [ValidateRange(10, 1800)]
    [int]$DockerTimeout = 180,

    [Parameter()]
    [ValidateRange(10, 1800)]
    [int]$DbTimeout = 60
)

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "[ERR] This script requires PowerShell 7 or newer." -ForegroundColor Red
    exit 1
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# =====================================================================
# Project-specific settings (adapt these values for your project)
# =====================================================================
$Script:Config = [ordered]@{
    AppName              = "{{APP_NAME}}"
    ProjectRoot          = "{{PROJECT_ROOT}}"
    BackendEntrypoint    = "{{MANAGE_OR_ENTRYPOINT}}"
    VenvName             = "venv"
    RequirementFiles     = @("requirements/base.txt", "requirements/dev.txt")
    DockerServices       = @("db", "mailpit")
    DbContainerName      = "{{DB_CONTAINER_NAME}}"
    RunCommandTemplate   = "{{RUN_COMMAND}}"
    SeedCommand          = "{{SEED_COMMAND}}"
    DjangoSettingsModule = "{{DJANGO_SETTINGS_MODULE}}"
    DevLogin             = "dev@example.com / dev-password"
    AssetMarkers         = @("staticfiles", "public/build", "dist")
    UsefulUrls           = @(
        "Application: http://127.0.0.1:{PORT}",
        "Mailpit: http://127.0.0.1:8025"
    )
}

$Script:StepIndex = 0

function Write-Banner {
    param([string]$AppName)

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  $AppName - Local Dev Bootstrap (PowerShell 7)" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

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

function Test-PlaceholderValue {
    param([Parameter()][AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    return $Value.Trim() -match '^\{\{[^}]+\}\}$'
}

function Resolve-TemplateConfig {
    # Keep the script runnable even if template placeholders were not replaced yet.
    if (Test-PlaceholderValue $Script:Config.AppName) {
        $Script:Config.AppName = "LocalDevApp"
    }

    if (Test-PlaceholderValue $Script:Config.ProjectRoot) {
        $Script:Config.ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    }

    if (Test-PlaceholderValue $Script:Config.BackendEntrypoint) {
        $Script:Config.BackendEntrypoint = "manage.py"
    }

    if (Test-PlaceholderValue $Script:Config.RunCommandTemplate) {
        $Script:Config.RunCommandTemplate = "python manage.py runserver 0.0.0.0:{PORT}"
    }

    if (Test-PlaceholderValue $Script:Config.DbContainerName) {
        if ($Script:Config.DockerServices.Count -gt 0) {
            $Script:Config.DbContainerName = $Script:Config.DockerServices[0]
        }
        else {
            $Script:Config.DbContainerName = ""
        }
    }

    if (Test-PlaceholderValue $Script:Config.SeedCommand) {
        $Script:Config.SeedCommand = ""
    }

    if (Test-PlaceholderValue $Script:Config.DjangoSettingsModule) {
        $Script:Config.DjangoSettingsModule = ""
    }
}

function Test-CommandAvailable {
    param([Parameter(Mandatory)][string]$Name)

    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter()][string[]]$Arguments = @(),
        [Parameter()][string]$WorkingDirectory = (Get-Location).Path,
        [Parameter()][switch]$IgnoreExitCode
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

    if ((-not $IgnoreExitCode) -and $exitCode -ne 0) {
        $argString = ($Arguments -join " ")
        throw "Command failed ($exitCode): $FilePath $argString"
    }

    return $exitCode
}

function Invoke-CommandLine {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter()][string]$WorkingDirectory = (Get-Location).Path,
        [Parameter()][switch]$IgnoreExitCode
    )

    Push-Location $WorkingDirectory
    try {
        Invoke-Expression $Command
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }
    }
    finally {
        Pop-Location
    }

    if ((-not $IgnoreExitCode) -and $exitCode -ne 0) {
        throw "Command failed ($exitCode): $Command"
    }

    return $exitCode
}

function Get-CombinedSha256 {
    param([Parameter(Mandatory)][string[]]$Paths)

    $builder = New-Object System.Text.StringBuilder
    foreach ($path in ($Paths | Sort-Object)) {
        $absolute = (Resolve-Path $path).Path
        $fileHash = (Get-FileHash -Algorithm SHA256 -Path $absolute).Hash
        [void]$builder.AppendLine("$absolute|$fileHash")
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($builder.ToString())
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digestBytes = $sha256.ComputeHash($bytes)
    }
    finally {
        $sha256.Dispose()
    }

    return ([System.BitConverter]::ToString($digestBytes)).Replace("-", "").ToLowerInvariant()
}

function Test-DockerDaemonReady {
    docker info *> $null
    $code = if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }
    return $code -eq 0
}

function Wait-ForDockerDaemon {
    param([Parameter(Mandatory)][int]$TimeoutSeconds)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (Test-DockerDaemonReady) {
            return $true
        }
        Start-Sleep -Seconds 2
    }

    return $false
}

function Start-DockerDesktop {
    $dockerDesktopCandidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe")
    ) | Where-Object { $_ -and (Test-Path $_) }

    if (-not $dockerDesktopCandidates) {
        throw "Docker daemon is not reachable and Docker Desktop executable was not found. Start Docker Desktop manually."
    }

    $exe = $dockerDesktopCandidates | Select-Object -First 1
    Write-Log INFO "Starting Docker Desktop: $exe"
    Start-Process -FilePath $exe | Out-Null
}

function Resolve-ComposeFile {
    param([Parameter(Mandatory)][string]$ProjectRoot)

    $candidates = @("compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml")
    foreach ($candidate in $candidates) {
        $fullPath = Join-Path $ProjectRoot $candidate
        if (Test-Path $fullPath) {
            return $fullPath
        }
    }
    return $null
}

function Resolve-ContainerName {
    param([Parameter(Mandatory)][string]$NameHint)

    $allNames = (& docker ps -a --format "{{.Names}}" 2>$null) | Where-Object { $_ -and $_.Trim().Length -gt 0 }
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    $exact = $allNames | Where-Object { $_ -eq $NameHint } | Select-Object -First 1
    if ($exact) {
        return $exact
    }

    $contains = $allNames | Where-Object { $_ -like "*$NameHint*" } | Select-Object -First 1
    return $contains
}

function Wait-ForDbHealth {
    param(
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][int]$TimeoutSeconds
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $warnedNoHealthcheck = $false

    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $healthStatus = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}" $ContainerName 2>$null)
        if ($LASTEXITCODE -ne 0) {
            Start-Sleep -Seconds 2
            continue
        }

        $status = ($healthStatus | Select-Object -First 1).Trim().ToLowerInvariant()
        if ($status -eq "healthy") {
            return $true
        }

        if ($status -eq "no-healthcheck") {
            if (-not $warnedNoHealthcheck) {
                Write-Log WARN "Container '$ContainerName' has no healthcheck; falling back to running state."
                $warnedNoHealthcheck = $true
            }

            $stateStatus = (& docker inspect --format "{{.State.Status}}" $ContainerName 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
            if ($stateStatus -eq "running") {
                return $true
            }
        }

        Start-Sleep -Seconds 2
    }

    return $false
}

function Assert-PortFree {
    param([Parameter(Mandatory)][int]$Port)

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        return
    }

    $pid = $listener.OwningProcess
    $processName = "<unknown>"
    try {
        $processName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName
    }
    catch {
        $processName = "<not accessible>"
    }

    throw "Port $Port is already in use by PID $pid ($processName). Stop the process or use -Port with another value."
}

function Set-EnvDefault {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )

    $currentValue = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace($currentValue)) {
        Set-Item -Path ("Env:{0}" -f $Name) -Value $Value
        Write-Log INFO "Set env $Name=$Value"
    }
    else {
        Write-Log SKIP "Env $Name already set ($currentValue)"
    }
}

function Resolve-BackendEntrypoint {
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$ConfiguredRelativePath
    )

    $configuredAbsolute = Join-Path $ProjectRoot $ConfiguredRelativePath
    if (Test-Path $configuredAbsolute -PathType Leaf) {
        return [ordered]@{
            Exists        = $true
            AbsolutePath  = (Resolve-Path $configuredAbsolute).Path
            Directory     = (Resolve-Path (Split-Path -Parent $configuredAbsolute)).Path
            ScriptName    = (Split-Path -Leaf $configuredAbsolute)
            RelativePath  = $ConfiguredRelativePath
        }
    }

    $detected = Get-ChildItem -Path $ProjectRoot -Filter "manage.py" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($detected) {
        $relative = [System.IO.Path]::GetRelativePath($ProjectRoot, $detected.FullName)
        Write-Log WARN "Configured backend entrypoint not found. Auto-detected: $relative"
        return [ordered]@{
            Exists        = $true
            AbsolutePath  = $detected.FullName
            Directory     = $detected.DirectoryName
            ScriptName    = $detected.Name
            RelativePath  = $relative
        }
    }

    return [ordered]@{
        Exists        = $false
        AbsolutePath  = $null
        Directory     = $ProjectRoot
        ScriptName    = $null
        RelativePath  = $ConfiguredRelativePath
    }
}

function Get-GitDirtyChoice {
    while ($true) {
        Write-Host ""
        Write-Host "Uncommitted changes detected. Choose an action:" -ForegroundColor Yellow
        Write-Host "  [C] Continue without pull"
        Write-Host "  [S] Stash + pull --ff-only + stash pop"
        Write-Host "  [A] Abort"
        $raw = Read-Host "Your choice"
        if ([string]::IsNullOrWhiteSpace($raw)) { return "CONTINUE" }
        $choice = $raw.Trim().ToUpperInvariant()
        switch ($choice) {
            "C" { return "CONTINUE" }
            "S" { return "STASH_PULL" }
            "A" { return "ABORT" }
            default { Write-Log WARN "Invalid choice. Enter C, S, or A." }
        }
    }
}

function Main {
    # Initialise $LASTEXITCODE so strict mode doesn't throw before the first
    # external command has had a chance to set it.
    $global:LASTEXITCODE = 0

    Resolve-TemplateConfig

    Write-Banner -AppName $Script:Config.AppName
    Write-Log INFO "Project root: $($Script:Config.ProjectRoot)"
    Write-Log INFO "Requested backend port: $Port"

    if (-not (Test-Path $Script:Config.ProjectRoot)) {
        throw "Project root does not exist: $($Script:Config.ProjectRoot)"
    }

    # -----------------------------------------------------------------
    # [01] Git step
    # -----------------------------------------------------------------
    Start-Step "Git synchronization"

    if (-not (Test-CommandAvailable "git")) {
        throw "Git is required but was not found in PATH."
    }

    Push-Location $Script:Config.ProjectRoot
    try {
        $insideWorktree = (& git rev-parse --is-inside-work-tree 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
        if ($LASTEXITCODE -ne 0 -or $insideWorktree -ne "true") {
            throw "Current folder is not a git repository: $($Script:Config.ProjectRoot)"
        }

        $branch = (& git rev-parse --abbrev-ref HEAD | Select-Object -First 1).Trim()
        Write-Log OK "Repository detected. Current branch: $branch"

        $dirtyStatus = (& git status --porcelain 2>$null)
        $hasLocalChanges = ($dirtyStatus | Measure-Object).Count -gt 0

        if ($hasLocalChanges) {
            Write-Log WARN "Local modifications detected."
            $action = Get-GitDirtyChoice
            switch ($action) {
                "CONTINUE" {
                    Write-Log SKIP "Continuing without pull."
                }
                "STASH_PULL" {
                    $stashMessage = "dev-bootstrap-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
                    $stashOutput = (& git stash push -u -m $stashMessage 2>&1 | Out-String).Trim()
                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to stash local changes.`n$stashOutput"
                    }

                    $stashCreated = -not ($stashOutput -match "No local changes to save")
                    Write-Log OK "Changes stashed."

                    Invoke-ExternalCommand -FilePath "git" -Arguments @("fetch", "--prune", "origin") -WorkingDirectory $Script:Config.ProjectRoot
                    $upstream = (& git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null | Select-Object -First 1)
                    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($upstream)) {
                        Invoke-ExternalCommand -FilePath "git" -Arguments @("pull", "--ff-only") -WorkingDirectory $Script:Config.ProjectRoot
                        Write-Log OK "Fast-forward pull completed."
                    }
                    else {
                        Write-Log SKIP "No upstream branch configured; skipping pull."
                    }

                    if ($stashCreated) {
                        $popOutput = (& git stash pop 2>&1 | Out-String).Trim()
                        if ($LASTEXITCODE -ne 0) {
                            throw "Failed to re-apply stash. Resolve conflicts manually.`n$popOutput"
                        }
                        Write-Log OK "Stash re-applied."
                    }
                }
                "ABORT" {
                    throw "Aborted by user."
                }
            }
        }
        else {
            Write-Log OK "Working tree is clean."
            Invoke-ExternalCommand -FilePath "git" -Arguments @("fetch", "--prune", "origin") -WorkingDirectory $Script:Config.ProjectRoot

            $upstream = (& git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null | Select-Object -First 1)
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($upstream)) {
                $behindRaw = (& git rev-list --count "HEAD..$upstream" 2>$null | Select-Object -First 1)
                [int]$behindCount = 0
                [void][int]::TryParse(($behindRaw.Trim()), [ref]$behindCount)

                if ($behindCount -gt 0) {
                    Write-Log INFO "Branch is behind upstream by $behindCount commit(s). Pulling..."
                    Invoke-ExternalCommand -FilePath "git" -Arguments @("pull", "--ff-only") -WorkingDirectory $Script:Config.ProjectRoot
                    Write-Log OK "Fast-forward pull completed."
                }
                else {
                    Write-Log SKIP "No remote updates to pull."
                }
            }
            else {
                Write-Log SKIP "No upstream branch configured; skipping pull."
            }
        }
    }
    finally {
        Pop-Location
    }

    # -----------------------------------------------------------------
    # [02] Prerequisites
    # -----------------------------------------------------------------
    Start-Step "Prerequisites and environment files"

    $missingCommands = @()
    foreach ($cmd in @("docker", "python", "node", "npm")) {
        if (Test-CommandAvailable $cmd) {
            Write-Log OK "$cmd found."
        }
        else {
            Write-Log ERR "$cmd not found in PATH."
            $missingCommands += $cmd
        }
    }

    if ($missingCommands.Count -gt 0) {
        throw "Missing prerequisites: $($missingCommands -join ', '). Install them and retry."
    }

    $composeVersionOutput = (& docker compose version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is required. 'docker compose version' failed.`n$composeVersionOutput"
    }
    Write-Log OK "Docker Compose v2 detected."

    $envPath = Join-Path $Script:Config.ProjectRoot ".env"
    $envExamplePath = Join-Path $Script:Config.ProjectRoot ".env.example"
    if (Test-Path $envPath) {
        Write-Log OK ".env file found."
    }
    elseif (Test-Path $envExamplePath) {
        Copy-Item -Path $envExamplePath -Destination $envPath -Force
        Write-Log OK ".env created from .env.example."
    }
    else {
        Write-Log WARN ".env missing and .env.example not found. Continuing without automatic env file bootstrap."
    }

    # -----------------------------------------------------------------
    # [03] Dependencies
    # -----------------------------------------------------------------
    Start-Step "Dependencies (Python / npm / assets)"

    $venvPath = Join-Path $Script:Config.ProjectRoot $Script:Config.VenvName
    $venvPython = Join-Path $venvPath "Scripts\python.exe"
    $venvActivate = Join-Path $venvPath "Scripts\Activate.ps1"
    $depsHashFile = Join-Path $venvPath ".deps_hash"
    $venvWasCreated = $false

    if (-not (Test-Path $venvPath)) {
        Write-Log INFO "Creating virtual environment at '$venvPath'..."
        Invoke-ExternalCommand -FilePath "python" -Arguments @("-m", "venv", $venvPath) -WorkingDirectory $Script:Config.ProjectRoot
        $venvWasCreated = $true
        Write-Log OK "Virtual environment created."
    }
    else {
        Write-Log SKIP "Virtual environment already exists."
    }

    if (-not (Test-Path $venvPython)) {
        throw "Virtual environment python not found: $venvPython"
    }

    $existingReqFiles = @()
    foreach ($relativeReq in $Script:Config.RequirementFiles) {
        $reqPath = Join-Path $Script:Config.ProjectRoot $relativeReq
        if (Test-Path $reqPath) {
            $existingReqFiles += $reqPath
        }
        else {
            Write-Log WARN "Requirements file not found: $relativeReq"
        }
    }

    $requirementsHash = $null
    if ($existingReqFiles.Count -gt 0) {
        $requirementsHash = Get-CombinedSha256 -Paths $existingReqFiles
    }

    $depsNeedInstall = $venvWasCreated -or -not (Test-Path $depsHashFile)
    if (-not $depsNeedInstall -and $requirementsHash) {
        $storedHash = (Get-Content $depsHashFile -Raw).Trim()
        if ($storedHash -ne $requirementsHash) {
            $depsNeedInstall = $true
        }
    }

    if ($depsNeedInstall -and $existingReqFiles.Count -gt 0) {
        Write-Log INFO "Installing Python dependencies..."
        Invoke-ExternalCommand -FilePath $venvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip", "wheel") -WorkingDirectory $Script:Config.ProjectRoot

        foreach ($reqPath in $existingReqFiles) {
            Invoke-ExternalCommand -FilePath $venvPython -Arguments @("-m", "pip", "install", "-r", $reqPath) -WorkingDirectory $Script:Config.ProjectRoot
        }

        if ($requirementsHash) {
            Set-Content -Path $depsHashFile -Value $requirementsHash -NoNewline
        }
        Write-Log OK "Python dependencies installed."
    }
    elseif ($existingReqFiles.Count -eq 0) {
        Write-Log SKIP "No requirements files found. Skipping pip install."
    }
    else {
        Write-Log SKIP "Python dependencies already up-to-date."
    }

    $packageJsonPath = Join-Path $Script:Config.ProjectRoot "package.json"
    if (Test-Path $packageJsonPath) {
        $nodeModulesPath = Join-Path $Script:Config.ProjectRoot "node_modules"
        if (-not (Test-Path $nodeModulesPath)) {
            Write-Log INFO "node_modules missing. Running npm install..."
            Invoke-ExternalCommand -FilePath "npm" -Arguments @("install") -WorkingDirectory $Script:Config.ProjectRoot
            Write-Log OK "npm install completed."
        }
        else {
            Write-Log SKIP "node_modules already present."
        }

        $assetsFound = $false
        foreach ($marker in $Script:Config.AssetMarkers) {
            if (Test-Path (Join-Path $Script:Config.ProjectRoot $marker)) {
                $assetsFound = $true
                break
            }
        }

        if (-not $assetsFound) {
            Write-Log WARN "No static asset marker found. Running frontend bootstrap commands if available."
            $pkgJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
            $scriptNames = @()
            if ($pkgJson.scripts) {
                $scriptNames = $pkgJson.scripts.PSObject.Properties.Name
            }

            if ($scriptNames -contains "setup") {
                Invoke-ExternalCommand -FilePath "npm" -Arguments @("run", "setup") -WorkingDirectory $Script:Config.ProjectRoot
                Write-Log OK "npm run setup completed."
            }
            else {
                Write-Log SKIP "No npm script named 'setup'."
            }

            if ($scriptNames -contains "build") {
                Invoke-ExternalCommand -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $Script:Config.ProjectRoot
                Write-Log OK "npm run build completed."
            }
            else {
                Write-Log SKIP "No npm script named 'build'."
            }
        }
        else {
            Write-Log SKIP "Static asset markers found. Skipping npm setup/build."
        }
    }
    else {
        Write-Log SKIP "package.json not found. Skipping npm checks."
    }

    # -----------------------------------------------------------------
    # [04] Docker Desktop
    # -----------------------------------------------------------------
    Start-Step "Docker daemon readiness"

    if (-not (Test-DockerDaemonReady)) {
        if ($NoDockerAutoStart) {
            throw "Docker daemon is unavailable and -NoDockerAutoStart was provided."
        }

        Start-DockerDesktop
        Write-Log INFO "Waiting for Docker daemon (timeout: ${DockerTimeout}s)..."
        if (-not (Wait-ForDockerDaemon -TimeoutSeconds $DockerTimeout)) {
            throw "Docker daemon did not become ready within ${DockerTimeout}s."
        }
    }
    Write-Log OK "Docker daemon is ready."

    # -----------------------------------------------------------------
    # [05] Docker Compose services
    # -----------------------------------------------------------------
    Start-Step "Docker Compose services"

    $composeFile = Resolve-ComposeFile -ProjectRoot $Script:Config.ProjectRoot
    if (-not $composeFile) {
        Write-Log SKIP "No compose file found. Skipping docker compose up."
    }
    else {
        Write-Log INFO "Compose file detected: $(Split-Path -Leaf $composeFile)"
        if ($Script:Config.DockerServices.Count -gt 0) {
            $composeArgs = @("compose", "up", "-d") + $Script:Config.DockerServices
            Invoke-ExternalCommand -FilePath "docker" -Arguments $composeArgs -WorkingDirectory $Script:Config.ProjectRoot
            Write-Log OK "Services started: $($Script:Config.DockerServices -join ', ')"
        }
        else {
            Write-Log SKIP "No docker services configured."
        }
    }

    # -----------------------------------------------------------------
    # [06] Database healthcheck
    # -----------------------------------------------------------------
    Start-Step "Database readiness"

    if ([string]::IsNullOrWhiteSpace($Script:Config.DbContainerName)) {
        Write-Log SKIP "DbContainerName is empty. Skipping DB readiness."
    }
    else {
        $resolvedDbContainer = Resolve-ContainerName -NameHint $Script:Config.DbContainerName
        if (-not $resolvedDbContainer) {
            throw "Unable to find DB container matching '$($Script:Config.DbContainerName)'."
        }

        Write-Log INFO "Waiting for DB container '$resolvedDbContainer' (timeout: ${DbTimeout}s)..."
        if (-not (Wait-ForDbHealth -ContainerName $resolvedDbContainer -TimeoutSeconds $DbTimeout)) {
            throw "DB container '$resolvedDbContainer' was not ready within ${DbTimeout}s."
        }
        Write-Log OK "Database container is ready."
    }

    # -----------------------------------------------------------------
    # [07] Backend port availability
    # -----------------------------------------------------------------
    Start-Step "Backend port check"
    Assert-PortFree -Port $Port
    Write-Log OK "Port $Port is free."

    # -----------------------------------------------------------------
    # [08] Python venv + environment variables
    # -----------------------------------------------------------------
    Start-Step "Activate venv and export dev environment"

    if (-not (Test-Path $venvActivate)) {
        throw "Venv activation script not found: $venvActivate"
    }

    . $venvActivate
    Write-Log OK "Virtual environment activated."

    Set-EnvDefault -Name "DB_HOST" -Value "127.0.0.1"
    Set-EnvDefault -Name "DB_PORT" -Value "5432"
    Set-EnvDefault -Name "EMAIL_HOST" -Value "127.0.0.1"
    Set-EnvDefault -Name "EMAIL_PORT" -Value "1025"
    if (-not [string]::IsNullOrWhiteSpace($Script:Config.DjangoSettingsModule)) {
        Set-EnvDefault -Name "DJANGO_SETTINGS_MODULE" -Value $Script:Config.DjangoSettingsModule
    }
    Set-EnvDefault -Name "PYTHONUNBUFFERED" -Value "1"

    # -----------------------------------------------------------------
    # [09] Migrations
    # -----------------------------------------------------------------
    Start-Step "Database migrations"

    $backend = Resolve-BackendEntrypoint -ProjectRoot $Script:Config.ProjectRoot -ConfiguredRelativePath $Script:Config.BackendEntrypoint
    if (-not $backend.Exists) {
        Write-Log WARN "Backend entrypoint not found ($($backend.RelativePath)). Skipping migrate checks."
    }
    else {
        $migrateCheckExit = Invoke-ExternalCommand -FilePath $venvPython -Arguments @($backend.ScriptName, "migrate", "--check", "--noinput") -WorkingDirectory $backend.Directory -IgnoreExitCode
        if ($migrateCheckExit -eq 0) {
            Write-Log OK "Migrations are up to date."
        }
        else {
            Write-Log WARN "Pending migrations detected. Applying migrations..."
            Invoke-ExternalCommand -FilePath $venvPython -Arguments @($backend.ScriptName, "migrate", "--noinput") -WorkingDirectory $backend.Directory
            Write-Log OK "Migrations applied."
        }
    }

    # -----------------------------------------------------------------
    # [10] Optional seed command
    # -----------------------------------------------------------------
    Start-Step "Seed dev user (optional)"

    if ([string]::IsNullOrWhiteSpace($Script:Config.SeedCommand)) {
        Write-Log SKIP "No seed command configured."
    }
    elseif (-not $backend.Exists) {
        Write-Log SKIP "Seed skipped because backend entrypoint is unavailable."
    }
    else {
        Write-Log INFO "Running seed command..."
        $seedExit = Invoke-CommandLine -Command $Script:Config.SeedCommand -WorkingDirectory $backend.Directory -IgnoreExitCode
        if ($seedExit -eq 0) {
            Write-Log OK "Seed command completed."
        }
        else {
            Write-Log WARN "Seed command exited with code $seedExit. Continuing."
        }
    }

    # -----------------------------------------------------------------
    # [11] Summary
    # -----------------------------------------------------------------
    Start-Step "Summary"

    Write-Log OK "Bootstrap completed successfully."
    Write-Host ""
    Write-Host "Useful URLs:" -ForegroundColor Cyan
    foreach ($line in $Script:Config.UsefulUrls) {
        $resolvedLine = $line.Replace("{PORT}", "$Port").Replace('$Port', "$Port")
        Write-Host ("  - " + $resolvedLine)
    }
    if (-not [string]::IsNullOrWhiteSpace($Script:Config.DevLogin)) {
        Write-Host ("  - Dev login: " + $Script:Config.DevLogin)
    }
    Write-Host ""

    # -----------------------------------------------------------------
    # [12] Launch dev server
    # -----------------------------------------------------------------
    Start-Step "Launch dev server"

    $runCommand = $Script:Config.RunCommandTemplate.Replace("{PORT}", "$Port").Replace('$Port', "$Port")
    $runDir = if ($backend.Exists) { $backend.Directory } else { $Script:Config.ProjectRoot }
    Write-Log INFO "Starting: $runCommand"
    Write-Log INFO "Working directory: $runDir"
    Write-Host ""

    Invoke-CommandLine -Command $runCommand -WorkingDirectory $runDir
}

try {
    Main
}
catch {
    Write-Host ""
    Write-Log ERR $_.Exception.Message
    Write-Log INFO "Troubleshooting: check prerequisites, docker status, and project-specific values at the top of scripts/start_dev.ps1."
    exit 1
}
