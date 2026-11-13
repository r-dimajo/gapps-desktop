use ksni::Tray;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

// snap terminals export GIO_MODULE_DIR into their sandbox cache; without the
// GnuTLS module there, webkit loads no TLS backend ("TLS support is not
// available"). Reset to the system module dir unless the current one has TLS.
fn fix_tls_module_dir() {
    let ok = std::env::var_os("GIO_MODULE_DIR")
        .map(|d| std::path::Path::new(&d).join("libgiognutls.so").exists())
        .unwrap_or(true);
    if !ok {
        std::env::remove_var("GIO_MODULE_DIR");
    }
}

struct TrayIcon(tauri::AppHandle);

impl TrayIcon {
    fn show_window(&mut self) {
        if let Some(w) = self.0.get_webview_window("gmail") {
            w.show().ok();
            w.set_focus().ok();
        }
    }
    fn toggle(&mut self) {
        if let Some(w) = self.0.get_webview_window("gmail") {
            if w.is_visible().unwrap_or(false) {
                w.hide().ok();
            } else {
                self.show_window();
            }
        }
    }
}

impl ksni::Tray for TrayIcon {
    fn id(&self) -> String {
        "com.dimric.gapps".into()
    }
    fn title(&self) -> String {
        "gapps".into()
    }
    // pixmap instead of icon-name: works before any icon theme install
    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        let img = image::load_from_memory(ICON_PNG).unwrap().to_rgba8();
        let (w, h) = (img.width() as i32, img.height() as i32);
        let mut argb = Vec::with_capacity((w * h * 4) as usize);
        // SNI wants ARGB32
        for p in img.pixels() {
            argb.extend_from_slice(&[p[3], p[0], p[1], p[2]]);
        }
        vec![ksni::Icon { width: w, height: h, data: argb }]
    }
    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::*;
        vec![
            StandardItem {
                label: "Show".into(),
                activate: Box::new(|t: &mut Self| t.show_window()),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Quit".into(),
                activate: Box::new(|t: &mut Self| t.0.exit(0)),
                ..Default::default()
            }
            .into(),
        ]
    }
    // left click on Plasma = activate
    fn activate(&mut self, _x: i32, _y: i32) {
        self.toggle();
    }
    fn secondary_activate(&mut self, _x: i32, _y: i32) {
        self.show_window();
    }
}

fn main() {
    fix_tls_module_dir();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let url: tauri::Url = "https://mail.google.com".parse()?;
            WebviewWindowBuilder::new(app, "gmail", WebviewUrl::External(url))
                .title("Gmail")
                .inner_size(1200.0, 800.0)
                .build()?;

            use ksni::blocking::TrayMethods;
            if let Err(e) = TrayIcon(app.handle().clone()).spawn() {
                eprintln!("tray error: {e}");
            }

            // spike: prove the notification path works
            use tauri_plugin_notification::NotificationExt;
            app.notification()
                .builder()
                .title("gapps")
                .body("Notifications work")
                .show()?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // close-to-tray: hide instead of quit
                api.prevent_close();
                window.hide().ok();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running gapps");
}
