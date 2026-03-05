import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { promises as fs, type Dirent } from 'fs'

type JsonRecord = Record<string, unknown>

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
    subscriptionType?: string
  }
  accessToken?: string
}

interface ClaudeUsageWindow {
  utilization?: number
  resets_at?: string
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow
  seven_day?: ClaudeUsageWindow
}

interface CodexUsageSnapshot {
  usedPercent: number | null
  resetIso: string | null
  plan: string | null
}

interface CodexLimitCandidate {
  limitId: string | null
  usedPercent: number | null
  resetIso: string | null
  plan: string | null
}

interface ProviderSnapshot {
  label: string
  usedPercent: number | null
  resetIso: string | null
  plan?: string | null
  email?: string | null
  error?: string
}

interface ClaudeCredentialInfo {
  token: string
  subscriptionType: string | null
  email: string | null
}

let brandStatusBarItem: vscode.StatusBarItem
let claudeStatusBarItem: vscode.StatusBarItem
let codexStatusBarItem: vscode.StatusBarItem
let output: vscode.OutputChannel
let refreshTimer: NodeJS.Timeout | null = null
let extensionVersion = 'dev'

// Cache last known good snapshots so API errors don't reset the display to 0%
let lastClaudeSnapshot: ProviderSnapshot | null = null
let lastCodexSnapshot: ProviderSnapshot | null = null

// Rate-limit backoff: timestamp (ms) until which we should not call the Claude usage API
let claudeUsageBackoffUntil = 0

// ── Shared disk cache ────────────────────────────────────────────────
// Both the Tauri app and this extension write/read the same file so that
// only ONE client actually hits the API per polling window.
const SHARED_CACHE_MAX_AGE_MS = 90_000 // 90 seconds
const SHARED_CACHE_PATH = path.join(os.homedir(), '.claude', 'meterai-usage-cache.json')

interface SharedUsageCache {
  fetched_at: number
  five_hour?: { utilization?: number; resets_at?: string }
  seven_day?: { utilization?: number; resets_at?: string }
}

async function readSharedCache(): Promise<SharedUsageCache | null> {
  try {
    const raw = await fs.readFile(SHARED_CACHE_PATH, 'utf8')
    return JSON.parse(raw) as SharedUsageCache
  } catch {
    return null
  }
}

async function writeSharedCache(payload: ClaudeUsageResponse): Promise<void> {
  const cache: SharedUsageCache = {
    fetched_at: Date.now(),
    five_hour: payload.five_hour,
    seven_day: payload.seven_day
  }
  try {
    await fs.writeFile(SHARED_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
  } catch { /* best effort */ }
}
// ─────────────────────────────────────────────────────────────────────

function log(line: string): void {
  const now = new Date().toISOString()
  output.appendLine(`[${now}] ${line}`)
}

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1')
}

function toTitleWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function formatClaudePlanName(subscriptionType: string | null): string | null {
  const normalized = parseString(subscriptionType)?.toLowerCase() ?? null
  if (!normalized) return null
  if (normalized === 'pro' || normalized === 'max') {
    return `Claude ${normalized.charAt(0).toUpperCase() + normalized.slice(1)}`
  }
  return `Claude ${toTitleWords(normalized)}`
}

function formatCodexPlanName(planType: string | null, limitName: string | null): string | null {
  const normalizedPlanType = parseString(planType)
  if (normalizedPlanType) {
    return `Codex ${toTitleWords(normalizedPlanType)}`
  }

  const normalizedLimitName = parseString(limitName)
  if (!normalizedLimitName) return null

  const lowered = normalizedLimitName.toLowerCase()
  if (lowered.includes('codex-spark')) return 'Codex Spark'

  const codexIdx = lowered.indexOf('codex')
  if (codexIdx >= 0) {
    const suffix = normalizedLimitName
      .slice(codexIdx + 'codex'.length)
      .replace(/^[-_\s]+/, '')
    return suffix.length > 0 ? `Codex ${toTitleWords(suffix)}` : 'OpenAI Codex'
  }

  return `Codex ${toTitleWords(normalizedLimitName)}`
}

