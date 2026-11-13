mod apps;
mod state;
mod tray;

use apps::AppDef;
use state::TabsState;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Rect,
    WebviewBuilder, WebviewUrl, WindowEvent,
};
use tauri::webview::NewWindowResponse;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const STRIP: f64 = 36.0;

// window client size in logical px. On Wayland inner_size() returns 0 until
// the compositor sends the first configure — fall back to builder dims then.
fn client_logical(window: &tauri::Window) -> (f64, f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let inner = window.inner_size().unwrap_or(PhysicalSize::new(0, 0));
    if inner.width == 0 || inner.height == 0 {
        (1280.0, 860.0)
    } else {
        (inner.width as f64 / scale, inner.height as f64 / scale)
    }
}

// snap terminals export sandbox env (GIO_MODULE_DIR, GST_*) into their host
// shell; webkit then loads no TLS/GStreamer elements. Drop vars pointing at a
// snap sandbox unless they actually contain what the system needs.
fn fix_snap_env() {
    let drop_tls = std::env::var_os("GIO_MODULE_DIR")
        .map(|d| !std::path::Path::new(&d).join("libgiognutls.so").exists())
        .unwrap_or(false);
    if drop_tls {
        std::env::remove_var("GIO_MODULE_DIR");
    }
    let drop_gst = std::env::var_os("GST_PLUGIN_SYSTEM_PATH")
        .map(|d| !std::path::Path::new(&d).join("libgstcoreelements.so").exists())
        .unwrap_or(false);
    if drop_gst {
        std::env::remove_var("GST_PLUGIN_SYSTEM_PATH");
        std::env::remove_var("GST_PLUGIN_PATH");
        std::env::remove_var("GST_PLUGIN_SCANNER");
    }
}

fn open_external(url: &tauri::Url) {
    let _ = std::process::Command::new("xdg-open").arg(url.as_str()).spawn();
}

// navigation policy for app webviews: internal hosts stay, everything else
// goes to the system browser. Records the tab's current url/app.
fn nav_policy(app: &AppHandle, id: u64, url: &tauri::Url) -> bool {
    {
        let st = app.state::<TabsState>();
        let mut i = st.0.lock().unwrap();
        if let Some(t) = i.tabs.iter_mut().find(|t| t.id == id) {
            t.url = url.to_string();
            if let Some(def) = apps::by_host(url.host_str().unwrap_or("")) {
                t.app = def.id.to_string();
            }
        }
    }
    state::save(app);
    state::emit(app);
    match url.scheme() {
        "http" | "https" => {
            if apps::is_internal(url.host_str().unwrap_or("")) {
                true
            } else {
                open_external(url);
                false
            }
        }
        _ => {
            open_external(url);
            false
        }
    }
}

// create the webview backing an already-registered tab (or register + create)
fn create_webview(
    app: &AppHandle,
    id: u64,
    url: tauri::Url,
    app_id: &'static str,
    hidden: bool,
) -> Result<(), String> {
    let Some(window) = app.get_window("hub") else {
        return Err("no hub window".into());
    };
    let (w, h) = client_logical(&window);

    let a1 = app.clone();
    let a2 = app.clone();
    let a3 = app.clone();
    let wb = WebviewBuilder::new(format!("tab-{id}"), WebviewUrl::External(url))
        .on_navigation(move |url| nav_policy(&a1, id, url))
        .on_document_title_changed(move |wv, title| {
            let tid = state::label_id(wv.label());
            if let Some(tid) = tid {
                {
                    let st = a2.state::<TabsState>();
                    let mut i = st.0.lock().unwrap();
                    if let Some(t) = i.tabs.iter_mut().find(|t| t.id == tid) {
                        t.title = title;
                    }
                }
                state::save(&a2);
                state::emit(&a2);
            }
        })
        .on_new_window(move |url, _| {
            // target=_blank: internal → new tab, external → system browser
            let internal =
                matches!(url.scheme(), "http" | "https") && apps::is_internal(url.host_str().unwrap_or(""));
            if internal {
                let a = a3.clone();
                let u = url.clone();
                tauri::async_runtime::spawn(async move {
                    let app_id = apps::by_host(u.host_str().unwrap_or(""))
                        .map(|d| d.id)
                        .unwrap_or("custom");
                    let _ = add_tab(&a, u, app_id, true);
                });
            } else {
                open_external(&url);
            }
            NewWindowResponse::Deny
        });

    window
        .add_child(
            wb,
            LogicalPosition::new(0.0, STRIP),
            LogicalSize::new(w, h - STRIP),
        )
        .map_err(|e| e.to_string())?;
    if hidden {
        if let Some(wv) = app.get_webview(&format!("tab-{id}")) {
            wv.hide().ok();
        }
    }
    let _ = app_id;
    Ok(())
}

