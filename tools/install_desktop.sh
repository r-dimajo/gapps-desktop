#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON="$DIR/icons/icon.png"
LAUNCHER="$DIR/gapps"

chmod +x "$LAUNCHER"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/128x128/apps"

mkdir -p "$APPS_DIR" "$ICONS_DIR"

# Install application icon into standard hicolor theme
cp -f "$ICON" "$ICONS_DIR/gapps.png" 2>/dev/null || true

# Install XDG desktop entry
cat <<EOF > "$APPS_DIR/gapps.desktop"
[Desktop Entry]
Type=Application
Version=1.0
Name=GApps
Comment=Unofficial desktop client for Google Workspace
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
StartupWMClass=gapps
StartupNotify=true
Categories=Network;Office;Chat;
EOF

# Update desktop and icon databases
update-desktop-database "$APPS_DIR" 2>/dev/null || true
kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true

echo "GApps desktop integration installed successfully for $USER!"
