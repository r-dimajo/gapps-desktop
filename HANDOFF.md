# gapps — Google Suite Desktop Shell for Linux

Google Suite desktop shell for Linux built with **Electron** (Chromium engine).
Target: Kubuntu 26.04, KDE Plasma 6.6 Wayland, NVIDIA GPU (10de:2d18), mixed-DPI monitors.
Language: Italian (User-facing UI).

---

## Repository Layout

```
google-suite-linux/
├── HANDOFF.md              ← Project documentation
├── package.json            ← Node/Electron dependencies & start script
├── .npmrc                  ← Disables progress bar to prevent KDE Konsole crash
├── apps.js                 ← Google Suite registry (11 apps, incl. Gemini) & URL routing helpers
├── svg-icons.js            ← Official 4-color Google Workspace SVG icons & UI symbols
├── main.js                 ← Electron main process: views, menus, tray, IPC, persistence
├── preload.js              ← Context bridge exposing safe gapps API to tab strip & new tab
├── tabbar/                 ← Sleek 36px top tab strip UI
│   ├── index.html          ← Tab strip markup: tabs, '+' button, reload, settings
│   ├── style.css           ← Dark Google Suite aesthetic with pinned/audio/badge styles
│   └── renderer.js         ← Tab events, drag-and-drop reorder, audio mute, shortcuts
├── newtab/                 ← Dashboard / App Launcher Grid (New Tab page)
│   ├── index.html          ← Google Workspace dashboard with search & app cards
│   ├── style.css           ← Dark responsive grid layout with hover animations
│   └── renderer.js         ← Card click navigation, search bar, shortcuts (1-9)
├── icons/
│   └── icon.png            ← 128px application & tray icon
└── src-tauri/              ← Legacy Rust prototype (preserved for reference)
```

---

## Features & Architecture

### 1. Multi-Tab Architecture (`WebContentsView`)
- Top 36px is an isolated `WebContentsView` loading `tabbar/index.html`.
- Active Google app runs in a dedicated `WebContentsView` taking `y: 36, height: window_height - 36`.
- **Drag-and-Drop Reordering**: Smooth tab dragging with visual insertion indicator lines and persistent tab order.
- **Lazy loading**: At boot, only the active tab creates a WebContents. Other tabs load on-demand when clicked.
- Inactive tabs remain cached in memory for zero-latency switching without reloading pages or losing unsaved edits.
- **Memory Saver**: Background tabs inactive for > 30 minutes are automatically hibernated to save RAM, then restored seamlessly when clicked.

### 2. New Tab Page (App Launcher Grid)
- Clicking `+` (or `Ctrl+T`) opens a Google Workspace dashboard grid rather than a plain dropdown.
- Shows all 11 apps with official SVG icons, descriptions, and keyboard shortcuts.
- Includes a Google Search and URL navigation bar.

### 3. Authentic SVG Icons
- All 11 apps (Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet, Chat, Gemini, Keep, Tasks) display official vector SVG icons in both the tab strip and the New Tab grid.

### 4. Schede Fissate (Pinned Tabs)
- Right-click any tab and choose "Fissa scheda (Pin)".
- Pinned tabs are placed at the beginning of the tab strip, compacted (icon-only), and protected from accidental closure.

### 5. Badges Notifiche & Notifiche Desktop Popup Native
- **Notifiche Popup Desktop per App**:
  - Script dedicato [`tab-preload.js`](file:///home/dimric/google-suite-linux/tab-preload.js) che intercetta sia `window.Notification` che `ServiceWorkerRegistration.showNotification`.
  - Permesso notifiche impostato automaticamente su `'granted'` (nessun banner fastidioso in Gmail o Chat).
  - Pop-up nativi KDE Plasma (`org.freedesktop.Notifications`) con l'icona ufficiale dell'applicazione (Gmail, Chat, Calendar, Meet, ecc.) e titolo personalizzato (`Gmail • Mittente`, `Google Chat • Nome Canale`).
  - Cliccando sul pop-up di notifica la finestra si apre e seleziona direttamente la scheda del messaggio/email.
  - Test rapido disponibile nel menu ⚙ Impostazioni: *"Test notifica desktop..."*.
- **Unread Count**: Gmail e Chat leggono i conteggi non letti e mostrano la pillola rossa sulla scheda, sulla tray e nella barra delle applicazioni di KDE.
- **Audio Indicator & Mute**: Le schede che riproducono audio mostrano l'icona 🔊 cliccabile per mutare al volo.

### 6. System Tray Parity
- KDE StatusNotifierItem tray icon (`icons/icon.png`).
- Left-click tray icon toggles window visibility.
- Right-click tray menu provides direct jumps to all 11 apps, plus quick "Nuova scheda..." action.
- Close-to-tray: Closing the window hides it to tray rather than exiting.

### 7. Link Policy & Global Shortcuts
- Internal Google domains (`mail.google.com`, `calendar.google.com`, `drive.google.com`, `docs.google.com`, `*.google.com`, `*.googleusercontent.com`, `*.gstatic.com`) stay strictly inside the shell and open as tabs.
- External URLs automatically open in the user's system default browser via `shell.openExternal`.
- **Global Shortcut**: `Ctrl+Alt+G` toggles Google Suite from anywhere in the OS.

---

## How to Run

```bash
cd /home/dimric/google-suite-linux
npm start
```
