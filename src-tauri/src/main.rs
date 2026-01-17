#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use chrono::{Local, Utc};
use notify_rust::Notification;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
    Window,
};
use thiserror::Error;

// ============== ERROR HANDLING ==============

#[derive(Error, Debug)]
pub enum AppError {
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Configuration error: {0}")]
    ConfigError(String),
    #[error("Keyring error: {0}")]
    KeyringError(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============== PROVIDER TYPES ==============

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    Manual,
    Anthropic,
    OpenAI,
}

impl Default for ProviderType {
    fn default() -> Self {
        ProviderType::Manual
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider_type: ProviderType,
    pub name: String,
    pub enabled: bool,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    pub has_api_key: bool,
    pub limit: u32,
    #[serde(rename = "alertThresholds")]
    pub alert_thresholds: Vec<u32>,
    #[serde(rename = "resetIntervalHours")]
    pub reset_interval_hours: u32,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider_type: ProviderType::Manual,
            name: "Manual".to_string(),
            enabled: true,
            api_key: None,
            has_api_key: false,
            limit: 100,
            alert_thresholds: vec![70, 90, 100],
            reset_interval_hours: 4,
        }
    }
}

// ============== DATA STRUCTURES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    pub used: u32,
    pub limit: u32,
    pub percent: u32,
    #[serde(rename = "resetTime")]
    pub reset_time: i64,
    pub history: Vec<HistoryEntry>,
    #[serde(rename = "providerType")]
    pub provider_type: ProviderType,
    #[serde(rename = "providerName")]
    pub provider_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub time: String,
    pub used: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub usage: UsageData,
    pub config: ProviderConfig,
    #[serde(skip)]
    pub notified_thresholds: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub providers: HashMap<String, ProviderUsage>,
    #[serde(rename = "activeProvider")]
    pub active_provider: String,
}

impl Default for AppState {
    fn default() -> Self {
        let mut providers = HashMap::new();
        let reset_interval = 4 * 3600;

        // Default manual provider
        providers.insert(
            "manual".to_string(),
            ProviderUsage {
                usage: UsageData {
                    used: 0,
                    limit: 100,
                    percent: 0,
                    reset_time: Utc::now().timestamp() + reset_interval,
                    history: vec![],
                    provider_type: ProviderType::Manual,
                    provider_name: "Manual".to_string(),
                },
                config: ProviderConfig::default(),
                notified_thresholds: vec![],
            },
        );

        // Anthropic provider (disabled by default)
        providers.insert(
            "anthropic".to_string(),
            ProviderUsage {
                usage: UsageData {
                    used: 0,
                    limit: 100,
                    percent: 0,
                    reset_time: Utc::now().timestamp() + reset_interval,
                    history: vec![],
                    provider_type: ProviderType::Anthropic,
                    provider_name: "Anthropic (Claude)".to_string(),
                },
                config: ProviderConfig {
                    provider_type: ProviderType::Anthropic,
                    name: "Anthropic (Claude)".to_string(),
                    enabled: false,
                    api_key: None,
                    has_api_key: false,
                    limit: 100,
                    alert_thresholds: vec![70, 90, 100],
                    reset_interval_hours: 4,
                },
                notified_thresholds: vec![],
            },
        );

        // OpenAI provider (disabled by default)
        providers.insert(
            "openai".to_string(),
            ProviderUsage {
                usage: UsageData {
                    used: 0,
                    limit: 100,
                    percent: 0,
                    reset_time: Utc::now().timestamp() + reset_interval,
                    history: vec![],
                    provider_type: ProviderType::OpenAI,
                    provider_name: "OpenAI (ChatGPT)".to_string(),
                },
                config: ProviderConfig {
                    provider_type: ProviderType::OpenAI,
                    name: "OpenAI (ChatGPT)".to_string(),
                    enabled: false,
                    api_key: None,
                    has_api_key: false,
                    limit: 100,
                    alert_thresholds: vec![70, 90, 100],
                    reset_interval_hours: 4,
                },
                notified_thresholds: vec![],
            },
        );

        Self {
            providers,
            active_provider: "manual".to_string(),
        }
    }
}

// ============== PERSISTENCE ==============

fn get_data_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("meter-ai");
    fs::create_dir_all(&path).ok();
    path.push("data.json");
    path
}

