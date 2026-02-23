import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { promises as fs, type Dirent } from 'fs'

type JsonRecord = Record<string, unknown>

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
  }
  accessToken?: string
}

interface ClaudeUsageWindow {
  utilization?: number
  resets_at?: string
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow
}

interface CodexUsageSnapshot {
  usedPercent: number | null
  resetIso: string | null
}

interface ProviderSnapshot {
  label: string
  usedPercent: number | null
  resetIso: string | null
  error?: string
}

let brandStatusBarItem: vscode.StatusBarItem
let claudeStatusBarItem: vscode.StatusBarItem
let codexStatusBarItem: vscode.StatusBarItem
let output: vscode.OutputChannel
let refreshTimer: NodeJS.Timeout | null = null
let extensionVersion = 'dev'

function log(line: string): void {
  const now = new Date().toISOString()
  output.appendLine(`[${now}] ${line}`)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath: string): Promise<JsonRecord | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content) as JsonRecord
  } catch {
    return null
  }
}

function getClaudeCredentialPaths(): string[] {
  const home = os.homedir()
  const paths: string[] = [
    path.join(home, '.claude', '.credentials.json'),
    path.join(home, '.claude', 'credentials.json'),
    path.join(home, '.config', 'claude-code', 'auth.json')
  ]

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    const localAppData = process.env.LOCALAPPDATA
    if (appData) {
      paths.push(path.join(appData, 'Code', 'User', 'globalStorage', 'anthropic.claude-code', 'credentials.json'))
    }
    if (localAppData) {
      paths.push(path.join(localAppData, 'claude-code', 'credentials.json'))
    }
  }

  if (process.platform === 'linux') {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME
    if (xdgConfigHome) {
      paths.push(path.join(xdgConfigHome, 'claude-code', 'auth.json'))
    }
  }

  if (process.platform === 'darwin') {
    paths.push(path.join(home, 'Library', 'Application Support', 'claude-code', 'credentials.json'))
  }

  return paths
}

function extractClaudeToken(credentials: ClaudeCredentials): string | null {
  const nested = credentials.claudeAiOauth?.accessToken
  if (typeof nested === 'string' && nested.trim().length > 0) return nested

  const flat = credentials.accessToken
  if (typeof flat === 'string' && flat.trim().length > 0) return flat

  return null
}

async function getClaudeToken(): Promise<string | null> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (envToken && envToken.trim().length > 0) {
    return envToken
  }

  for (const p of getClaudeCredentialPaths()) {
    if (!(await fileExists(p))) continue
    const data = await readJson(p)
    if (!data) continue
    const token = extractClaudeToken(data as unknown as ClaudeCredentials)
    if (token) return token
  }

  return null
}

function httpGet(url: string, headers: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({ statusCode: res.statusCode ?? 0, body })
        })
      }
    )

    req.on('error', (err) => reject(err))
    req.end()
  })
}

async function readClaudeUsage(): Promise<ProviderSnapshot> {
  const token = await getClaudeToken()
  if (!token) {
    return {
      label: 'Claude',
      usedPercent: null,
      resetIso: null,
      error: 'Claude token not found in local credentials'
    }
  }

  try {
    const response = await httpGet('https://api.anthropic.com/api/oauth/usage', {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': `meterai-vscode/${extensionVersion}`,
      'Content-Type': 'application/json'
    })

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        label: 'Claude',
        usedPercent: null,
        resetIso: null,
        error: `API ${response.statusCode}`
      }
    }

    const payload = JSON.parse(response.body) as ClaudeUsageResponse
    // If no active five-hour window yet, treat as 0% used and waiting state
    const used = typeof payload.five_hour?.utilization === 'number' ? payload.five_hour.utilization : 0
    const resetIso = typeof payload.five_hour?.resets_at === 'string' ? payload.five_hour.resets_at : null

    return {
      label: 'Claude',
      usedPercent: getEffectiveUsedPercent(used, resetIso),
      resetIso
    }
  } catch (error) {
    return {
      label: 'Claude',
      usedPercent: null,
      resetIso: null,
      error: `Request failed: ${String(error)}`
    }
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function parseResetFromEpoch(value: unknown): string | null {
  const epochSeconds = parseNumber(value)
  if (epochSeconds === null) return null
  return new Date(epochSeconds * 1000).toISOString()
}

async function findLatestCodexSessionFile(rootDir: string): Promise<string | null> {
  if (!(await fileExists(rootDir))) return null

  let latestFile: string | null = null
  let latestMtime = 0
  const stack: string[] = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (!currentDir) break

    let entries: Dirent[]
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (!entry.isFile() || path.extname(entry.name) !== '.jsonl') continue

      try {
        const stat = await fs.stat(fullPath)
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs
          latestFile = fullPath
        }
      } catch {
        continue
      }
    }
  }

  return latestFile
}

