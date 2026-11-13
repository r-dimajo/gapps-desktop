# gapps — handoff & project documentation

Google Suite desktop shell for Linux. Rust + Tauri 2 (WebKitGTK engine, **no Chromium**).
Target: Kubuntu 26.04, KDE Plasma 6.6 Wayland, NVIDIA GPU (10de:2d18), mixed-DPI monitors.
User speaks Italian. Avoid the word "chrome" in UI-facing strings (use "tabbar" or "strip").

## Repo layout

```
google-suite-linux/
├── HANDOFF.md            ← this file
├── dist/                 tab strip UI (plain HTML/JS/CSS, no framework, loaded via WebviewUrl::App)
│   ├── index.html        strip: tabs + '+' button + reload + settings
│   ├── app.js            IPC to Rust commands, renders tabs from "tabs" events, native menu triggers
│   └── style.css         exact 36px height strip, dark Google Suite styling
└── src-tauri/
    ├── Cargo.toml        tauri 2 (unstable, devtools), gtk 0.18 (linux), ksni 0.3 (blocking), serde, image
    ├── tauri.conf.json   withGlobalTauri: true, frontendDist ../dist, windows: [] (hub built in code)
    ├── capabilities/default.json   "tabbar" webview, core:default + start-dragging
    ├── icons/icon.png    128px icon (also installed to ~/.local/share/icons/hicolor/128x128/apps/gapps.png)
    └── src/
        ├── main.rs       GTK layout, commands, boot, nav policy, launch_arg (mailto/webcal/URL routing), native menus
        ├── apps.rs       APPS registry (10 apps: gmail, calendar, drive, docs, sheets, slides, meet, chat, keep, tasks) + is_internal()
        ├── state.rs      TabsState (tabs/active/settings), state.json/settings.json in app data dir (~/.local/share/com.dimric.gapps)
        └── tray.rs       ksni StatusNotifierItem tray (left-click toggle hub, right-click menu, pixmap icon)
```

Build/run: `cargo build` then `./target/debug/gapps` in `src-tauri/`.
Kill: `pkill -x gapps` (never `pkill -f gapps` — it kills your own shell).

## Architectural Architecture & Fixes

### 1. The Core Layout Fix (GTK Box Packing)
- **Problem**: Tauri's `add_child` packs child webviews into `window.default_vbox()` with `expand = true, fill = true`. `set_bounds()` is an intentional no-op in `wry` when the parent container is a `GtkBox`. Consequently, GTK divided window height equally across visible webviews (tabbar got 50%, active tab got 50%), causing giant bars and white slices.
- **Solution**:
  - We configure GTK box packing on the main thread via `apply_gtk_layout(window)`:
    - `tabbar` child: `vbox.set_child_packing(tabbar, false, false, 0, gtk::PackType::Start)` and `tabbar.set_size_request(-1, 36)`.
    - Content webviews: `vbox.set_child_packing(content, true, true, 0, gtk::PackType::Start)`.
  - GTK's native layout engine now automatically allocates exactly 36 logical pixels to the tabbar, and 100% of the remaining height (`window_height - 36`) to the active tab webview.
  - Inactive tabs are hidden (`wv.hide()`), which completely removes them from GTK box allocation.
  - Resizing the window is handled natively by GTK without any manual pixel bounds math.

### 2. Native Menus (No Clipping, Perfect KDE Plasma Integration)
- **Problem**: Popups (the '+' app menu, right-click context menu, and settings panel) were previously HTML `<div>` elements inside `index.html`. Since the tabbar webview is strictly 36px tall, any dropdown menu rendered at `top: 40px` was clipped and invisible outside the 36px webview rect.
- **Solution**:
  - Replaced HTML popups with Tauri 2 native desktop menus via `MenuBuilder`, `MenuItemBuilder`, `CheckMenuItemBuilder`, and `menu.popup(window)`.
  - Triggered via IPC commands:
    - Click `+`: `show_app_menu` -> native menu listing all 10 Google Suite apps.
    - Right-click tab: `show_tab_menu` -> native menu with "Open in browser", "Reload", "Close tab".
    - Click gear ⚙: `show_settings_menu` -> native menu with "Open at startup", "Start minimized", "Clear cache", "Quit".
  - Handled on the backend with `.on_menu_event(...)`.
  - Native menus render outside the webview, match the system's Breeze/KDE Dark theme, and are never clipped.

### 3. Instant Boot & Lazy Tab Loading (No Wayland/NVIDIA GPU Race)
- **Problem**: Spawning multiple `WebKitWebProcess` instances simultaneously at boot overwhelmed the Wayland/NVIDIA EGL compositor, causing blank white pages and requiring 4+ seconds of artificial `sleep()` delays. Additionally, if launched minimized, Wayland never sent `Resized` events, causing boot to hang indefinitely.
- **Solution**:
  - Instant boot: Startup now only spawns the `tabbar` and the single active tab.
  - Startup delay reduced from 4+ seconds to instant.
  - Other tabs from `state.json` are restored into `TabsState` and rendered immediately in the tabbar strip.
  - Background tabs load on demand (lazy loading): when the user clicks a tab, its webview is created and displayed.
  - `ensure_booted(&app)` is called both on `WindowEvent::Resized` and when unhiding from the system tray, fixing the start-minimized boot hang.

### 4. Tray Icon Left-Click Fix
- **Problem**: In `tray.rs`, `self.0.get_webview_window("hub")` returned `None` because the hub window was constructed with `tauri::WindowBuilder`, not `WebviewWindowBuilder`. Left-clicking the tray icon did nothing.
- **Solution**: Switched to `self.0.get_window("hub")` in `activate()` and `secondary_activate()`, properly toggling visibility and focusing the window.

## User requirements checklist

1. [x] Browser-style tabs in ONE window; pick apps from a `+` menu; tab layout saved across restarts. Right-click tab → open in browser (then close the tab).
2. [x] Internal Google links (Drive→Docs, Gmail→Sheets…) stay inside the shell as tabs; external links open in the system default browser.
3. [x] Settings: Open at startup, Start minimized, Clear cache (notifies user).
4. [x] Reload button in the strip (⟳).
5. [x] Notifications, close-to-tray, start minimized/autostart.
6. [x] No "chrome" in user-facing UI.

## Environment details
- OS: Kubuntu 26.04, KDE Plasma 6.6 Wayland, NVIDIA GPU.
- WebKitGTK 4.1, GTK3, Rust Tauri 2 (with `unstable` feature for multi-webview).
- Webcal default: gapps. Mailto default: user prefers Betterbird.
