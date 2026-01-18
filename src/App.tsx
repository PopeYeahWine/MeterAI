import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { appWindow, LogicalSize } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/api/process'
import { shell } from '@tauri-apps/api'
import { fetch } from '@tauri-apps/api/http'
import { AI_PROVIDERS, CATEGORY_INFO, type ProviderCategory, type ProviderDefinition } from './providers'

// Crypto logos
import btcLogo from './assets/crypto/btc.png'
import ethLogo from './assets/crypto/eth.png'
import solLogo from './assets/crypto/sol.png'
import usdcLogo from './assets/crypto/usdc.png'
import usdtLogo from './assets/crypto/usdt.png'
import usd1Logo from './assets/crypto/usd1.svg'

// Version injected at build time from package.json via vite.config.ts
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__
const GITHUB_REPO = 'PopeYeahWine/MeterAI'
const GITHUB_USERNAME = 'PopeYeahWine'

type ProviderType = 'manual' | 'anthropic' | 'openai' | string

// SVG Category Icon component
const CategoryIcon = ({ iconPath, color, size = 16 }: { iconPath: string; color: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={iconPath} />
  </svg>
)

interface UsageData {
  used: number
  limit: number
  percent: number
  resetTime: number
  history: HistoryEntry[]
  providerType: ProviderType
  providerName: string
}

interface HistoryEntry {
  time: string
  used: number
  limit: number
}

interface ProviderConfig {
  provider_type: ProviderType
  name: string
  enabled: boolean
  has_api_key: boolean
  limit: number
  alertThresholds: number[]
  resetIntervalHours: number
  used?: number
  percent?: number
}

interface AllProvidersUsage {
  [key: string]: {
    used: number
    limit: number
    percent: number
  }
}

interface ClaudeCodeUsageResult {
  success: boolean
  error: string | null
  five_hour_percent: number | null
  five_hour_reset: string | null
  seven_day_percent: number | null
  seven_day_reset: string | null
}

type ViewMode = 'compact' | 'expanded' | 'settings'

// Custom Stepper Component for threshold inputs
const ThresholdStepper = ({
  value,
  onChange,
  min = 0,
  max = 100,
  disabled = false
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  disabled?: boolean
}) => {
  const handleDecrement = () => {
    if (value > min) onChange(value - 1)
  }
  const handleIncrement = () => {
    if (value < max) onChange(value + 1)
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value) || 0
    onChange(Math.max(min, Math.min(max, newValue)))
  }

  return (
    <div className="threshold-stepper">
      <button
        type="button"
        className="stepper-btn decrement"
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        aria-label="Decrease"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <input
        type="text"
        className="stepper-input"
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        inputMode="numeric"
        pattern="[0-9]*"
      />
      <button
        type="button"
        className="stepper-btn increment"
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        aria-label="Increase"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </div>
  )
}

// Provider Settings Panel - Extracted as separate component to prevent remount
interface ProviderSettingsPanelProps {
  providerId: string | null
  onClose: () => void
  providerThresholds: Record<string, { green: number; yellow: number; orange: number; red: number }>
  setProviderThresholds: React.Dispatch<React.SetStateAction<Record<string, { green: number; yellow: number; orange: number; red: number }>>>
  providerTimeThresholds: Record<string, { red: number; orange: number; yellow: number; blue: number }>
  setProviderTimeThresholds: React.Dispatch<React.SetStateAction<Record<string, { red: number; orange: number; yellow: number; blue: number }>>>
  configStatus: { detected: boolean; source: string; customPath: string | null }
  setConfigStatus: React.Dispatch<React.SetStateAction<{ detected: boolean; source: string; customPath: string | null }>>
  setHasClaudeCodeToken: React.Dispatch<React.SetStateAction<boolean>>
  setEnabledProviders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  refreshClaudeCodeUsage: () => Promise<void>
}