fn load_state() -> AppState {
    let path = get_data_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut state) = serde_json::from_str::<AppState>(&content) {
                // Load API keys from secure storage
                for (provider_id, provider) in state.providers.iter_mut() {
                    if let Ok(entry) = keyring::Entry::new("meter-ai", provider_id) {
                        if let Ok(key) = entry.get_password() {
                            provider.config.api_key = Some(key);
                            provider.config.has_api_key = true;
                        }
                    }
                }
                return state;
            }
        }
    }
    AppState::default()
}

fn save_state(state: &AppState) {
    let path = get_data_path();
    if let Ok(json) = serde_json::to_string_pretty(state) {
        fs::write(path, json).ok();
    }
}

// ============== SECURE API KEY STORAGE ==============

fn save_api_key(provider_id: &str, api_key: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new("meter-ai", provider_id)
        .map_err(|e| AppError::KeyringError(e.to_string()))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::KeyringError(e.to_string()))?;
    Ok(())
}

fn delete_api_key(provider_id: &str) -> Result<(), AppError> {
    if let Ok(entry) = keyring::Entry::new("meter-ai", provider_id) {
        entry.delete_password().ok();
    }
    Ok(())
}

// ============== CLAUDE CODE OAUTH INTEGRATION ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeOAuthData {
    #[serde(rename = "accessToken")]
    pub access_token: Option<String>,
    #[serde(rename = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<i64>,
    #[serde(rename = "subscriptionType")]
    pub subscription_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeCredentials {
    // New nested format: { "claudeAiOauth": { "accessToken": "..." } }
    #[serde(rename = "claudeAiOauth")]
    pub claude_ai_oauth: Option<ClaudeOAuthData>,
    // Legacy flat format: { "accessToken": "..." }
    #[serde(rename = "accessToken")]
    pub access_token: Option<String>,
    #[serde(rename = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeUsageWindow {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeUsageResponse {
    pub five_hour: Option<ClaudeUsageWindow>,
    pub seven_day: Option<ClaudeUsageWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeUsageResult {
    pub success: bool,
    pub error: Option<String>,
    pub five_hour_percent: Option<f64>,
    pub five_hour_reset: Option<String>,
    pub seven_day_percent: Option<f64>,
    pub seven_day_reset: Option<String>,
}

/// Extract token from ClaudeCodeCredentials (handles both nested and flat format)
fn extract_token_from_creds(creds: &ClaudeCodeCredentials) -> Option<String> {
    // Try nested format first: { "claudeAiOauth": { "accessToken": "..." } }
    if let Some(ref oauth) = creds.claude_ai_oauth {
        if let Some(ref token) = oauth.access_token {
            if !token.is_empty() {
                return Some(token.clone());
            }
        }
    }
    // Fall back to flat format: { "accessToken": "..." }
    if let Some(ref token) = creds.access_token {
        if !token.is_empty() {
            return Some(token.clone());
        }
    }
    None
}

/// Get Claude Code OAuth token from various sources
fn get_claude_code_oauth_token() -> Option<String> {
    // 1. Check environment variable first
    if let Ok(token) = env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }

    // 2. Check ~/.claude/.credentials.json (primary location for Claude Code)
    if let Some(home) = dirs::home_dir() {
        let credentials_path = home.join(".claude").join(".credentials.json");
        if credentials_path.exists() {
            if let Ok(content) = fs::read_to_string(&credentials_path) {
                if let Ok(creds) = serde_json::from_str::<ClaudeCodeCredentials>(&content) {
                    if let Some(token) = extract_token_from_creds(&creds) {
                        return Some(token);
                    }
                }
            }
        }

        // Also try credentials.json without the dot prefix
        let credentials_path_alt = home.join(".claude").join("credentials.json");
        if credentials_path_alt.exists() {
            if let Ok(content) = fs::read_to_string(&credentials_path_alt) {
                if let Ok(creds) = serde_json::from_str::<ClaudeCodeCredentials>(&content) {
                    if let Some(token) = extract_token_from_creds(&creds) {
                        return Some(token);
                    }
                }
            }
        }
    }

    // 3. Check ~/.config/claude-code/auth.json (alternative CLI location)
    if let Some(home) = dirs::home_dir() {
        let auth_path = home.join(".config").join("claude-code").join("auth.json");
        if auth_path.exists() {
            if let Ok(content) = fs::read_to_string(&auth_path) {
                if let Ok(creds) = serde_json::from_str::<ClaudeCodeCredentials>(&content) {
                    if let Some(token) = extract_token_from_creds(&creds) {
                        return Some(token);
                    }
                }
            }
        }
    }

    None
}

