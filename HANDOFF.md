# gapps — Google Suite Desktop Shell for Linux

Google Suite desktop shell for Linux built with **Electron** (Chromium engine).
Target: Kubuntu 26.04, KDE Plasma 6.6 Wayland, NVIDIA GPU (10de:2d18), mixed-DPI monitors.
Language: Italian (User-facing UI).

---

## Why Electron over Rust/WebKitGTK

The initial prototype attempted Rust + Tauri 2 (WebKitGTK). WebKitGTK on Linux Wayland with NVIDIA drivers resulted in insurmountable issues:
1. **DMA-BUF & Blank Pages**: WebKitGTK's hardware acceleration frequently broke on NVIDIA Wayland drivers, rendering blank white screens.
2. **Google Suite Compatibility**: Google actively degrades WebKitGTK (blocking Google Meet screen sharing via PipeWire, failing Google Docs offline, warning of "insecure browser" on login).
3. **Multi-webview Layout**: Tauri on Linux packs webviews inside GTK3 `GtkBox`, where dynamic tab sizing and multi-instance lifecycle caused layout fighting.

**Electron (Chromium)** natively supports:
- Full Google Workspace functionality (Meet screen share, Docs, Sheets, Drive, Gmail).
- Seamless Wayland and XWayland integration via Chromium Ozone (`ozone-platform-hint=auto`).
- Native `WebContentsView` tab strip architecture without DOM overhead.
- Instant, stable startup with hardware acceleration.

---

## Repository Layout

```
google-suite-linux/
├── HANDOFF.md              ← Project documentation
├── package.json            ← Node/Electron dependencies & scripts
├── apps.js                 ← Google Suite registry (10 apps) & URL routing helpers
├── main.js                 ← Electron main process: views, menus, tray, IPC, persistence
├── preload.js              ← Context bridge exposing safe gapps API to tab strip
├── tabbar/                 ← Sleek 36px top tab strip UI
│   ├── index.html          ← Tab strip markup: tabs, '+' button, reload, settings
│   ├── style.css           ← Dark Google Suite aesthetic (36px fixed height)
│   └── renderer.js         ← Tab events, shortcuts, middle-click close, context menu
├── icons/
│   └── icon.png            ← 128px application & tray icon
└── src-tauri/              ← Legacy Rust prototype (preserved for reference)
```

---

## Features & Architecture

### 1. Multi-Tab Architecture (`WebContentsView`)
- Top 36px is an isolated `WebContentsView` loading `tabbar/index.html`.
- Active Google app runs in a dedicated `WebContentsView` taking `y: 36, height: window_height - 36`.
- **Lazy loading**: At boot, only the active tab creates a WebContents. Other tabs load on-demand when clicked.
- Inactive tabs remain cached in memory for zero-latency switching without reloading pages or losing unsaved edits.

### 2. Link Policy & Interception
- Internal Google domains (`mail.google.com`, `calendar.google.com`, `drive.google.com`, `docs.google.com`, `*.google.com`, `*.googleusercontent.com`, `*.gstatic.com`) stay strictly inside the shell and open as tabs.
- External URLs automatically open in the user's system default browser via `shell.openExternal`.

### 3. Native Menus (KDE Plasma Styled)
- Click `+` button: Native dropdown menu to open any of the 10 Google Suite apps.
- Right-click tab: "Apri nel browser predefinito" (opens externally and closes tab), "Ricarica scheda", "Duplica scheda", "Chiudi scheda", "Chiudi le altre schede".
- Click gear ⚙: "Avvia all'avvio del sistema", "Avvia ridotto a icona", "Cancella cache...", "Esci".

### 4. Google Login & Hardware Acceleration Fixes
- User-Agent automatically strips `Electron/...` so Google Accounts sign-in works without "Browser not secure" warnings.
- WebRTC PipeWire screen capturer enabled (`WebRTCPipeWireCapturer`) for Google Meet screen sharing on Wayland.
- Permissions (mic, camera, display-capture, notifications) automatically handled for Google domains.

### 5. System Tray & Single Instance
- KDE StatusNotifierItem tray icon (`icons/icon.png`).
- Left-click tray icon toggles window visibility.
- Right-click tray menu provides direct jumps to Gmail, Calendar, Drive, Meet, Chat, and Quit.
- Close-to-tray: Closing the window hides it to tray rather than exiting.
- State (`~/.config/gapps/state.json`) and settings (`~/.config/gapps/settings.json`) persist across restarts.

---

## How to Run

From the project root:

```bash
# 1. Install dependencies
npm install

# 2. Start the application
npm start
```

Or run via npx:
```bash
npx electron .
```
