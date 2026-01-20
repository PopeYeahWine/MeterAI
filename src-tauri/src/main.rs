#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use chrono::{Local, Utc, DateTime};
use notify_rust::Notification;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
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

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    #[default]
    Manual,
    Anthropic,
    OpenAI,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(rename = "customCredentialsPath")]
    pub custom_credentials_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub providers: HashMap<String, ProviderUsage>,
    #[serde(rename = "activeProvider")]
    pub active_provider: String,
    #[serde(default)]
    pub settings: AppSettings,
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
            settings: AppSettings::default(),
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
    pub subscription_type: Option<String>, // "pro", "max", etc.
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

/// Credentials info with token and subscription type
#[derive(Debug, Clone)]
pub struct CredentialsInfo {
    pub token: String,
    pub subscription_type: Option<String>,
}

/// Try to read credentials from a specific path
fn try_read_credentials(path: &PathBuf) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let creds: ClaudeCodeCredentials = serde_json::from_str(&content).ok()?;
    extract_token_from_creds(&creds)
}

/// Try to read full credentials info (token + subscription type) from a path
fn try_read_credentials_info(path: &PathBuf) -> Option<CredentialsInfo> {
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let creds: ClaudeCodeCredentials = serde_json::from_str(&content).ok()?;
    let token = extract_token_from_creds(&creds)?;

    // Extract subscription type from nested format
    let subscription_type = creds
        .claude_ai_oauth
        .as_ref()
        .and_then(|oauth| oauth.subscription_type.clone());

    Some(CredentialsInfo {
        token,
        subscription_type,
    })
}

/// Get all possible credential paths for the current OS
fn get_credential_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        // Primary: ~/.claude/.credentials.json
        paths.push(home.join(".claude").join(".credentials.json"));
        // Legacy: ~/.claude/credentials.json
        paths.push(home.join(".claude").join("credentials.json"));
        // Alternative: ~/.config/claude-code/auth.json
        paths.push(home.join(".config").join("claude-code").join("auth.json"));
    }

    // Windows-specific paths
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            // VS Code extension storage
            paths.push(
                PathBuf::from(&appdata)
                    .join("Code")
                    .join("User")
                    .join("globalStorage")
                    .join("anthropic.claude-code")
                    .join("credentials.json"),
            );
        }
        if let Ok(localappdata) = env::var("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(&localappdata)
                    .join("claude-code")
                    .join("credentials.json"),
            );
        }
    }

    // Linux XDG paths
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg_config) = env::var("XDG_CONFIG_HOME") {
            paths.insert(
                2,
                PathBuf::from(&xdg_config)
                    .join("claude-code")
                    .join("auth.json"),
            );
        }
    }

    // macOS specific
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(
                home.join("Library")
                    .join("Application Support")
                    .join("claude-code")
                    .join("credentials.json"),
            );
        }
    }

    paths
}

/// Get Claude Code OAuth token from various sources
fn get_claude_code_oauth_token_with_custom(custom_path: Option<&str>) -> Option<String> {
    // 1. Custom path (priority)
    if let Some(path) = custom_path {
        if let Some(token) = try_read_credentials(&PathBuf::from(path)) {
            return Some(token);
        }
    }

    // 2. Environment variable
    if let Ok(token) = env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        if !token.is_empty() {
            return Some(token);
        }
    }

    // 3. Auto-detect paths
    for path in get_credential_paths() {
        if let Some(token) = try_read_credentials(&path) {
            return Some(token);
        }
    }

    None
}

/// Get Claude Code OAuth token (legacy function for backward compatibility)
fn get_claude_code_oauth_token() -> Option<String> {
    get_claude_code_oauth_token_with_custom(None)
}

/// Get full credentials info (token + subscription type)
fn get_claude_code_credentials_info() -> Option<CredentialsInfo> {
    // Try auto-detect paths
    for path in get_credential_paths() {
        if let Some(info) = try_read_credentials_info(&path) {
            return Some(info);
        }
    }
    None
}