const ProviderSettingsPanel = ({
  providerId,
  onClose,
  providerThresholds,
  setProviderThresholds,
  providerTimeThresholds,
  setProviderTimeThresholds,
  configStatus,
  setConfigStatus,
  setHasClaudeCodeToken,
  setEnabledProviders,
  refreshClaudeCodeUsage
}: ProviderSettingsPanelProps) => {
  // Local accordion states - stable because component is not recreated
  const [usageThresholdsOpen, setUsageThresholdsOpen] = useState(false)
  const [timeThresholdsOpen, setTimeThresholdsOpen] = useState(false)

  if (!providerId) return null

  const providerDef = AI_PROVIDERS.find(p => p.id === providerId)
  if (!providerDef) return null

  const thresholds = providerThresholds[providerId] || { green: 70, yellow: 85, orange: 95, red: 100 }
  const timeThresholds = providerTimeThresholds[providerId] || { red: 20, orange: 40, yellow: 70, blue: 100 }

  const updateThreshold = (key: 'green' | 'yellow' | 'orange' | 'red', value: number) => {
    setProviderThresholds(prev => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || { green: 70, yellow: 85, orange: 95, red: 100 }),
        [key]: Math.max(0, Math.min(100, value))
      }
    }))
  }

  const updateTimeThreshold = (key: 'red' | 'orange' | 'yellow' | 'blue', value: number) => {
    setProviderTimeThresholds(prev => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || { red: 20, orange: 40, yellow: 70, blue: 100 }),
        [key]: Math.max(0, Math.min(100, value))
      }
    }))
  }

  const handleRedetect = async () => {
    try {
      const hasToken = await invoke<boolean>('has_claude_code_token')
      setHasClaudeCodeToken(hasToken)
      if (hasToken) {
        await refreshClaudeCodeUsage()
      }
      const status = await invoke<{ detected: boolean; source: string; customPath: string | null }>('get_config_detection_status')
      setConfigStatus(status)
    } catch (e) {
      console.error('Failed to re-detect credentials:', e)
    }
  }

  const handleBrowseCredentials = async () => {
    try {
      const path = await invoke<string | null>('browse_credentials_file')
      if (path) {
        await invoke('set_custom_credentials_path', { path })
        const status = await invoke<{ detected: boolean; source: string; customPath: string | null }>('get_config_detection_status')
        setConfigStatus(status)
        await handleRedetect()
      }
    } catch (e) {
      console.error('Failed to browse credentials:', e)
    }
  }

  const handleResetConfig = async () => {
    // Reset thresholds to defaults
    setProviderThresholds(prev => ({
      ...prev,
      [providerId]: { green: 70, yellow: 85, orange: 95, red: 100 }
    }))
    setProviderTimeThresholds(prev => ({
      ...prev,
      [providerId]: { red: 20, orange: 40, yellow: 70, blue: 100 }
    }))

    // Clear custom credentials path and reset detection state
    try {
      await invoke('set_custom_credentials_path', { path: null })

      // Clear the "dismissed" flag so detection popup can show again on next startup
      localStorage.removeItem('claudeDetectedDismissed')

      // Disable this provider in UI state (will also persist via useEffect)
      setEnabledProviders(prev => ({ ...prev, [providerId]: false }))

      // Reset token state to false (full reset)
      setHasClaudeCodeToken(false)

      // Update config status to reflect no credential
      setConfigStatus({ detected: false, source: 'none', customPath: null })
    } catch (e) {
      console.error('Failed to reset config:', e)
    }
  }

  // Format path with middle ellipsis, keeping end visible (filename)
  const formatPath = (path: string, maxLen: number = 45) => {
    if (path.length <= maxLen) return path
    // Keep more of the end to show filename
    const endLen = Math.min(25, Math.floor(maxLen * 0.55))
    const startLen = maxLen - endLen - 3
    return `${path.slice(0, startLen)}...${path.slice(-endLen)}`
  }

  // Extract path from configStatus.source (format: "auto:path" or "custom:path" or "env:...")
  const getDetectedPath = (): string | null => {
    if (!configStatus.source || configStatus.source === 'none') return null
    if (configStatus.source.startsWith('env:')) return configStatus.source // Show env var name
    const colonIndex = configStatus.source.indexOf(':')
    if (colonIndex > 0) {
      return configStatus.source.slice(colonIndex + 1)
    }
    return null
  }

  const detectedPath = getDetectedPath()

  return (
    <div className="provider-settings-overlay" onClick={onClose}>
      <div className="provider-settings-panel" onClick={e => e.stopPropagation()}>
        {/* Header - Brand + Plan on same line */}
        <div className="provider-settings-header">
          <span className="provider-settings-icon" style={{ background: providerDef.color }}>
            {providerDef.icon}
          </span>
          <div className="provider-settings-title-inline">
            <span className="provider-settings-brand">{providerDef.brand}</span>
            <span className="provider-settings-plan">{providerDef.name}</span>
          </div>
          <button className="provider-settings-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Configuration Section */}
        <div className="provider-settings-section">
          <h4 className="provider-settings-section-title">Configuration</h4>
          <div className="config-detection-box">
            <div className="config-detection-status">
              <span className={`config-detection-dot ${configStatus.detected ? 'detected' : 'not-detected'}`}></span>
              <span className="config-detection-text">
                {configStatus.detected ? (
                  <>Credentials <strong>detected</strong></>
                ) : (
                  <>Credentials <strong>not found</strong></>
                )}
              </span>
            </div>
            {detectedPath && (
              <div className="config-detection-path" title={detectedPath}>
                {formatPath(detectedPath)}
              </div>
            )}
          </div>
        </div>

        {/* Usage Color Thresholds - Accordion */}
        <div className="provider-settings-accordion">
          <div
            className={`accordion-header ${usageThresholdsOpen ? 'open' : ''}`}
            onClick={() => setUsageThresholdsOpen(!usageThresholdsOpen)}
          >
            <svg
              className={`accordion-chevron ${usageThresholdsOpen ? 'open' : ''}`}
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="9,18 15,12 9,6"></polyline>
            </svg>
            <span className="accordion-title">Usage Thresholds</span>
            {!usageThresholdsOpen && (
              <div className="accordion-mini-preview">
                <div
                  className="threshold-preview-bar mini"
                  style={{
                    '--green-end': `${thresholds.green}%`,
                    '--yellow-end': `${thresholds.yellow}%`,
                    '--orange-end': `${thresholds.orange}%`
                  } as React.CSSProperties}
                ></div>
              </div>
            )}
          </div>
          {usageThresholdsOpen && (
            <div className="accordion-content">
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot green"></span>
                  Green (OK)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">0 -</span>
                  <ThresholdStepper value={thresholds.green} onChange={v => updateThreshold('green', v)} />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot yellow"></span>
                  Yellow (Caution)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">{thresholds.green} -</span>
                  <ThresholdStepper value={thresholds.yellow} onChange={v => updateThreshold('yellow', v)} />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot orange"></span>
                  Orange (Warning)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">{thresholds.yellow} -</span>
                  <ThresholdStepper value={thresholds.orange} onChange={v => updateThreshold('orange', v)} />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot red"></span>
                  Red (Critical)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">{thresholds.orange} - 100%</span>
                </div>
              </div>
              <div className="threshold-preview">
                <div className="threshold-preview-label">Preview</div>
                <div
                  className="threshold-preview-bar"
                  style={{
                    '--green-end': `${thresholds.green}%`,
                    '--yellow-end': `${thresholds.yellow}%`,
                    '--orange-end': `${thresholds.orange}%`
                  } as React.CSSProperties}
                ></div>
                <div className="threshold-preview-markers">
                  <span>0%</span>
                  <span>{thresholds.green}%</span>
                  <span>{thresholds.yellow}%</span>
                  <span>{thresholds.orange}%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Time Lapse Color Thresholds - Accordion */}
        <div className="provider-settings-accordion">
          <div
            className={`accordion-header ${timeThresholdsOpen ? 'open' : ''}`}
            onClick={() => setTimeThresholdsOpen(!timeThresholdsOpen)}
          >
            <svg
              className={`accordion-chevron ${timeThresholdsOpen ? 'open' : ''}`}
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="9,18 15,12 9,6"></polyline>
            </svg>
            <span className="accordion-title">Time Lapse Thresholds</span>
            {!timeThresholdsOpen && (
              <div className="accordion-mini-preview">
                <div
                  className="threshold-preview-bar-time mini"
                  style={{
                    '--red-end': `${timeThresholds.red}%`,
                    '--orange-end': `${timeThresholds.orange}%`,
                    '--yellow-end': `${timeThresholds.yellow}%`
                  } as React.CSSProperties}
                ></div>
              </div>
            )}
          </div>
          {timeThresholdsOpen && (
            <div className="accordion-content">
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot time-red"></span>
                  Red (Just started)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">0 -</span>
                  <ThresholdStepper value={timeThresholds.red} onChange={v => updateTimeThreshold('red', v)} />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot time-orange"></span>
                  Orange (Early)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">{timeThresholds.red} -</span>
                  <ThresholdStepper value={timeThresholds.orange} onChange={v => updateTimeThreshold('orange', v)} />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot time-yellow"></span>
                  Yellow (Midway)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">{timeThresholds.orange} -</span>
                  <ThresholdStepper value={timeThresholds.yellow} onChange={v => updateTimeThreshold('yellow', v)} />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
              <div className="threshold-row">
                <span className="threshold-label">
                  <span className="threshold-color-dot time-blue"></span>
                  Blue (Near reset)
                </span>
                <div className="threshold-input-group">
                  <span className="threshold-range-label">{timeThresholds.yellow} - 100%</span>
                </div>
              </div>
              <div className="threshold-preview">
                <div className="threshold-preview-label">Preview</div>
                <div
                  className="threshold-preview-bar-time"
                  style={{
                    '--red-end': `${timeThresholds.red}%`,
                    '--orange-end': `${timeThresholds.orange}%`,
                    '--yellow-end': `${timeThresholds.yellow}%`
                  } as React.CSSProperties}
                ></div>
                <div className="threshold-preview-markers">
                  <span>0%</span>
                  <span>{timeThresholds.red}%</span>
                  <span>{timeThresholds.orange}%</span>
                  <span>{timeThresholds.yellow}%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="provider-settings-actions">
          <div className="provider-settings-actions-row">
            <button className="provider-settings-btn-action primary" onClick={handleRedetect}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6"></path>
                <path d="M1 20v-6h6"></path>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              Re-detect
            </button>
            <button className="provider-settings-btn-action secondary" onClick={handleBrowseCredentials}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Browse...
            </button>
          </div>
          <button className="provider-settings-btn-action danger" onClick={handleResetConfig}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18"></path>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Reset config
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [usage, setUsage] = useState<UsageData>({
    used: 0,
    limit: 100,
    percent: 0,
    resetTime: Date.now() / 1000 + 4 * 3600,
    history: [],
    providerType: 'manual',
    providerName: 'Manual'
  })
  const [providersUsage, setProvidersUsage] = useState<AllProvidersUsage>({})
  const [countdown, setCountdown] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('compact')
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [activeProvider, setActiveProvider] = useState('manual')
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null)
  const [claudeCodeUsage, setClaudeCodeUsage] = useState<ClaudeCodeUsageResult | null>(null)
  const [hasClaudeCodeToken, setHasClaudeCodeToken] = useState(false)
  const [showClaudeDetectedPopup, setShowClaudeDetectedPopup] = useState(false)
  const [claudeDetectedDismissed, setClaudeDetectedDismissed] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<ProviderCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsing, setIsCollapsing] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [lastUpdateCheck, setLastUpdateCheck] = useState<number>(0)
  // Settings states
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [configStatus, setConfigStatus] = useState<{
    detected: boolean;
    source: string;
    customPath: string | null;
  }>({ detected: false, source: 'none', customPath: null })
  // Provider settings panel
  const [providerSettingsOpen, setProviderSettingsOpen] = useState<string | null>(null)
  const [providerThresholds, setProviderThresholds] = useState<Record<string, { green: number; yellow: number; orange: number; red: number }>>({
    'claude-pro-max': { green: 70, yellow: 85, orange: 95, red: 100 }
  })
  const [providerTimeThresholds, setProviderTimeThresholds] = useState<Record<string, { red: number; orange: number; yellow: number; blue: number }>>({
    'claude-pro-max': { red: 20, orange: 40, yellow: 70, blue: 100 }
  })
  // Note: accordion states moved inside ProviderSettingsPanel to prevent flicker
  const [detectedCredentialPaths, setDetectedCredentialPaths] = useState<string[]>([])
  // Collapsed state for categories - coding is open by default
  const [collapsedCategories, setCollapsedCategories] = useState<Record<ProviderCategory, boolean>>({
    coding: false, // Open by default
    chat: true,
    image: true,
    video: true,
    audio: true,
    multimodal: true
  })

  // Track enabled state for all AI providers (from providers.ts)
  const [enabledProviders, setEnabledProviders] = useState<Record<string, boolean>>(() => {
    // Try to load from localStorage first
    const stored = localStorage.getItem('enabledProviders')
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch (e) {
        // Invalid JSON, use defaults
      }
    }
    // Default: all providers disabled, user must enable via detection popup or manually
    const initial: Record<string, boolean> = {}
    AI_PROVIDERS.forEach(p => {
      initial[p.id] = false
    })
    return initial
  })

  // Provider config form state
  const [configForm, setConfigForm] = useState({
    apiKey: '',
    limit: 100,
    alertThresholds: '70, 90, 100',
    resetIntervalHours: 4,
    enabled: true
  })

  // Persist enabledProviders to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('enabledProviders', JSON.stringify(enabledProviders))
  }, [enabledProviders])

  // Load data on startup
  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await invoke<UsageData>('get_usage')
        setUsage(data)
        const providersList = await invoke<ProviderConfig[]>('get_all_providers')
        setProviders(providersList)
        const active = await invoke<string>('get_active_provider')
        setActiveProvider(active)

        // Check if Claude Code token is available
        try {
          const hasToken = await invoke<boolean>('has_claude_code_token')
          setHasClaudeCodeToken(hasToken)

          // If token available, fetch Claude Code usage
          if (hasToken) {
            const ccUsage = await invoke<ClaudeCodeUsageResult>('get_claude_code_usage')
            setClaudeCodeUsage(ccUsage)

            // Update Claude provider with real data if successful
            if (ccUsage.success && ccUsage.five_hour_percent !== null) {
              setProvidersUsage(prev => ({
                ...prev,
                'claude-pro-max': {
                  used: Math.round(ccUsage.five_hour_percent || 0),
                  limit: 100,
                  percent: Math.round(ccUsage.five_hour_percent || 0)
                }
              }))

              // Show popup only if Claude is not already enabled AND not dismissed before
              const storedDismissed = localStorage.getItem('claudeDetectedDismissed')
              const claudeAlreadyEnabled = enabledProviders['claude-pro-max']
              if (!storedDismissed && !claudeAlreadyEnabled) {
                setShowClaudeDetectedPopup(true)
              }
            }
          }
        } catch (e) {
          console.log('Claude Code integration not available:', e)
        }

        // Load autostart and config status
        try {
          const autostart = await invoke<boolean>('get_autostart_enabled')
          setAutostartEnabled(autostart)
        } catch (e) {
          console.log('Autostart not available:', e)
        }

        try {
          const status = await invoke<{ detected: boolean; source: string; customPath: string | null }>('get_config_detection_status')
          setConfigStatus(status)
        } catch (e) {
          console.log('Config status not available:', e)
        }

        // Load usage for all providers
        const allUsage: AllProvidersUsage = {}
        for (const provider of providersList) {
          try {
            await invoke('set_active_provider', { providerId: provider.provider_type })
            const providerData = await invoke<UsageData>('get_usage')
            allUsage[provider.provider_type] = {
              used: providerData.used,
              limit: providerData.limit,
              percent: providerData.percent
            }
          } catch (e) {
            allUsage[provider.provider_type] = { used: 0, limit: 100, percent: 0 }
          }
        }
        // Restore active provider
        await invoke('set_active_provider', { providerId: active })
        setProvidersUsage(prev => ({ ...prev, ...allUsage }))
      } catch (e) {
        console.log('Backend not ready, using defaults')
      }
    }
    loadData()

    const unlisten = listen<UsageData>('usage-updated', (event) => {
      setUsage(event.payload)
      // Update the current provider's usage in the providers usage state
      setProvidersUsage(prev => ({
        ...prev,
        [event.payload.providerType]: {
          used: event.payload.used,
          limit: event.payload.limit,
          percent: event.payload.percent
        }
      }))
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now() / 1000
      const remaining = Math.max(0, usage.resetTime - now)

      if (remaining <= 0) {
        // Session ended or not started - show waiting state
        setCountdown('Waiting to start')
        return
      }

      const hours = Math.floor(remaining / 3600)
      const minutes = Math.floor((remaining % 3600) / 60)
      const seconds = Math.floor(remaining % 60)

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes.toString().padStart(2, '0')}m`)
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds.toString().padStart(2, '0')}s`)
      } else {
        setCountdown(`${seconds}s`)
      }
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [usage.resetTime])

  // Refresh Claude Code usage function - can be called manually or by interval
  const refreshClaudeCodeUsage = useCallback(async () => {
    try {
      // First check if token is still available
      const hasToken = await invoke<boolean>('has_claude_code_token')
      // Only update state if value changed to avoid unnecessary re-renders
      setHasClaudeCodeToken(prev => prev !== hasToken ? hasToken : prev)

      if (!hasToken) {
        console.log('MeterAI: No Claude Code token available')
        return
      }

      console.log('MeterAI: Refreshing Claude Code usage...')
      const ccUsage = await invoke<ClaudeCodeUsageResult>('get_claude_code_usage')

      // Only update if data is different to minimize re-renders
      setClaudeCodeUsage(prev => {
        if (!prev || prev.five_hour_percent !== ccUsage.five_hour_percent ||
            prev.five_hour_reset !== ccUsage.five_hour_reset ||
            prev.seven_day_percent !== ccUsage.seven_day_percent) {
          return ccUsage
        }
        return prev
      })

      if (ccUsage.success) {
        const percent = ccUsage.five_hour_percent ?? 0
        console.log(`MeterAI: Usage updated - 5h: ${percent}%, reset: ${ccUsage.five_hour_reset}`)
        setProvidersUsage(prev => {
          const current = prev['claude-pro-max']
          const newPercent = Math.round(percent)
          // Only update if changed
          if (!current || current.percent !== newPercent) {
            return {
              ...prev,
              'claude-pro-max': {
                used: newPercent,
                limit: 100,
                percent: newPercent
              }
            }
          }
          return prev
        })
      } else {
        console.log('MeterAI: Usage fetch returned success=false')
      }
    } catch (e) {
      console.log('MeterAI: Failed to refresh usage:', e)
    }
  }, [])

  // Auto-refresh Claude Code usage every 2 minutes
  useEffect(() => {
    // Don't start polling if we don't have a token yet
    // But check periodically anyway in case token becomes available
    const POLL_INTERVAL = 2 * 60 * 1000 // 2 minutes

    // Immediate refresh on mount (after a short delay to let initial load complete)
    const initialRefresh = setTimeout(() => {
      console.log('MeterAI: Starting periodic usage refresh (every 2 minutes)')
      refreshClaudeCodeUsage()
    }, 5000) // 5 second delay after mount

    // Set up polling interval
    const refreshInterval = setInterval(() => {
      console.log('MeterAI: Periodic refresh triggered')
      refreshClaudeCodeUsage()
    }, POLL_INTERVAL)

    return () => {
      clearTimeout(initialRefresh)
      clearInterval(refreshInterval)
    }
  }, [refreshClaudeCodeUsage])

  const addRequest = useCallback(async (count: number = 1) => {
    try {
      await invoke('add_request', { count })
    } catch (e) {
      setUsage(prev => {
        const newUsed = Math.min(prev.used + count, prev.limit)
        return {
          ...prev,
          used: newUsed,
          percent: Math.round((newUsed / prev.limit) * 100)
        }
      })
    }
  }, [])

  const resetUsage = useCallback(async () => {
    try {
      await invoke('reset_usage')
    } catch (e) {
      setUsage(prev => ({
        ...prev,
        used: 0,
        percent: 0,
        resetTime: Date.now() / 1000 + 4 * 3600,
        history: [
          { time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), used: prev.used, limit: prev.limit },
          ...prev.history.slice(0, 5)
        ]
      }))
    }
  }, [])

  const switchProvider = useCallback(async (providerId: string) => {
    try {
      await invoke('set_active_provider', { providerId })
      setActiveProvider(providerId)
      const data = await invoke<UsageData>('get_usage')
      setUsage(data)
    } catch (e) {
      console.error('Failed to switch provider:', e)
    }
  }, [])

  const openProviderConfig = (providerId: string) => {
    const provider = providers.find(p =>
      p.provider_type === providerId ||
      (providerId === 'manual' && p.provider_type === 'manual')
    )
    if (provider) {
      setConfigForm({
        apiKey: '',
        limit: provider.limit,
        alertThresholds: provider.alertThresholds.join(', '),
        resetIntervalHours: provider.resetIntervalHours,
        enabled: provider.enabled
      })
      setEditingProvider(providerId)
    }
  }

  const saveProviderConfig = useCallback(async () => {
    if (!editingProvider) return

    try {
      const thresholds = configForm.alertThresholds
        .split(',')
        .map(v => parseInt(v.trim()))
        .filter(v => !isNaN(v))

      await invoke('configure_provider', {
        providerId: editingProvider,
        apiKey: configForm.apiKey || null,
        limit: configForm.limit,
        alertThresholds: thresholds,
        resetIntervalHours: configForm.resetIntervalHours,
        enabled: configForm.enabled
      })

      // Refresh providers list
      const providersList = await invoke<ProviderConfig[]>('get_all_providers')
      setProviders(providersList)
      setEditingProvider(null)
      setViewMode('expanded')
    } catch (e) {
      console.error('Failed to save provider config:', e)
    }
  }, [editingProvider, configForm])

  const removeApiKey = useCallback(async (providerId: string) => {
    try {
      await invoke('remove_api_key', { providerId })
      const providersList = await invoke<ProviderConfig[]>('get_all_providers')
      setProviders(providersList)
    } catch (e) {
      console.error('Failed to remove API key:', e)
    }
  }, [])


  const toggleProviderEnabled = useCallback(async (providerId: string, enabled: boolean) => {
    try {
      const provider = providers.find(p => p.provider_type === providerId)
      if (!provider) return

      await invoke('configure_provider', {
        providerId,
        apiKey: null,
        limit: provider.limit,
        alertThresholds: provider.alertThresholds,
        resetIntervalHours: provider.resetIntervalHours,
        enabled
      })

      const providersList = await invoke<ProviderConfig[]>('get_all_providers')
      setProviders(providersList)
    } catch (e) {
      console.error('Failed to toggle provider:', e)
    }
  }, [providers])

  const minimizeToTray = useCallback(async () => {
    try {
      await appWindow.hide()
    } catch (e) {
      console.log('Tray not available')
    }
  }, [])

  const closeApp = useCallback(async () => {
    try {
      await exit(0)
    } catch (e) {
      console.log('Failed to exit')
    }
  }, [])

  // Start window drag via Tauri API
  const startDrag = useCallback(async (e: React.MouseEvent) => {
    // Only start drag on left mouse button
    if (e.button !== 0) return
    try {
      await appWindow.startDragging()
    } catch (err) {
      console.log('Drag failed:', err)
    }
  }, [])

  const toggleExpand = useCallback(async () => {
    const newMode = viewMode === 'compact' ? 'expanded' : 'compact'
    console.log('Toggle expand: switching from', viewMode, 'to', newMode)
    try {
      if (newMode === 'expanded') {
        // Larger height to accommodate all providers with scrolling
        await appWindow.setSize(new LogicalSize(520, 600))
        setViewMode(newMode)
      } else {
        // Trigger collapse animation first
        setIsCollapsing(true)
        // Wait for animation to complete before resizing
        setTimeout(async () => {
          await appWindow.setSize(new LogicalSize(520, 56))
          setViewMode(newMode)
          setIsCollapsing(false)
        }, 300)
      }
    } catch (e) {
      console.log('Failed to resize window:', e)
      setViewMode(newMode)
      setIsCollapsing(false)
    }
  }, [viewMode])

  const openSettings = useCallback(async () => {
    setViewMode('settings')
    try {
      await appWindow.setSize(new LogicalSize(380, 480))
    } catch (e) {
      console.log('Failed to resize window')
    }
  }, [])

  const getColor = (percent: number) => {
    if (percent >= 90) return 'red'
    if (percent >= 70) return 'yellow'
    return 'green'
  }

  const getProviderIcon = (type: ProviderType) => {
    const providerDef = AI_PROVIDERS.find(p => p.id === type)
    if (providerDef) return providerDef.icon
    switch (type) {
      case 'anthropic': return 'C'
      case 'openai': return 'O'
      default: return 'M'
    }
  }

  const getProviderColor = (type: ProviderType) => {
    const providerDef = AI_PROVIDERS.find(p => p.id === type)
    if (providerDef) return providerDef.color
    switch (type) {
      case 'anthropic': return '#d97706'
      case 'openai': return '#10a37f'
      default: return '#6366f1'
    }
  }

  const getProviderName = (type: ProviderType) => {
    const providerDef = AI_PROVIDERS.find(p => p.id === type)
    if (providerDef) return providerDef.name
    return type
  }

  // Get display name with brand (e.g., "Anthropic Claude Pro")
  const getProviderDisplayName = (provider: ProviderDefinition) => {
    return `${provider.brand} ${provider.name}`
  }

  // Toggle category collapsed state
  const toggleCategoryCollapse = useCallback((category: ProviderCategory) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }))
  }, [])

  const color = getColor(usage.percent)

  // Battery SVG component with dynamic gradient colors based on percentage
  const Battery = ({ percent, color, disabled = false, uniqueId = 'default' }: { percent: number, color: string, disabled?: boolean, uniqueId?: string }) => {
    const fillWidth = Math.min(Math.max(percent, 0), 100) * 0.7 // Scale to 70% of battery width
    const opacity = disabled ? 0.4 : 1

    // Generate gradient stops based on percentage thresholds
    // <70%: bleu-vert, 70-85%: +jaune, 85-95%: +orange, 95-100%: +rouge
    const getGradientStops = () => {
      if (disabled) {
        return [
          { offset: '0%', color: '#4a4a5a' },
          { offset: '100%', color: '#4a4a5a' }
        ]
      }
      if (percent < 70) {
        // Bleu -> Vert
        return [
          { offset: '0%', color: '#2563EB' },
          { offset: '100%', color: '#22F0B6' }
        ]
      } else if (percent < 85) {
        // Bleu -> Vert -> Jaune
        return [
          { offset: '0%', color: '#2563EB' },
          { offset: '50%', color: '#22F0B6' },
          { offset: '100%', color: '#eab308' }
        ]
      } else if (percent < 95) {
        // Bleu -> Vert -> Jaune -> Orange
        return [
          { offset: '0%', color: '#2563EB' },
          { offset: '33%', color: '#22F0B6' },
          { offset: '66%', color: '#eab308' },
          { offset: '100%', color: '#f97316' }
        ]
      } else {
        // Bleu -> Vert -> Jaune -> Orange -> Rouge
        return [
          { offset: '0%', color: '#2563EB' },
          { offset: '25%', color: '#22F0B6' },
          { offset: '50%', color: '#eab308' },
          { offset: '75%', color: '#f97316' },
          { offset: '100%', color: '#ef4444' }
        ]
      }
    }

    const gradientStops = getGradientStops()
    const gradientId = `batteryGrad-${uniqueId}-${percent}`

    return (
      <svg width="32" height="16" viewBox="0 0 32 16" style={{ opacity }}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            {gradientStops.map((stop, idx) => (
              <stop key={idx} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>
        {/* Battery shell */}
        <rect x="1" y="2" width="26" height="12" rx="3" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.5" />
        {/* Battery cap */}
        <rect x="28" y="5" width="3" height="6" rx="1" fill={disabled ? '#4a4a5a' : gradientStops[gradientStops.length - 1].color} />
        {/* Battery fill */}
        <rect x="3" y="4" width={fillWidth * 0.32} height="8" rx="1.5" fill={`url(#${gradientId})`} />
      </svg>
    )
  }

  // Check if Claude session is active (has a valid future reset time and usage > 0)
  const isClaudeSessionActive = (resetStr: string | null | undefined, usagePercent: number | null | undefined): boolean => {
    if (!resetStr) return false
    if (usagePercent === null || usagePercent === undefined || usagePercent === 0) return false
    try {
      const resetDate = new Date(resetStr)
      const now = new Date()
      return resetDate.getTime() > now.getTime()
    } catch {
      return false
    }
  }

  // Helper to format reset time
  const formatResetTime = (resetStr: string | null | undefined, usagePercent?: number | null) => {
    // If no session active (no usage or expired), show waiting state
    if (!resetStr) return 'Waiting to start'
    try {
      const resetDate = new Date(resetStr)
      const now = new Date()
      const diff = resetDate.getTime() - now.getTime()
      // If reset time passed or usage is 0, session is not active
      if (diff <= 0) return 'Waiting to start'
      // If we have usage info and it's 0, we're waiting
      if (usagePercent !== undefined && usagePercent !== null && usagePercent === 0) {
        return 'Waiting to start'
      }
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`
      return `${minutes}m`
    } catch {
      return 'Waiting to start'
    }
  }

  // Helper to calculate time progress (percentage of 5h window elapsed)
  const getTimeProgress = (resetStr: string | null | undefined): number => {
    if (!resetStr) return 0
    try {
      const resetDate = new Date(resetStr)
      const now = new Date()
      const diff = resetDate.getTime() - now.getTime()
      if (diff <= 0) return 100
      const fiveHoursMs = 5 * 60 * 60 * 1000
      const elapsed = fiveHoursMs - diff
      return Math.max(0, Math.min(100, (elapsed / fiveHoursMs) * 100))
    } catch {
      return 0
    }
  }

  // Get gradient for usage gauge with customizable thresholds
  const getUsageGradientStyle = (percent: number, providerId: string = 'claude-pro-max'): string => {
    const thresholds = providerThresholds[providerId] || { green: 70, yellow: 85, orange: 95, red: 100 }
    if (percent < thresholds.green) {
      // Green
      return 'linear-gradient(90deg, #4ade80, #22c55e)'
    } else if (percent < thresholds.yellow) {
      // Green -> Yellow
      return 'linear-gradient(90deg, #22c55e, #4ade80, #eab308)'
    } else if (percent < thresholds.orange) {
      // Green -> Yellow -> Orange
      return 'linear-gradient(90deg, #22c55e, #eab308, #f97316)'
    } else {
      // Green -> Yellow -> Orange -> Red
      return 'linear-gradient(90deg, #22c55e, #eab308, #f97316, #ef4444)'
    }
  }

  // Get gradient for time gauge - progression from red (start/far) to blue (end/close to reset)
  // percent = time elapsed (0% = just reset, 100% = about to reset)
  // The gradient goes from red (left/start) through orange, yellow to blue (right/end)
  const getTimeGradientStyle = (percent: number): string => {
    // Always show full gradient: red -> orange -> yellow -> blue
    // As time progresses, more of the blue end becomes visible
    if (percent < 20) {
      // Just started - mostly red visible
      return 'linear-gradient(90deg, #ef4444, #f97316)'
    } else if (percent < 50) {
      // Mid-early - red to orange to yellow
      return 'linear-gradient(90deg, #ef4444, #f97316, #eab308)'
    } else if (percent < 80) {
      // Mid-late - red through yellow to light blue
      return 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #60a5fa)'
    } else {
      // Close to reset - full gradient red -> blue
      return 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #60a5fa, #38bdf8)'
    }
  }

  // Get single color for time indicator - based on time elapsed
  // percent = time elapsed (0% = just reset/far, 100% = about to reset/close)
  // Higher elapsed = closer to reset = cooler colors (blue)
  // Lower elapsed = far from reset = warmer colors (red)
  const getTimeGradientColor = (percent: number): string => {
    if (percent >= 90) {
      return '#38bdf8' // Très proche du reset - bleu très clair
    } else if (percent >= 70) {
      return '#60a5fa' // Proche du reset - bleu clair
    } else if (percent >= 40) {
      return '#eab308' // Milieu - jaune
    } else if (percent >= 20) {
      return '#f97316' // Loin du reset - orange
    } else {
      return '#ef4444' // Très loin du reset - rouge
    }
  }

  // Check for updates from GitHub (using tags API, not releases)
  const checkForUpdates = useCallback(async () => {
    console.log(`MeterAI: Fetching tags from GitHub (current: v${APP_VERSION})...`)
    try {
      // Use tags API instead of releases - tags are always available
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags`, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MeterAI'
        }
      })

      console.log('MeterAI: GitHub API response:', response.status, response.ok)

      // Tauri fetch returns { ok, status, data }
      if (response.ok && response.data) {
        const tags = response.data as Array<{ name: string }>
        console.log('MeterAI: Tags found:', tags.length)

        if (tags && tags.length > 0) {
          // Find the latest version tag (filter only vX.X.X format)
          const versionTags = tags
            .map(t => t.name)
            .filter(name => /^v?\d+\.\d+\.\d+$/.test(name))
            .map(name => name.replace(/^v/, ''))
            .sort((a, b) => {
              const aParts = a.split('.').map(Number)
              const bParts = b.split('.').map(Number)
              for (let i = 0; i < 3; i++) {
                if ((bParts[i] || 0) !== (aParts[i] || 0)) {
                  return (bParts[i] || 0) - (aParts[i] || 0)
                }
              }
              return 0
            })

          const latestVersion = versionTags[0] || ''
          console.log(`MeterAI: Latest version tag: ${latestVersion}`)

          // Compare versions
          if (latestVersion && latestVersion !== APP_VERSION) {
            const currentParts = APP_VERSION.split('.').map(Number)
            const latestParts = latestVersion.split('.').map(Number)

            let isNewer = false
            for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
              const current = currentParts[i] || 0
              const latest = latestParts[i] || 0
              if (latest > current) {
                isNewer = true
                break
              } else if (latest < current) {
                break
              }
            }

            if (isNewer) {
              setUpdateAvailable(latestVersion)
              console.log(`MeterAI: Update available! v${latestVersion} > v${APP_VERSION}`)
            } else {
              console.log(`MeterAI: No update needed (${latestVersion} is not newer than ${APP_VERSION})`)
              setUpdateAvailable(null)
            }
          } else {
            console.log(`MeterAI: Already on latest version (${APP_VERSION})`)
            setUpdateAvailable(null)
          }
        } else {
          console.log('MeterAI: No tags found')
        }
      } else {
        console.log('MeterAI: No data in response or request failed')
      }
      setLastUpdateCheck(Date.now())
      localStorage.setItem('lastUpdateCheck', Date.now().toString())
    } catch (e) {
      console.log('MeterAI: Failed to check for updates:', e)
    }
  }, [])

  // Check for updates on startup and every 2 hours
  useEffect(() => {
    const twoHoursMs = 2 * 60 * 60 * 1000

    console.log(`MeterAI: App started (v${APP_VERSION})`)
    console.log(`MeterAI: GitHub repo: ${GITHUB_REPO}`)

    // Restore stored update state immediately
    const storedUpdate = localStorage.getItem('updateAvailable')
    if (storedUpdate && storedUpdate !== APP_VERSION) {
      console.log(`MeterAI: Restored cached update: v${storedUpdate}`)
      setUpdateAvailable(storedUpdate)
    }

    // Always check on startup (with small delay to let app initialize)
    const startupCheck = setTimeout(() => {
      console.log('MeterAI: Running startup update check...')
      checkForUpdates()
    }, 3000) // 3 second delay after startup

    // Set interval for checks every 2 hours
    const interval = setInterval(() => {
      console.log('MeterAI: Running periodic update check (2h interval)...')
      checkForUpdates()
    }, twoHoursMs)

    return () => {
      clearTimeout(startupCheck)
      clearInterval(interval)
    }
  }, [checkForUpdates])

  // Store update state
  useEffect(() => {
    if (updateAvailable) {
      localStorage.setItem('updateAvailable', updateAvailable)
    } else {
      localStorage.removeItem('updateAvailable')
    }
  }, [updateAvailable])

  // Open external link
  const openLink = useCallback(async (url: string) => {
    try {
      await shell.open(url)
    } catch (e) {
      console.log('Failed to open link:', e)
    }
  }, [])

  // About Panel Component (inline in expanded view)
  const AboutPanel = () => {
    return (
      <div className="about-panel">
        <div className="about-panel-header">
          <div className="about-panel-logo">
            <svg width="40" height="40" viewBox="0 0 128 128">
              <defs>
                <linearGradient id="aboutLogoGrad" x1="18" y1="28" x2="110" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#2563EB"/>
                  <stop offset="1" stopColor="#22F0B6"/>
                </linearGradient>
              </defs>
              <rect x="16" y="34" width="88" height="60" rx="18" fill="#0B1020" opacity="0.92"/>
              <rect x="16" y="34" width="88" height="60" rx="18" stroke="url(#aboutLogoGrad)" strokeWidth="3.5" fill="none"/>
              <rect x="106" y="52" width="10" height="24" rx="5" fill="url(#aboutLogoGrad)" opacity="0.95"/>
              <rect x="30" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
              <rect x="44" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
              <rect x="58" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
              <rect x="72" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.45"/>
            </svg>
          </div>
          <div className="about-panel-title-block">
            <h2 className="about-panel-title">MeterAI</h2>
            <p className="about-panel-version">
              Version {APP_VERSION}
            </p>
          </div>
          <button className="about-panel-close" onClick={() => setShowAbout(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="about-panel-description">
          Multi-provider AI usage tracker. Monitor your Claude, OpenAI, and other AI API usage in real-time.
        </div>

        {/* Settings Section */}
        <div className="about-panel-section">
          <h3 className="about-section-title">Settings</h3>

          {/* Autostart toggle */}
          <div className="settings-row">
            <span className="settings-label">Launch at startup</span>
            <label className="settings-toggle-mini">
              <input
                type="checkbox"
                checked={autostartEnabled}
                onChange={async (e) => {
                  const enabled = e.target.checked
                  try {
                    await invoke('set_autostart_enabled', { enabled })
                    setAutostartEnabled(enabled)
                  } catch (err) {
                    console.error('Failed to set autostart:', err)
                  }
                }}
              />
              <span className="settings-toggle-slider-mini"></span>
            </label>
          </div>

          {/* Claude Config Status */}
          <div className="settings-row config-status-row">
            <span className="settings-label">Claude Configuration</span>
            <span className={`config-status ${configStatus.detected ? 'detected' : 'not-detected'}`}>
              {configStatus.detected ? 'Detected' : 'Not found'}
            </span>
          </div>

          {configStatus.customPath && (
            <div className="settings-row config-path-row">
              <span className="config-path-text" title={configStatus.customPath}>
                {configStatus.customPath.length > 40
                  ? '...' + configStatus.customPath.slice(-37)
                  : configStatus.customPath}
              </span>
              <button
                className="config-clear-btn"
                onClick={async () => {
                  try {
                    await invoke('set_custom_credentials_path', { path: null })
                    const status = await invoke<{ detected: boolean; source: string; customPath: string | null }>('get_config_detection_status')
                    setConfigStatus(status)
                  } catch (err) {
                    console.error('Failed to clear custom path:', err)
                  }
                }}
                title="Remove custom path"
              >
                ✕
              </button>
            </div>
          )}

          {!configStatus.detected && (
            <div className="settings-help">
              <p className="help-text">
                File not found automatically. Paths checked:
              </p>
              <ul className="help-paths">
                <li>~/.claude/.credentials.json</li>
                <li>~/.claude/credentials.json</li>
                <li>~/.config/claude-code/auth.json</li>
              </ul>
              <button
                className="browse-config-btn"
                onClick={async () => {
                  try {
                    const path = await invoke<string | null>('browse_credentials_file')
                    if (path) {
                      await invoke('set_custom_credentials_path', { path })
                      const status = await invoke<{ detected: boolean; source: string; customPath: string | null }>('get_config_detection_status')
                      setConfigStatus(status)
                    }
                  } catch (err) {
                    console.error('Failed to browse for config:', err)
                  }
                }}
              >
                Browse...
              </button>
            </div>
          )}
        </div>

        <div className="about-panel-section">
          <h3 className="about-section-title">Contact</h3>
          <div className="about-contact-row">
            {/* GitHub Support */}
            <button className="contact-card" onClick={() => openLink(`https://github.com/${GITHUB_REPO}/issues`)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <span className="contact-card-label">GitHub</span>
            </button>

            {/* Telegram Contact */}
            <button className="contact-card telegram" onClick={() => openLink('https://t.me/PopeYeah')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#229ED9">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              <span className="contact-card-label">@PopeYeah</span>
            </button>
          </div>
        </div>

        <div className="about-panel-section">
          <h3 className="about-section-title">Support Development</h3>
          <p className="about-donate-text">If you find this tool useful, consider supporting its development:</p>

          {/* Bitcoin */}
          <div className="about-donate-item">
            <div className="about-donate-logos">
              <img src={btcLogo} alt="BTC" className="crypto-logo crypto-logo-main" title="Bitcoin" />
            </div>
            <code className="about-donate-address" onClick={() => navigator.clipboard.writeText('bc1qnav0zef8edpgtr0t7vkylyt0xly4vxzgwaerrt')}>
              bc1qnav0zef8edpgtr0t7vkylyt0xly4vxzgwaerrt
            </code>
          </div>

          {/* Ethereum - USDC, USDT */}
          <div className="about-donate-item">
            <div className="about-donate-logos">
              <img src={ethLogo} alt="ETH" className="crypto-logo crypto-logo-main" title="Ethereum" />
              <img src={usdcLogo} alt="USDC" className="crypto-logo crypto-logo-token" title="USDC" />
              <img src={usdtLogo} alt="USDT" className="crypto-logo crypto-logo-token" title="USDT" />
              <img src={usd1Logo} alt="USD1" className="crypto-logo crypto-logo-token" title="USD1 (World Liberty Financial)" />
            </div>
            <code className="about-donate-address" onClick={() => navigator.clipboard.writeText('0xaE42e321F2672A072b2e7421FF0E6Aa117cCd667')}>
              0xaE42e321F2672A072b2e7421FF0E6Aa117cCd667
            </code>
          </div>

          {/* Solana - USDC, USDT */}
          <div className="about-donate-item">
            <div className="about-donate-logos">
              <img src={solLogo} alt="SOL" className="crypto-logo crypto-logo-main" title="Solana" />
              <img src={usdcLogo} alt="USDC" className="crypto-logo crypto-logo-token" title="USDC" />
              <img src={usdtLogo} alt="USDT" className="crypto-logo crypto-logo-token" title="USDT" />
              <img src={usd1Logo} alt="USD1" className="crypto-logo crypto-logo-token" title="USD1 (World Liberty Financial)" />
            </div>
            <code className="about-donate-address" onClick={() => navigator.clipboard.writeText('9MGSJXZwta7rWkL5MwpEbvwznXY6pU7uQqcoJoK2n39')}>
              9MGSJXZwta7rWkL5MwpEbvwznXY6pU7uQqcoJoK2n39
            </code>
          </div>
        </div>

        {/* Update Section */}
        {updateAvailable && (
          <div className="about-panel-section about-update-section">
            <div className="about-update-banner" onClick={() => openLink(`https://github.com/${GITHUB_REPO}/releases/latest`)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>New version available: <strong>v{updateAvailable}</strong></span>
              <span className="about-update-action">Download</span>
            </div>
          </div>
        )}

        <div className="about-panel-section">
          <h3 className="about-section-title">License</h3>
          <p className="about-license-text">
            Source-available for viewing and auditing only.<br/>
            All rights reserved. © 2026 HPSC
          </p>
        </div>

        <div className="about-panel-footer">
          <button className="about-github-btn" onClick={() => openLink(`https://github.com/${GITHUB_REPO}`)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View on GitHub
          </button>
        </div>
      </div>
    )
  }

  // Open About - expands the window if in compact mode
  const openAbout = useCallback(async () => {
    if (viewMode === 'compact') {
      try {
        await appWindow.setSize(new LogicalSize(520, 600))
        setViewMode('expanded')
      } catch (e) {
        console.log('Failed to resize window:', e)
      }
    }
    setShowAbout(true)
  }, [viewMode])

  // Claude Code Detection Popup handlers
  const handleClaudeDetectedEnable = useCallback(() => {
    setEnabledProviders(prev => ({ ...prev, 'claude-pro-max': true }))
    setShowClaudeDetectedPopup(false)
    localStorage.setItem('claudeDetectedDismissed', 'true')
  }, [])

  const handleClaudeDetectedDismiss = useCallback(() => {
    setShowClaudeDetectedPopup(false)
    localStorage.setItem('claudeDetectedDismissed', 'true')
  }, [])

  // Compact banner mode
  if (viewMode === 'compact') {
    const anthropicProvider = providers.find(p => p.provider_type === 'anthropic')
    const openaiProvider = providers.find(p => p.provider_type === 'openai')
    const anthropicUsage = providersUsage['anthropic'] || { percent: 0 }
    const openaiUsage = providersUsage['openai'] || { percent: 0 }

    // Claude is configured if we have Claude Code token OR API key
    const isAnthropicConfigured = hasClaudeCodeToken || (anthropicProvider?.enabled && anthropicProvider?.has_api_key)
    const isOpenaiConfigured = openaiProvider?.enabled && openaiProvider?.has_api_key

    // Use Claude Code real data if available
    const claudeDisplayPercent = claudeCodeUsage?.success && claudeCodeUsage?.five_hour_percent !== null
      ? Math.round(claudeCodeUsage.five_hour_percent)
      : anthropicUsage.percent

    // Format reset time for compact display - pass usage percent to detect waiting state
    const compactResetDisplay = claudeCodeUsage?.success && claudeCodeUsage?.five_hour_reset
      ? formatResetTime(claudeCodeUsage.five_hour_reset, claudeCodeUsage.five_hour_percent)
      : countdown

    return (
      <div className="banner-container" onMouseDown={startDrag}>
        {/* Logo + App name - drag zone */}
        <div className="banner-brand">
          <div className="banner-logo">
            <svg width="20" height="20" viewBox="0 0 128 128">
              <defs>
                <linearGradient id="logoGrad" x1="18" y1="28" x2="110" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#2563EB"/>
                  <stop offset="1" stopColor="#22F0B6"/>
                </linearGradient>
              </defs>
              <rect x="16" y="34" width="88" height="60" rx="18" fill="#0B1020" opacity="0.92"/>
              <rect x="16" y="34" width="88" height="60" rx="18" stroke="url(#logoGrad)" strokeWidth="3.5" fill="none"/>
              <rect x="106" y="52" width="10" height="24" rx="5" fill="url(#logoGrad)" opacity="0.95"/>
              <rect x="30" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
              <rect x="44" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
              <rect x="58" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
              <rect x="72" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.45"/>
            </svg>
          </div>
          <span className="banner-title">MeterAI</span>
        </div>

        {/* Providers - only show if at least one is enabled */}
        {(enabledProviders['claude-pro-max'] || enabledProviders['openai']) && (
          <div className="banner-providers">
            {/* Claude/Anthropic - only show if enabled via toggle */}
            {enabledProviders['claude-pro-max'] && (
              <div className={`banner-provider-wrapper ${!isAnthropicConfigured ? 'disabled' : ''}`} title={isAnthropicConfigured ? `Claude: ${claudeDisplayPercent}% (5h) - Reset: ${compactResetDisplay}` : 'Claude: Not configured'}>
                <div className="banner-provider-main">
                  <span className="provider-label">Claude</span>
                  <Battery percent={claudeDisplayPercent} color="#d97706" disabled={!isAnthropicConfigured} uniqueId="claude-compact" />
                  <span className="provider-percent">{isAnthropicConfigured ? `${claudeDisplayPercent}%` : '--'}</span>
                </div>
                {isAnthropicConfigured && (
                  <div
                    className={`provider-reset-row ${compactResetDisplay === 'Waiting to start' ? 'waiting' : ''}`}
                    style={{ color: compactResetDisplay === 'Waiting to start' ? '#22F0B6' : getTimeGradientColor(getTimeProgress(claudeCodeUsage?.five_hour_reset)) }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12,6 12,12 16,14"></polyline>
                    </svg>
                    {compactResetDisplay}
                  </div>
                )}
              </div>
            )}

            {/* OpenAI - only show if enabled via toggle */}
            {enabledProviders['openai'] && (
              <div className={`banner-provider ${!isOpenaiConfigured ? 'disabled' : ''}`} title={isOpenaiConfigured ? `OpenAI: ${openaiUsage.percent}%` : 'OpenAI: Not configured'}>
                <span className="provider-label">OpenAI</span>
                <Battery percent={openaiUsage.percent} color="#10a37f" disabled={!isOpenaiConfigured} uniqueId="openai-compact" />
                <span className="provider-percent">{isOpenaiConfigured ? `${openaiUsage.percent}%` : '--'}</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {/* Actions - stop propagation for buttons */}
        <div className="banner-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button className="banner-btn chevron-btn" onClick={toggleExpand} title="Details">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="url(#chevronGrad)" strokeWidth="2.5">
              <defs>
                <linearGradient id="chevronGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#2563EB"/>
                  <stop offset="100%" stopColor="#22F0B6"/>
                </linearGradient>
              </defs>
              <polyline points="6,9 12,15 18,9"></polyline>
            </svg>
          </button>
          <button className={`banner-btn about-btn ${updateAvailable ? 'has-update' : ''}`} onClick={openAbout} title="About">
            <span className="about-icon-text">i</span>
            {updateAvailable && <span className="update-dot"></span>}
          </button>
          <button className="banner-btn" onClick={minimizeToTray} title="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button className="banner-btn close" onClick={closeApp} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // Settings view (provider config)
  if (viewMode === 'settings' || editingProvider) {
    const backToCompact = async () => {
      setEditingProvider(null)
      setViewMode('compact')
      try {
        await appWindow.setSize(new LogicalSize(520, 56))
      } catch (e) {
        console.log('Failed to resize window')
      }
    }

    // If editing a specific provider
    if (editingProvider) {
      const provider = providers.find(p => p.provider_type === editingProvider)
      return (
        <div className="settings-container compact">
          <div className="settings-header" onMouseDown={startDrag}>
            <div className="settings-title-row">
              <span className="settings-provider-icon" style={{ background: getProviderColor(editingProvider as ProviderType) }}>
                {getProviderIcon(editingProvider as ProviderType)}
              </span>
              <span className="settings-title-text">Configure {provider?.name || editingProvider}</span>
            </div>
            <div className="settings-header-actions">
              <button className="settings-header-btn" onClick={() => setEditingProvider(null)} title="Back">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15,18 9,12 15,6"></polyline>
                </svg>
              </button>
              <button className="settings-header-btn close" onClick={closeApp} title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <div className="settings-content-compact">
            {/* API Key row */}
            {editingProvider !== 'manual' && (
              <div className="settings-row-api">
                <label className="settings-label-inline">API Key</label>
                <input
                  type="password"
                  className="settings-input-inline"
                  placeholder={provider?.has_api_key ? '••••••••' : 'sk-ant-api03-...'}
                  value={configForm.apiKey}
                  onChange={(e) => setConfigForm(f => ({ ...f, apiKey: e.target.value }))}
                />
                {provider?.has_api_key && (
                  <button className="settings-remove-key-inline" onClick={() => removeApiKey(editingProvider)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Single row: Toggle + Limite + Reset */}
            <div className="settings-row-inline">
              <div className="settings-inline-group">
                <label className="settings-toggle-mini">
                  <input
                    type="checkbox"
                    checked={configForm.enabled}
                    onChange={(e) => setConfigForm(f => ({ ...f, enabled: e.target.checked }))}
                  />
                  <span className="settings-toggle-slider-mini"></span>
                </label>
                <span className="settings-inline-label">Active</span>
              </div>
              <div className="settings-inline-group">
                <span className="settings-inline-label">Limit</span>
                <input
                  type="number"
                  className="settings-input-mini"
                  value={configForm.limit}
                  onChange={(e) => setConfigForm(f => ({ ...f, limit: parseInt(e.target.value) || 100 }))}
                />
              </div>
              <div className="settings-inline-group">
                <span className="settings-inline-label">Reset</span>
                <input
                  type="number"
                  className="settings-input-mini"
                  value={configForm.resetIntervalHours}
                  onChange={(e) => setConfigForm(f => ({ ...f, resetIntervalHours: parseInt(e.target.value) || 4 }))}
                />
                <span className="settings-inline-unit">h</span>
              </div>
            </div>

            {/* Alertes - compact chips style */}
            <div className="settings-row-alerts">
              <span className="settings-inline-label">Alerts</span>
              <div className="settings-alerts-chips">
                {configForm.alertThresholds.split(',').map((val, idx) => (
                  <span key={idx} className="settings-alert-chip">{val.trim()}%</span>
                ))}
                <input
                  type="text"
                  className="settings-alerts-input"
                  placeholder="70, 90, 100"
                  value={configForm.alertThresholds}
                  onChange={(e) => setConfigForm(f => ({ ...f, alertThresholds: e.target.value }))}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="settings-actions-compact">
              <button className="settings-btn-compact primary" onClick={saveProviderConfig}>
                Save
              </button>
              <button className="settings-btn-compact secondary" onClick={() => setEditingProvider(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )
    }

    // Settings main view (providers list)
    return (
      <div className="settings-container">
        <div className="settings-header" onMouseDown={startDrag}>
          <div className="settings-title-row">
            <span className="settings-logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="url(#settingsGrad)" strokeWidth="2">
                <defs>
                  <linearGradient id="settingsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2563EB"/>
                    <stop offset="100%" stopColor="#22F0B6"/>
                  </linearGradient>
                </defs>
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </span>
            <span className="settings-title-text">Settings</span>
          </div>
          <div className="settings-header-actions">
            <button className="settings-header-btn" onClick={backToCompact} title="Back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15,18 9,12 15,6"></polyline>
              </svg>
            </button>
            <button className="settings-header-btn close" onClick={closeApp} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div className="settings-providers-list">
          {providers.map((provider) => {
            const providerId = provider.provider_type
            const provUsage = providersUsage[providerId] || { percent: 0 }
            const isConfigured = provider.provider_type === 'manual' || provider.has_api_key
            return (
              <div
                key={providerId}
                className={`settings-provider-card ${!provider.enabled ? 'disabled' : ''}`}
                onClick={() => openProviderConfig(providerId)}
              >
                <span
                  className="settings-provider-icon"
                  style={{ background: getProviderColor(provider.provider_type) }}
                >
                  {getProviderIcon(provider.provider_type)}
                </span>
                <div className="settings-provider-info">
                  <span className="settings-provider-name">{provider.name}</span>
                  <span className="settings-provider-status">
                    {!provider.enabled ? 'Disabled' :
                      !isConfigured ? 'Key missing' :
                      `${provUsage.percent}% used`}
                  </span>
                </div>
                <svg className="settings-provider-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9,6 15,12 9,18"></polyline>
                </svg>
              </div>
            )
          })}
        </div>

        <div className="settings-hint">
          Click on a provider to configure it
        </div>
      </div>
    )
  }

  // Expanded view (detailed usage)
  if (viewMode === 'expanded') {
    const anthropicProvider = providers.find(p => p.provider_type === 'anthropic')
    const openaiProvider = providers.find(p => p.provider_type === 'openai')
    const anthropicUsage = providersUsage['anthropic'] || { used: 0, limit: 100, percent: 0 }
    const openaiUsage = providersUsage['openai'] || { used: 0, limit: 100, percent: 0 }

    // Check if Claude Code token is available (for real usage data)
    const isAnthropicConfigured = hasClaudeCodeToken || (anthropicProvider?.enabled && anthropicProvider?.has_api_key)
    const isOpenaiConfigured = openaiProvider?.enabled && openaiProvider?.has_api_key

    // Use Claude Code real data if available
    const claudeFiveHourPercent = claudeCodeUsage?.five_hour_percent ?? anthropicUsage.percent
    const claudeSevenDayPercent = claudeCodeUsage?.seven_day_percent

    // Filter providers based on category and search
    const filteredProviders = AI_PROVIDERS.filter(p => {
      const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter
      const matchesSearch = searchQuery === '' ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.brand.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesCategory && matchesSearch
    })

    // Group providers by category
    const categories: ProviderCategory[] = ['coding', 'chat', 'image', 'video', 'audio']

    return (
      <div className="expanded-container">
        {/* Popup for Claude Code detection */}
        {showClaudeDetectedPopup && (
          <div className="popup-overlay">
            <div className="popup-container">
              <div className="popup-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#popupGrad)" strokeWidth="2">
                  <defs>
                    <linearGradient id="popupGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#2563EB"/>
                      <stop offset="100%" stopColor="#22F0B6"/>
                    </linearGradient>
                  </defs>
                  <path d="M9 12l2 2 4-4"></path>
                  <circle cx="12" cy="12" r="10"></circle>
                </svg>
              </div>
              <h3 className="popup-title">Claude Code Detected</h3>
              <p className="popup-message">
                We found your Claude Code credentials. Enable automatic usage tracking?
              </p>
              <div className="popup-actions">
                <button className="popup-btn primary" onClick={handleClaudeDetectedEnable}>
                  Enable
                </button>
                <button className="popup-btn secondary" onClick={handleClaudeDetectedDismiss}>
                  Not Now
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Provider settings panel */}
        <ProviderSettingsPanel
          providerId={providerSettingsOpen}
          onClose={() => setProviderSettingsOpen(null)}
          providerThresholds={providerThresholds}
          setProviderThresholds={setProviderThresholds}
          providerTimeThresholds={providerTimeThresholds}
          setProviderTimeThresholds={setProviderTimeThresholds}
          configStatus={configStatus}
          setConfigStatus={setConfigStatus}
          setHasClaudeCodeToken={setHasClaudeCodeToken}
          setEnabledProviders={setEnabledProviders}
          refreshClaudeCodeUsage={refreshClaudeCodeUsage}
        />

        {/* Same banner as compact mode */}
        <div className="banner-container" onMouseDown={startDrag}>
          <div className="banner-brand">
            <div className="banner-logo">
              <svg width="20" height="20" viewBox="0 0 128 128">
                <defs>
                  <linearGradient id="logoGrad" x1="18" y1="28" x2="110" y2="100" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#2563EB"/>
                    <stop offset="1" stopColor="#22F0B6"/>
                  </linearGradient>
                </defs>
                <rect x="16" y="34" width="88" height="60" rx="18" fill="#0B1020" opacity="0.92"/>
                <rect x="16" y="34" width="88" height="60" rx="18" stroke="url(#logoGrad)" strokeWidth="3.5" fill="none"/>
                <rect x="106" y="52" width="10" height="24" rx="5" fill="url(#logoGrad)" opacity="0.95"/>
                <rect x="30" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
                <rect x="44" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
                <rect x="58" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.95"/>
                <rect x="72" y="50" width="10" height="28" rx="5" fill="#22F0B6" opacity="0.45"/>
              </svg>
            </div>
            <span className="banner-title">MeterAI</span>
          </div>

          {/* Providers - only show if at least one is enabled */}
          {(enabledProviders['claude-pro-max'] || enabledProviders['openai']) && (
            <div className="banner-providers">
              {/* Claude/Anthropic - only show if enabled via toggle */}
              {enabledProviders['claude-pro-max'] && (
                <div className={`banner-provider-wrapper ${!isAnthropicConfigured ? 'disabled' : ''}`}>
                  <div className="banner-provider-main">
                    <span className="provider-label">Claude</span>
                    <Battery percent={claudeFiveHourPercent} color="#d97706" disabled={!isAnthropicConfigured} uniqueId="claude-expanded" />
                    <span className="provider-percent">{isAnthropicConfigured ? `${Math.round(claudeFiveHourPercent)}%` : '--'}</span>
                  </div>
                  {isAnthropicConfigured && (
                    <div
                      className={`provider-reset-row ${!isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? 'waiting' : ''}`}
                      style={{ color: !isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? '#22F0B6' : getTimeGradientColor(getTimeProgress(claudeCodeUsage?.five_hour_reset)) }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12,6 12,12 16,14"></polyline>
                      </svg>
                      {formatResetTime(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent)}
                    </div>
                  )}
                </div>
              )}
              {/* OpenAI - only show if enabled via toggle */}
              {enabledProviders['openai'] && (
                <div className={`banner-provider ${!isOpenaiConfigured ? 'disabled' : ''}`}>
                  <span className="provider-label">OpenAI</span>
                  <Battery percent={openaiUsage.percent} color="#10a37f" disabled={!isOpenaiConfigured} uniqueId="openai-expanded" />
                  <span className="provider-percent">{isOpenaiConfigured ? `${openaiUsage.percent}%` : '--'}</span>
                </div>
              )}
            </div>
          )}

          <div className="banner-actions" onMouseDown={(e) => e.stopPropagation()}>
            <button className="banner-btn chevron-btn up" onClick={toggleExpand} title="Collapse">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="url(#chevronGradUp)" strokeWidth="2.5">
                <defs>
                  <linearGradient id="chevronGradUp" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2563EB"/>
                    <stop offset="100%" stopColor="#22F0B6"/>
                  </linearGradient>
                </defs>
                <polyline points="18,15 12,9 6,15"></polyline>
              </svg>
            </button>
            <button className={`banner-btn about-btn ${updateAvailable ? 'has-update' : ''} ${showAbout ? 'active' : ''}`} onClick={() => setShowAbout(!showAbout)} title="About">
              <span className="about-icon-text">i</span>
              {updateAvailable && <span className="update-dot"></span>}
            </button>
            <button className="banner-btn" onClick={minimizeToTray} title="Minimize">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button className="banner-btn close" onClick={closeApp} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Expanded content with gradient theme */}
        <div className={`expanded-content ${isCollapsing ? 'collapsing' : ''}`}>
          {/* About Panel - shown when showAbout is true */}
          {showAbout ? (
            <AboutPanel />
          ) : (
            <>
          {/* Search bar */}
          <div className="provider-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Category filter pills */}
          <div className="category-filters">
            <div
              className={`category-filter-pill ${categoryFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
              All
            </div>
            {categories.map(cat => (
              <div
                key={cat}
                className={`category-filter-pill ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                <CategoryIcon iconPath={CATEGORY_INFO[cat].iconPath} color="currentColor" size={12} />
                {CATEGORY_INFO[cat].name.split(' ')[0]}
              </div>
            ))}
          </div>

          {/* Provider list by category */}
          <div className="expanded-cards">
            {categories.map(category => {
              const categoryProviders = filteredProviders.filter(p => p.category === category)
              if (categoryProviders.length === 0) return null

              const isCollapsed = collapsedCategories[category]

              return (
                <div key={category} className="expanded-category">
                  <div
                    className="category-header clickable"
                    style={{ borderLeftColor: CATEGORY_INFO[category].color }}
                    onClick={() => toggleCategoryCollapse(category)}
                  >
                    <svg
                      className={`category-chevron ${isCollapsed ? '' : 'expanded'}`}
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={CATEGORY_INFO[category].color}
                      strokeWidth="2"
                    >
                      <polyline points="9,6 15,12 9,18"></polyline>
                    </svg>
                    <CategoryIcon iconPath={CATEGORY_INFO[category].iconPath} color={CATEGORY_INFO[category].color} size={16} />
                    <span className="category-name">{CATEGORY_INFO[category].name}</span>
                    <span className="category-count">{categoryProviders.length}</span>
                  </div>

                  {!isCollapsed && categoryProviders.map((providerDef) => {
                    const providerId = providerDef.id
                    const isEnabled = enabledProviders[providerId] ?? false
                    const provUsage = providersUsage[providerId] || { used: 0, limit: 100, percent: 0 }
                    const backendProvider = providers.find(p => p.provider_type === providerId)
                    // Check if this is a Claude provider that can use Claude Code OAuth
                    const isClaudeProvider = providerId === 'claude-pro-max' || providerDef.parentId === 'anthropic'
                    const isConfigured = backendProvider?.has_api_key ||
                      (isClaudeProvider && hasClaudeCodeToken)
                    const isRefreshing = refreshingProvider === providerId

                    // Special handling for Claude with real OAuth data
                    // Show detailed card if we have Claude Code token, even if no active session (usage=0)
                    const isClaudeWithRealData = isClaudeProvider && hasClaudeCodeToken && (claudeCodeUsage?.success || claudeCodeUsage !== null)
                    const displayPercent = isClaudeWithRealData
                      ? Math.round(claudeFiveHourPercent ?? 0)
                      : provUsage.percent

                    const refreshProvider = async () => {
                      setRefreshingProvider(providerId)
                      try {
                        if (isClaudeProvider && hasClaudeCodeToken) {
                          await refreshClaudeCodeUsage()
                        }
                      } catch (e) {
                        console.log('Failed to refresh provider')
                      }
                      setRefreshingProvider(null)
                    }

                    // Check if this is an active/configured provider (show detailed card)
                    const showDetailedCard = isEnabled && (isConfigured || isClaudeProvider)

                    if (showDetailedCard && isClaudeWithRealData) {
                      // Full detailed card for Claude with real data
                      return (
                        <div key={providerId} className="expanded-card">
                          <div className="expanded-card-header">
                            <label className={`expanded-toggle-mini ${!isEnabled ? 'activable' : ''}`} onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={(e) => {
                                  setEnabledProviders(prev => ({ ...prev, [providerId]: e.target.checked }))
                                  if (backendProvider) toggleProviderEnabled(providerId, e.target.checked)
                                }}
                              />
                              <span className="expanded-toggle-slider-mini"></span>
                            </label>
                            <span className="expanded-card-icon" style={{ background: providerDef.color }}>
                              {providerDef.icon}
                            </span>
                            <span className="expanded-card-name-inline">
                              <span className="expanded-card-brand">{providerDef.brand}</span>
                              <span className="expanded-card-plan">{providerDef.name}</span>
                            </span>
                            <button
                              className={`refresh-btn ${isRefreshing ? 'spinning' : ''}`}
                              onClick={refreshProvider}
                              title="Refresh"
                              disabled={isRefreshing}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M23 4v6h-6"></path>
                                <path d="M1 20v-6h6"></path>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                              </svg>
                            </button>
                            <button className="add-credits-btn coming-soon" disabled title="Coming soon">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                              </svg>
                              Credits
                              <span className="coming-soon-badge">Soon</span>
                            </button>
                            <button
                              className="provider-settings-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setProviderSettingsOpen(providerId)
                              }}
                              title="Provider settings"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                              </svg>
                            </button>
                            <span className="provider-info-icon" title={`${providerDef.name} - ${providerDef.website}`}>?</span>
                          </div>
                          <div className="expanded-usage-block">
                            <div className="expanded-usage-label-row">
                              <span className="expanded-usage-label">Usage</span>
                              <span className="expanded-usage-badge badge-5h">5h: {Math.round(claudeFiveHourPercent)}%</span>
                              {claudeSevenDayPercent !== undefined && claudeSevenDayPercent !== null && (
                                <span className="expanded-usage-badge badge-7d">7d: {Math.round(claudeSevenDayPercent)}%</span>
                              )}
                            </div>
                            <div className="expanded-usage-row">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                              </svg>
                              <div className="expanded-usage-bar-container">
                                <div
                                  className="expanded-usage-bar-fill"
                                  style={{
                                    width: `${Math.min(displayPercent, 100)}%`,
                                    background: getUsageGradientStyle(displayPercent, providerId)
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="expanded-time-progress">
                            <div className="expanded-time-label-row">
                              <span className="expanded-time-label">{isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? 'Time Elapsed' : 'Session Status'}</span>
                              <span className={`expanded-time-badge ${!isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? 'waiting' : ''}`} style={!isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? { color: '#22F0B6' } : {}}>
                                {isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? `Reset ${formatResetTime(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent)}` : 'Waiting to start'}
                              </span>
                            </div>
                            <div className="expanded-time-row">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? 'currentColor' : '#22F0B6'} strokeWidth="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12,6 12,12 16,14"></polyline>
                              </svg>
                              <div className="expanded-time-bar">
                                {isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? (
                                  <div
                                    className="expanded-time-fill"
                                    style={{
                                      width: `${getTimeProgress(claudeCodeUsage?.five_hour_reset)}%`,
                                      background: getTimeGradientStyle(getTimeProgress(claudeCodeUsage?.five_hour_reset))
                                    }}
                                  />
                                ) : (
                                  <div
                                    className="expanded-time-fill waiting"
                                    style={{
                                      width: '100%',
                                      background: 'linear-gradient(90deg, rgba(34, 240, 182, 0.3), rgba(34, 240, 182, 0.1))'
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Mini card for other providers
                    // Only Claude Pro/Max is fully configured - others show "Coming soon"
                    const isClaudeProMax = providerId === 'claude-pro-max'
                    const isComingSoon = !isClaudeProMax

                    return (
                      <div
                        key={providerId}
                        className={`provider-card-mini ${!isEnabled ? 'disabled' : ''} ${isConfigured ? 'configured' : ''} ${isComingSoon ? 'coming-soon' : ''}`}
                        onClick={() => !isComingSoon && setProviderSettingsOpen(providerId)}
                      >
                        <label
                          className={`expanded-toggle-mini provider-card-mini-toggle ${isComingSoon ? 'disabled' : ''} ${!isComingSoon && !isEnabled ? 'activable' : ''}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            disabled={isComingSoon}
                            onChange={(e) => {
                              if (!isComingSoon) {
                                setEnabledProviders(prev => ({ ...prev, [providerId]: e.target.checked }))
                                if (backendProvider) toggleProviderEnabled(providerId, e.target.checked)
                              }
                            }}
                          />
                          <span className="expanded-toggle-slider-mini"></span>
                        </label>
                        <span className="provider-card-mini-icon" style={{ background: providerDef.color }}>
                          {providerDef.icon}
                        </span>
                        <div className="provider-card-mini-info">
                          <span className="provider-card-mini-name">{providerDef.brand}</span>
                          <span className="provider-card-mini-version">{providerDef.name}</span>
                        </div>
                        <div className="provider-card-mini-status">
                          {isComingSoon ? (
                            <span className="version-badge coming-soon">Coming soon</span>
                          ) : isEnabled && isConfigured ? (
                            <span className="provider-card-mini-percent">{displayPercent}%</span>
                          ) : !isConfigured ? (
                            <span className="version-badge setup">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                              </svg>
                              Setup
                            </span>
                          ) : (
                            <span className="version-badge free">Off</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // Fallback to compact
  return null
}

export default App
