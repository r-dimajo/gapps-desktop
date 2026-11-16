#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON="$DIR/icons/icon.png"
LAUNCHER="$DIR/google-suite"

chmod +x "$LAUNCHER"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/128x128/apps"

mkdir -p "$APPS_DIR" "$ICONS_DIR"

# Install application icon into standard hicolor theme
cp -f "$ICON" "$ICONS_DIR/google-suite.png" 2>/dev/null || true

# Install XDG desktop entry
cat <<EOF > "$APPS_DIR/google-suite.desktop"
[Desktop Entry]
Type=Application
Version=1.0
Name=Google Suite
Comment=Google Workspace desktop client for Linux
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
StartupWMClass=google-suite
StartupNotify=true
Categories=Network;Office;Chat;
EOF

# Update desktop and icon databases
update-desktop-database "$APPS_DIR" 2>/dev/null || true
kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true

echo "Google Suite desktop integration installed successfully for $USER!"