function base64UrlDecode(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function parseJwtPayload(token: string | null): JsonRecord | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  const payloadRaw = base64UrlDecode(parts[1])
  if (!payloadRaw) return null
  try {
    const parsed = JSON.parse(payloadRaw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as JsonRecord
  } catch {
    return null
  }
}

function extractEmailFromJwt(token: string | null): string | null {
  const payload = parseJwtPayload(token)
  if (!payload) return null
  return parseString(payload.email)
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

function extractClaudeCredentialInfo(credentials: ClaudeCredentials): ClaudeCredentialInfo | null {
  const token = extractClaudeToken(credentials)
  if (!token) return null
  const subscriptionType = parseString(credentials.claudeAiOauth?.subscriptionType)
  const email = extractEmailFromJwt(token)
  return { token, subscriptionType, email }
}

async function getClaudeCredentialInfo(): Promise<ClaudeCredentialInfo | null> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (envToken && envToken.trim().length > 0) {
    const token = envToken.trim()
    return {
      token,
      subscriptionType: null,
      email: extractEmailFromJwt(token)
    }
  }

  for (const p of getClaudeCredentialPaths()) {
    if (!(await fileExists(p))) continue
    const data = await readJson(p)
    if (!data) continue
    const info = extractClaudeCredentialInfo(data as unknown as ClaudeCredentials)
    if (info) return info
  }

  return null
}

function httpGet(url: string, headers: Record<string, string>): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
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
          resolve({ statusCode: res.statusCode ?? 0, body, headers: res.headers })
        })
      }
    )

    req.on('error', (err) => reject(err))
    req.end()
  })
}

async function readClaudeUsage(): Promise<ProviderSnapshot> {
  const credentialInfo = await getClaudeCredentialInfo()
  if (!credentialInfo) {
    return {
      label: 'Claude',
      usedPercent: null,
      resetIso: null,
      error: 'Claude token not found in local credentials'
    }
  }

  // 1. Check shared disk cache — if another client fetched recently, reuse it
  const cached = await readSharedCache()
  if (cached && (Date.now() - cached.fetched_at) < SHARED_CACHE_MAX_AGE_MS) {
    log('Claude usage: using shared cache (fresh)')
    const used = typeof cached.five_hour?.utilization === 'number' ? cached.five_hour.utilization : 0
    const resetIso = typeof cached.five_hour?.resets_at === 'string' ? cached.five_hour.resets_at : null
    return {
      label: 'Claude',
      usedPercent: getEffectiveUsedPercent(used, resetIso),
      resetIso,
      plan: formatClaudePlanName(credentialInfo.subscriptionType),
      email: credentialInfo.email
    }
  }

  // 2. Skip API call if we are in a rate-limit backoff window
  if (Date.now() < claudeUsageBackoffUntil) {
    log('Claude usage: skipping fetch (rate-limit backoff active)')
    return {
      label: 'Claude',
      usedPercent: null,
      resetIso: null,
      plan: formatClaudePlanName(credentialInfo.subscriptionType),
      email: credentialInfo.email,
      error: 'Rate limited (backoff active, will retry later)'
    }
  }

  // 3. Actually call the API
  try {
    const response = await httpGet('https://api.anthropic.com/api/oauth/usage', {
      Authorization: `Bearer ${credentialInfo.token}`,
      'User-Agent': `meterai-vscode/${extensionVersion}`,
      'Content-Type': 'application/json'
    })

    // Handle 429 rate limit: respect Retry-After header and back off
    if (response.statusCode === 429) {
      const retryAfterRaw = response.headers['retry-after']
      const retryAfter = typeof retryAfterRaw === 'string' ? parseInt(retryAfterRaw, 10) : 0
      // Minimum 5min backoff even if Retry-After is 0 (API may return 0 when soft-blocked)
      const backoffSecs = Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 300)
      claudeUsageBackoffUntil = Date.now() + (backoffSecs + 2) * 1000
      log(`Claude usage: rate limited, backing off for ${backoffSecs}s`)
      return {
        label: 'Claude',
        usedPercent: null,
        resetIso: null,
        plan: formatClaudePlanName(credentialInfo.subscriptionType),
        email: credentialInfo.email,
        error: `Rate limited (retry after ${backoffSecs}s)`
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        label: 'Claude',
        usedPercent: null,
        resetIso: null,
        error: `API ${response.statusCode}`
      }
    }

    // Success — clear backoff and write shared cache
    claudeUsageBackoffUntil = 0

    const payload = JSON.parse(response.body) as ClaudeUsageResponse
    await writeSharedCache(payload)

    const used = typeof payload.five_hour?.utilization === 'number' ? payload.five_hour.utilization : 0
    const resetIso = typeof payload.five_hour?.resets_at === 'string' ? payload.five_hour.resets_at : null

    return {
      label: 'Claude',
      usedPercent: getEffectiveUsedPercent(used, resetIso),
      resetIso,
      plan: formatClaudePlanName(credentialInfo.subscriptionType),
      email: credentialInfo.email
    }
  } catch (error) {
    return {
      label: 'Claude',
      usedPercent: null,
      resetIso: null,
      plan: formatClaudePlanName(credentialInfo.subscriptionType),
      email: credentialInfo.email,
      error: `Request failed: ${String(error)}`
    }
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object') return null
  return value as JsonRecord
}

