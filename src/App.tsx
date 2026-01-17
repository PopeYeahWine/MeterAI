import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { appWindow } from '@tauri-apps/api/window'

type ProviderType = 'manual' | 'anthropic' | 'openai'

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
}

type ViewMode = 'main' | 'settings' | 'providers'

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
  const [countdown, setCountdown] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [activeProvider, setActiveProvider] = useState('manual')
  const [editingProvider, setEditingProvider] = useState<string | null>(null)

  // Provider config form state
  const [configForm, setConfigForm] = useState({
    apiKey: '',
    limit: 100,
    alertThresholds: '70, 90, 100',
    resetIntervalHours: 4,
    enabled: true
  })

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
      } catch (e) {
        console.log('Backend not ready, using defaults')
      }
    }
    loadData()

    const unlisten = listen<UsageData>('usage-updated', (event) => {
      setUsage(event.payload)
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
        setCountdown('Reset en cours...')
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
          { time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), used: prev.used, limit: prev.limit },
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
      setViewMode('providers')
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

  const minimizeToTray = useCallback(async () => {
    try {
      await appWindow.hide()
    } catch (e) {
      console.log('Tray not available')
    }
  }, [])

  const getColor = (percent: number) => {
    if (percent >= 90) return 'red'
    if (percent >= 70) return 'yellow'
    return 'green'
  }

  const getProviderIcon = (type: ProviderType) => {
    switch (type) {
      case 'anthropic': return 'C'
      case 'openai': return 'O'
      default: return 'M'
    }
  }

  const getProviderColor = (type: ProviderType) => {
    switch (type) {
      case 'anthropic': return '#d97706'
      case 'openai': return '#10a37f'
      default: return '#6366f1'
    }
  }

  const color = getColor(usage.percent)

  // Provider config view
  if (editingProvider) {
    const provider = providers.find(p => p.provider_type === editingProvider)
    return (
      <div className="widget-container">
        <div className="widget-header" data-tauri-drag-region>
          <div className="widget-title">
            <span className="logo" style={{ background: getProviderColor(editingProvider as ProviderType) }}>
              {getProviderIcon(editingProvider as ProviderType)}
            </span>
            Configurer {provider?.name || editingProvider}
          </div>
          <div className="header-actions">
            <button className="header-btn" onClick={() => setEditingProvider(null)} title="Retour">
              ←
            </button>
          </div>
        </div>

        <div className="settings-panel" style={{ borderTop: 'none' }}>
          {editingProvider !== 'manual' && (
            <div className="setting-row">
              <span className="setting-label">Clé API</span>
              <input
                type="password"
                className="setting-input"
                style={{ width: '160px' }}
                placeholder={provider?.has_api_key ? '••••••••' : 'Entrer la clé'}
                value={configForm.apiKey}
                onChange={(e) => setConfigForm(f => ({ ...f, apiKey: e.target.value }))}
              />
            </div>
          )}

          {editingProvider !== 'manual' && provider?.has_api_key && (
            <div style={{ marginBottom: '12px' }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 8px' }}
                onClick={() => removeApiKey(editingProvider)}
              >
                Supprimer la clé
              </button>
            </div>
          )}

          <div className="setting-row">
            <span className="setting-label">Activé</span>
            <input
              type="checkbox"
              checked={configForm.enabled}
              onChange={(e) => setConfigForm(f => ({ ...f, enabled: e.target.checked }))}
              style={{ width: 'auto' }}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">Limite par période</span>
            <input
              type="number"
              className="setting-input"
              value={configForm.limit}
              onChange={(e) => setConfigForm(f => ({ ...f, limit: parseInt(e.target.value) || 100 }))}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">Période de reset (h)</span>
            <input
              type="number"
              className="setting-input"
              value={configForm.resetIntervalHours}
              onChange={(e) => setConfigForm(f => ({ ...f, resetIntervalHours: parseInt(e.target.value) || 4 }))}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">Alertes (%)</span>
            <input
              type="text"
              className="setting-input"
              style={{ width: '120px' }}
              value={configForm.alertThresholds}
              onChange={(e) => setConfigForm(f => ({ ...f, alertThresholds: e.target.value }))}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button className="btn btn-primary" onClick={saveProviderConfig}>
              Enregistrer
            </button>
            <button className="btn btn-secondary" onClick={() => setEditingProvider(null)}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Providers list view
  if (viewMode === 'providers') {
    return (
      <div className="widget-container">
        <div className="widget-header" data-tauri-drag-region>
          <div className="widget-title">
            <span className="logo" style={{ background: '#6366f1' }}>⚡</span>
            Providers
          </div>
          <div className="header-actions">
            <button className="header-btn" onClick={() => setViewMode('main')} title="Retour">
              ←
            </button>
            <button className="header-btn" onClick={minimizeToTray} title="Réduire">
              _
            </button>
          </div>
        </div>

        <div className="providers-list">
          {providers.map((provider) => {
            const providerId = provider.provider_type
            const isActive = activeProvider === providerId
            return (
              <div
                key={providerId}
                className={`provider-item ${isActive ? 'active' : ''} ${!provider.enabled ? 'disabled' : ''}`}
              >
                <div className="provider-info" onClick={() => provider.enabled && switchProvider(providerId)}>
                  <span
                    className="provider-icon"
                    style={{ background: getProviderColor(provider.provider_type) }}
                  >
                    {getProviderIcon(provider.provider_type)}
                  </span>
                  <div className="provider-details">
                    <span className="provider-name">{provider.name}</span>
                    <span className="provider-status">
                      {!provider.enabled ? 'Désactivé' :
                        provider.provider_type !== 'manual' && !provider.has_api_key ? 'Clé manquante' :
                        isActive ? 'Actif' : 'Prêt'}
                    </span>
                  </div>
                </div>
                <button
                  className="header-btn"
                  onClick={() => openProviderConfig(providerId)}
                  title="Configurer"
                >
                  ⚙
                </button>
              </div>
            )
          })}
        </div>

        <div className="provider-hint">
          Cliquez sur un provider pour le sélectionner, ou sur ⚙ pour le configurer.
        </div>
      </div>
    )
  }

  // Main view
  return (
    <div className="widget-container">
      <div className="widget-header" data-tauri-drag-region>
        <div className="widget-title">
          <span className="logo" style={{ background: getProviderColor(usage.providerType) }}>
            {getProviderIcon(usage.providerType)}
          </span>
          {usage.providerName || 'MeterAI'}
        </div>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={() => setViewMode('providers')}
            title="Providers"
          >
            ⚡
          </button>
          <button
            className="header-btn"
            onClick={minimizeToTray}
            title="Réduire dans le tray"
          >
            _
          </button>
        </div>
      </div>

      <div className="progress-section">
        <div className="progress-header">
          <span className={`usage-percent ${color}`}>{usage.percent}%</span>
          <div className="reset-timer">
            Reset dans <span className="time">{countdown}</span>
          </div>
        </div>

        <div className="progress-bar-container">
          <div
            className={`progress-bar ${color}`}
            style={{ width: `${Math.min(usage.percent, 100)}%` }}
          />
        </div>

        <div className="usage-text">
          <span>{usage.used} utilisé(s)</span>
          <span>{usage.limit - usage.used} restant(s)</span>
        </div>
      </div>

      <div className="quick-stats">
        <div className="stat-item">
          <span className="stat-label">Cette période</span>
          <span className="stat-value">{usage.used}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Limite</span>
          <span className="stat-value">{usage.limit}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Disponible</span>
          <span className="stat-value">{usage.limit - usage.used}</span>
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
        <button className="btn btn-primary" onClick={() => addRequest(1)}>
          +1 Requête
        </button>
        <button className="btn btn-secondary" onClick={() => addRequest(5)}>
          +5
        </button>
        <button className="btn btn-secondary" onClick={resetUsage}>
          ↻ Reset
        </button>
      </div>

      <div
        className={`expand-toggle ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="arrow">▼</span>
        {expanded ? 'Masquer' : 'Historique'}
      </div>

      <div className={`details-section ${expanded ? 'expanded' : ''}`}>
        <div className="details-content">
          <div className="details-title">Historique des resets</div>
          <div className="history-list">
            {usage.history.length === 0 ? (
              <div className="history-item">
                <span className="history-time">Aucun historique</span>
              </div>
            ) : (
              usage.history.map((entry, i) => (
                <div key={i} className="history-item">
                  <span className="history-time">{entry.time}</span>
                  <span className="history-value">{entry.used} / {entry.limit}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