async function parseLatestCodexUsage(sessionFile: string): Promise<CodexUsageSnapshot | null> {
  let content: string
  try {
    content = await fs.readFile(sessionFile, 'utf8')
  } catch {
    return null
  }

  const lines = content.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue

    let parsed: JsonRecord
    try {
      parsed = JSON.parse(line) as JsonRecord
    } catch {
      continue
    }

    const payload = parsed.payload as JsonRecord | undefined
    if (!payload || payload.type !== 'token_count') continue

    const rateLimits = payload.rate_limits as JsonRecord | undefined
    const primary = rateLimits?.primary as JsonRecord | undefined
    if (!primary) continue

    const usedPercent = parseNumber(primary.used_percent)
    const resetIso = parseResetFromEpoch(primary.resets_at)

    return {
      usedPercent: getEffectiveUsedPercent(usedPercent, resetIso),
      resetIso
    }
  }

  // No token_count event yet: session not started -> full battery / waiting reset
  return {
    usedPercent: 0,
    resetIso: null
  }
}

async function readCodexUsage(): Promise<ProviderSnapshot> {
  const codexDir = getCodexBaseDir()
  const authPath = path.join(codexDir, 'auth.json')
  const sessionsDir = path.join(codexDir, 'sessions')

  const authJson = await readJson(authPath)
  const accessToken = authJson?.tokens && typeof authJson.tokens === 'object'
    ? (authJson.tokens as JsonRecord).access_token
    : null

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return {
      label: 'Codex',
      usedPercent: null,
      resetIso: null,
      error: 'Codex token not found in local credentials'
    }
  }

  const latestSession = await findLatestCodexSessionFile(sessionsDir)
  if (!latestSession) {
    // Token exists but no sessions yet -> waiting to start
    return {
      label: 'Codex',
      usedPercent: 0,
      resetIso: null,
    }
  }

  const snapshot = await parseLatestCodexUsage(latestSession)
  if (!snapshot) {
    return {
      label: 'Codex',
      usedPercent: null,
      resetIso: null,
      error: 'No token_count event found in latest session'
    }
  }

  return {
    label: 'Codex',
    usedPercent: snapshot.usedPercent,
    resetIso: snapshot.resetIso
  }
}

function getCodexBaseDir(): string {
  const codexHome = process.env.CODEX_HOME
  if (typeof codexHome === 'string' && codexHome.trim().length > 0) {
    return codexHome
  }
  return path.join(os.homedir(), '.codex')
}

function getEffectiveUsedPercent(usedPercent: number | null, resetIso: string | null): number | null {
  if (usedPercent === null) return null
  const rounded = Math.max(0, Math.min(100, Math.round(usedPercent)))
  if (!resetIso) return rounded
  const resetMs = new Date(resetIso).getTime()
  if (Number.isNaN(resetMs)) return rounded
  return Date.now() > resetMs ? 0 : rounded
}