/// Fetch usage from Claude Code OAuth API
async fn fetch_claude_code_usage(token: &str) -> Result<ClaudeUsageResponse, AppError> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "claude-code/2.0.32")
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| AppError::NetworkError(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::ApiError(format!(
            "API returned {}: {}",
            status, body
        )));
    }

    let usage: ClaudeUsageResponse = response
        .json()
        .await
        .map_err(|e| AppError::ApiError(format!("Failed to parse response: {}", e)))?;

    Ok(usage)
}

// ============== NOTIFICATIONS ==============

fn send_notification(title: &str, body: &str) {
    Notification::new()
        .summary(title)
        .body(body)
        .appname("MeterAI")
        .timeout(5000)
        .show()
        .ok();
}

fn check_and_notify(provider: &mut ProviderUsage) {
    let percent = provider.usage.percent;

    for threshold in &provider.config.alert_thresholds {
        if percent >= *threshold && !provider.notified_thresholds.contains(threshold) {
            provider.notified_thresholds.push(*threshold);

            let provider_name = &provider.config.name;
            let (title, body) = if *threshold >= 100 {
                (
                    format!("⚠️ {} - Limite atteinte!", provider_name),
                    "Vous avez utilisé 100% de votre quota.".to_string(),
                )
            } else {
                (
                    format!("⚡ {} - {}%", provider_name, threshold),
                    format!(
                        "Vous avez utilisé {} requêtes sur {}.",
                        provider.usage.used, provider.usage.limit
                    ),
                )
            };

            send_notification(&title, &body);
        }
    }
}

// ============== COMMANDS ==============

#[tauri::command]
fn get_usage(state: tauri::State<Mutex<AppState>>) -> UsageData {
    let state = state.lock().unwrap();
    let active = &state.active_provider;
    state
        .providers
        .get(active)
        .map(|p| p.usage.clone())
        .unwrap_or_else(|| UsageData {
            used: 0,
            limit: 100,
            percent: 0,
            reset_time: Utc::now().timestamp() + 4 * 3600,
            history: vec![],
            provider_type: ProviderType::Manual,
            provider_name: "Manual".to_string(),
        })
}

#[tauri::command]
fn get_all_providers(state: tauri::State<Mutex<AppState>>) -> Vec<ProviderConfig> {
    let state = state.lock().unwrap();
    state
        .providers
        .values()
        .map(|p| {
            let mut config = p.config.clone();
            config.api_key = None; // Never send API keys to frontend
            config
        })
        .collect()
}

#[tauri::command]
fn get_active_provider(state: tauri::State<Mutex<AppState>>) -> String {
    let state = state.lock().unwrap();
    state.active_provider.clone()
}

#[tauri::command]
fn set_active_provider(
    provider_id: String,
    state: tauri::State<Mutex<AppState>>,
    window: Window,
) -> Result<(), AppError> {
    let mut state = state.lock().unwrap();
    if state.providers.contains_key(&provider_id) {
        state.active_provider = provider_id.clone();
        save_state(&state);
        if let Some(provider) = state.providers.get(&provider_id) {
            window.emit("usage-updated", provider.usage.clone()).ok();
        }
        Ok(())
    } else {
        Err(AppError::ConfigError("Provider not found".to_string()))
    }
}

#[tauri::command]
fn configure_provider(
    provider_id: String,
    api_key: Option<String>,
    limit: u32,
    alert_thresholds: Vec<u32>,
    reset_interval_hours: u32,
    enabled: bool,
    state: tauri::State<Mutex<AppState>>,
    window: Window,
) -> Result<(), AppError> {
    let mut state = state.lock().unwrap();

    if !state.providers.contains_key(&provider_id) {
        return Err(AppError::ConfigError("Provider not found".to_string()));
    }

    // Save API key securely if provided
    if let Some(key) = &api_key {
        if !key.is_empty() {
            save_api_key(&provider_id, key)?;
        }
    }

    let should_emit = state.active_provider == provider_id;
    let usage_data;

    {
        let provider = state.providers.get_mut(&provider_id).unwrap();
        if let Some(key) = &api_key {
            if !key.is_empty() {
                provider.config.api_key = Some(key.clone());
                provider.config.has_api_key = true;
            }
        }

        provider.config.limit = limit;
        provider.config.alert_thresholds = alert_thresholds;
        provider.config.reset_interval_hours = reset_interval_hours;
        provider.config.enabled = enabled;
        provider.usage.limit = limit;
        provider.usage.percent =
            ((provider.usage.used as f64 / provider.usage.limit as f64) * 100.0) as u32;
        usage_data = provider.usage.clone();
    }

    save_state(&state);

    if should_emit {
        window.emit("usage-updated", usage_data).ok();
    }

    Ok(())
}

