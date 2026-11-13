use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let url: tauri::Url = "https://mail.google.com".parse()?;
            WebviewWindowBuilder::new(app, "gmail", WebviewUrl::External(url))
                .title("Gmail")
                .inner_size(1200.0, 800.0)
                .build()?;

            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("gapps-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("gapps")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("gmail") {
                            w.show().ok();
                            w.set_focus().ok();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

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