function formatResetCountdown(resetIso: string | null): string {
  if (!resetIso) return 'waiting'
  const resetMs = new Date(resetIso).getTime()
  if (Number.isNaN(resetMs)) return 'waiting'
  const diff = resetMs - Date.now()
  if (diff <= 0) return 'waiting'
  const totalMinutes = Math.floor(diff / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

function buildBatteryBar(remainingPercent: number | null, segments = 20): string {
  if (remainingPercent === null) return `║${'░'.repeat(segments)}║`
  const safe = Math.max(0, Math.min(100, Math.round(remainingPercent)))
  const filled = Math.round((safe / 100) * segments)
  return `║${'█'.repeat(filled)}${'░'.repeat(segments - filled)}║`
}

function getItemColors(remainingPercent: number | null): { color?: vscode.ThemeColor; backgroundColor?: vscode.ThemeColor } {
  if (remainingPercent === null) {
    return {
      color: new vscode.ThemeColor('statusBarItem.warningForeground')
    }
  }

  if (remainingPercent <= 5) {
    return {
      color: new vscode.ThemeColor('statusBarItem.errorForeground'),
      backgroundColor: new vscode.ThemeColor('statusBarItem.errorBackground')
    }
  }

  if (remainingPercent <= 20) {
    return {
      color: new vscode.ThemeColor('statusBarItem.warningForeground'),
      backgroundColor: new vscode.ThemeColor('statusBarItem.warningBackground')
    }
  }

  return {}
}

function updateProviderItem(
  item: vscode.StatusBarItem,
  snapshot: ProviderSnapshot | null,
  cfg: ReturnType<typeof getConfig>
): void {
  if (!snapshot) {
    item.hide()
    return
  }

  const isAvailable = snapshot.usedPercent !== null
  const remainingPercent = isAvailable ? Math.max(0, 100 - (snapshot.usedPercent ?? 0)) : null
  const battery = buildBatteryBar(remainingPercent)
  const resetInline = (cfg.showResetCountdown && isAvailable) ? ` ${formatResetCountdown(snapshot.resetIso)}` : ''

  if (isAvailable) {
    item.text = `${snapshot.label} ${battery} ${remainingPercent}%${resetInline}`
  } else {
    item.text = `${snapshot.label} ${battery} --${resetInline}`
  }

  const tooltip = new vscode.MarkdownString(undefined, true)
  tooltip.isTrusted = true
  tooltip.appendMarkdown(`**${snapshot.label}**\n\n`)
  if (isAvailable) {
    tooltip.appendMarkdown(`- Used: ${snapshot.usedPercent}%\n`)
    tooltip.appendMarkdown(`- Remaining: ${remainingPercent}%\n`)
    tooltip.appendMarkdown(`- Reset: ${formatResetCountdown(snapshot.resetIso)}\n`)
  } else {
    tooltip.appendMarkdown(`- Status: unavailable\n`)
  }
  if (snapshot.error) {
    tooltip.appendMarkdown(`- Error: ${snapshot.error}\n`)
  }
  tooltip.appendMarkdown('\n[Refresh now](command:meterai.refreshUsage)')
  item.tooltip = tooltip

  const colors = getItemColors(remainingPercent)
  item.color = colors.color
  item.backgroundColor = colors.backgroundColor
  item.show()
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('meterai.statusBar')
  return {
    refreshIntervalSeconds: cfg.get<number>('refreshIntervalSeconds', 60),
    showClaude: cfg.get<boolean>('showClaude', true),
    showCodex: cfg.get<boolean>('showCodex', true),
    showResetCountdown: cfg.get<boolean>('showResetCountdown', true),
  }
}


async function refreshStatusBar(userTriggered = false): Promise<void> {
  const cfg = getConfig()
  brandStatusBarItem.text = '$(sync~spin) MeterAI'
  brandStatusBarItem.tooltip = 'Refreshing usage...'
  brandStatusBarItem.show()

  const [claude, codex] = await Promise.all([
    cfg.showClaude ? readClaudeUsage() : Promise.resolve<ProviderSnapshot | null>(null),
    cfg.showCodex ? readCodexUsage() : Promise.resolve<ProviderSnapshot | null>(null)
  ])

  const snapshots = [claude, codex].filter((s): s is ProviderSnapshot => s !== null)
  const successfulCount = snapshots.filter((s) => s.usedPercent !== null).length
  brandStatusBarItem.text = successfulCount > 0 ? '$(dashboard) MeterAI' : '$(warning) MeterAI'
  brandStatusBarItem.color = successfulCount > 0 ? undefined : new vscode.ThemeColor('statusBarItem.warningForeground')
  brandStatusBarItem.backgroundColor = undefined

  const tooltip = new vscode.MarkdownString(undefined, true)
  tooltip.isTrusted = true
  tooltip.appendMarkdown('**MeterAI Usage**\n\n')

  for (const snapshot of snapshots) {
    if (snapshot.usedPercent !== null) {
      const countdown = cfg.showResetCountdown ? ` · reset ${formatResetCountdown(snapshot.resetIso)}` : ''
      tooltip.appendMarkdown(`- **${snapshot.label}**: ${snapshot.usedPercent}%${countdown}\n`)
    } else {
      tooltip.appendMarkdown(`- **${snapshot.label}**: unavailable`)
      if (snapshot.error) {
        tooltip.appendMarkdown(` (${snapshot.error})`)
      }
      tooltip.appendMarkdown('\n')
    }
  }

  tooltip.appendMarkdown('\n[Refresh now](command:meterai.refreshUsage) · [Settings](command:meterai.openSettings)')
  brandStatusBarItem.tooltip = tooltip
  brandStatusBarItem.show()

  updateProviderItem(claudeStatusBarItem, claude, cfg)
  updateProviderItem(codexStatusBarItem, codex, cfg)

  if (userTriggered) {
    const failures = snapshots.filter((s) => s.error)
    if (failures.length > 0) {
      const details = failures.map((f) => `${f.label}: ${f.error}`).join(' | ')
      vscode.window.showWarningMessage(`MeterAI refresh completed with issues. ${details}`)
      log(`Refresh issues: ${details}`)
    } else {
      vscode.window.showInformationMessage('MeterAI usage refreshed.')
    }
  }
}

function restartTimer(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }

  const cfg = getConfig()
  const intervalMs = Math.max(30, cfg.refreshIntervalSeconds) * 1000
  refreshTimer = setInterval(() => {
    void refreshStatusBar(false)
  }, intervalMs)

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {
        clearInterval(refreshTimer)
        refreshTimer = null
      }
    }
  })
}

export function activate(context: vscode.ExtensionContext): void {
  const pkgVersion = context.extension.packageJSON?.version
  if (typeof pkgVersion === 'string' && pkgVersion.trim().length > 0) {
    extensionVersion = pkgVersion
  }

  output = vscode.window.createOutputChannel('MeterAI')
  context.subscriptions.push(output)

  brandStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  brandStatusBarItem.command = 'meterai.refreshUsage'
  context.subscriptions.push(brandStatusBarItem)

  claudeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99)
  claudeStatusBarItem.command = 'meterai.refreshUsage'
  context.subscriptions.push(claudeStatusBarItem)

  codexStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98)
  codexStatusBarItem.command = 'meterai.refreshUsage'
  context.subscriptions.push(codexStatusBarItem)

  context.subscriptions.push(
    vscode.commands.registerCommand('meterai.refreshUsage', async () => {
      await refreshStatusBar(true)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('meterai.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'meterai.statusBar')
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('meterai.statusBar')) {
        restartTimer(context)
        void refreshStatusBar(false)
      }
    })
  )

  restartTimer(context)
  void refreshStatusBar(false)
  log('MeterAI VS Code extension activated')
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}