/// Get detected config source for UI display
fn get_detected_config_source(custom_path: Option<&str>) -> String {
    // 1. Custom path
    if let Some(path) = custom_path {
        if try_read_credentials(&PathBuf::from(path)).is_some() {
            return format!("custom:{}", path);
        }
    }

    // 2. Environment variable
    if let Ok(token) = env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        if !token.is_empty() {
            return "env:CLAUDE_CODE_OAUTH_TOKEN".to_string();
        }
    }

    // 3. Auto-detect paths
    for path in get_credential_paths() {
        if try_read_credentials(&path).is_some() {
            return format!("auto:{}", path.display());
        }
    }

    "none".to_string()
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
#[allow(clippy::too_many_arguments)]
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
    // Try to get credentials info (token + subscription type)
    let creds_info = match get_claude_code_credentials_info() {
        Some(info) => info,
        None => {
            // Fallback to legacy token-only method
            match get_claude_code_oauth_token() {
                Some(token) => CredentialsInfo {
                    token,
                    subscription_type: None,
                },
                None => {
                    return ClaudeCodeUsageResult {
                        success: false,
                        error: Some("Token OAuth Claude Code non trouvé. Vérifiez que Claude Code est connecté.".to_string()),
                        five_hour_percent: None,
                        five_hour_reset: None,
                        seven_day_percent: None,
                        seven_day_reset: None,
                        subscription_type: None,
                    };
                }
            }
        }
    };

    // Fetch usage from API
    match fetch_claude_code_usage(&creds_info.token).await {
        Ok(usage) => {
            // API returns utilization already as percentage (0-100), no need to multiply
            ClaudeCodeUsageResult {
                success: true,
                error: None,
                five_hour_percent: usage.five_hour.as_ref().map(|w| w.utilization),
                five_hour_reset: usage.five_hour.and_then(|w| w.resets_at),
                seven_day_percent: usage.seven_day.as_ref().map(|w| w.utilization),
                seven_day_reset: usage.seven_day.and_then(|w| w.resets_at),
                subscription_type: creds_info.subscription_type,
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
                subscription_type: None,
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

// ============== AUTOSTART (Windows) ==============

/// Check if autostart is enabled (Windows registry)
#[tauri::command]
fn get_autostart_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run_key) =
            hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        {
            return run_key.get_value::<String, _>("MeterAI").is_ok();
        }
    }
    false
}

/// Set autostart enabled/disabled (Windows registry)
/// In debug mode: no-op (toggle works in UI but doesn't modify registry)
/// In release mode: modifies registry to point to installed application
#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    // In debug mode, do nothing - prevents dev builds from polluting the registry
    #[cfg(debug_assertions)]
    {
        let _ = enabled;
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    {
        #[cfg(target_os = "windows")]
        {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let run_key = hkcu
                .open_subkey_with_flags(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    KEY_SET_VALUE | KEY_QUERY_VALUE,
                )
                .map_err(|e| e.to_string())?;

            if enabled {
                // Use the standard install location: %LOCALAPPDATA%\MeterAI\MeterAI.exe
                let local_app_data = std::env::var("LOCALAPPDATA")
                    .map_err(|_| "Could not find LOCALAPPDATA environment variable")?;
                let installed_path = std::path::PathBuf::from(&local_app_data)
                    .join("MeterAI")
                    .join("MeterAI.exe");

                // Check if the installed version exists
                if !installed_path.exists() {
                    return Err(format!(
                        "MeterAI is not installed. Please install the application first.\nExpected path: {}",
                        installed_path.display()
                    ));
                }

                run_key
                    .set_value("MeterAI", &installed_path.to_string_lossy().to_string())
                    .map_err(|e| e.to_string())?;
            } else {
                // Ignore error if value doesn't exist
                run_key.delete_value("MeterAI").ok();
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // On non-Windows platforms, just ignore for now
            let _ = enabled;
        }

        Ok(())
    }
}

// ============== CONFIG DETECTION STATUS ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigStatus {
    pub detected: bool,
    pub source: String,
    #[serde(rename = "customPath")]
    pub custom_path: Option<String>,
}

/// Get config detection status for UI display
#[tauri::command]
fn get_config_detection_status(state: tauri::State<Mutex<AppState>>) -> ConfigStatus {
    let state = state.lock().unwrap();
    let custom_path = state.settings.custom_credentials_path.as_deref();

    ConfigStatus {
        detected: get_claude_code_oauth_token_with_custom(custom_path).is_some(),
        source: get_detected_config_source(custom_path),
        custom_path: state.settings.custom_credentials_path.clone(),
    }
}