#[tauri::command]
fn remove_api_key(
    provider_id: String,
    state: tauri::State<Mutex<AppState>>,
) -> Result<(), AppError> {
    let mut state = state.lock().unwrap();

    if let Some(provider) = state.providers.get_mut(&provider_id) {
        delete_api_key(&provider_id)?;
        provider.config.api_key = None;
        provider.config.has_api_key = false;
        save_state(&state);
        Ok(())
    } else {
        Err(AppError::ConfigError("Provider not found".to_string()))
    }
}

#[tauri::command]
fn add_request(count: u32, state: tauri::State<Mutex<AppState>>, window: Window) {
    let mut state = state.lock().unwrap();
    let active = state.active_provider.clone();

    if !state.providers.contains_key(&active) {
        return;
    }

    let usage_data = {
        let provider = state.providers.get_mut(&active).unwrap();

        // Check if reset needed
        let now = Utc::now().timestamp();
        if now >= provider.usage.reset_time {
            // Save to history
            let time_str = Local::now().format("%H:%M").to_string();
            provider.usage.history.insert(
                0,
                HistoryEntry {
                    time: time_str,
                    used: provider.usage.used,
                    limit: provider.usage.limit,
                },
            );
            if provider.usage.history.len() > 6 {
                provider.usage.history.pop();
            }

            // Reset
            provider.usage.used = 0;
            provider.usage.reset_time =
                now + (provider.config.reset_interval_hours as i64 * 3600);
            provider.notified_thresholds.clear();

            send_notification(
                &format!("🔄 {} - Quota réinitialisé!", provider.config.name),
                &format!(
                    "Votre quota de {} requêtes est à nouveau disponible.",
                    provider.config.limit
                ),
            );
        }

        // Add requests
        provider.usage.used = (provider.usage.used + count).min(provider.usage.limit);
        provider.usage.percent =
            ((provider.usage.used as f64 / provider.usage.limit as f64) * 100.0) as u32;

        // Check notifications
        check_and_notify(provider);

        provider.usage.clone()
    };

    // Save and emit (outside the borrow scope)
    save_state(&state);
    window.emit("usage-updated", usage_data).ok();
}

#[tauri::command]
fn reset_usage(state: tauri::State<Mutex<AppState>>, window: Window) {
    let mut state = state.lock().unwrap();
    let active = state.active_provider.clone();

    if !state.providers.contains_key(&active) {
        return;
    }

    let usage_data = {
        let provider = state.providers.get_mut(&active).unwrap();

        // Save to history
        let time_str = Local::now().format("%H:%M").to_string();
        provider.usage.history.insert(
            0,
            HistoryEntry {
                time: time_str,
                used: provider.usage.used,
                limit: provider.usage.limit,
            },
        );
        if provider.usage.history.len() > 6 {
            provider.usage.history.pop();
        }

        // Reset
        provider.usage.used = 0;
        provider.usage.percent = 0;
        provider.usage.reset_time =
            Utc::now().timestamp() + (provider.config.reset_interval_hours as i64 * 3600);
        provider.notified_thresholds.clear();

        provider.usage.clone()
    };

    save_state(&state);
    window.emit("usage-updated", usage_data).ok();
}

// Legacy command for backward compatibility
#[tauri::command]
fn get_settings(state: tauri::State<Mutex<AppState>>) -> ProviderConfig {
    let state = state.lock().unwrap();
    let active = &state.active_provider;
    state
        .providers
        .get(active)
        .map(|p| {
            let mut config = p.config.clone();
            config.api_key = None;
            config
        })
        .unwrap_or_default()
}

