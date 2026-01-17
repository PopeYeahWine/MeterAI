#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use chrono::{DateTime, Local, Utc};
use notify_rust::Notification;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
    Window,
};

// ============== DATA STRUCTURES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UsageData {
    used: u32,
    limit: u32,
    percent: u32,
    #[serde(rename = "resetTime")]
    reset_time: i64, // Unix timestamp
    history: Vec<HistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryEntry {
    time: String,
    used: u32,
    limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Settings {
    limit: u32,
    #[serde(rename = "alertThresholds")]
    alert_thresholds: Vec<u32>,
    #[serde(rename = "resetIntervalHours")]
    reset_interval_hours: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            limit: 100,
            alert_thresholds: vec![70, 90, 100],
            reset_interval_hours: 4,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppState {
    usage: UsageData,
    settings: Settings,
    #[serde(skip)]
    notified_thresholds: Vec<u32>,
}

impl Default for AppState {
    fn default() -> Self {
        let reset_interval = 4 * 3600; // 4 heures en secondes
        Self {
            usage: UsageData {
                used: 0,
                limit: 100,
                percent: 0,
                reset_time: Utc::now().timestamp() + reset_interval,
                history: vec![],
            },
            settings: Settings::default(),
            notified_thresholds: vec![],
        }
    }
}

// ============== PERSISTENCE ==============

fn get_data_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("claude-usage-tracker");
    fs::create_dir_all(&path).ok();
    path.push("data.json");
    path
}

fn load_state() -> AppState {
    let path = get_data_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<AppState>(&content) {
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

// ============== NOTIFICATIONS ==============

fn send_notification(title: &str, body: &str) {
    Notification::new()
        .summary(title)
        .body(body)
        .appname("Claude Usage Tracker")
        .timeout(5000)
        .show()
        .ok();
}

fn check_and_notify(state: &mut AppState) {
    let percent = state.usage.percent;

    for threshold in &state.settings.alert_thresholds {
        if percent >= *threshold && !state.notified_thresholds.contains(threshold) {
            state.notified_thresholds.push(*threshold);

            let (title, body) = if *threshold >= 100 {
                (
                    "⚠️ Limite Claude atteinte!",
                    format!("Vous avez utilisé 100% de votre quota. Reset dans quelques heures."),
                )
            } else {
                (
                    &format!("⚡ {}% du quota Claude", threshold),
                    format!(
                        "Vous avez utilisé {} requêtes sur {}.",
                        state.usage.used, state.usage.limit
                    ),
                )
            };

            send_notification(title, &body);
        }
    }
}

// ============== COMMANDS ==============

#[tauri::command]
fn get_usage(state: tauri::State<Mutex<AppState>>) -> UsageData {
    let state = state.lock().unwrap();
    state.usage.clone()
}

#[tauri::command]
fn get_settings(state: tauri::State<Mutex<AppState>>) -> Settings {
    let state = state.lock().unwrap();
    state.settings.clone()
}

#[tauri::command]
fn add_request(count: u32, state: tauri::State<Mutex<AppState>>, window: Window) {
    let mut state = state.lock().unwrap();

    // Vérifier si reset nécessaire
    let now = Utc::now().timestamp();
    if now >= state.usage.reset_time {
        // Sauvegarder dans l'historique
        let time_str = Local::now().format("%H:%M").to_string();
        state.usage.history.insert(
            0,
            HistoryEntry {
                time: time_str,
                used: state.usage.used,
                limit: state.usage.limit,
            },
        );
        if state.usage.history.len() > 6 {
            state.usage.history.pop();
        }

        // Reset
        state.usage.used = 0;
        state.usage.reset_time = now + (state.settings.reset_interval_hours as i64 * 3600);
        state.notified_thresholds.clear();

        send_notification(
            "🔄 Quota Claude réinitialisé!",
            &format!(
                "Votre quota de {} requêtes est à nouveau disponible.",
                state.settings.limit
            ),
        );
    }

    // Ajouter les requêtes
    state.usage.used = (state.usage.used + count).min(state.usage.limit);
    state.usage.percent = ((state.usage.used as f64 / state.usage.limit as f64) * 100.0) as u32;

    // Vérifier les notifications
    check_and_notify(&mut state);

    // Sauvegarder
    save_state(&state);

    // Émettre l'événement de mise à jour
    window.emit("usage-updated", state.usage.clone()).ok();
}

#[tauri::command]
fn reset_usage(state: tauri::State<Mutex<AppState>>, window: Window) {
    let mut state = state.lock().unwrap();

    // Sauvegarder dans l'historique
    let time_str = Local::now().format("%H:%M").to_string();
    state.usage.history.insert(
        0,
        HistoryEntry {
            time: time_str,
            used: state.usage.used,
            limit: state.usage.limit,
        },
    );
    if state.usage.history.len() > 6 {
        state.usage.history.pop();
    }

    // Reset
    state.usage.used = 0;
    state.usage.percent = 0;
    state.usage.reset_time =
        Utc::now().timestamp() + (state.settings.reset_interval_hours as i64 * 3600);
    state.notified_thresholds.clear();

    save_state(&state);
    window.emit("usage-updated", state.usage.clone()).ok();
}

#[tauri::command]
fn save_settings(settings: Settings, state: tauri::State<Mutex<AppState>>, window: Window) {
    let mut state = state.lock().unwrap();

    state.settings = settings.clone();
    state.usage.limit = settings.limit;
    state.usage.percent = ((state.usage.used as f64 / state.usage.limit as f64) * 100.0) as u32;

    save_state(&state);
    window.emit("usage-updated", state.usage.clone()).ok();
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
            get_settings,
            add_request,
            reset_usage,
            save_settings
        ])
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Masquer au lieu de fermer
                event.window().hide().ok();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
