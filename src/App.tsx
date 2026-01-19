import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { appWindow, LogicalSize, LogicalPosition, currentMonitor } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/api/process'
import { shell } from '@tauri-apps/api'
import { fetch } from '@tauri-apps/api/http'
import { platform } from '@tauri-apps/api/os'
import { AI_PROVIDERS, CATEGORY_INFO, TRACKING_STATUS_INFO, type ProviderCategory, type ProviderDefinition, type TrackingStatus } from './providers'

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
  subscription_type: string | null // "pro", "max", etc.
}

// Cache for Claude usage when VS Code stops refreshing
interface ClaudeUsageCache {
  lastKnownUsage: ClaudeCodeUsageResult
  lastKnownAt: number // timestamp when data was received
  isStale: boolean // true if data might be outdated
}

interface OpenAIUsageResult {
  success: boolean
  error: string | null
  usage_usd: number | null
  limit_usd: number | null
  percent: number | null
  is_pay_as_you_go: boolean
  daily_usage: Array<{ date: string; cost_usd: number }>
}

// Token management types
interface TokenStatus {
  has_internal_token: boolean
  token_preview: string | null
  token_hash: string | null
  copied_at: string | null
  expires_at: string | null
  source: string
  source_differs: boolean
  source_hash: string | null
}

interface TokenChangeEntry {
  timestamp: string
  changed: boolean
  old_hash: string | null
  new_hash: string | null
  source: string
}

