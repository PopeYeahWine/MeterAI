import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { appWindow } from '@tauri-apps/api/window'

interface UsageData {
  used: number
  limit: number
  percent: number
  resetTime: number // timestamp en secondes
  history: HistoryEntry[]
}

interface HistoryEntry {
  time: string
  used: number
  limit: number
}

interface Settings {
  limit: number
  alertThresholds: number[]
  resetIntervalHours: number
}

function App() {
  const [usage, setUsage] = useState<UsageData>({
    used: 0,
    limit: 100,
    percent: 0,
    resetTime: Date.now() / 1000 + 4 * 3600,
    history: []
  })
  const [countdown, setCountdown] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<Settings>({
    limit: 100,
    alertThresholds: [70, 90, 100],
    resetIntervalHours: 4
  })

  // Charger les données au démarrage
  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await invoke<UsageData>('get_usage')
        setUsage(data)
        const savedSettings = await invoke<Settings>('get_settings')
        setSettings(savedSettings)
      } catch (e) {
        console.log('Backend not ready, using defaults')
      }
    }
    loadData()

    // Écouter les mises à jour du backend
    const unlisten = listen<UsageData>('usage-updated', (event) => {
      setUsage(event.payload)
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // Compte à rebours
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

  // Ajouter une requête manuellement
  const addRequest = useCallback(async (count: number = 1) => {
    try {
      await invoke('add_request', { count })
    } catch (e) {
      // Mode standalone: mise à jour locale
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

  // Reset manuel
  const resetUsage = useCallback(async () => {
    try {
      await invoke('reset_usage')
    } catch (e) {
      setUsage(prev => ({
        ...prev,
        used: 0,
        percent: 0,
        resetTime: Date.now() / 1000 + settings.resetIntervalHours * 3600,
        history: [
          { time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), used: prev.used, limit: prev.limit },
          ...prev.history.slice(0, 5)
        ]
      }))
    }
  }, [settings.resetIntervalHours])

  // Sauvegarder les paramètres
  const saveSettings = useCallback(async () => {
    try {
      await invoke('save_settings', { settings })
      setUsage(prev => ({ ...prev, limit: settings.limit }))
    } catch (e) {
      setUsage(prev => ({ ...prev, limit: settings.limit }))
    }
    setShowSettings(false)
  }, [settings])

  // Minimiser dans le tray
  const minimizeToTray = useCallback(async () => {
    try {
      await appWindow.hide()
    } catch (e) {
      console.log('Tray not available')
    }
  }, [])

  // Couleur selon le pourcentage
  const getColor = (percent: number) => {
    if (percent >= 90) return 'red'
    if (percent >= 70) return 'yellow'
    return 'green'
  }

  const color = getColor(usage.percent)

  return (
    <div className="widget-container">
      {/* Header avec drag */}
      <div className="widget-header" data-tauri-drag-region>
        <div className="widget-title">
          <span className="logo">C</span>
          Claude Usage
        </div>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Paramètres"
          >
            ⚙
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

      {/* Section principale */}
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

      {/* Stats rapides */}
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

      {/* Boutons d'action rapide */}
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

      {/* Toggle détails */}
      <div
        className={`expand-toggle ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="arrow">▼</span>
        {expanded ? 'Masquer' : 'Historique'}
      </div>

      {/* Détails extensibles */}
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

      {/* Panneau de paramètres */}
      {showSettings && (
        <div className="settings-panel">
          <div className="settings-title">Paramètres</div>

          <div className="setting-row">
            <span className="setting-label">Limite par période</span>
            <input
              type="number"
              className="setting-input"
              value={settings.limit}
              onChange={(e) => setSettings(s => ({ ...s, limit: parseInt(e.target.value) || 100 }))}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">Période de reset (heures)</span>
            <input
              type="number"
              className="setting-input"
              value={settings.resetIntervalHours}
              onChange={(e) => setSettings(s => ({ ...s, resetIntervalHours: parseInt(e.target.value) || 4 }))}
            />
          </div>

          <div className="setting-row">
            <span className="setting-label">Alertes à (%)</span>
            <input
              type="text"
              className="setting-input"
              style={{ width: '120px' }}
              value={settings.alertThresholds.join(', ')}
              onChange={(e) => {
                const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v))
                setSettings(s => ({ ...s, alertThresholds: vals }))
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button className="btn btn-primary" onClick={saveSettings}>
              Enregistrer
            </button>
            <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
