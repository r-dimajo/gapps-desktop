use crate::{open_app_tab, apps};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

pub struct TrayIcon(pub AppHandle);

impl TrayIcon {
    fn toggle_autostart(&mut self) {
        let autostart = self.0.autolaunch();
        if autostart.is_enabled().unwrap_or(false) {
            autostart.disable().ok();
        } else {
            autostart.enable().ok();
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
    // triggers a menu re-eval every time the user opens it
    fn menu_about_to_show(&mut self) {}
    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::*;
        let mut items: Vec<MenuItem<Self>> = apps::APPS
            .iter()
            .map(|a| {
                StandardItem {
                    label: a.title.into(),
                    activate: Box::new(move |t: &mut Self| {
                        let _ = open_app_tab(&t.0, a);
                    }),
                    ..Default::default()
                }
                .into()
            })
            .collect();
        items.push(MenuItem::Separator);
        let checked = self.0.autolaunch().is_enabled().unwrap_or(false);
        items.push(
            CheckmarkItem {
                label: "Start on login".into(),
                checked,
                activate: Box::new(|t: &mut Self| t.toggle_autostart()),
                ..Default::default()
            }
            .into(),
        );
        items.push(MenuItem::Separator);
        items.push(
            StandardItem {
                label: "Quit".into(),
                activate: Box::new(|t: &mut Self| t.0.exit(0)),
                ..Default::default()
            }
            .into(),
        );
        items
    }
    // left click on Plasma = activate: toggle the hub window
    fn activate(&mut self, _x: i32, _y: i32) {
        if let Some(w) = self.0.get_webview_window("hub") {
            if w.is_visible().unwrap_or(false) {
                w.hide().ok();
            } else {
                w.show().ok();
                w.set_focus().ok();
            }
        }
    }
    fn secondary_activate(&mut self, _x: i32, _y: i32) {
        if let Some(w) = self.0.get_webview_window("hub") {
            w.show().ok();
            w.set_focus().ok();
        }
    }
}

pub fn spawn(app: AppHandle) -> Result<(), String> {
    use ksni::blocking::TrayMethods;
    TrayIcon(app).spawn().map(|_| ()).map_err(|e| e.to_string())
}