/// Get Claude Code usage from OAuth API (for Pro/Max plans)
#[tauri::command]
async fn get_claude_code_usage() -> ClaudeCodeUsageResult {
    // Try to get OAuth token
    let token = match get_claude_code_oauth_token() {
        Some(t) => t,
        None => {
            return ClaudeCodeUsageResult {
                success: false,
                error: Some("Token OAuth Claude Code non trouvé. Vérifiez que Claude Code est connecté.".to_string()),
                five_hour_percent: None,
                five_hour_reset: None,
                seven_day_percent: None,
                seven_day_reset: None,
            };
        }
    };

    // Fetch usage from API
    match fetch_claude_code_usage(&token).await {
        Ok(usage) => {
            // API returns utilization already as percentage (0-100), no need to multiply
            ClaudeCodeUsageResult {
                success: true,
                error: None,
                five_hour_percent: usage.five_hour.as_ref().map(|w| w.utilization),
                five_hour_reset: usage.five_hour.and_then(|w| w.resets_at),
                seven_day_percent: usage.seven_day.as_ref().map(|w| w.utilization),
                seven_day_reset: usage.seven_day.and_then(|w| w.resets_at),
            }
        }
        Err(e) => {
            ClaudeCodeUsageResult {
                success: false,
                error: Some(e.to_string()),
                five_hour_percent: None,
                five_hour_reset: None,
                seven_day_percent: None,
                seven_day_reset: None,
            }
        }
    }
}

/// Check if Claude Code OAuth token is available
#[tauri::command]
fn has_claude_code_token() -> bool {
    get_claude_code_oauth_token().is_some()
}

#[tauri::command]
fn save_settings(
    limit: u32,
    alert_thresholds: Vec<u32>,
    reset_interval_hours: u32,
    state: tauri::State<Mutex<AppState>>,
    window: Window,
) {
    let mut state = state.lock().unwrap();
    let active = state.active_provider.clone();

    if !state.providers.contains_key(&active) {
        return;
    }

    let usage_data = {
        let provider = state.providers.get_mut(&active).unwrap();
        provider.config.limit = limit;
        provider.config.alert_thresholds = alert_thresholds;
        provider.config.reset_interval_hours = reset_interval_hours;
        provider.usage.limit = limit;
        provider.usage.percent =
            ((provider.usage.used as f64 / provider.usage.limit as f64) * 100.0) as u32;
        provider.usage.clone()
    };

    save_state(&state);
    window.emit("usage-updated", usage_data).ok();
}

// ============== SYSTEM TRAY ==============

fn create_tray_menu() -> SystemTrayMenu {
    let show = CustomMenuItem::new("show".to_string(), "Afficher");
    let add_one = CustomMenuItem::new("add_one".to_string(), "+1 Requête");
    let add_five = CustomMenuItem::new("add_five".to_string(), "+5 Requêtes");
    let reset = CustomMenuItem::new("reset".to_string(), "Reset quota");
    let quit = CustomMenuItem::new("quit".to_string(), "Quitter");

    SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(add_one)
        .add_item(add_five)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(reset)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit)
}

fn handle_tray_event(app: &tauri::AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            if let Some(window) = app.get_window("main") {
                window.show().ok();
                window.set_focus().ok();
            }
        }
        SystemTrayEvent::MenuItemClick { id, .. } => {
            let window = app.get_window("main");

            match id.as_str() {
                "show" => {
                    if let Some(w) = window {
                        w.show().ok();
                        w.set_focus().ok();
                    }
                }
                "add_one" => {
                    if let Some(w) = &window {
                        let state = app.state::<Mutex<AppState>>();
                        add_request(1, state, w.clone());
                    }
                }
                "add_five" => {
                    if let Some(w) = &window {
                        let state = app.state::<Mutex<AppState>>();
                        add_request(5, state, w.clone());
                    }
                }
                "reset" => {
                    if let Some(w) = &window {
                        let state = app.state::<Mutex<AppState>>();
                        reset_usage(state, w.clone());
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

// ============== MAIN ==============

fn main() {
    let state = load_state();
    let tray = SystemTray::new().with_menu(create_tray_menu());

    tauri::Builder::default()
        .manage(Mutex::new(state))
        .system_tray(tray)
        .on_system_tray_event(handle_tray_event)
        .invoke_handler(tauri::generate_handler![
            get_usage,
            get_all_providers,
            get_active_provider,
            set_active_provider,
            configure_provider,
            remove_api_key,
            add_request,
            reset_usage,
            get_settings,
            save_settings,
            get_claude_code_usage,
            has_claude_code_token
        ])
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                event.window().hide().ok();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
