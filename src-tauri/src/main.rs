mod apps;
mod state;
mod tray;

pub use apps::{by_id, APPS, AppDef};
use state::TabsState;
use tauri::{
    menu::{CheckMenuItemBuilder, ContextMenu, MenuBuilder, MenuItemBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewBuilder, WebviewUrl, WindowEvent,
};
use tauri::webview::NewWindowResponse;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub const STRIP: f64 = 36.0;

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

// layout: on Linux/GTK, Tauri's default_vbox() holds the child webviews.
// By default add_child packs children with expand = true, dividing height equally.
// Setting expand = false and size_request = 36 on the tabbar ensures it occupies
// exactly 36 logical px, while the active content webview receives all remaining height.
#[cfg(target_os = "linux")]
pub fn apply_gtk_layout(window: &tauri::Window) {
    use gtk::prelude::*;
    let window = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(vbox) = window.default_vbox() else { return };
        let children = vbox.children();
        if let Some(tabbar) = children.first() {
            vbox.set_child_packing(tabbar, false, false, 0, gtk::PackType::Start);
            tabbar.set_size_request(-1, STRIP as i32);
        }
        for content in children.iter().skip(1) {
            vbox.set_child_packing(content, true, true, 0, gtk::PackType::Start);
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn apply_gtk_layout(_window: &tauri::Window) {}

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
        "mailto" | "webcal" => {
            open_external(url);
            false
        }
        _ => false,
    }
}

// create the webview backing an already-registered tab
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
            } else if matches!(url.scheme(), "http" | "https" | "mailto" | "webcal") {
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

    apply_gtk_layout(&window);

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

    // Lazy load: if webview does not exist yet, create it on demand
    let label = format!("tab-{id}");
    if app.get_webview(&label).is_none() {
        let tab_info = {
            let st = app.state::<TabsState>();
            let guard = st.0.lock().unwrap();
            guard.tabs.iter().find(|t| t.id == id).map(|t| (t.url.clone(), t.app.clone()))
        };
        if let Some((url_str, app_id)) = tab_info {
            let parsed: tauri::Url = url_str.parse().unwrap_or_else(|_| {
                apps::by_id("gmail").unwrap().url.parse().unwrap()
            });
            let def_id = apps::by_id(&app_id).map(|d| d.id).unwrap_or("custom");
            create_webview(app, id, parsed, def_id, false)?;
        }
    }

    {
        let st = app.state::<TabsState>();
        i_active(&st, id);
    }

    for wv in window.webviews() {
        match state::label_id(wv.label()) {
            Some(tid) if tid == id => {
                wv.show().ok();
                wv.set_focus().ok();
            }
            Some(_) => {
                wv.hide().ok();
            }
            None => {}
        }
    }

    apply_gtk_layout(&window);
    state::save(app);
    state::emit(app);
    Ok(())
}

fn i_active(st: &tauri::State<TabsState>, id: u64) {
    st.0.lock().unwrap().active = id;
}

static BOOTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static PENDING_ARGS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

pub fn ensure_booted(app: &AppHandle) {
    if BOOTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_window("hub") else { return };
    let (w, _) = client_logical(&window);

    // 1. Create tabbar webview
    if let Err(e) = window.add_child(
        WebviewBuilder::new("tabbar", WebviewUrl::App("index.html".into())),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(w, STRIP),
    ) {
        eprintln!("Failed to create tabbar: {e}");
        return;
    }

    apply_gtk_layout(&window);

    // 2. Determine active tab from persisted state
    let (active_id, active_url, active_app) = {
        let st = app.state::<TabsState>();
        let mut guard = st.0.lock().unwrap();
        if guard.tabs.is_empty() {
            let gmail = apps::by_id("gmail").unwrap();
            let id = guard.next_id;
            guard.next_id += 1;
            guard.tabs.push(state::Tab {
                id,
                url: gmail.url.to_string(),
                app: "gmail".into(),
                title: "Gmail".into(),
            });
            guard.active = id;
            (id, gmail.url.to_string(), "gmail".into())
        } else {
            let active = guard.active;
            let tab = guard.tabs.iter().find(|t| t.id == active).or_else(|| guard.tabs.first()).cloned();
            match tab {
                Some(t) => {
                    guard.active = t.id;
                    (t.id, t.url, t.app)
                }
                None => {
                    let gmail = apps::by_id("gmail").unwrap();
                    let id = guard.next_id;
                    guard.next_id += 1;
                    guard.tabs.push(state::Tab {
                        id,
                        url: gmail.url.to_string(),
                        app: "gmail".into(),
                        title: "Gmail".into(),
                    });
                    guard.active = id;
                    (id, gmail.url.to_string(), "gmail".into())
                }
            }
        }
    };
    state::save(app);
    state::emit(app);

    // 3. Create ONLY the active tab on startup (other tabs load on demand)
    let parsed: tauri::Url = active_url.parse().unwrap_or_else(|_| {
        apps::by_id("gmail").unwrap().url.parse().unwrap()
    });
    let app_id = apps::by_id(&active_app).map(|d| d.id).unwrap_or("custom");
    let _ = create_webview(app, active_id, parsed, app_id, false);

    // 4. Handle any initial launch arguments
    if let Some(args) = PENDING_ARGS.get() {
        for a in args {
            launch_arg(app, a);
        }
    }
}