interface TokenHistory {
  entries: TokenChangeEntry[]
  last_check: string | null
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
  tokenStatus: TokenStatus | null
  setTokenStatus: React.Dispatch<React.SetStateAction<TokenStatus | null>>
  customProviderNames: Record<string, string>
  setCustomProviderNames: React.Dispatch<React.SetStateAction<Record<string, string>>>
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
  refreshClaudeCodeUsage,
  tokenStatus,
  setTokenStatus,
  customProviderNames,
  setCustomProviderNames
}: ProviderSettingsPanelProps) => {
  // Local accordion states - stable because component is not recreated
  const [usageThresholdsOpen, setUsageThresholdsOpen] = useState(false)
  const [timeThresholdsOpen, setTimeThresholdsOpen] = useState(false)
  const [tokenManagementOpen, setTokenManagementOpen] = useState(false)
  const [tokenHistoryOpen, setTokenHistoryOpen] = useState(false)
  const [tokenHistory, setTokenHistory] = useState<TokenHistory | null>(null)
  const [tokenActionMessage, setTokenActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // OpenAI API states
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [openaiHasKey, setOpenaiHasKey] = useState(false)
  const [openaiKeyPreview, setOpenaiKeyPreview] = useState<string | null>(null)
  const [openaiSaveMessage, setOpenaiSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [openaiKeyVisible, setOpenaiKeyVisible] = useState(false)

  // Compute values needed for useEffect BEFORE any conditional returns
  const isOpenAIProvider = providerId === 'openai-api'
  const providerDef = providerId ? AI_PROVIDERS.find(p => p.id === providerId) : null

  // Check OpenAI key status when opening panel - MUST be before any conditional returns
  useEffect(() => {
    const checkKey = async () => {
      if (isOpenAIProvider) {
        try {
          const hasKey = await invoke<boolean>('has_openai_api_key')
          setOpenaiHasKey(hasKey)
          if (hasKey) {
            const preview = await invoke<string | null>('get_openai_api_key_preview')
            setOpenaiKeyPreview(preview)
          } else {
            setOpenaiKeyPreview(null)
          }
        } catch (e) {
          console.error('Failed to check OpenAI API key:', e)
        }
      }
    }
    checkKey()
  }, [isOpenAIProvider])

  // Early returns AFTER all hooks
  if (!providerId) return null
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

  // Token management handlers (only for Claude provider)
  const isClaudeProvider = providerId === 'claude-pro-max'

  const refreshTokenStatus = async () => {
    if (!isClaudeProvider) return
    try {
      const status = await invoke<TokenStatus>('get_token_status')
      setTokenStatus(status)
    } catch (e) {
      console.error('Failed to get token status:', e)
    }
  }

  const handleCopyTokenInternal = async () => {
    try {
      await invoke('copy_token_to_internal')
      setTokenActionMessage({ type: 'success', text: 'Token copied to internal storage' })
      await refreshTokenStatus()
      setTimeout(() => setTokenActionMessage(null), 3000)
    } catch (e) {
      setTokenActionMessage({ type: 'error', text: `Failed: ${e}` })
      setTimeout(() => setTokenActionMessage(null), 5000)
    }
  }

  const handleExportToken = async () => {
    try {
      const data = await invoke<string>('export_token_data')
      // Use clipboard to copy export data
      await navigator.clipboard.writeText(data)
      setTokenActionMessage({ type: 'success', text: 'Token data copied to clipboard' })
      setTimeout(() => setTokenActionMessage(null), 3000)
    } catch (e) {
      setTokenActionMessage({ type: 'error', text: `Export failed: ${e}` })
      setTimeout(() => setTokenActionMessage(null), 5000)
    }
  }

  const handleImportToken = async () => {
    try {
      const data = await navigator.clipboard.readText()
      if (!data.trim()) {
        setTokenActionMessage({ type: 'error', text: 'Clipboard is empty' })
        setTimeout(() => setTokenActionMessage(null), 3000)
        return
      }
      await invoke('import_token_data', { data })
      setTokenActionMessage({ type: 'success', text: 'Token imported successfully' })
      await refreshTokenStatus()
      setTimeout(() => setTokenActionMessage(null), 3000)
    } catch (e) {
      setTokenActionMessage({ type: 'error', text: `Import failed: ${e}` })
      setTimeout(() => setTokenActionMessage(null), 5000)
    }
  }

  const handleClearInternalToken = async () => {
    try {
      await invoke('clear_internal_token')
      setTokenActionMessage({ type: 'success', text: 'Internal token cleared' })
      await refreshTokenStatus()
      setTimeout(() => setTokenActionMessage(null), 3000)
    } catch (e) {
      setTokenActionMessage({ type: 'error', text: `Failed: ${e}` })
      setTimeout(() => setTokenActionMessage(null), 5000)
    }
  }

  const loadTokenHistory = async () => {
    if (!isClaudeProvider) return
    try {
      // First, check for token changes (this records the change in history if detected)
      await invoke('check_token_change').catch(() => {})
      // Then load the updated history
      const history = await invoke<TokenHistory>('get_token_history')
      setTokenHistory(history)
    } catch (e) {
      console.error('Failed to load token history:', e)
    }
  }

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // OpenAI API handlers
  const handleSaveOpenAIKey = async () => {
    if (!openaiApiKey.trim()) {
      setOpenaiSaveMessage({ type: 'error', text: 'Please enter an API key' })
      setTimeout(() => setOpenaiSaveMessage(null), 3000)
      return
    }
    try {
      await invoke('save_openai_api_key', { apiKey: openaiApiKey })
      setOpenaiSaveMessage({ type: 'success', text: 'API key saved successfully' })
      setOpenaiHasKey(true)
      setOpenaiApiKey('') // Clear input for security
      setOpenaiKeyVisible(false)
      // Enable the provider
      setEnabledProviders(prev => ({ ...prev, 'openai-api': true }))
      setTimeout(() => setOpenaiSaveMessage(null), 3000)
    } catch (e) {
      setOpenaiSaveMessage({ type: 'error', text: `Failed: ${e}` })
      setTimeout(() => setOpenaiSaveMessage(null), 5000)
    }
  }

  const handleRemoveOpenAIKey = async () => {
    try {
      await invoke('remove_openai_api_key')
      setOpenaiSaveMessage({ type: 'success', text: 'API key removed' })
      setOpenaiHasKey(false)
      setOpenaiApiKey('')
      // Disable the provider
      setEnabledProviders(prev => ({ ...prev, 'openai-api': false }))
      setTimeout(() => setOpenaiSaveMessage(null), 3000)
    } catch (e) {
      setOpenaiSaveMessage({ type: 'error', text: `Failed: ${e}` })
      setTimeout(() => setOpenaiSaveMessage(null), 5000)
    }
  }

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

        {/* Display Name Section */}
        <div className="provider-settings-section">
          <h4 className="provider-settings-section-title">Display Name</h4>
          <div className="custom-name-section">
            <p className="custom-name-help">Customize the name shown in the banner</p>
            <div className="custom-name-input-row">
              <input
                type="text"
                className="custom-name-input"
                placeholder={`${providerDef.brand} ${providerDef.name}`}
                value={customProviderNames[providerId] || ''}
                onChange={(e) => {
                  const value = e.target.value
                  setCustomProviderNames(prev => {
                    if (value === '') {
                      const { [providerId]: _, ...rest } = prev
                      return rest
                    }
                    return { ...prev, [providerId]: value }
                  })
                }}
              />
              {customProviderNames[providerId] && (
                <button
                  className="custom-name-clear-btn"
                  onClick={() => setCustomProviderNames(prev => {
                    const { [providerId]: _, ...rest } = prev
                    return rest
                  })}
                  title="Reset to default"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Configuration Section */}
        <div className="provider-settings-section">
          <h4 className="provider-settings-section-title">Configuration</h4>

          {/* OpenAI API Key Configuration */}
          {isOpenAIProvider ? (
            <div className="config-detection-box">
              <div className="config-detection-status">
                <span className={`config-detection-dot ${openaiHasKey ? 'detected' : 'not-detected'}`}></span>
                <span className="config-detection-text">
                  {openaiHasKey ? (
                    <>API Key <strong>configured</strong></>
                  ) : (
                    <>API Key <strong>not configured</strong></>
                  )}
                </span>
              </div>

              {/* API Key Input */}
              <div className="openai-api-key-section">
                {openaiHasKey ? (
                  /* Key is configured - show preview */
                  <>
                    <div className="openai-api-key-configured">
                      <div className="openai-key-preview">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                        </svg>
                        <span className="key-preview-text">
                          {openaiKeyVisible ? openaiKeyPreview : '••••••••••...'}
                        </span>
                      </div>
                      <button
                        className="openai-key-visibility-btn"
                        onClick={() => setOpenaiKeyVisible(!openaiKeyVisible)}
                        title={openaiKeyVisible ? 'Hide preview' : 'Show preview'}
                      >
                        {openaiKeyVisible ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                        )}
                      </button>
                    </div>
                    <button
                      className="openai-api-key-btn remove full-width"
                      onClick={handleRemoveOpenAIKey}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                      Remove API Key
                    </button>
                  </>
                ) : (
                  /* No key configured - show input */
                  <>
                    <div className="openai-api-key-input-wrapper">
                      <input
                        type={openaiKeyVisible ? 'text' : 'password'}
                        className="openai-api-key-input"
                        placeholder="sk-..."
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveOpenAIKey()
                        }}
                      />
                      <button
                        className="openai-key-visibility-btn"
                        onClick={() => setOpenaiKeyVisible(!openaiKeyVisible)}
                        title={openaiKeyVisible ? 'Hide key' : 'Show key'}
                      >
                        {openaiKeyVisible ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                        )}
                      </button>
                    </div>

                    <button
                      className="openai-api-key-btn save full-width"
                      onClick={handleSaveOpenAIKey}
                      disabled={!openaiApiKey.trim()}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                      </svg>
                      Save API Key
                    </button>

                    <div className="openai-api-help">
                      Get your API key from <a href="#" onClick={(e) => {
                        e.preventDefault()
                        import('@tauri-apps/api/shell').then(({ open }) => {
                          open('https://platform.openai.com/api-keys')
                        })
                      }}>platform.openai.com/api-keys</a>
                    </div>
                  </>
                )}

                {/* Success/Error message */}
                {openaiSaveMessage && (
                  <div className={`openai-api-message ${openaiSaveMessage.type}`}>
                    {openaiSaveMessage.text}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Claude Credentials Detection */
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
          )}
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

        {/* Token Management - Only for Claude provider */}
        {isClaudeProvider && (
          <div className="provider-settings-accordion">
            <div
              className={`accordion-header ${tokenManagementOpen ? 'open' : ''}`}
              onClick={() => {
                if (!tokenManagementOpen) refreshTokenStatus()
                setTokenManagementOpen(!tokenManagementOpen)
              }}
            >
              <svg
                className={`accordion-chevron ${tokenManagementOpen ? 'open' : ''}`}
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <polyline points="9,18 15,12 9,6"></polyline>
              </svg>
              <span className="accordion-title">Token Storage</span>
              {!tokenManagementOpen && tokenStatus?.has_internal_token && (
                <span className="accordion-badge stored">Stored</span>
              )}
            </div>
            {tokenManagementOpen && (
              <div className="accordion-content">
                {/* Token Status */}
                <div className="token-status-box">
                  <div className="token-status-row">
                    <span className="token-status-label">Internal Token</span>
                    <span className={`token-status-value ${tokenStatus?.has_internal_token ? 'active' : 'inactive'}`}>
                      {tokenStatus?.has_internal_token ? 'Stored' : 'Not stored'}
                    </span>
                  </div>
                  {tokenStatus?.has_internal_token && (
                    <>
                      <div className="token-status-row">
                        <span className="token-status-label">Preview</span>
                        <span className="token-preview-text">{tokenStatus.token_preview}</span>
                      </div>
                      <div className="token-status-row">
                        <span className="token-status-label">Hash</span>
                        <span className="token-hash-text">{tokenStatus.token_hash}</span>
                      </div>
                      {tokenStatus.copied_at && (
                        <div className="token-status-row">
                          <span className="token-status-label">Copied</span>
                          <span className="token-date-text">{formatTimestamp(tokenStatus.copied_at)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {tokenStatus?.source_differs && (
                    <div className="token-warning-box">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                      </svg>
                      <span>Source token differs from stored (hash: {tokenStatus.source_hash?.slice(0, 8)}...)</span>
                    </div>
                  )}
                </div>

                {/* Action message */}
                {tokenActionMessage && (
                  <div className={`token-action-message ${tokenActionMessage.type}`}>
                    {tokenActionMessage.text}
                  </div>
                )}

                {/* Token Actions */}
                <div className="token-actions-grid">
                  <button
                    className="token-action-btn primary"
                    onClick={handleCopyTokenInternal}
                    disabled={!configStatus.detected}
                    title={configStatus.detected ? 'Copy Claude Code token to internal storage' : 'No source token detected'}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    {tokenStatus?.has_internal_token ? 'Update' : 'Copy'} to Storage
                  </button>
                  <button
                    className="token-action-btn secondary"
                    onClick={handleExportToken}
                    disabled={!tokenStatus?.has_internal_token}
                    title="Export token to clipboard (for use on another PC)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    Export
                  </button>
                  <button
                    className="token-action-btn secondary"
                    onClick={handleImportToken}
                    title="Import token from clipboard"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Import
                  </button>
                  <button
                    className="token-action-btn danger"
                    onClick={handleClearInternalToken}
                    disabled={!tokenStatus?.has_internal_token}
                    title="Clear stored token"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18"></path>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Clear
                  </button>
                </div>

                <div className="token-help-text">
                  Store the token internally to keep MeterAI working even without Claude Code installed.
                  Export to transfer to another computer.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Token History - Only for Claude provider */}
        {isClaudeProvider && (
          <div className="provider-settings-accordion">
            <div
              className={`accordion-header ${tokenHistoryOpen ? 'open' : ''}`}
              onClick={() => {
                if (!tokenHistoryOpen) loadTokenHistory()
                setTokenHistoryOpen(!tokenHistoryOpen)
              }}
            >
              <svg
                className={`accordion-chevron ${tokenHistoryOpen ? 'open' : ''}`}
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <polyline points="9,18 15,12 9,6"></polyline>
              </svg>
              <span className="accordion-title">Token History</span>
              {!tokenHistoryOpen && tokenHistory && tokenHistory.entries.length > 0 && (
                <span className="accordion-badge">{tokenHistory.entries.length}</span>
              )}
            </div>
            {tokenHistoryOpen && (
              <div className="accordion-content">
                {tokenHistory && tokenHistory.entries.length > 0 ? (
                  <div className="token-history-list">
                    {tokenHistory.entries.slice(0, 10).map((entry, i) => (
                      <div key={i} className={`token-history-entry ${entry.changed ? 'changed' : 'same'}`}>
                        <div className="token-history-time">{formatTimestamp(entry.timestamp)}</div>
                        <div className="token-history-status">
                          {entry.changed ? (
                            <>
                              <span className="token-history-badge changed">Changed</span>
                              <span className="token-history-hash">{entry.old_hash?.slice(0, 6)} → {entry.new_hash?.slice(0, 6)}</span>
                            </>
                          ) : (
                            <span className="token-history-badge same">No change</span>
                          )}
                        </div>
                        <div className="token-history-source">{entry.source}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="token-history-empty">
                    No token changes recorded yet.
                    Changes are tracked when you copy or update the internal token.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions - Claude specific */}
        {isClaudeProvider && (
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
        )}
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
  const [claudeUsageCache, setClaudeUsageCache] = useState<ClaudeUsageCache | null>(() => {
    // Load cache from localStorage on startup
    try {
      const cached = localStorage.getItem('claudeUsageCache')
      if (cached) {
        const parsed = JSON.parse(cached) as ClaudeUsageCache
        // Mark as stale if older than 5 minutes
        const ageMs = Date.now() - parsed.lastKnownAt
        return { ...parsed, isStale: ageMs > 5 * 60 * 1000 }
      }
    } catch { /* ignore */ }
    return null
  })
  const [hasClaudeCodeToken, setHasClaudeCodeToken] = useState(false)
  const [openaiUsage, setOpenaiUsage] = useState<OpenAIUsageResult | null>(null)
  const [hasOpenaiApiKey, setHasOpenaiApiKey] = useState(false)
  const [showClaudeDetectedPopup, setShowClaudeDetectedPopup] = useState(false)
  const [claudeDetectedDismissed, setClaudeDetectedDismissed] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<ProviderCategory | 'all' | 'available'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsing, setIsCollapsing] = useState(false)
  const [hasAnimatedExpand, setHasAnimatedExpand] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [lastUpdateCheck, setLastUpdateCheck] = useState<number>(0)
  // Settings states
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [notifyUpdateEnabled, setNotifyUpdateEnabled] = useState(() => {
    // Default to true - user can disable if they don't want tray notifications
    const saved = localStorage.getItem('notifyUpdateEnabled')
    return saved === null ? true : saved === 'true'
  })
  const [savePositionEnabled, setSavePositionEnabled] = useState(() => {
    return localStorage.getItem('savePositionEnabled') === 'true'
  })
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
  // Custom display names for providers in the banner
  const [customProviderNames, setCustomProviderNames] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('customProviderNames')
    return saved ? JSON.parse(saved) : {}
  })
  // Persist custom names to localStorage
  useEffect(() => {
    localStorage.setItem('customProviderNames', JSON.stringify(customProviderNames))
  }, [customProviderNames])
  // Note: accordion states moved inside ProviderSettingsPanel to prevent flicker
  const [detectedCredentialPaths, setDetectedCredentialPaths] = useState<string[]>([])
  // Token management state
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null)
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

  // Load data on startup and show window when ready
  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await invoke<UsageData>('get_usage')
        setUsage(data)
        const providersList = await invoke<ProviderConfig[]>('get_all_providers')
        setProviders(providersList)
        const active = await invoke<string>('get_active_provider')
        setActiveProvider(active)

        // Position window before showing - always use default centered position
        // Note: Save position feature disabled due to issues with invalid coordinates
        try {
          const monitor = await currentMonitor()
          if (monitor) {
            // Default: center horizontally at top
            const screenWidth = monitor.size.width / monitor.scaleFactor
            const windowWidth = 520
            const x = Math.round((screenWidth - windowWidth) / 2)
            await appWindow.setPosition(new LogicalPosition(x, 1))
          }
        } catch (e) {
          console.log('Failed to set window position:', e)
        }

        // Show window once data is loaded (window starts hidden to prevent grey flash)
        await appWindow.show()

        // Check if Claude Code token is available
        try {
          const hasToken = await invoke<boolean>('has_claude_code_token')
          setHasClaudeCodeToken(hasToken)

          // If token available, fetch Claude Code usage
          if (hasToken) {
            const ccUsage = await invoke<ClaudeCodeUsageResult>('get_claude_code_usage')

            // Check if we got valid data or if VS Code is stuck on "loading usage data"
            const hasValidData = ccUsage.success && ccUsage.five_hour_percent !== null

            if (hasValidData) {
              // Valid data received - update state and cache
              setClaudeCodeUsage(ccUsage)
              const newCache: ClaudeUsageCache = {
                lastKnownUsage: ccUsage,
                lastKnownAt: Date.now(),
                isStale: false
              }
              setClaudeUsageCache(newCache)
              localStorage.setItem('claudeUsageCache', JSON.stringify(newCache))
              console.log('MeterAI: Claude usage updated and cached:', ccUsage.five_hour_percent + '%')

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
            } else {
              // No valid data (VS Code stuck on "loading usage data" or error)
              // Use cached data if available, mark as stale
              console.log('MeterAI: No valid Claude data received, using cache if available')
              const cached = localStorage.getItem('claudeUsageCache')
              if (cached) {
                try {
                  const parsedCache = JSON.parse(cached) as ClaudeUsageCache
                  const ageMs = Date.now() - parsedCache.lastKnownAt
                  const ageMinutes = Math.round(ageMs / 60000)
                  console.log(`MeterAI: Using cached data from ${ageMinutes} minutes ago`)

                  // Mark as stale and use cached data
                  parsedCache.isStale = true
                  setClaudeUsageCache(parsedCache)
                  setClaudeCodeUsage(parsedCache.lastKnownUsage)

                  // Update providers with cached data (NOT 100%!)
                  if (parsedCache.lastKnownUsage.five_hour_percent !== null) {
                    setProvidersUsage(prev => ({
                      ...prev,
                      'claude-pro-max': {
                        used: Math.round(parsedCache.lastKnownUsage.five_hour_percent || 0),
                        limit: 100,
                        percent: Math.round(parsedCache.lastKnownUsage.five_hour_percent || 0)
                      }
                    }))
                  }
                } catch { /* ignore parse error */ }
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
        // Still show window even if data loading fails
        await appWindow.show()
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
      // Skip token check if Claude provider is already enabled and we have a valid config
      // This avoids re-reading the credentials file every 2 minutes
      const claudeEnabled = enabledProviders['claude-pro-max']
      const hasValidConfig = configStatus.detected

      if (!claudeEnabled || !hasValidConfig) {
        // Only check token if Claude is not enabled or config not detected
        const hasToken = await invoke<boolean>('has_claude_code_token')
        setHasClaudeCodeToken(prev => prev !== hasToken ? hasToken : prev)

        if (!hasToken) {
          console.log('MeterAI: No Claude Code token available')
          return
        }
      }

      console.log('MeterAI: Refreshing Claude Code usage...')
      const ccUsage = await invoke<ClaudeCodeUsageResult>('get_claude_code_usage')

      // Check if we got valid data
      const hasValidData = ccUsage.success && ccUsage.five_hour_percent !== null

      if (hasValidData) {
        // Valid data - update state and cache
        setClaudeCodeUsage(prev => {
          if (!prev || prev.five_hour_percent !== ccUsage.five_hour_percent ||
              prev.five_hour_reset !== ccUsage.five_hour_reset ||
              prev.seven_day_percent !== ccUsage.seven_day_percent) {
            return ccUsage
          }
          return prev
        })

        // Update cache
        const newCache: ClaudeUsageCache = {
          lastKnownUsage: ccUsage,
          lastKnownAt: Date.now(),
          isStale: false
        }
        setClaudeUsageCache(newCache)
        localStorage.setItem('claudeUsageCache', JSON.stringify(newCache))

        const percent = ccUsage.five_hour_percent ?? 0
        console.log(`MeterAI: Usage updated - 5h: ${percent}%, reset: ${ccUsage.five_hour_reset}`)
        setProvidersUsage(prev => {
          const current = prev['claude-pro-max']
          const newPercent = Math.round(percent)
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
        // No valid data - VS Code might be stuck on "loading usage data"
        // Use cached data and mark as stale, but DON'T reset to 100%
        console.log('MeterAI: No valid data received - VS Code might be paused or stuck')

        setClaudeUsageCache(prev => {
          if (prev) {
            const ageMs = Date.now() - prev.lastKnownAt
            const ageMinutes = Math.round(ageMs / 60000)
            console.log(`MeterAI: Using cached data from ${ageMinutes} min ago (marking stale)`)

            // If we have cached reset time, check if it has passed
            if (prev.lastKnownUsage.five_hour_reset) {
              const resetTime = new Date(prev.lastKnownUsage.five_hour_reset).getTime()
              const now = Date.now()
              if (now > resetTime) {
                console.log('MeterAI: Cached reset time has passed - usage might have reset')
                // Don't assume 100% available, just mark as very stale
              }
            }

            return { ...prev, isStale: true }
          }
          return prev
        })

        // Keep using the last known usage, don't change to 100%
        // The UI will show "stale" indicator based on claudeUsageCache.isStale
      }
    } catch (e) {
      console.log('MeterAI: Failed to refresh usage:', e)
      // On error, mark cache as stale but keep using it
      setClaudeUsageCache(prev => prev ? { ...prev, isStale: true } : prev)
    }
  }, [enabledProviders, configStatus.detected])

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

  // Refresh OpenAI usage function
  const refreshOpenAIUsage = useCallback(async () => {
    try {
      const openaiEnabled = enabledProviders['openai-api']

      // Check if we have an API key
      const hasKey = await invoke<boolean>('has_openai_api_key')
      setHasOpenaiApiKey(prev => prev !== hasKey ? hasKey : prev)

      if (!openaiEnabled || !hasKey) {
        return
      }

      console.log('MeterAI: Refreshing OpenAI API usage...')
      const result = await invoke<OpenAIUsageResult>('get_openai_api_usage')

      setOpenaiUsage(prev => {
        if (!prev || prev.percent !== result.percent ||
            prev.usage_usd !== result.usage_usd) {
          return result
        }
        return prev
      })

      if (result.success) {
        const percent = result.percent ?? 0
        console.log(`MeterAI: OpenAI usage updated - ${percent}% ($${result.usage_usd?.toFixed(2)} / $${result.limit_usd?.toFixed(2)})`)
        setProvidersUsage(prev => {
          const current = prev['openai-api']
          const newPercent = Math.round(percent)
          if (!current || current.percent !== newPercent) {
            return {
              ...prev,
              'openai-api': {
                used: newPercent,
                limit: 100,
                percent: newPercent
              }
            }
          }
          return prev
        })
      } else {
        console.log('MeterAI: OpenAI usage fetch returned success=false:', result.error)
      }
    } catch (e) {
      console.log('MeterAI: Failed to refresh OpenAI usage:', e)
    }
  }, [enabledProviders])

  // Auto-refresh OpenAI usage every 5 minutes
  useEffect(() => {
    const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes (less frequent than Claude)

    const initialRefresh = setTimeout(() => {
      refreshOpenAIUsage()
    }, 6000) // 6 second delay (staggered from Claude refresh)

    const refreshInterval = setInterval(() => {
      refreshOpenAIUsage()
    }, POLL_INTERVAL)

    return () => {
      clearTimeout(initialRefresh)
      clearInterval(refreshInterval)
    }
  }, [refreshOpenAIUsage])

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

  // Save window position when moved (if save position is enabled)
  useEffect(() => {
    let unlistenMove: (() => void) | null = null

    const setupMoveListener = async () => {
      unlistenMove = await appWindow.onMoved(async ({ payload: position }) => {
        if (savePositionEnabled) {
          localStorage.setItem('windowPosition', JSON.stringify({ x: position.x, y: position.y }))
        }
      })
    }

    setupMoveListener()

    return () => {
      if (unlistenMove) unlistenMove()
    }
  }, [savePositionEnabled])

  const toggleExpand = useCallback(async () => {
    const newMode = viewMode === 'compact' ? 'expanded' : 'compact'
    console.log('Toggle expand: switching from', viewMode, 'to', newMode)
    try {
      if (newMode === 'expanded') {
        // Reset animation flag so animation plays when expanding
        setHasAnimatedExpand(false)
        // Larger height to accommodate all providers with scrolling
        await appWindow.setSize(new LogicalSize(520, 600))
        setViewMode(newMode)
        // Mark animation as done after a short delay
        setTimeout(() => setHasAnimatedExpand(true), 600)
      } else {
        // Trigger collapse animation first
        setIsCollapsing(true)
        // Wait for animation to complete before resizing
        setTimeout(async () => {
          await appWindow.setSize(new LogicalSize(520, 56))
          setViewMode(newMode)
          setIsCollapsing(false)
          setHasAnimatedExpand(false)
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

  // Battery SVG component with dynamic gradient colors based on REMAINING percentage
  // 100% = full battery = blue-green (good), 0% = empty = red (critical)
  // The "remaining" represents how much is LEFT to use (inverted from "used")
  const Battery = ({ percent, color, disabled = false, uniqueId = 'default' }: { percent: number, color: string, disabled?: boolean, uniqueId?: string }) => {
    // percent = remaining percentage (100 = full, 0 = empty)
    const remaining = Math.min(Math.max(percent, 0), 100)
    const fillWidth = remaining * 0.7 // Scale to 70% of battery width for fill
    const opacity = disabled ? 0.4 : 1

    // New gradient system based on remaining percentage (inverted logic)
    // Zone 1: 100%-50% remaining -> Blue-Green (OK)
    // Zone 2: 50%-30% remaining -> Yellow appears (warning)
    // Zone 3: 30%-20% remaining -> Orange-Yellow (alert)
    // Zone 4: <20% remaining -> Red dominant (critical)
    const getGradientStops = () => {
      if (disabled) {
        return [
          { offset: '0%', color: '#4a4a5a' },
          { offset: '100%', color: '#4a4a5a' }
        ]
      }

      // Zone 1: 100%-50% remaining - Blue -> Green (good)
      if (remaining >= 50) {
        return [
          { offset: '0%', color: '#2563EB' },  // Blue
          { offset: '100%', color: '#22F0B6' } // Green
        ]
      }
      // Zone 2: 50%-30% remaining - Yellow appears, Blue/Green compress
      else if (remaining >= 30) {
        // Yellow takes 1/3, Blue-Green compress
        return [
          { offset: '0%', color: '#22F0B6' },  // Green
          { offset: '65%', color: '#eab308' }, // Yellow dominant
          { offset: '100%', color: '#eab308' } // Yellow
        ]
      }
      // Zone 3: 30%-20% remaining - Orange-Yellow (no more green)
      else if (remaining >= 20) {
        return [
          { offset: '0%', color: '#eab308' },  // Yellow
          { offset: '100%', color: '#f97316' } // Orange
        ]
      }
      // Zone 4: <20% remaining - Red dominant
      else if (remaining >= 5) {
        // Red becomes more dominant as we approach 0
        const redDominance = 1 - (remaining / 20) // 0 at 20%, 0.75 at 5%
        return [
          { offset: '0%', color: '#f97316' },  // Orange
          { offset: `${(1 - redDominance) * 60}%`, color: '#f97316' },
          { offset: '100%', color: '#ef4444' } // Red
        ]
      }
      // <5% - Almost all red (critical)
      else {
        return [
          { offset: '0%', color: '#ef4444' },  // Red
          { offset: '30%', color: '#ef4444' },
          { offset: '100%', color: '#dc2626' } // Darker red
        ]
      }
    }

    const gradientStops = getGradientStops()
    const gradientId = `batteryGrad-${uniqueId}-${Math.round(remaining)}`

    // For nearly empty battery (<5%), show a small red bar at the start
    const showLowBatteryIndicator = remaining < 5 && remaining > 0 && !disabled
    // Critical battery (<2%) - will blink
    const isCriticalBattery = remaining < 2 && remaining > 0 && !disabled

    // Outline gradient ID - always blue to green regardless of fill level
    const outlineGradientId = `batteryOutline-${uniqueId}`

    return (
      <svg width="32" height="16" viewBox="0 0 32 16" style={{ opacity }}>
        <defs>
          {/* Fill gradient - changes based on remaining level */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            {gradientStops.map((stop, idx) => (
              <stop key={idx} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
          {/* Outline gradient - ALWAYS blue to green */}
          <linearGradient id={outlineGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={disabled ? '#4a4a5a' : '#2563EB'} />
            <stop offset="100%" stopColor={disabled ? '#4a4a5a' : '#22F0B6'} />
          </linearGradient>
        </defs>
        {/* Battery shell - ALWAYS blue-green gradient outline */}
        <rect x="1" y="2" width="26" height="12" rx="3" fill="none" stroke={`url(#${outlineGradientId})`} strokeWidth="1.5" />
        {/* Battery cap - green end of gradient */}
        <rect x="28" y="5" width="3" height="6" rx="1" fill={disabled ? '#4a4a5a' : '#22F0B6'} />
        {/* Battery fill - width based on remaining percentage */}
        {/* Critical battery (<2%): smaller red bar that blinks */}
        {isCriticalBattery && (
          <rect x="3" y="4" width="2" height="8" rx="1" fill="#ef4444" className="battery-critical-blink" />
        )}
        {/* Low battery (2-5%): normal fill */}
        {remaining >= 2 && remaining > 0 && (
          <rect x="3" y="4" width={Math.max(fillWidth * 0.32, 2)} height="8" rx="1.5" fill={`url(#${gradientId})`} />
        )}
        {/* Empty battery indicator - small red bar when at 0% */}
        {remaining === 0 && !disabled && (
          <rect x="3" y="4" width="2" height="8" rx="1" fill="#ef4444" className="battery-critical-blink" />
        )}
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

  // Helper to format reset time - uses PC local time for countdown calculation
  const formatResetTime = (resetStr: string | null | undefined, usagePercent?: number | null, showStaleIndicator = false) => {
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

      let timeStr = hours > 0 ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`

      // Add stale indicator if data is old
      if (showStaleIndicator && claudeUsageCache?.isStale) {
        const ageMs = Date.now() - claudeUsageCache.lastKnownAt
        const ageMinutes = Math.round(ageMs / 60000)
        timeStr += ` (~${ageMinutes}m ago)`
      }

      return timeStr
    } catch {
      return 'Waiting to start'
    }
  }

  // Get cache age in human-readable format
  const getCacheAgeDisplay = (): string | null => {
    if (!claudeUsageCache?.isStale) return null
    const ageMs = Date.now() - claudeUsageCache.lastKnownAt
    const ageMinutes = Math.round(ageMs / 60000)
    if (ageMinutes < 1) return 'just now'
    if (ageMinutes === 1) return '1 min ago'
    return `${ageMinutes} min ago`
  }

  // Helper to format 7-day reset time in days
  const formatSevenDayReset = (resetStr: string | null | undefined): string | null => {
    if (!resetStr) return null
    try {
      const resetDate = new Date(resetStr)
      const now = new Date()
      const diff = resetDate.getTime() - now.getTime()
      if (diff <= 0) return null
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
      if (days === 1) return '1 day'
      return `${days} days`
    } catch {
      return null
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

  // Get gradient for usage gauge based on REMAINING percentage
  // remainingPercent: 100 = full (good), 0 = empty (critical)
  // Matches the Battery component's 4-zone system
  const getUsageGradientStyle = (remainingPercent: number, providerId: string = 'claude-pro-max'): string => {
    // Zone 1: 100%-50% remaining - Blue/Green (good)
    if (remainingPercent >= 50) {
      return 'linear-gradient(90deg, #2563EB, #22F0B6)'
    }
    // Zone 2: 50%-30% remaining - Green/Yellow (warning)
    else if (remainingPercent >= 30) {
      return 'linear-gradient(90deg, #22F0B6, #eab308)'
    }
    // Zone 3: 30%-20% remaining - Yellow/Orange (alert)
    else if (remainingPercent >= 20) {
      return 'linear-gradient(90deg, #eab308, #f97316)'
    }
    // Zone 4: <20% remaining - Orange/Red (critical)
    else {
      return 'linear-gradient(90deg, #f97316, #ef4444)'
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

  // Check for updates from GitHub releases (only notify when assets for current platform are available)
  const checkForUpdates = useCallback(async (shouldNotify: boolean = true) => {
    try {
      // Detect current platform
      const currentPlatform = await platform()

      // Map platform to expected asset patterns
      const platformAssetPatterns: Record<string, RegExp[]> = {
        'win32': [/\.exe$/i, /\.msi$/i],
        'darwin': [/\.dmg$/i, /\.app\.tar\.gz$/i],
        'linux': [/\.AppImage$/i, /\.deb$/i]
      }

      const expectedPatterns = platformAssetPatterns[currentPlatform] || []

      // Fetch latest release (not tags) - only published releases with assets
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

      const response = await fetch<{
        tag_name: string
        name: string
        draft: boolean
        prerelease: boolean
        assets: Array<{ name: string; state: string }>
        message?: string
        documentation_url?: string
      }>(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MeterAI'
        }
      })

      // Try to parse data even if response.ok is false (Tauri fetch behavior)
      const release = response.data
      if (!release) {
        setLastUpdateCheck(Date.now())
        localStorage.setItem('lastUpdateCheck', Date.now().toString())
        return
      }

      // Check if data looks like an error response
      if (release.message && release.documentation_url) {
        setLastUpdateCheck(Date.now())
        localStorage.setItem('lastUpdateCheck', Date.now().toString())
        return
      }

      // Validate release data
      if (!release.tag_name) {
        setLastUpdateCheck(Date.now())
        localStorage.setItem('lastUpdateCheck', Date.now().toString())
        return
      }

      // Skip drafts and prereleases
      if (release.draft || release.prerelease) {
        setLastUpdateCheck(Date.now())
        localStorage.setItem('lastUpdateCheck', Date.now().toString())
        return
      }

      const latestVersion = release.tag_name.replace(/^v/, '')

      // Check if assets for current platform are available
      const platformAssets = release.assets?.filter(asset =>
        asset.state === 'uploaded' && expectedPatterns.some(pattern => pattern.test(asset.name))
      ) || []

      if (platformAssets.length === 0) {
        // Don't notify - assets not ready for this platform
        setLastUpdateCheck(Date.now())
        localStorage.setItem('lastUpdateCheck', Date.now().toString())
        return
      }

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
          // Always set state (for About badge) regardless of notification setting
          setUpdateAvailable(latestVersion)
          localStorage.setItem('updateAvailable', latestVersion)

          // Only show tray notification if enabled AND shouldNotify is true
          if (shouldNotify && notifyUpdateEnabled) {
            try {
              const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/api/notification')
              let permissionGranted = await isPermissionGranted()
              if (!permissionGranted) {
                const permission = await requestPermission()
                permissionGranted = permission === 'granted'
              }
              if (permissionGranted) {
                sendNotification({
                  title: 'MeterAI Update Available',
                  body: `Version ${latestVersion} is ready to download`
                })
              }
            } catch {
              // Notification failed, but update state is already set
            }
          }
        } else {
          setUpdateAvailable(null)
          localStorage.removeItem('updateAvailable')
        }
      } else {
        setUpdateAvailable(null)
        localStorage.removeItem('updateAvailable')
      }
      setLastUpdateCheck(Date.now())
      localStorage.setItem('lastUpdateCheck', Date.now().toString())
    } catch {
      // Silently fail - update check is not critical
    }
  }, [notifyUpdateEnabled])

  // Check for updates on startup and every 2 hours
  useEffect(() => {
    const twoHoursMs = 2 * 60 * 60 * 1000

    // Clear problematic localStorage values that may cause issues
    localStorage.removeItem('savePositionEnabled')
    localStorage.removeItem('windowPosition')

    // Restore stored update state immediately (only if stored version is newer than current)
    const storedUpdate = localStorage.getItem('updateAvailable')

    if (storedUpdate && storedUpdate !== APP_VERSION) {
      // Verify stored version is actually newer than current version
      const currentParts = APP_VERSION.split('.').map(Number)
      const storedParts = storedUpdate.split('.').map(Number)

      let isStillNewer = false
      for (let i = 0; i < Math.max(currentParts.length, storedParts.length); i++) {
        const current = currentParts[i] || 0
        const stored = storedParts[i] || 0
        if (stored > current) {
          isStillNewer = true
          break
        } else if (stored < current) {
          break
        }
      }
      if (isStillNewer) {
        setUpdateAvailable(storedUpdate)
      } else {
        // Clear stale cached update (user already updated past this version)
        localStorage.removeItem('updateAvailable')
      }
    }

    // Check on startup (with small delay to let app initialize)
    // Pass false to not show notification on startup - only show for new discoveries
    const startupCheck = setTimeout(() => {
      checkForUpdates(false)
    }, 2000)

    // Set interval for checks every 2 hours - these can show notifications
    const interval = setInterval(() => {
      checkForUpdates(true)
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

          {/* Update notification toggle */}
          <div className="settings-row">
            <span className="settings-label">Notify when update available</span>
            <label className="settings-toggle-mini">
              <input
                type="checkbox"
                checked={notifyUpdateEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked
                  setNotifyUpdateEnabled(enabled)
                  localStorage.setItem('notifyUpdateEnabled', enabled ? 'true' : 'false')
                }}
              />
              <span className="settings-toggle-slider-mini"></span>
            </label>
          </div>

          {/* Save position toggle - temporarily disabled due to coordinate issues
          <div className="settings-row">
            <span className="settings-label">Remember position</span>
            <label className="settings-toggle-mini">
              <input
                type="checkbox"
                checked={savePositionEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked
                  setSavePositionEnabled(enabled)
                  localStorage.setItem('savePositionEnabled', enabled ? 'true' : 'false')
                  if (!enabled) {
                    localStorage.removeItem('windowPosition')
                  }
                }}
              />
              <span className="settings-toggle-slider-mini"></span>
            </label>
          </div>
          */}
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

        <div id="support-development" className="about-panel-section">
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
            Licensed under <strong>GNU GPL-3.0-or-later</strong><br/>
            Free to use, modify, and distribute under GPL terms.
          </p>
          <p className="about-license-text about-license-publisher">
            Published by <strong>HPSC SAS</strong> · © 2026<br/>
            <span className="signpath-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M9 12l2 2 4-4"></path>
              </svg>
              Signed by SignPath Foundation
            </span>
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

  // Scroll to Support Development section (used when update is available)
  const scrollToSupportSection = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const supportSection = document.getElementById('support-development')
        if (supportSection) {
          supportSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100) // Small delay to ensure panel is rendered
    })
  }, [])

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

    // If update is available, scroll to Support Development section after panel renders
    if (updateAvailable) {
      scrollToSupportSection()
    }
  }, [viewMode, updateAvailable, scrollToSupportSection])

  // Toggle About panel (for expanded mode button)
  const toggleAbout = useCallback(() => {
    const willOpen = !showAbout
    setShowAbout(willOpen)

    // If opening and update is available, scroll to Support Development section
    if (willOpen && updateAvailable) {
      scrollToSupportSection()
    }
  }, [showAbout, updateAvailable, scrollToSupportSection])

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
    const anthropicUsage = providersUsage['anthropic'] || { percent: 0 }

    // Claude is configured if we have Claude Code token OR API key
    const isAnthropicConfigured = hasClaudeCodeToken || (anthropicProvider?.enabled && anthropicProvider?.has_api_key)
    // OpenAI is configured if we have an API key (use the state we track)
    const isOpenaiConfigured = hasOpenaiApiKey

    // Use Claude Code real data if available - this is the USED percentage
    const claudeUsedPercent = claudeCodeUsage?.success && claudeCodeUsage?.five_hour_percent !== null
      ? Math.round(claudeCodeUsage.five_hour_percent)
      : anthropicUsage.percent

    // For battery display: REMAINING percentage (100 = full, 0 = empty)
    const claudeRemainingPercent = 100 - claudeUsedPercent

    // Get subscription type for display name (Pro, Max, etc.)
    const claudeSubscriptionType = claudeCodeUsage?.subscription_type || null
    // Format display name: use custom name if set, else "Claude Max" or "Claude Pro" based on subscription_type
    const claudeDisplayName = customProviderNames['claude-pro-max']
      || (claudeSubscriptionType
        ? `Claude ${claudeSubscriptionType.charAt(0).toUpperCase() + claudeSubscriptionType.slice(1)}`
        : 'Claude Pro') // Default fallback

    // OpenAI: calculate remaining credits for battery display
    // IMPORTANT: $0/$0 (no credits, no limit) = EMPTY battery (0%)
    // For pay-as-you-go with no usage data or $0 limit: show empty
    // For hard limit: use remaining from limit
    const openaiUsageUsd = openaiUsage?.usage_usd ?? 0
    const openaiLimitUsd = openaiUsage?.limit_usd ?? 0

    const openaiRemainingPercent = openaiUsage?.success
      ? (openaiUsage.is_pay_as_you_go
        // Pay-as-you-go: if $0 usage AND $0 limit (not configured), show empty battery
        // Otherwise, estimate remaining based on $100 monthly budget
        ? (openaiLimitUsd === 0 && openaiUsageUsd === 0
          ? 0 // $0/$0 = empty battery
          : Math.max(0, 100 - Math.min(openaiUsageUsd * 1, 100))) // $100 budget = 1% per $1
        : (openaiLimitUsd > 0
          ? Math.max(0, 100 * (1 - openaiUsageUsd / openaiLimitUsd)) // Remaining = limit - usage
          : 0)) // No limit set = empty
      : 0 // If not loaded or error, show empty (safer than full)

    // For display text: show remaining / total format
    // Format: "$X.XX / $Y.XX" always (e.g., "$0.00 / $0.00", "$17.50 / $20.00")
    // No color coding needed - battery already shows the state
    const openaiRemainingDisplay = openaiUsage?.success
      ? (openaiUsage.is_pay_as_you_go
        // Pay-as-you-go: show remaining / total with 2 decimals
        // If limit is 0, show "spent / 0" (e.g., "$0.00 / $0.00")
        ? (openaiLimitUsd > 0
          ? `$${Math.max(0, openaiLimitUsd - openaiUsageUsd).toFixed(2)} / $${openaiLimitUsd.toFixed(2)}`
          : `$${openaiUsageUsd.toFixed(2)} / $0.00`) // Show "$0.00 / $0.00" when no credits
        : `${Math.round(100 - (openaiUsage.percent ?? 0))}%`) // Hard limit: show remaining%
      : '$0.00 / $0.00'

    // Format reset time for compact display - pass usage percent to detect waiting state
    const compactResetDisplay = claudeCodeUsage?.success && claudeCodeUsage?.five_hour_reset
      ? formatResetTime(claudeCodeUsage.five_hour_reset, claudeCodeUsage.five_hour_percent)
      : countdown

    // Get time progress for color calculation (0% = just started, 100% = about to reset)
    const timeProgressCompact = claudeCodeUsage?.success && claudeCodeUsage?.five_hour_reset
      ? getTimeProgress(claudeCodeUsage.five_hour_reset)
      : 0
    // Get color for timer based on time elapsed (red when far, blue when close to reset)
    const timerColorCompact = getTimeGradientColor(timeProgressCompact)

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
        {(enabledProviders['claude-pro-max'] || enabledProviders['openai-api']) && (
          <div className="banner-providers">
            {/* Claude/Anthropic - new compact 2-line layout */}
            {/* Line 1: Claude Pro/Max + Battery */}
            {/* Line 2: Timer icon + time + used% */}
            {enabledProviders['claude-pro-max'] && (
              <div
                className={`banner-provider-compact ${!isAnthropicConfigured ? 'disabled' : ''}`}
                title={isAnthropicConfigured ? `${claudeDisplayName}: ${claudeRemainingPercent}% remaining (5h) - Reset: ${compactResetDisplay}` : 'Claude: Not configured'}
              >
                <div className="provider-line-top">
                  <span className="provider-name">{claudeDisplayName}</span>
                  <Battery percent={claudeRemainingPercent} color="#d97706" disabled={!isAnthropicConfigured} uniqueId="claude-compact" />
                </div>
                {isAnthropicConfigured && (
                  <div
                    className={`provider-line-bottom ${compactResetDisplay === 'Waiting to start' ? 'waiting' : ''}`}
                    style={{ color: compactResetDisplay === 'Waiting to start' ? '#22F0B6' : timerColorCompact }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12,6 12,12 16,14"></polyline>
                    </svg>
                    <span className="provider-time">{compactResetDisplay}</span>
                    <span className="provider-remaining">{claudeRemainingPercent}%</span>
                  </div>
                )}
                {!isAnthropicConfigured && (
                  <div className="provider-line-bottom disabled">
                    <span className="provider-time">--</span>
                  </div>
                )}
              </div>
            )}

            {/* OpenAI - new compact 2-line layout */}
            {/* Line 1: OpenAI API + Battery */}
            {/* Line 2: Remaining credits ($X.XX / $Y.YY) */}
            {enabledProviders['openai-api'] && (
              <div
                className={`banner-provider-compact ${!isOpenaiConfigured ? 'disabled' : ''}`}
                title={isOpenaiConfigured
                  ? `${customProviderNames['openai-api'] || 'OpenAI API'}: ${openaiRemainingDisplay} remaining`
                  : `${customProviderNames['openai-api'] || 'OpenAI API'}: Not configured`}
              >
                <div className="provider-line-top">
                  <span className="provider-name">{customProviderNames['openai-api'] || 'OpenAI API'}</span>
                  <Battery
                    percent={openaiRemainingPercent}
                    color="#10a37f"
                    disabled={!isOpenaiConfigured}
                    uniqueId="openai-compact"
                  />
                </div>
                <div className="provider-line-bottom">
                  <span className="provider-remaining">{isOpenaiConfigured ? openaiRemainingDisplay : '--'}</span>
                </div>
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
    const anthropicUsageLocal = providersUsage['anthropic'] || { used: 0, limit: 100, percent: 0 }
    const openaiUsageLocal = providersUsage['openai'] || { used: 0, limit: 100, percent: 0 }

    // Check if Claude Code token is available (for real usage data)
    const isAnthropicConfigured = hasClaudeCodeToken || (anthropicProvider?.enabled && anthropicProvider?.has_api_key)
    // OpenAI is configured if we have an API key
    const isOpenaiConfigured = hasOpenaiApiKey

    // Use Claude Code real data if available - this is the USED percentage
    const claudeFiveHourUsedPercent = claudeCodeUsage?.five_hour_percent ?? anthropicUsageLocal.percent
    const claudeSevenDayPercent = claudeCodeUsage?.seven_day_percent
    const claudeSevenDayReset = claudeCodeUsage?.seven_day_reset

    // For battery: REMAINING percentage (100 = full, 0 = empty)
    const claudeFiveHourRemainingPercent = 100 - claudeFiveHourUsedPercent

    // Get subscription type for display name (Pro, Max, etc.)
    const claudeSubscriptionTypeExpanded = claudeCodeUsage?.subscription_type || null
    // Format display name: use custom name if set, else "Claude Max" or "Claude Pro" based on subscription_type
    const claudeDisplayNameExpanded = customProviderNames['claude-pro-max']
      || (claudeSubscriptionTypeExpanded
        ? `Claude ${claudeSubscriptionTypeExpanded.charAt(0).toUpperCase() + claudeSubscriptionTypeExpanded.slice(1)}`
        : 'Claude Pro') // Default fallback

    // OpenAI: calculate remaining credits for battery display
    // IMPORTANT: $0/$0 (no credits, no limit) = EMPTY battery (0%)
    const openaiUsageUsdExpanded = openaiUsage?.usage_usd ?? 0
    const openaiLimitUsdExpanded = openaiUsage?.limit_usd ?? 0

    const openaiRemainingPercentExpanded = openaiUsage?.success
      ? (openaiUsage.is_pay_as_you_go
        // Pay-as-you-go: if $0 usage AND $0 limit (not configured), show empty battery
        ? (openaiLimitUsdExpanded === 0 && openaiUsageUsdExpanded === 0
          ? 0 // $0/$0 = empty battery
          : Math.max(0, 100 - Math.min(openaiUsageUsdExpanded * 1, 100))) // $100 budget = 1% per $1
        : (openaiLimitUsdExpanded > 0
          ? Math.max(0, 100 * (1 - openaiUsageUsdExpanded / openaiLimitUsdExpanded))
          : 0)) // No limit set = empty
      : 0 // If not loaded or error, show empty

    // For display text: show remaining / total format
    // Format: "$X.XX / $Y.XX" always (e.g., "$0.00 / $0.00", "$17.50 / $20.00")
    const openaiRemainingDisplayExpanded = openaiUsage?.success
      ? (openaiUsage.is_pay_as_you_go
        // Pay-as-you-go: show remaining / total with 2 decimals
        ? (openaiLimitUsdExpanded > 0
          ? `$${Math.max(0, openaiLimitUsdExpanded - openaiUsageUsdExpanded).toFixed(2)} / $${openaiLimitUsdExpanded.toFixed(2)}`
          : `$${openaiUsageUsdExpanded.toFixed(2)} / $0.00`) // Show "$0.00 / $0.00" when no credits
        : `${Math.round(100 - (openaiUsage.percent ?? 0))}%`) // Hard limit: show remaining%
      : '$0.00 / $0.00'

    // Get time progress for color calculation (0% = just started, 100% = about to reset)
    const timeProgressExpanded = claudeCodeUsage?.success && claudeCodeUsage?.five_hour_reset
      ? getTimeProgress(claudeCodeUsage.five_hour_reset)
      : 0
    // Get color for timer based on time elapsed (red when far, blue when close to reset)
    const timerColorExpanded = getTimeGradientColor(timeProgressExpanded)

    // Filter providers based on category and search
    const filteredProviders = AI_PROVIDERS.filter(p => {
      const isEnabled = enabledProviders[p.id] ?? false
      let matchesCategory = false
      if (categoryFilter === 'all') {
        matchesCategory = true
      } else if (categoryFilter === 'available') {
        matchesCategory = isEnabled
      } else {
        matchesCategory = p.category === categoryFilter
      }
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
          tokenStatus={tokenStatus}
          setTokenStatus={setTokenStatus}
          customProviderNames={customProviderNames}
          setCustomProviderNames={setCustomProviderNames}
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
          {(enabledProviders['claude-pro-max'] || enabledProviders['openai-api']) && (
            <div className="banner-providers">
              {/* Claude/Anthropic - new compact 2-line layout */}
              {enabledProviders['claude-pro-max'] && (
                <div
                  className={`banner-provider-compact ${!isAnthropicConfigured ? 'disabled' : ''}`}
                  title={isAnthropicConfigured ? `${claudeDisplayNameExpanded}: ${Math.round(claudeFiveHourRemainingPercent)}% remaining (5h)` : 'Claude: Not configured'}
                >
                  <div className="provider-line-top">
                    <span className="provider-name">{claudeDisplayNameExpanded}</span>
                    <Battery percent={claudeFiveHourRemainingPercent} color="#d97706" disabled={!isAnthropicConfigured} uniqueId="claude-expanded" />
                  </div>
                  {isAnthropicConfigured && (
                    <div
                      className={`provider-line-bottom ${!isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? 'waiting' : ''}`}
                      style={{ color: !isClaudeSessionActive(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent) ? '#22F0B6' : timerColorExpanded }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12,6 12,12 16,14"></polyline>
                      </svg>
                      <span className="provider-time">{formatResetTime(claudeCodeUsage?.five_hour_reset, claudeCodeUsage?.five_hour_percent)}</span>
                      <span className="provider-remaining">{Math.round(claudeFiveHourRemainingPercent)}%</span>
                    </div>
                  )}
                  {!isAnthropicConfigured && (
                    <div className="provider-line-bottom disabled">
                      <span className="provider-time">--</span>
                    </div>
                  )}
                </div>
              )}
              {/* OpenAI - new compact 2-line layout */}
              {enabledProviders['openai-api'] && (
                <div
                  className={`banner-provider-compact ${!isOpenaiConfigured ? 'disabled' : ''}`}
                  title={isOpenaiConfigured ? `${customProviderNames['openai-api'] || 'OpenAI API'}: ${openaiRemainingDisplayExpanded}` : `${customProviderNames['openai-api'] || 'OpenAI API'}: Not configured`}
                >
                  <div className="provider-line-top">
                    <span className="provider-name">{customProviderNames['openai-api'] || 'OpenAI API'}</span>
                    <Battery
                      percent={openaiRemainingPercentExpanded}
                      color="#10a37f"
                      disabled={!isOpenaiConfigured}
                      uniqueId="openai-expanded"
                    />
                  </div>
                  <div className="provider-line-bottom">
                    <span className="provider-remaining">{isOpenaiConfigured ? openaiRemainingDisplayExpanded : '--'}</span>
                  </div>
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
            <button className={`banner-btn about-btn ${updateAvailable ? 'has-update' : ''} ${showAbout ? 'active' : ''}`} onClick={toggleAbout} title="About">
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
        <div className={`expanded-content ${isCollapsing ? 'collapsing' : ''} ${hasAnimatedExpand ? 'no-animation' : ''}`}>
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
              className={`category-filter-pill ${categoryFilter === 'available' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('available')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              Available
            </div>
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
              const categoryProviders = filteredProviders
                .filter(p => p.category === category)
                // Sort enabled providers first
                .sort((a, b) => {
                  const aEnabled = enabledProviders[a.id] ?? false
                  const bEnabled = enabledProviders[b.id] ?? false
                  if (aEnabled && !bEnabled) return -1
                  if (!aEnabled && bEnabled) return 1
                  return 0
                })
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

                    // Used percentage for display text
                    const usedPercent = isClaudeWithRealData
                      ? Math.round(claudeFiveHourUsedPercent ?? 0)
                      : provUsage.percent

                    // Remaining percentage for progress bar (inverted: 100 = full, 0 = empty)
                    const remainingPercent = 100 - usedPercent

                    const isOpenAIProvider = providerId === 'openai-api'
                    const isOpenAIWithApiKey = isOpenAIProvider && hasOpenaiApiKey

                    const refreshProvider = async () => {
                      setRefreshingProvider(providerId)
                      try {
                        if (isClaudeProvider && hasClaudeCodeToken) {
                          await refreshClaudeCodeUsage()
                        } else if (isOpenAIProvider && hasOpenaiApiKey) {
                          await refreshOpenAIUsage()
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
                              <span className="expanded-usage-badge badge-5h">5h: {Math.round(claudeFiveHourUsedPercent)}%</span>
                              {claudeSevenDayPercent !== undefined && claudeSevenDayPercent !== null && (
                                <span className="expanded-usage-badge badge-7d">
                                  7d: {Math.round(claudeSevenDayPercent)}%
                                  {formatSevenDayReset(claudeSevenDayReset) && (
                                    <span className="reset-info"> · Reset in {formatSevenDayReset(claudeSevenDayReset)}</span>
                                  )}
                                </span>
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
                                    width: `${Math.min(remainingPercent, 100)}%`,
                                    background: getUsageGradientStyle(remainingPercent, providerId)
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

                    // Full detailed card for OpenAI with API key
                    const isOpenAIWithRealData = isOpenAIProvider && hasOpenaiApiKey && isEnabled
                    // Used/remaining amounts for display
                    const openaiUsedUsdCard = openaiUsage?.usage_usd ?? 0
                    const openaiLimitUsdCard = openaiUsage?.limit_usd ?? 0
                    // Remaining percentage for progress bar (inverted: 100 = full, 0 = empty)
                    // IMPORTANT: $0/$0 = EMPTY battery
                    const openaiRemainingPercentCard = openaiUsage?.success
                      ? (openaiUsage.is_pay_as_you_go
                        // Pay-as-you-go: if $0 limit and $0 usage = empty battery
                        ? (openaiLimitUsdCard === 0 && openaiUsedUsdCard === 0
                          ? 0 // $0/$0 = empty battery
                          : Math.max(0, 100 - Math.min(openaiUsedUsdCard * 1, 100))) // $100 budget
                        : (openaiLimitUsdCard > 0
                          ? Math.max(0, 100 * (1 - openaiUsedUsdCard / openaiLimitUsdCard))
                          : 0)) // No limit = empty
                      : 0 // Not loaded = empty (safer)

                    if (isOpenAIWithRealData) {
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
                              {openaiUsage?.success ? (
                                openaiUsage.is_pay_as_you_go ? (
                                  <span className="expanded-usage-badge badge-openai">
                                    ${(openaiUsage.usage_usd ?? 0).toFixed(2)} (Pay as you go)
                                  </span>
                                ) : (
                                  <span className="expanded-usage-badge badge-openai">
                                    ${(openaiUsage.usage_usd ?? 0).toFixed(2)} / ${openaiUsage.limit_usd?.toFixed(2) ?? '∞'}
                                  </span>
                                )
                              ) : openaiUsage?.error ? (
                                <span className="expanded-usage-badge badge-openai badge-error" title={openaiUsage.error}>
                                  Error
                                </span>
                              ) : (
                                <span className="expanded-usage-badge badge-openai">Loading...</span>
                              )}
                            </div>
                            <div className="expanded-usage-row">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                              </svg>
                              <div className="expanded-usage-bar-container">
                                {/* Show minimum red bar (3%) when empty to indicate no credits */}
                                {openaiRemainingPercentCard <= 0 ? (
                                  <div
                                    className="expanded-usage-bar-fill empty"
                                    style={{
                                      width: '3%',
                                      background: '#ef4444' // Red for empty
                                    }}
                                  />
                                ) : (
                                  <div
                                    className="expanded-usage-bar-fill"
                                    style={{
                                      width: `${Math.min(openaiRemainingPercentCard, 100)}%`,
                                      background: getUsageGradientStyle(openaiRemainingPercentCard, providerId)
                                    }}
                                  />
                                )}
                              </div>
                              {/* No redundant value display - already shown in badge above */}
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // Mini card for other providers
                    // Only 'available' status providers are fully configured
                    const isAvailable = providerDef.trackingStatus === 'available'
                    const statusBadge = TRACKING_STATUS_INFO[providerDef.trackingStatus]

                    return (
                      <div
                        key={providerId}
                        className={`provider-card-mini ${!isEnabled ? 'disabled' : ''} ${isConfigured ? 'configured' : ''} ${!isAvailable ? 'coming-soon' : ''}`}
                        onClick={() => isAvailable && setProviderSettingsOpen(providerId)}
                      >
                        <label
                          className={`expanded-toggle-mini provider-card-mini-toggle ${!isAvailable ? 'disabled' : ''} ${isAvailable && !isEnabled ? 'activable' : ''}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            disabled={!isAvailable}
                            onChange={(e) => {
                              if (isAvailable) {
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
                          {!isAvailable ? (
                            <span
                              className="version-badge tracking-status"
                              style={{ color: statusBadge.color, background: statusBadge.bgColor }}
                            >
                              {statusBadge.label}
                            </span>
                          ) : isEnabled && isConfigured ? (
                            <span className="provider-card-mini-percent">{remainingPercent}%</span>
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