function parseResetFromEpoch(epoch: number): string | null {
  if (!Number.isFinite(epoch)) return null
  const epochMs = Math.abs(epoch) >= 1e12 ? epoch : epoch * 1000
  const resetMs = new Date(epochMs).getTime()
  if (Number.isNaN(resetMs)) return null
  return new Date(resetMs).toISOString()
}

function parseResetValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const numeric = parseNumber(trimmed)
    if (numeric !== null) return parseResetFromEpoch(numeric)
    const isoMs = new Date(trimmed).getTime()
    if (Number.isNaN(isoMs)) return null
    return new Date(isoMs).toISOString()
  }

  const numeric = parseNumber(value)
  if (numeric === null) return null
  return parseResetFromEpoch(numeric)
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
  let latestAny: CodexLimitCandidate | null = null
  let latestNonZero: CodexLimitCandidate | null = null
  let latestCodex: CodexLimitCandidate | null = null

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue

    let parsed: JsonRecord
    try {
      parsed = JSON.parse(line) as JsonRecord
    } catch {
      continue
    }

    const payload = asRecord(parsed.payload)
    if (!payload || payload.type !== 'token_count') continue

    const rateLimits = asRecord(payload.rate_limits) ?? asRecord(payload.rateLimits)
    const primary = rateLimits
      ? (asRecord(rateLimits.primary) ?? asRecord(asRecord(rateLimits.windows)?.primary))
      : null
    if (!primary) continue

    const usedPercent = parseNumber(primary.used_percent ?? primary.usedPercent)
    const resetIso = parseResetValue(primary.resets_at ?? primary.resetsAt)
    const rawLimitId = rateLimits?.limit_id ?? rateLimits?.limitId
    const limitId = typeof rawLimitId === 'string' && rawLimitId.trim().length > 0
      ? rawLimitId.trim().toLowerCase()
      : null
    const planType = parseString(rateLimits?.plan_type ?? rateLimits?.planType)
    const limitName = parseString(rateLimits?.limit_name ?? rateLimits?.limitName)
    const plan = formatCodexPlanName(planType, limitName)

    const candidate: CodexLimitCandidate = {
      limitId,
      usedPercent,
      resetIso,
      plan
    }

    if (!latestAny) latestAny = candidate
    if (!latestNonZero && usedPercent !== null && usedPercent > 0) latestNonZero = candidate
    if (!latestCodex && limitId === 'codex') latestCodex = candidate

    if (latestCodex) break
  }

  const selected = latestCodex ?? latestNonZero ?? latestAny
  if (selected) {
    return {
      usedPercent: getEffectiveUsedPercent(selected.usedPercent ?? 0, selected.resetIso),
      resetIso: selected.resetIso,
      plan: selected.plan
    }
  }

  // No token_count event yet: session not started -> full battery / waiting reset
  return {
    usedPercent: 0,
    resetIso: null,
    plan: null
  }
}