/// Browse for credentials file using system dialog
#[tauri::command]
async fn browse_credentials_file() -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;

    let path = FileDialogBuilder::new()
        .add_filter("JSON", &["json"])
        .set_title("Select Claude credentials file")
        .pick_file();

    if let Some(path) = path {
        // Validate file
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let _: ClaudeCodeCredentials = serde_json::from_str(&content)
            .map_err(|_| "Invalid file: incorrect JSON format or missing fields".to_string())?;

        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// Set custom credentials path
#[tauri::command]
fn set_custom_credentials_path(
    path: Option<String>,
    state: tauri::State<Mutex<AppState>>,
) -> Result<(), String> {
    let mut state = state.lock().unwrap();
    state.settings.custom_credentials_path = path;
    save_state(&state);
    Ok(())
}

/// Get custom credentials path
#[tauri::command]
fn get_custom_credentials_path(state: tauri::State<Mutex<AppState>>) -> Option<String> {
    state.lock().unwrap().settings.custom_credentials_path.clone()
}

// ============== INTERNAL TOKEN STORAGE ==============

/// Stored token data (internal copy of Claude Code credentials)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokenData {
    /// The actual token (stored encrypted via keyring)
    #[serde(skip)]
    pub token: Option<String>,
    /// SHA256 hash of the token (first 16 chars for display)
    pub token_hash: String,
    /// When the token was copied to internal storage
    pub copied_at: String,
    /// Token expiration time (if available from source)
    pub expires_at: Option<String>,
    /// Source path where the token was copied from
    pub source_path: Option<String>,
    /// Refresh token (if available)
    #[serde(skip)]
    pub refresh_token: Option<String>,
}

/// Token change history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenChangeEntry {
    pub timestamp: String,
    pub changed: bool,
    pub old_hash: Option<String>,
    pub new_hash: Option<String>,
    pub source: String,
}

/// Token status for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStatus {
    /// Whether internal token exists
    pub has_internal_token: bool,
    /// Masked token preview (e.g., "sk-ant-...xxxx")
    pub token_preview: Option<String>,
    /// Token hash (first 16 chars)
    pub token_hash: Option<String>,
    /// When copied
    pub copied_at: Option<String>,
    /// Expiration
    pub expires_at: Option<String>,
    /// Source used
    pub source: String,
    /// Whether source token differs from internal
    pub source_differs: bool,
    /// Source token hash (for comparison)
    pub source_hash: Option<String>,
}

/// Token history data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenHistory {
    pub entries: Vec<TokenChangeEntry>,
    pub last_check: Option<String>,
}

/// Get path for internal token metadata
fn get_internal_token_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("meter-ai");
    fs::create_dir_all(&path).ok();
    path.push("token_metadata.json");
    path
}

/// Get path for token history
fn get_token_history_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("meter-ai");
    fs::create_dir_all(&path).ok();
    path.push("token_history.json");
    path
}

/// Compute SHA256 hash of a string, return first 16 hex chars
fn compute_token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8]) // First 8 bytes = 16 hex chars
}

/// Create masked token preview (e.g., "sk-ant-oaut01-...xxxx")
fn mask_token(token: &str) -> String {
    if token.len() <= 20 {
        return "*".repeat(token.len());
    }
    let prefix = &token[..15];
    let suffix = &token[token.len()-4..];
    format!("{}...{}", prefix, suffix)
}

/// Save token to secure storage (keyring)
fn save_internal_token(token: &str, refresh_token: Option<&str>) -> Result<(), AppError> {
    let entry = keyring::Entry::new("meter-ai", "claude-internal-token")
        .map_err(|e| AppError::KeyringError(e.to_string()))?;
    entry
        .set_password(token)
        .map_err(|e| AppError::KeyringError(e.to_string()))?;

    // Save refresh token if provided
    if let Some(rt) = refresh_token {
        if let Ok(rt_entry) = keyring::Entry::new("meter-ai", "claude-internal-refresh") {
            rt_entry.set_password(rt).ok();
        }
    }

    Ok(())
}

/// Load token from secure storage
fn load_internal_token() -> Option<String> {
    let entry = keyring::Entry::new("meter-ai", "claude-internal-token").ok()?;
    entry.get_password().ok()
}

