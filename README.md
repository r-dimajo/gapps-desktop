# Google Suite for Linux

A lightweight, multi-tab desktop shell for Google Workspace applications on Linux desktop environments.

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
| `Alt + Shift + V` | Toggle vertical / horizontal tabs layout |
| `Ctrl + Alt + G` | Global hotkey to show or hide the application window |

---

## Installation

### Debian / Ubuntu (`.deb`)
Download the latest `.deb` package from the [Releases](https://github.com/r-dimajo/google-suite-linux/releases) section and install it:
```bash
sudo dpkg -i google-suite-linux_*.deb
```

### Universal Linux (`.AppImage`)
Download the `.AppImage` from [Releases](https://github.com/r-dimajo/google-suite-linux/releases):
```bash
chmod +x google-suite-linux_*.AppImage
./google-suite-linux_*.AppImage
```

### Running from Source
```bash
git clone https://github.com/r-dimajo/google-suite-linux.git
cd google-suite-linux
npm install
npm start
```

---

## License

This project is released under the MIT License.