async function readCodexUsage(): Promise<ProviderSnapshot> {
  const codexDir = getCodexBaseDir()
  const authPath = path.join(codexDir, 'auth.json')
  const sessionsDir = path.join(codexDir, 'sessions')

  const authJson = await readJson(authPath)
  const authTokens = authJson?.tokens && typeof authJson.tokens === 'object'
    ? authJson.tokens as JsonRecord
    : null
  const accessToken = parseString(authTokens?.access_token)
  const idToken = parseString(authTokens?.id_token)
  const email = extractEmailFromJwt(idToken) ?? extractEmailFromJwt(accessToken)

  if (!accessToken) {
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
      email,
      plan: null
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
    resetIso: snapshot.resetIso,
    email,
    plan: snapshot.plan
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
  const displayChars = Math.ceil(segments / 2)
  if (remainingPercent === null) return `[${'░'.repeat(displayChars)}]`
  const safe = Math.max(0, Math.min(100, Math.round(remainingPercent)))
  const filled = Math.round((safe / 100) * segments)
  let bar = ''
  for (let i = 0; i < segments; i += 2) {
    const left = i < filled
    const right = (i + 1) < filled
    if (left && right) bar += '█'
    else if (left) bar += '▒'
    else bar += '░'
  }
  return `[${bar}]`
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
  if (snapshot.plan) {
    tooltip.appendMarkdown(`- Plan: ${escapeMarkdown(snapshot.plan)}\n`)
  }
  if (snapshot.email) {
    tooltip.appendMarkdown(`- Account: ${escapeMarkdown(snapshot.email)}\n`)
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

/**
 * When fresh data has a valid usedPercent, update the cache and return fresh data.
 * When fresh data has an error (usedPercent === null) but we have cached good data,
 * return the cached data with the error attached so the display stays stable.
 */
function resolveWithCache(
  fresh: ProviderSnapshot | null,
  cached: ProviderSnapshot | null
): { resolved: ProviderSnapshot | null; cache: ProviderSnapshot | null } {
  if (!fresh) return { resolved: null, cache: cached }

  // Fresh data is valid → update cache
  if (fresh.usedPercent !== null) {
    return { resolved: fresh, cache: fresh }
  }

  // Fresh data has an error → fall back to cache if available
  if (cached && cached.usedPercent !== null) {
    const stale: ProviderSnapshot = {
      ...cached,
      error: fresh.error ? `${fresh.error} · showing last known value` : 'showing last known value'
    }
    log(`${fresh.label}: API error, using cached value (${cached.usedPercent}% used)`)
    return { resolved: stale, cache: cached }
  }

  // No cache either → pass through the error as-is
  return { resolved: fresh, cache: cached }
}


async function refreshStatusBar(userTriggered = false): Promise<void> {
  const cfg = getConfig()
  brandStatusBarItem.text = '$(sync~spin) MeterAI'
  brandStatusBarItem.tooltip = 'Refreshing usage...'
  brandStatusBarItem.show()

  const [claudeRaw, codexRaw] = await Promise.all([
    cfg.showClaude ? readClaudeUsage() : Promise.resolve<ProviderSnapshot | null>(null),
    cfg.showCodex ? readCodexUsage() : Promise.resolve<ProviderSnapshot | null>(null)
  ])

  // Resolve against cache: on API error, keep last known values instead of showing 0%
  const claudeResolved = resolveWithCache(claudeRaw, lastClaudeSnapshot)
  const codexResolved = resolveWithCache(codexRaw, lastCodexSnapshot)
  lastClaudeSnapshot = claudeResolved.cache
  lastCodexSnapshot = codexResolved.cache
  const claude = claudeResolved.resolved
  const codex = codexResolved.resolved

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
      if (snapshot.plan) {
        tooltip.appendMarkdown(`  Plan: ${escapeMarkdown(snapshot.plan)}\n`)
      }
      if (snapshot.email) {
        tooltip.appendMarkdown(`  Account: ${escapeMarkdown(snapshot.email)}\n`)
      }
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
