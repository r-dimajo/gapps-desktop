#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON="$DIR/icons/icon.png"

mkdir -p ~/.local/share/applications/
mkdir -p ~/.local/share/icons/hicolor/128x128/apps/

# Copy official Google 4-color icon to standard XDG user icon theme
cp -f "$ICON" ~/.local/share/icons/hicolor/128x128/apps/gapps.png
cp -f "$ICON" ~/.local/share/icons/hicolor/128x128/apps/google-suite.png

# Install standard .desktop files for KDE Plasma Task Manager & App Launcher
cat <<EOF > ~/.local/share/applications/gapps.desktop
[Desktop Entry]
Name=Google Suite
Comment=Google Suite desktop shell for Linux
Exec=npm start --prefix $DIR
Icon=$ICON
Terminal=false
Type=Application
StartupWMClass=gapps
StartupNotify=true
Categories=Network;Office;Chat;
EOF

cat <<EOF > ~/.local/share/applications/google-suite.desktop
[Desktop Entry]
Name=Google Suite
Comment=Google Suite desktop shell for Linux
Exec=npm start --prefix $DIR
Icon=$ICON
Terminal=false
Type=Application
StartupWMClass=google-suite
StartupNotify=true
Categories=Network;Office;Chat;
EOF

# Refresh KDE Sycoca configuration and desktop database
update-desktop-database ~/.local/share/applications/ 2>/dev/null || true
kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true

echo "KDE desktop files and Google Suite icons installed successfully!"
