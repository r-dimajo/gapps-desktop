<p align="center"><img src="icons/linux/128x128.png" width="96" alt="GApps logo"></p>

# GApps

**Unofficial** lightweight, multi-tab desktop client for Google Workspace applications on Linux desktop environments.

> GApps is an independent open-source project. It is not affiliated with, endorsed or sponsored by Google LLC.
> Google, Gmail, Google Chat, Google Calendar, Google Drive, Google Docs, Google Sheets, Google Slides, Google Meet,
> Gemini, Google Keep, Google Tasks, Google Translate and Google Workspace are trademarks of Google LLC.
> GApps does not bundle Google logos: service icons are loaded at runtime from Google's own servers, like a browser does.

Built on Electron, tailored specifically for Linux Wayland and X11 sessions (GNOME, KDE Plasma, and others).

---

## Supported Applications

- **Gmail**
- **Google Chat**
- **Google Calendar**
- **Google Drive**
- **Google Docs**
- **Google Sheets**
- **Google Slides**
- **Google Meet** (with PipeWire Wayland screen sharing)
- **Google Gemini**
- **Google Keep**
- **Google Tasks**
- **Google Translate**

---

## Features

- **Multi-Tab Workspace**: Isolated web views for each service with low memory footprint and tab reordering.
- **Split View Multiplexing**: Tile two tabs simultaneously side-by-side or stacked (`Alt+Shift+S`, right-click on any tab, or toolbar split button).
- **Vertical & Horizontal Layouts**: Switch instantly between a top tab strip and a side tab bar (`Alt+Shift+V`).
- **Tab Pinning & Custom Naming**: Pin dedicated pages (such as a specific chat or shared drive) and customize tab titles via right-click > "Rename tab…" or double-click.
- **URL Indicator**: Dedicated URL bar displays the current page address with one-click copy.
- **Tab Protection**: Lock vital communication tabs (Gmail, Chat, Calendar) to prevent accidental closure.
- **Desktop Adaptation**: Automatically matches your active desktop environment (Libadwaita styling on GNOME, Breeze on KDE Plasma).
- **Intelligent Notifications**: Native desktop banners and unread indicators that clear automatically once you view or interact with the active conversation.
- **System Tray Integration**: Background running with quick app navigation and unread status badges.
- **Link Routing**: Google Workspace links stay contained within the app; external web links open directly in your default system browser.
- **Memory Saver**: Tabs inactive for more than 30 minutes are hibernated to conserve RAM, restoring on click.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + T` | Open new tab / Google apps dashboard |
| `Ctrl + W` | Close current tab (unlocked tabs only) |
| `Ctrl + Tab` | Switch to next tab |
| `Ctrl + Shift + Tab` | Switch to previous tab |
| `Ctrl + 1` ... `Ctrl + 9` | Direct switch to tabs 1 through 9 |
| `Ctrl + R` | Reload active tab |
| `Alt + Home` | Go back to the tab's home page (set when pinning, or from the tab menu) |
| `Alt + Shift + V` | Toggle vertical / horizontal tabs layout |
| `Alt + Shift + S` | Toggle / configure split view multiplexer |
| `Ctrl + Alt + G` | Global hotkey to show or hide the application window |

---

## Installation

### Debian / Ubuntu (`.deb`)
Download the latest `.deb` package from the [Releases](https://github.com/r-dimajo/gapps-desktop/releases) section and install it:
```bash
sudo dpkg -i gapps-desktop_*.deb
```

### Universal Linux (`.AppImage`)
Download the `.AppImage` from [Releases](https://github.com/r-dimajo/gapps-desktop/releases):
```bash
chmod +x gapps-desktop_*.AppImage
./gapps-desktop_*.AppImage
```

### Running from Source
```bash
git clone https://github.com/r-dimajo/gapps-desktop.git
cd gapps-desktop
npm install
npm start
```

---

## License

This project is released under the MIT License.
The MIT License covers the source code and the GApps logo (`icons/`). Google trademarks and logos belong to Google LLC and are not part of this project.