/// Load refresh token from secure storage
fn load_internal_refresh_token() -> Option<String> {
    let entry = keyring::Entry::new("meter-ai", "claude-internal-refresh").ok()?;
    entry.get_password().ok()
}

/// Delete internal token from secure storage
fn delete_internal_token() -> Result<(), AppError> {
    if let Ok(entry) = keyring::Entry::new("meter-ai", "claude-internal-token") {
        entry.delete_password().ok();
    }
    if let Ok(entry) = keyring::Entry::new("meter-ai", "claude-internal-refresh") {
        entry.delete_password().ok();
    }
    // Also delete metadata file
    let path = get_internal_token_path();
    if path.exists() {
        fs::remove_file(path).ok();
    }
    Ok(())
}

/// Save token metadata (non-sensitive data)
fn save_token_metadata(data: &StoredTokenData) -> Result<(), AppError> {
    let path = get_internal_token_path();
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| AppError::ConfigError(e.to_string()))?;
    fs::write(path, json)
        .map_err(|e| AppError::ConfigError(e.to_string()))?;
    Ok(())
}

/// Load token metadata
fn load_token_metadata() -> Option<StoredTokenData> {
    let path = get_internal_token_path();
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let mut data: StoredTokenData = serde_json::from_str(&content).ok()?;
    // Load actual token from keyring
    data.token = load_internal_token();
    data.refresh_token = load_internal_refresh_token();
    Some(data)
}

/// Load token history
fn load_token_history() -> TokenHistory {
    let path = get_token_history_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(history) = serde_json::from_str(&content) {
                return history;
            }
        }
    }
    TokenHistory::default()
}

/// Save token history
fn save_token_history(history: &TokenHistory) -> Result<(), AppError> {
    let path = get_token_history_path();
    let json = serde_json::to_string_pretty(history)
        .map_err(|e| AppError::ConfigError(e.to_string()))?;
    fs::write(path, json)
        .map_err(|e| AppError::ConfigError(e.to_string()))?;
    Ok(())
}

/// Read full credentials from source file (for export)
fn read_source_credentials(custom_path: Option<&str>) -> Option<(String, ClaudeCodeCredentials)> {
    // Try custom path first
    if let Some(path) = custom_path {
        let path_buf = PathBuf::from(path);
        if path_buf.exists() {
            if let Ok(content) = fs::read_to_string(&path_buf) {
                if let Ok(creds) = serde_json::from_str::<ClaudeCodeCredentials>(&content) {
                    return Some((path.to_string(), creds));
                }
            }
        }
    }

    // Try auto-detect paths
    for path in get_credential_paths() {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(creds) = serde_json::from_str::<ClaudeCodeCredentials>(&content) {
                    return Some((path.to_string_lossy().to_string(), creds));
                }
            }
        }
    }

    None
}