// register a new tab (state + webview) and optionally focus it
fn add_tab(
    app: &AppHandle,
    url: tauri::Url,
    app_id: &'static str,
    activate: bool,
) -> Result<(), String> {
    let def_title = apps::by_id(app_id).map(|d| d.title).unwrap_or("New tab");
    let id = {
        let st = app.state::<TabsState>();
        let mut i = st.0.lock().unwrap();
        let id = i.next_id;
        i.next_id += 1;
        i.tabs.push(state::Tab {
            id,
            url: url.to_string(),
            app: app_id.to_string(),
            title: def_title.to_string(),
        });
        id
    };
    create_webview(app, id, url, app_id, !activate)?;
    if activate {
        activate_tab_impl(app, id)?;
    } else {
        state::save(app);
        state::emit(app);
    }
    Ok(())
}

fn activate_tab_impl(app: &AppHandle, id: u64) -> Result<(), String> {
    let Some(window) = app.get_window("hub") else {
        return Err("no hub window".into());
    };
    let (w, h) = client_logical(&window);
    let scale = window.scale_factor().unwrap_or(1.0);
    let strip_h = (STRIP * scale) as u32;
    {
        let st = app.state::<TabsState>();
        i_active(&st, id);
    }
    for wv in window.webviews() {
        match state::label_id(wv.label()) {
            Some(tid) if tid == id => {
                let _ = wv.set_bounds(Rect {
                    position: PhysicalPosition::new(0, strip_h as i32).into(),
                    size: PhysicalSize::new(
                        (w * scale) as u32,
                        ((h - STRIP) * scale) as u32,
                    )
                    .into(),
                });
                wv.show().ok();
            }
            Some(_) => {
                wv.hide().ok();
            }
            None => {}
        }
    }
    state::save(app);
    state::emit(app);
    Ok(())
}

fn i_active(st: &tauri::State<TabsState>, id: u64) {
    st.0.lock().unwrap().active = id;
}

// layout: strip on top, active tab fills the rest — on every window resize
fn relayout(app: &AppHandle) {
    let Some(window) = app.get_window("hub") else { return };
    let (w, h) = client_logical(&window);
    let scale = window.scale_factor().unwrap_or(1.0);
    let strip_h = (STRIP * scale) as u32;
    let active = {
        let st = app.state::<TabsState>();
        let guard = st.0.lock().unwrap();
        guard.active
    };
    for wv in window.webviews() {
        if wv.label() == "tabbar" {
            let _ = wv.set_bounds(Rect {
                position: PhysicalPosition::new(0, 0).into(),
                size: PhysicalSize::new((w * scale) as u32, strip_h).into(),
            });
        } else if state::label_id(wv.label()) == Some(active) {
            let _ = wv.set_bounds(Rect {
                position: PhysicalPosition::new(0, strip_h as i32).into(),
                size: PhysicalSize::new(
                    (w * scale) as u32,
                    ((h - STRIP) * scale) as u32,
                )
                .into(),
            });
        }
    }
}

