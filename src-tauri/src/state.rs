use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct Tab {
    pub id: u64,
    pub url: String,
    pub app: String,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub open_at_startup: bool,
    pub start_minimized: bool,
}

#[derive(Serialize, Clone)]
pub struct Snapshot {
    pub tabs: Vec<Tab>,
    pub active: u64,
    pub settings: Settings,
}

pub struct Inner {
    pub tabs: Vec<Tab>,
    pub active: u64,
    pub next_id: u64,
    pub settings: Settings,
}

pub struct TabsState(pub Mutex<Inner>);

fn data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok()
}

pub fn init(app: &AppHandle, autostart_on: bool) {
    let mut tabs = Vec::new();
    let mut active = 0u64;
    let mut next_id = 1u64;
    let mut start_minimized = false;
    if let Some(dir) = data_dir(app) {
        if let Ok(s) = fs::read_to_string(dir.join("state.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Ok(t) = serde_json::from_value(v["tabs"].clone()) {
                    tabs = t;
                }
                active = v["active"].as_u64().unwrap_or(0);
                next_id = v["next_id"].as_u64().unwrap_or(1);
            }
        }
        if let Ok(s) = fs::read_to_string(dir.join("settings.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                start_minimized = v["start_minimized"].as_bool().unwrap_or(false);
            }
        }
    }
    // validate: active must point at an existing tab
    if !tabs.iter().any(|t: &Tab| t.id == active) {
        active = tabs.first().map(|t| t.id).unwrap_or(0);
    }
    app.manage(TabsState(Mutex::new(Inner {
        tabs,
        active,
        next_id,
        settings: Settings {
            open_at_startup: autostart_on,
            start_minimized,
        },
    })));
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    let st = app.state::<TabsState>();
    let i = st.0.lock().unwrap();
    Snapshot {
        tabs: i.tabs.clone(),
        active: i.active,
        settings: i.settings.clone(),
    }
}

pub fn save(app: &AppHandle) {
    let Some(dir) = data_dir(app) else { return };
    let _ = fs::create_dir_all(&dir);
    let st = app.state::<TabsState>();
    let i = st.0.lock().unwrap();
    let _ = fs::write(
        dir.join("state.json"),
        serde_json::json!({
            "tabs": i.tabs, "active": i.active, "next_id": i.next_id
        })
        .to_string(),
    );
    let _ = fs::write(
        dir.join("settings.json"),
        serde_json::json!({
            "open_at_startup": i.settings.open_at_startup,
            "start_minimized": i.settings.start_minimized
        })
        .to_string(),
    );
}

pub fn emit(app: &AppHandle) {
    let snap = snapshot(app);
    let _ = app.emit("tabs", snap);
}

// "tab-N" label -> N
pub fn label_id(label: &str) -> Option<u64> {
    label.strip_prefix("tab-")?.parse().ok()
}