/// Copy token from source to internal storage
#[tauri::command]
fn copy_token_to_internal(state: tauri::State<Mutex<AppState>>) -> Result<TokenStatus, String> {
    let state = state.lock().unwrap();
    let custom_path = state.settings.custom_credentials_path.as_deref();

    // Read source credentials
    let (source_path, creds) = read_source_credentials(custom_path)
        .ok_or("No Claude Code credentials found. Please ensure Claude Code is installed and logged in.")?;

    // Extract token
    let token = extract_token_from_creds(&creds)
        .ok_or("Token not found in credentials file")?;

    // Extract refresh token and expiration
    let (refresh_token, expires_at) = if let Some(ref oauth) = creds.claude_ai_oauth {
        (
            oauth.refresh_token.clone(),
            oauth.expires_at.map(|ts| {
                DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                    .unwrap_or_else(|| ts.to_string())
            })
        )
    } else {
        (creds.refresh_token.clone(), creds.expires_at.map(|ts| {
            DateTime::from_timestamp(ts, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                .unwrap_or_else(|| ts.to_string())
        }))
    };

    // Compute hash
    let token_hash = compute_token_hash(&token);

    // Check if this is a change from existing internal token
    let old_metadata = load_token_metadata();
    let changed = old_metadata.as_ref()
        .map(|m| m.token_hash != token_hash)
        .unwrap_or(true);

    // Log change if applicable
    if changed {
        let mut history = load_token_history();
        history.entries.push(TokenChangeEntry {
            timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            changed: true,
            old_hash: old_metadata.as_ref().map(|m| m.token_hash.clone()),
            new_hash: Some(token_hash.clone()),
            source: source_path.clone(),
        });
        // Keep only last 100 entries
        if history.entries.len() > 100 {
            history.entries = history.entries.split_off(history.entries.len() - 100);
        }
        history.last_check = Some(Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
        save_token_history(&history).ok();
    }

    // Save to keyring
    save_internal_token(&token, refresh_token.as_deref())
        .map_err(|e| e.to_string())?;

    // Save metadata
    let metadata = StoredTokenData {
        token: Some(token.clone()),
        token_hash: token_hash.clone(),
        copied_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        expires_at: expires_at.clone(),
        source_path: Some(source_path.clone()),
        refresh_token,
    };
    save_token_metadata(&metadata).map_err(|e| e.to_string())?;

    Ok(TokenStatus {
        has_internal_token: true,
        token_preview: Some(mask_token(&token)),
        token_hash: Some(token_hash),
        copied_at: Some(metadata.copied_at),
        expires_at,
        source: source_path,
        source_differs: false,
        source_hash: None,
    })
}

/// Get current token status
#[tauri::command]
fn get_token_status(state: tauri::State<Mutex<AppState>>) -> TokenStatus {
    let state = state.lock().unwrap();
    let custom_path = state.settings.custom_credentials_path.as_deref();

    // Load internal token metadata
    let internal = load_token_metadata();

    // Check source token
    let source_info = read_source_credentials(custom_path);
    let source_hash = source_info.as_ref()
        .and_then(|(_, creds)| extract_token_from_creds(creds))
        .map(|t| compute_token_hash(&t));

    let source_path = source_info.as_ref()
        .map(|(p, _)| p.clone())
        .unwrap_or_else(|| "none".to_string());

    if let Some(meta) = internal {
        let source_differs = source_hash.as_ref()
            .map(|sh| sh != &meta.token_hash)
            .unwrap_or(false);

        TokenStatus {
            has_internal_token: true,
            token_preview: meta.token.as_ref().map(|t| mask_token(t)),
            token_hash: Some(meta.token_hash),
            copied_at: Some(meta.copied_at),
            expires_at: meta.expires_at,
            source: source_path,
            source_differs,
            source_hash,
        }
    } else {
        TokenStatus {
            has_internal_token: false,
            token_preview: None,
            token_hash: None,
            copied_at: None,
            expires_at: None,
            source: source_path,
            source_differs: source_hash.is_some(),
            source_hash,
        }
    }
}

/// Check if source token has changed and log it
#[tauri::command]
fn check_token_change(state: tauri::State<Mutex<AppState>>) -> Result<TokenChangeEntry, String> {
    let state = state.lock().unwrap();
    let custom_path = state.settings.custom_credentials_path.as_deref();

    let internal = load_token_metadata();
    let source_info = read_source_credentials(custom_path);

    let source_hash = source_info.as_ref()
        .and_then(|(_, creds)| extract_token_from_creds(creds))
        .map(|t| compute_token_hash(&t));

    let source_path = source_info.as_ref()
        .map(|(p, _)| p.clone())
        .unwrap_or_else(|| "unknown".to_string());

    let internal_hash = internal.as_ref().map(|m| m.token_hash.clone());

    let changed = match (&internal_hash, &source_hash) {
        (Some(ih), Some(sh)) => ih != sh,
        (None, Some(_)) => true,
        _ => false,
    };

    let entry = TokenChangeEntry {
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        changed,
        old_hash: internal_hash,
        new_hash: source_hash,
        source: source_path,
    };

    // Log this check
    let mut history = load_token_history();
    history.entries.push(entry.clone());
    if history.entries.len() > 100 {
        history.entries = history.entries.split_off(history.entries.len() - 100);
    }
    history.last_check = Some(entry.timestamp.clone());
    save_token_history(&history).ok();

    Ok(entry)
}

/// Get token change history
#[tauri::command]
fn get_token_history() -> TokenHistory {
    load_token_history()
}

/// Export token data (for transfer to another PC)
#[tauri::command]
fn export_token_data() -> Result<String, String> {
    let metadata = load_token_metadata()
        .ok_or("No internal token stored")?;

    let token = metadata.token
        .ok_or("Token not found in secure storage")?;

    // Create export structure (similar to Claude Code credentials format)
    let export_data = serde_json::json!({
        "claudeAiOauth": {
            "accessToken": token,
            "refreshToken": metadata.refresh_token,
            "expiresAt": metadata.expires_at,
        },
        "exportedFrom": "MeterAI",
        "exportedAt": Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    });

    serde_json::to_string_pretty(&export_data)
        .map_err(|e| e.to_string())
}

/// Import token data (from another PC)
#[tauri::command]
fn import_token_data(json_data: String) -> Result<TokenStatus, String> {
    // Parse the imported data
    let creds: ClaudeCodeCredentials = serde_json::from_str(&json_data)
        .map_err(|e| format!("Invalid JSON format: {}", e))?;

    // Extract token
    let token = extract_token_from_creds(&creds)
        .ok_or("No access token found in imported data")?;

    // Extract refresh token and expiration
    let (refresh_token, expires_at) = if let Some(ref oauth) = creds.claude_ai_oauth {
        (
            oauth.refresh_token.clone(),
            oauth.expires_at.map(|ts| {
                DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                    .unwrap_or_else(|| ts.to_string())
            })
        )
    } else {
        (creds.refresh_token.clone(), creds.expires_at.map(|ts| {
            DateTime::from_timestamp(ts, 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                .unwrap_or_else(|| ts.to_string())
        }))
    };

    // Compute hash
    let token_hash = compute_token_hash(&token);

    // Save to keyring
    save_internal_token(&token, refresh_token.as_deref())
        .map_err(|e| e.to_string())?;

    // Save metadata
    let metadata = StoredTokenData {
        token: Some(token.clone()),
        token_hash: token_hash.clone(),
        copied_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        expires_at: expires_at.clone(),
        source_path: Some("imported".to_string()),
        refresh_token,
    };
    save_token_metadata(&metadata).map_err(|e| e.to_string())?;

    // Log import
    let mut history = load_token_history();
    history.entries.push(TokenChangeEntry {
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        changed: true,
        old_hash: None,
        new_hash: Some(token_hash.clone()),
        source: "imported".to_string(),
    });
    save_token_history(&history).ok();

    Ok(TokenStatus {
        has_internal_token: true,
        token_preview: Some(mask_token(&token)),
        token_hash: Some(token_hash),
        copied_at: Some(metadata.copied_at),
        expires_at,
        source: "imported".to_string(),
        source_differs: false,
        source_hash: None,
    })
}

/// Delete internal token
#[tauri::command]
fn clear_internal_token() -> Result<(), String> {
    delete_internal_token().map_err(|e| e.to_string())
}

// ============== OPENAI API INTEGRATION ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIUsageResponse {
    pub total_usage: f64, // Usage in cents
    #[serde(default)]
    pub daily_costs: Vec<OpenAIDailyCost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIDailyCost {
    pub timestamp: f64,
    pub line_items: Vec<OpenAILineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAILineItem {
    pub name: String,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAISubscriptionResponse {
    pub hard_limit_usd: Option<f64>,
    pub soft_limit_usd: Option<f64>,
    pub system_hard_limit_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIUsageResult {
    pub success: bool,
    pub error: Option<String>,
    /// Total usage in USD for current billing period
    pub usage_usd: Option<f64>,
    /// Hard limit in USD
    pub limit_usd: Option<f64>,
    /// Usage percentage (0-100)
    pub percent: Option<f64>,
    /// Whether this is a pay-as-you-go account (no hard limit)
    pub is_pay_as_you_go: bool,
    /// Daily breakdown
    pub daily_costs: Option<Vec<OpenAIDailyCostSummary>>,
    /// Billing period start date
    pub period_start: Option<String>,
    /// Billing period end date
    pub period_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIDailyCostSummary {
    pub date: String,
    pub cost_usd: f64,
}

/// Fetch OpenAI API usage
async fn fetch_openai_usage(api_key: &str) -> Result<OpenAIUsageResult, AppError> {
    let client = reqwest::Client::new();

    // Calculate date range for current month
    let now = Local::now();
    let start_date = now.format("%Y-%m-01").to_string();
    let end_date = (now + chrono::Duration::days(1)).format("%Y-%m-%d").to_string();

    // First, verify the API key is valid by making a simple models request
    let models_response = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| AppError::NetworkError(e.to_string()))?;

    if !models_response.status().is_success() {
        let status = models_response.status();
        return Err(AppError::ApiError(format!(
            "Invalid API key or API error (status {})",
            status
        )));
    }

    // Try to fetch usage data (this is an internal API that may not work for all accounts)
    let usage_url = format!(
        "https://api.openai.com/v1/dashboard/billing/usage?start_date={}&end_date={}",
        start_date, end_date
    );

    let usage_response = client
        .get(&usage_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await;

    let (usage_usd, daily_costs) = match usage_response {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<OpenAIUsageResponse>().await {
                Ok(usage_data) => {
                    let usage = usage_data.total_usage / 100.0;
                    let costs: Vec<OpenAIDailyCostSummary> = usage_data.daily_costs
                        .iter()
                        .map(|day| {
                            let total_cost: f64 = day.line_items.iter().map(|li| li.cost).sum();
                            let date = DateTime::from_timestamp(day.timestamp as i64, 0)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_else(|| "Unknown".to_string());
                            OpenAIDailyCostSummary {
                                date,
                                cost_usd: total_cost / 100.0,
                            }
                        })
                        .collect();
                    (Some(usage), Some(costs))
                }
                Err(_) => (Some(0.0), None) // API worked but parsing failed, assume 0 usage
            }
        }
        _ => (Some(0.0), None) // API not available, assume 0 usage (pay-as-you-go)
    };

    // Try to fetch subscription/limits
    let sub_response = client
        .get("https://api.openai.com/v1/dashboard/billing/subscription")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await;

    let limit_usd = match sub_response {
        Ok(resp) if resp.status().is_success() => {
            resp.json::<OpenAISubscriptionResponse>()
                .await
                .ok()
                .and_then(|sub_data| {
                    sub_data.hard_limit_usd
                        .or(sub_data.soft_limit_usd)
                        .or(sub_data.system_hard_limit_usd)
                })
        }
        _ => None
    };

    // Determine if pay-as-you-go (no limit set)
    let is_pay_as_you_go = limit_usd.is_none();

    // Calculate percentage (0% if pay-as-you-go or no usage)
    let percent = if let (Some(usage), Some(limit)) = (usage_usd, limit_usd) {
        if limit > 0.0 {
            Some((usage / limit * 100.0).min(100.0))
        } else {
            Some(0.0)
        }
    } else {
        // Pay-as-you-go: show 0% (no limit to compare against)
        Some(0.0)
    };

    Ok(OpenAIUsageResult {
        success: true,
        error: None,
        usage_usd,
        limit_usd,
        percent,
        is_pay_as_you_go,
        daily_costs,
        period_start: Some(start_date),
        period_end: Some(end_date),
    })
}

/// Get OpenAI API usage
#[tauri::command]
async fn get_openai_api_usage(state: tauri::State<'_, Mutex<AppState>>) -> Result<OpenAIUsageResult, String> {
    // Get API key from state
    let api_key = {
        let state = state.lock().unwrap();
        state.providers
            .get("openai")
            .and_then(|p| p.config.api_key.clone())
    };

    let api_key = match api_key {
        Some(key) if !key.is_empty() => key,
        _ => {
            return Ok(OpenAIUsageResult {
                success: false,
                error: Some("No OpenAI API key configured. Please add your API key in settings.".to_string()),
                usage_usd: None,
                limit_usd: None,
                percent: None,
                is_pay_as_you_go: false,
                daily_costs: None,
                period_start: None,
                period_end: None,
            });
        }
    };

    match fetch_openai_usage(&api_key).await {
        Ok(result) => Ok(result),
        Err(e) => Ok(OpenAIUsageResult {
            success: false,
            error: Some(e.to_string()),
            usage_usd: None,
            limit_usd: None,
            percent: None,
            is_pay_as_you_go: false,
            daily_costs: None,
            period_start: None,
            period_end: None,
        }),
    }
}

/// Check if OpenAI API key is configured
#[tauri::command]
fn has_openai_api_key(state: tauri::State<Mutex<AppState>>) -> bool {
    let state = state.lock().unwrap();
    state.providers
        .get("openai")
        .map(|p| p.config.has_api_key && p.config.api_key.is_some())
        .unwrap_or(false)
}

/// Save OpenAI API key
#[tauri::command]
fn save_openai_api_key(
    api_key: String,
    state: tauri::State<Mutex<AppState>>,
) -> Result<(), String> {
    if api_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    // Validate API key format (should start with sk-)
    if !api_key.starts_with("sk-") {
        return Err("Invalid API key format. OpenAI API keys start with 'sk-'".to_string());
    }

    // Save to keyring
    save_api_key("openai", &api_key).map_err(|e| e.to_string())?;

    // Update state
    let mut state = state.lock().unwrap();
    if let Some(provider) = state.providers.get_mut("openai") {
        provider.config.api_key = Some(api_key);
        provider.config.has_api_key = true;
    }
    save_state(&state);

    Ok(())
}

/// Remove OpenAI API key
#[tauri::command]
fn remove_openai_api_key(state: tauri::State<Mutex<AppState>>) -> Result<(), String> {
    delete_api_key("openai").map_err(|e| e.to_string())?;

    let mut state = state.lock().unwrap();
    if let Some(provider) = state.providers.get_mut("openai") {
        provider.config.api_key = None;
        provider.config.has_api_key = false;
    }
    save_state(&state);

    Ok(())
}

/// Get OpenAI API key preview (first 10 chars + masked rest)
#[tauri::command]
fn get_openai_api_key_preview(state: tauri::State<Mutex<AppState>>) -> Option<String> {
    let state = state.lock().unwrap();
    state.providers
        .get("openai")
        .and_then(|p| p.config.api_key.as_ref())
        .map(|key| {
            if key.len() > 10 {
                format!("{}...", &key[..10])
            } else {
                key.clone()
            }
        })
}

/// Get Claude Code usage using internal token (fallback to source if not available)
#[tauri::command]
async fn get_claude_code_usage_internal() -> ClaudeCodeUsageResult {
    // Try internal token first
    let token = if let Some(meta) = load_token_metadata() {
        meta.token
    } else {
        None
    };

    // Get subscription type from credentials (if available)
    let subscription_type = get_claude_code_credentials_info()
        .and_then(|info| info.subscription_type);

    // Fall back to source token if internal not available
    let token = match token {
        Some(t) => t,
        None => {
            match get_claude_code_oauth_token() {
                Some(t) => t,
                None => {
                    return ClaudeCodeUsageResult {
                        success: false,
                        error: Some("No token available. Please copy token to internal storage or ensure Claude Code is connected.".to_string()),
                        five_hour_percent: None,
                        five_hour_reset: None,
                        seven_day_percent: None,
                        seven_day_reset: None,
                        subscription_type: None,
                    };
                }
            }
        }
    };

    // Fetch usage
    match fetch_claude_code_usage(&token).await {
        Ok(usage) => {
            ClaudeCodeUsageResult {
                success: true,
                error: None,
                five_hour_percent: usage.five_hour.as_ref().map(|w| w.utilization),
                five_hour_reset: usage.five_hour.and_then(|w| w.resets_at),
                seven_day_percent: usage.seven_day.as_ref().map(|w| w.utilization),
                seven_day_reset: usage.seven_day.and_then(|w| w.resets_at),
                subscription_type,
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
                subscription_type: None,
            }
        }
    }
}

// ============== SYSTEM TRAY ==============

fn create_tray_menu() -> SystemTrayMenu {
    let show = CustomMenuItem::new("show".to_string(), "Show");
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");

    SystemTrayMenu::new()
        .add_item(show)
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
            has_claude_code_token,
            get_autostart_enabled,
            set_autostart_enabled,
            get_config_detection_status,
            browse_credentials_file,
            set_custom_credentials_path,
            get_custom_credentials_path,
            // Internal token management
            copy_token_to_internal,
            get_token_status,
            check_token_change,
            get_token_history,
            export_token_data,
            import_token_data,
            clear_internal_token,
            get_claude_code_usage_internal,
            // OpenAI API
            get_openai_api_usage,
            has_openai_api_key,
            save_openai_api_key,
            remove_openai_api_key,
            get_openai_api_key_preview
        ])
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                event.window().hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
