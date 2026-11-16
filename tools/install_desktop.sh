#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON="$DIR/icons/icon.png"
LAUNCHER="$DIR/google-suite"

# Determine target user homes (handles both standard host environment and snap environments)
HOMES=("$HOME")
if [[ "$HOME" == *"/snap/"* ]]; then
  REAL_HOME=$(echo "$HOME" | sed 's|/snap/.*||')
  if [ -d "$REAL_HOME" ]; then
    HOMES+=("$REAL_HOME")
  fi
fi

# Ensure launcher is executable
chmod +x "$LAUNCHER"

for H in "${HOMES[@]}"; do
  [ -z "$H" ] && continue
  mkdir -p "$H/.local/share/applications/" 2>/dev/null || true
  mkdir -p "$H/.config/autostart/" 2>/dev/null || true
  mkdir -p "$H/.local/share/icons/hicolor/128x128/apps/" 2>/dev/null || true

  # Copy official Google 4-color icon to standard XDG user icon theme
  cp -f "$ICON" "$H/.local/share/icons/hicolor/128x128/apps/gapps.png" 2>/dev/null || true
  cp -f "$ICON" "$H/.local/share/icons/hicolor/128x128/apps/google-suite.png" 2>/dev/null || true

  # Install standard .desktop files for KDE Plasma Task Manager & App Launcher
  GAPPS_FILE="$H/.local/share/applications/gapps.desktop"
  if ( : > "$GAPPS_FILE" ) 2>/dev/null; then
    cat <<EOF > "$GAPPS_FILE"
[Desktop Entry]
Type=Application
Version=1.0
Name=Google Suite
Comment=Google Suite desktop shell for Linux
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
StartupWMClass=gapps
StartupNotify=true
Categories=Network;Office;Chat;
EOF
  fi

  SUITE_FILE="$H/.local/share/applications/google-suite.desktop"
  if ( : > "$SUITE_FILE" ) 2>/dev/null; then
    cat <<EOF > "$SUITE_FILE"
[Desktop Entry]
Type=Application
Version=1.0
Name=Google Suite
Comment=Google Suite desktop shell for Linux
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
StartupWMClass=google-suite
StartupNotify=true
Categories=Network;Office;Chat;
EOF
  fi

  # Install autostart desktop file for KDE / GNOME / XDG autostart
  AUTOSTART_FILE="$H/.config/autostart/gapps.desktop"
  if ( : > "$AUTOSTART_FILE" ) 2>/dev/null; then
    cat <<EOF > "$AUTOSTART_FILE"
[Desktop Entry]
Type=Application
Version=1.0
Name=Google Suite
Comment=Google Suite desktop shell for Linux
Exec=$LAUNCHER
Icon=$ICON
Terminal=false
StartupWMClass=gapps
StartupNotify=false
Categories=Network;Office;Chat;
X-GNOME-Autostart-enabled=true
X-KDE-autostart-after=panel
X-KDE-autostart-phase=2
EOF
  fi

  # Refresh KDE Sycoca configuration and desktop database
  update-desktop-database "$H/.local/share/applications/" 2>/dev/null || true
done

kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null || true

echo "KDE desktop files, autostart configuration, and Google Suite icons installed successfully in: ${HOMES[*]}"