// route an argv value (desktop handler / manual) to a tab
pub fn launch_arg(app: &AppHandle, arg: &str) {
    let lower = arg.to_ascii_lowercase();
    if let Some(def) = apps::by_id(&lower) {
        let _ = open_app_tab(app, def);
        return;
    }
    if lower.starts_with("mailto:") {
        // Gmail compose prefilled from the mailto target
        if let Ok(url) = tauri::Url::parse_with_params(
            "https://mail.google.com/mail/",
            &[
                ("view", "cm"),
                ("fs", "1"),
                ("tf", "1"),
                ("extsrc", "mailto"),
                ("url", arg),
            ],
        ) {
            let _ = add_tab(app, url, "gmail", true);
        }
        return;
    }
    if lower.starts_with("webcal:") {
        let rest = arg
            .strip_prefix("webcal://")
            .unwrap_or(&arg["webcal:".len()..]);
        if let Ok(url) = tauri::Url::parse_with_params(
            "https://calendar.google.com/calendar/r",
            &[("cid", rest)],
        ) {
            let _ = add_tab(app, url, "calendar", true);
        }
        return;
    }
    if let Ok(u) = tauri::Url::parse(arg) {
        if let Some(def) = apps::by_host(u.host_str().unwrap_or("")) {
            let _ = add_tab(app, u, def.id, true);
        } else if apps::is_internal(u.host_str().unwrap_or("")) {
            let _ = add_tab(app, u, "custom", true);
        }
    }
}

fn open_app_tab(app: &AppHandle, def: &'static AppDef) -> Result<(), String> {
    let existing = {
        let st = app.state::<TabsState>();
        let guard = st.0.lock().unwrap();
        guard.tabs.iter().find(|t| t.app == def.id).map(|t| t.id)
    };
    match existing {
        Some(id) => activate_tab_impl(app, id),
        None => add_tab(
            app,
            def.url
                .parse::<tauri::Url>()
                .map_err(|e| e.to_string())?,
            def.id,
            true,
        ),
    }
}

// ---------- IPC commands ----------

#[tauri::command]
fn get_state(app: AppHandle) -> state::Snapshot {
    state::snapshot(&app)
}

#[tauri::command]
fn list_apps() -> Vec<serde_json::Value> {
    apps::APPS
        .iter()
        .map(|a| serde_json::json!({ "id": a.id, "title": a.title, "color": a.color }))
        .collect()
}

#[tauri::command]
fn open_tab(app: AppHandle, app_id: String) -> Result<(), String> {
    match apps::by_id(&app_id) {
        Some(def) => open_app_tab(&app, def),
        None => Err(format!("unknown app {app_id}")),
    }
}

#[tauri::command]
fn open_url_tab(app: AppHandle, url: String) -> Result<(), String> {
    let u: tauri::Url = url
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let app_id = apps::by_host(u.host_str().unwrap_or(""))
        .map(|d| d.id)
        .unwrap_or("custom");
    add_tab(&app, u, app_id, true)
}

#[tauri::command]
fn close_tab(app: AppHandle, id: u64) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&format!("tab-{id}")) {
        wv.close().ok();
    }
    let next = {
        let st = app.state::<TabsState>();
        let mut i = st.0.lock().unwrap();
        let pos = i.tabs.iter().position(|t| t.id == id);
        if let Some(p) = pos {
            i.tabs.remove(p);
        }
        let was_active = i.active == id;
        let n = if was_active {
            i.tabs
                .get(pos.and_then(|p| p.checked_sub(1)).unwrap_or(0).min(i.tabs.len().saturating_sub(1)))
                .map(|t| t.id)
        } else {
            Some(i.active)
        };
        (was_active, n)
    };
    match next {
        (true, Some(n)) => activate_tab_impl(&app, n),
        (true, None) => {
            state::save(&app);
            state::emit(&app);
            Ok(())
        }
        (false, _) => {
            state::save(&app);
            state::emit(&app);
            Ok(())
        }
    }
}

#[tauri::command]
fn activate_tab(app: AppHandle, id: u64) -> Result<(), String> {
    activate_tab_impl(&app, id)
}

#[tauri::command]
fn open_in_browser(app: AppHandle, id: u64) {
    let url = {
        let st = app.state::<TabsState>();
        let guard = st.0.lock().unwrap();
        guard.tabs.iter().find(|t| t.id == id).map(|t| t.url.clone())
    };
    if let Some(u) = url {
        if let Ok(parsed) = tauri::Url::parse(&u) {
            open_external(&parsed);
        }
        let _ = close_tab(app, id);
    }
}

