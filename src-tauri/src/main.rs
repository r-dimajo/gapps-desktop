mod apps;
mod tray;

use apps::AppDef;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// snap terminals export sandbox env (GIO_MODULE_DIR, GST_*) into their host
// shell; webkit then loads no TLS/GStreamer elements ("TLS support is not
// available", "appsink not found"). Drop vars pointing at a snap sandbox
// unless they actually contain what the system needs.
fn fix_snap_env() {
    let drop_tls = std::env::var_os("GIO_MODULE_DIR")
        .map(|d| !std::path::Path::new(&d).join("libgiognutls.so").exists())
        .unwrap_or(false);
    if drop_tls {
        std::env::remove_var("GIO_MODULE_DIR");
    }
    let drop_gst = std::env::var_os("GST_PLUGIN_SYSTEM_PATH")
        .map(|d| {
            !std::path::Path::new(&d)
                .join("libgstcoreelements.so")
                .exists()
        })
        .unwrap_or(false);
    if drop_gst {
        std::env::remove_var("GST_PLUGIN_SYSTEM_PATH");
        std::env::remove_var("GST_PLUGIN_PATH");
        std::env::remove_var("GST_PLUGIN_SCANNER");
    }
}

// most recently focused app window, used by the tray left-click toggle
pub static LAST_WINDOW: Mutex<Option<String>> = Mutex::new(None);

pub fn open(app: &AppHandle, def: &'static AppDef, url: Option<tauri::Url>) {
    if let Some(w) = app.get_webview_window(def.id) {
        w.show().ok();
        w.set_focus().ok();
        return;
    }
    let target = url.unwrap_or_else(|| def.url.parse().unwrap());
    if let Err(e) = WebviewWindowBuilder::new(app, def.id, WebviewUrl::External(target))
        .title(def.title)
        .inner_size(1200.0, 800.0)
        .build()
    {
        eprintln!("open {} failed: {e}", def.id);
    }
}

pub fn open_app(app: &AppHandle, def: &'static AppDef) {
    open(app, def, None);
}

pub fn toggle_window(app: &AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window(id) {
        if w.is_visible().unwrap_or(false) {
            w.hide().ok();
        } else {
            w.show().ok();
            w.set_focus().ok();
        }
    }
}

// route an argv value (desktop handler / manual) to the right app window
pub fn launch_arg(app: &AppHandle, arg: &str) {
    let lower = arg.to_ascii_lowercase();
    if let Some(def) = apps::by_id(&lower) {
        open_app(app, def);
        return;
    }
    if lower.starts_with("mailto:") {
        // compose window prefilled from the mailto target
        let url = tauri::Url::parse_with_params(
            "https://mail.google.com/mail/",
            &[
                ("view", "cm"),
                ("fs", "1"),
                ("tf", "1"),
                ("extsrc", "mailto"),
                ("url", arg),
            ],
        )
        .unwrap();
        open(app, apps::by_id("gmail").unwrap(), Some(url));
        return;
    }
    if lower.starts_with("webcal:") {
        let rest = arg
            .strip_prefix("webcal://")
            .unwrap_or(&arg["webcal:".len()..]);
        let url = tauri::Url::parse_with_params(
            "https://calendar.google.com/calendar/r",
            &[("cid", rest)],
        )
        .unwrap();
        open(app, apps::by_id("calendar").unwrap(), Some(url));
        return;
    }
    if let Ok(u) = tauri::Url::parse(arg) {
        if let Some(host) = u.host_str() {
            if let Some(def) = apps::by_host(host) {
                open(app, def, Some(u));
            }
        }
    }
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
        .setup(move |app| {
            let handle = app.handle().clone();
            let target = args.iter().find(|a| !a.starts_with('-'));
            match target {
                Some(arg) => launch_arg(&handle, arg),
                None => open_app(&handle, apps::by_id("gmail").unwrap()),
            }
            tray::spawn(handle)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // close-to-tray: hide instead of quit
                api.prevent_close();
                window.hide().ok();
            }
            tauri::WindowEvent::Focused(true) => {
                if apps::by_id(window.label()).is_some() {
                    *LAST_WINDOW.lock().unwrap() = Some(window.label().to_string());
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error running gapps");
}