pub fn launch_arg(app: &AppHandle, arg: &str) {
    if let Some(w) = app.get_window("hub") {
        w.show().ok();
        w.set_focus().ok();
    }
    ensure_booted(app);

    let lower = arg.to_ascii_lowercase();
    if let Some(def) = apps::by_id(&lower) {
        let _ = open_app_tab(app, def);
        return;
    }
    if lower.starts_with("mailto:") {
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

pub fn open_app_tab(app: &AppHandle, def: &'static AppDef) -> Result<(), String> {
    if let Some(w) = app.get_window("hub") {
        w.show().ok();
        w.set_focus().ok();
    }
    ensure_booted(app);

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
            {
                let st = app.state::<TabsState>();
                st.0.lock().unwrap().active = 0;
            }
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
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let _ = std::fs::remove_dir_all(&cache_dir);
    }
    if let Ok(dir) = app.path().app_data_dir() {
        for sub in ["WebKitCache", "CacheStorage"] {
            let _ = std::fs::remove_dir_all(dir.join(sub));
        }
    }
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("gapps")
        .body("Cache cleared successfully")
        .show();
    Ok(())
}

#[tauri::command]
fn show_app_menu(app: AppHandle) -> Result<(), String> {
    let window = app.get_window("hub").ok_or("no hub window")?;
    let mut builder = MenuBuilder::new(&app);
    for a in apps::APPS {
        let item = MenuItemBuilder::with_id(format!("open_app_{}", a.id), a.title)
            .build(&app)
            .map_err(|e| e.to_string())?;
        builder = builder.item(&item);
    }
    let menu = builder.build().map_err(|e| e.to_string())?;
    menu.popup(window).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn show_tab_menu(app: AppHandle, id: u64) -> Result<(), String> {
    let window = app.get_window("hub").ok_or("no hub window")?;
    let menu = MenuBuilder::new(&app)
        .item(
            &MenuItemBuilder::with_id(format!("browser_{id}"), "Open in browser")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(format!("reload_{id}"), "Reload")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id(format!("close_{id}"), "Close tab")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;
    menu.popup(window).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn show_settings_menu(app: AppHandle) -> Result<(), String> {
    let window = app.get_window("hub").ok_or("no hub window")?;
    let (startup, minimized) = {
        let st = app.state::<TabsState>();
        let guard = st.0.lock().unwrap();
        (
            guard.settings.open_at_startup,
            guard.settings.start_minimized,
        )
    };
    let menu = MenuBuilder::new(&app)
        .item(
            &CheckMenuItemBuilder::with_id("toggle_startup", "Open at startup")
                .checked(startup)
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &CheckMenuItemBuilder::with_id("toggle_minimized", "Start minimized")
                .checked(minimized)
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("clear_cache", "Clear cache")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("quit", "Quit")
                .build(&app)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;
    menu.popup(window).map_err(|e| e.to_string())?;
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
        .on_menu_event(|app, event| {
            let id_str = event.id().as_ref();
            if let Some(app_id) = id_str.strip_prefix("open_app_") {
                if let Some(def) = apps::by_id(app_id) {
                    let _ = open_app_tab(app, def);
                }
            } else if let Some(tab_id_str) = id_str.strip_prefix("browser_") {
                if let Ok(tid) = tab_id_str.parse::<u64>() {
                    open_in_browser(app.clone(), tid);
                }
            } else if let Some(tab_id_str) = id_str.strip_prefix("reload_") {
                if let Ok(tid) = tab_id_str.parse::<u64>() {
                    if let Some(wv) = app.get_webview(&format!("tab-{tid}")) {
                        wv.reload().ok();
                    }
                }
            } else if let Some(tab_id_str) = id_str.strip_prefix("close_") {
                if let Ok(tid) = tab_id_str.parse::<u64>() {
                    let _ = close_tab(app.clone(), tid);
                }
            } else if id_str == "toggle_startup" {
                let current = {
                    let st = app.state::<TabsState>();
                    st.0.lock().unwrap().settings.open_at_startup
                };
                set_settings(app.clone(), Some(!current), None);
            } else if id_str == "toggle_minimized" {
                let current = {
                    let st = app.state::<TabsState>();
                    st.0.lock().unwrap().settings.start_minimized
                };
                set_settings(app.clone(), None, Some(!current));
            } else if id_str == "clear_cache" {
                let _ = clear_cache(app.clone());
            } else if id_str == "quit" {
                app.exit(0);
            }
        })
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
            clear_cache,
            show_app_menu,
            show_tab_menu,
            show_settings_menu
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
            tauri::WindowBuilder::new(&handle, "hub")
                .title("gapps")
                .inner_size(1280.0, 860.0)
                .visible(!start_min)
                .build()?;

            let _ = PENDING_ARGS.set(
                args.iter()
                    .filter(|a| !a.starts_with('-'))
                    .cloned()
                    .collect(),
            );

            tray::spawn(handle.clone()).map_err(|e| e.to_string())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                window.hide().ok();
            }
            WindowEvent::Resized(size) => {
                if !BOOTED.load(std::sync::atomic::Ordering::SeqCst)
                    && size.width > 0
                    && size.height > 0
                {
                    let app = window.app_handle().clone();
                    ensure_booted(&app);
                } else {
                    apply_gtk_layout(window);
                }
            }
            WindowEvent::Focused(_) => {
                apply_gtk_layout(window);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error running gapps");
}