#[tauri::command]
fn reload_active(app: AppHandle) {
    let id = {
        let st = app.state::<TabsState>();
        let guard = st.0.lock().unwrap();
        guard.active
    };
    if let Some(wv) = app.get_webview(&format!("tab-{id}")) {
        wv.reload().ok();
    }
}

#[tauri::command]
fn set_settings(
    app: AppHandle,
    open_at_startup: Option<bool>,
    start_minimized: Option<bool>,
) {
    {
        let st = app.state::<TabsState>();
        let mut i = st.0.lock().unwrap();
        if let Some(o) = open_at_startup {
            i.settings.open_at_startup = o;
        }
        if let Some(s) = start_minimized {
            i.settings.start_minimized = s;
        }
    }
    if let Some(o) = open_at_startup {
        let autostart = app.autolaunch();
        if o {
            autostart.enable().ok();
        } else {
            autostart.disable().ok();
        }
    }
    state::save(&app);
    state::emit(&app);
}

#[tauri::command]
fn clear_cache(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    // cookies/localstorage/offline storage survive; only page caches go
    for sub in ["WebKitCache", "CacheStorage"] {
        let _ = std::fs::remove_dir_all(dir.join(sub));
    }
    Ok(())
}

fn main() {
    fix_snap_env();
    let args: Vec<String> = std::env::args().skip(1).collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for a in argv.iter().skip(1) {
                launch_arg(app, a);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            list_apps,
            open_tab,
            open_url_tab,
            close_tab,
            activate_tab,
            open_in_browser,
            reload_active,
            set_settings,
            clear_cache
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            state::init(&handle, handle.autolaunch().is_enabled().unwrap_or(false));

            let start_min = handle
                .state::<TabsState>()
                .0
                .lock()
                .unwrap()
                .settings
                .start_minimized;
            let window = tauri::WindowBuilder::new(&handle, "hub")
                .title("gapps")
                .inner_size(1280.0, 860.0)
                .visible(!start_min)
                .build()?;

            let scale = window.scale_factor().unwrap_or(1.0);
            let inner = window.inner_size()?;
            let w = inner.width as f64 / scale;
            window.add_child(
                WebviewBuilder::new("tabbar", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(w, STRIP),
            )?;

            // restore saved tab layout (webviews hidden; active one shown after)
            let (tabs, active) = {
                let st = handle.state::<TabsState>();
                let i = st.0.lock().unwrap();
                (
                    i.tabs
                        .iter()
                        .map(|t| (t.id, t.url.clone(), t.app.clone()))
                        .collect::<Vec<_>>(),
                    i.active,
                )
            };
            if tabs.is_empty() {
                add_tab(&handle, "https://mail.google.com".parse().unwrap(), "gmail", true)?;
            } else {
                for (id, url, app_id) in &tabs {
                    let parsed: tauri::Url = url.parse().unwrap_or_else(|_| {
                        apps::by_id("gmail").unwrap().url.parse().unwrap()
                    });
                    create_webview(
                        &handle,
                        *id,
                        parsed,
                        apps::by_id(app_id).map(|d| d.id).unwrap_or("custom"),
                        true,
                    )?;
                }
                if active != 0 {
                    activate_tab_impl(&handle, active)?;
                }
            }

            // first-launch args (mailto/webcal/url) become tabs
            if let Some(arg) = args.iter().find(|a| !a.starts_with('-')) {
                launch_arg(&handle, arg);
            }

            tray::spawn(handle.clone()).map_err(|e| e.to_string())?;

            // Wayland: inner_size() is 0 until the compositor maps the window;
            // re-layout once the real size has arrived
            let rl = handle.clone();
            std::thread::spawn(move || {
                for ms in [150u64, 500, 1200] {
                    std::thread::sleep(std::time::Duration::from_millis(ms));
                    relayout(&rl);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // close-to-tray
                api.prevent_close();
                window.hide().ok();
            }
            WindowEvent::Resized(_) | WindowEvent::Focused(_) => relayout(window.app_handle()),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error running gapps");
}
