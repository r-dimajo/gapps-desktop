# gapps — handoff for the next agent

Google Suite desktop shell for Linux. Rust + Tauri 2 (WebKitGTK engine, **no Chromium**).
Target: Kubuntu 26.04, KDE Plasma 6.6 Wayland, NVIDIA GPU (10de:2d18), mixed-DPI monitors.
User speaks Italian. "chrome"/"tabbar" in the code = UI chrome (tab strip), not the Chrome browser — user got confused once; avoid the word "chrome" in UI-facing strings.

## Repo layout

```
google-suite-linux/
├── HANDOFF.md            ← this file
├── dist/                 tab strip UI (plain HTML/JS/CSS, no framework, loaded via WebviewUrl::App)
│   ├── index.html        strip + settings popup + context menu (+ temporary debug readout)
│   ├── app.js            IPC to Rust commands, renders tabs from "tabs" events
│   └── style.css
└── src-tauri/
    ├── Cargo.toml        tauri 2 (features: unstable, devtools), ksni 0.3 (blocking), serde/serde_json, image, plugins: notification, single-instance, autostart
    ├── tauri.conf.json   withGlobalTauri: true, frontendDist ../dist, windows: [] (hub built in code)
    ├── capabilities/default.json   "tabbar" webview, core:default + start-dragging
    ├── icons/icon.png    128px icon (also installed to ~/.local/share/icons/hicolor/128x128/apps/gapps.png)
    └── src/
        ├── main.rs       commands, boot, relayout, nav policy, launch_arg (mailto/webcal/URL routing)
        ├── apps.rs       APPS registry (10 apps: gmail, calendar, drive, docs, sheets, slides, meet, chat, keep, tasks) + is_internal()
        ├── state.rs      TabsState (tabs/active/settings), state.json/settings.json in app data dir (~/.local/share/com.dimric.gapps)
        └── tray.rs       ksni StatusNotifierItem tray (left-click toggle hub, right-click menu, pixmap icon)
```

Build/run (no tauri-cli needed): `cargo build` then `./target/debug/gapps` in `src-tauri/`.
Kill: `pkill -x gapps` (never `pkill -f gapps` — it kills your own shell).

## What works (committed)

- Gmail etc. render on WebKitGTK; login persists (cookies in app data dir).
- Tray: left-click toggles window, right-click menu with all 10 apps + Start-on-login checkbox + Quit. Notifications work.
- Single instance; `mailto:`/`webcal:`/URL args open the right tab (desktop file at ~/.local/share/applications/gapps.desktop; webcal default is gapps, mailto still Betterbird by user choice).
- Snap-env fix (fix_snap_env): snap terminals export GIO_MODULE_DIR and GST_PLUGIN_* into their sandbox; WebKit then has no TLS/GStreamer ("TLS support is not available", "appsink not found"). We drop those vars unless they contain libgiognutls.so / libgstcoreelements.so.
- Tab state (open tabs + active) persisted to state.json; restored on launch.
- Link policy: internal hosts (apps::is_internal: *.google.com etc.) stay in the shell; window.open/target=_blank internal → new tab; external → xdg-open; about:/blob:/javascript: denied silently (this killed the "empty tab in Firefox Nightly" bug).
- Settings UI in strip: Open at startup (synced with autostart plugin), Start minimized, Clear cache (removes WebKitCache + CacheStorage only, keeps login).

## THE core bug (unfixed) — root cause confirmed

**Layout is broken: on Linux, Tauri does not put child webviews where we ask.**

- Evidence chain: `debug_info` command (returns window inner_size, scale_factor, and every webview's bounds()) renders into the strip top-right in red. Last read: `2560x1720 s2 | tabbar 0,0 2560x1720` — the tabbar webview is at FULL window size, `set_bounds` was ignored.
- Root cause in dependencies:
  - `tauri-runtime-wry-2.12.3/src/lib.rs` ~line 5171: on Linux, `Window::add_child` builds the webview with `webview_builder.build_gtk(window.default_vbox())` — packed into the window's default **GtkVBox** with `pack_start(child, true, true, 0)` (expand/fill = true).
  - `wry-0.57.2/src/webkitgtk/mod.rs` `set_bounds()` (~line 976) only applies bounds when the parent is an x11 child window or a **GtkFixed** (`is_in_fixed_parent` flag). GtkBox parent → bounds calls are **no-ops**.
  - Consequences: every webview gets an equal slice of window height (1/N). The "giant strip" and "white slices" the user sees are exactly this. show/hide DOES work (visible children absorb the space), so the LAST created/shown webview looks full-height and pages look right only when it's the only visible one (that's why single newly-opened tabs sometimes looked perfect).
- Boot blank pages: additionally, webviews created before the compositor maps the window (or many WebKitWebProcesses spawned at once) rendered blank on this NVIDIA/Wayland box. Current mitigation: all webview creation deferred to the first `Resized` with nonzero size (`boot_webviews`, BOOTED flag, PENDING_ARGS), staggered 2000ms then 700ms apart. Keep some deferral after the fix, then re-tune delays.

### The fix path (was mid-investigation)

Reparent the WebKit widgets into a GtkFixed we own:

1. Create the hub window (tauri::WindowBuilder, label "hub").
2. Get `window.gtk_window()` (tauri 2.12.5 exposes it on Linux, src/window/mod.rs:1790) and `window.default_vbox()` (…:1804).
3. Instead of trusting add_child placement: after each `add_child` (it still creates the webview, in the vbox), grab the actual widget and reparent:
   - `Webview::with_webview(|pw| …)` (src/webview/mod.rs:1857) gives `PlatformWebview` → on Linux the `webkit2gtk::WebView` widget (verify exact accessor: likely `pw.webview()` returning the widget, or `pw.inner()`).
   - On the **main thread only** (`window.run_on_main_thread`): `gtk_container_remove(vbox, widget)`; create/keep one `gtk::Fixed` attached to the gtk_window (replace the vbox as the window child, or add the fixed into the vbox); `fixed.put(&widget, x, y)`.
4. `set_bounds` stays a no-op after manual reparenting (wry's `is_in_fixed_parent` flag is set only when wry itself added it to a GtkFixed), so do allocation ourselves: track logical layout in Rust — tabbar at (0,0,W,36), active tab at (0,36,W,H-36), hidden tabs keep bounds — and apply with `widget.size_allocate(gtk::Allocation…)` + `widget.set_size_request(…)` on the main thread. Scale: tao reports scale 2 here; window inner_size is physical; logical = physical/scale. Keep using `client_logical()` in main.rs.
5. show/hide: keep tauri `Webview::show()/hide()` (widget-level, container-agnostic) — verify after reparenting.
6. relayout() already runs on Resized/Focused and at boot; route any GTK call through the main thread (event handlers are already main-thread; boot thread must use run_on_main_thread).

If reparenting fights wry/tauri (e.g. wry holds internal state keyed to the vbox), fallback options in order:
- Patch at the source: `cargo patch` wry to also honor GtkFixed via set_size_request, or vendor a fork where Linux WindowChild uses a GtkFixed container instead of the vbox (small change in tauri-runtime-wry: replace `build_gtk(vbox)` with building a GtkFixed once and `build_gtk(fixed)` + set is_in_fixed_parent).
- Give up on one-window tabs → revert to commit `P1: all 10 apps…` (multi-window per app; it worked fully) and keep the strip only as a launcher window.

## Debug tooling that worked

- Screenshots: `spectacle -b -n -o /tmp/opencode/x.png`, then crop with PIL (3-monitor desktop, image ~12898x2880; gapps usually right of center: `img.crop((w*0.55, 0, w, h))`).
- Raise gapps over the IDE via KWin script (works, keepAbove + activeWindow):
  `cat > /tmp/opencode/raise.js` with `for (const w of workspace.windowList()) if (w.resourceClass=="gapps") { w.minimized=false; w.keepAbove=true; workspace.activeWindow=w; }` then `qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript /tmp/opencode/raise.js && qdbus … start`. Unset keepAbove when done testing.
- App log: `/tmp/opencode/gapps.log`, filter noise: `grep -viE "pxbackend|libEGL|query proxy"`.
- Trigger single-instance actions from CLI: `./target/debug/gapps <app-id|mailto:…|webcal://…|https://…>` opens/activates tabs in the running instance — use it instead of clicking to test activation.
- debug_info red readout in the strip shows inner size, scale, and each webview's tauri bounds — leave it until layout is fixed, then remove (main.rs debug_info + app.js renderDebug + index.html #debug).

## Environment quirks (all real, all hit)

- Rust 1.99, no tauri-cli (not needed). webkit2gtk-4.1 2.52.6, GTK3, glib-networking + gst-plugins-base/good/bad/libav installed.
- KDE Plasma 6.6.6 Wayland; GNOME Shell 50 also installed (GNOME support is a later phase; tray needs an extension there).
- ksni 0.3 needs feature "blocking" for `ksni::blocking::TrayMethods` (`.spawn()` runs its own thread; implement `menu_about_to_show()` → empty, so the autostart checkbox refreshes).
- App commands (#[tauri::command]) need NO permission entries in capabilities (only core/plugin ones). The chrome… tabbar webview must be listed in the capability's `windows` for core:default to apply.
- Tauri 2 multi-webview needs the "unstable" feature (already in Cargo.toml).
- Never trust pre-map sizes on Wayland: `inner_size()` returns 0 before first configure; `client_logical()` falls back to 1280x860.
- User's mailto default stays Betterbird (their choice); webcal → gapps already set in ~/.config/mimeapps.list.

## User requirements (their words, priorities)

1. Browser-style tabs in ONE window; pick apps from a `+` menu; tab layout saved across restarts. Right-click tab → open in browser (then close the tab).
2. Internal Google links (Drive→Docs, Gmail→Sheets…) must open as tabs inside the shell, never the browser.
3. Settings: Open at startup, Start minimized, Clear cache. Cache = warm pages for fast tab reopen.
4. Reload button in the strip (exists, ⟳).
5. Notifications working well, close-to-tray, start minimized/autostart — done and working.
6. Don't call it "chrome".

## Not started / later phases

- Unread badge in tray tooltip/title (poll Gmail via webview eval or Google API — pick later).
- Dark mode sync (KDE color scheme → prefers-color-scheme / per-app CSS).
- Per-app zoom, downloads handling (WebKitGTK downloads currently unhandled — Drive file download may do nothing), Meet screen share verification (gst libs are installed; getDisplayMedia→PipeWire untested), MPRIS, per-app user-agent override if Google sniffs engine.
- Packaging: .desktop already exists for dev path; proper tauri bundler .deb + icons (P3).
- Remove devtools from release build.

## Commit style

Conventional-ish one-liners, everything committed so far in the repo (git initialized). Current HEAD: "stagger webview creation at boot (WebKit/NVIDIA blank-page race); boot off event thread" + debug_info additions uncommitted? — check `git status` first: debug_info command, debug readout, and the boot-time refactor may be uncommitted; commit them as `debug: webview bounds readout in strip` before starting the reparent fix.
