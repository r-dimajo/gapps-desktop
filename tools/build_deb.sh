#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

echo "==> Building GApps Debian package (.deb)..."
if ! command -v npx &>/dev/null; then
  echo "Error: npx is not installed or not in PATH."
  exit 1
fi

npx electron-builder --linux deb

echo ""
echo "==> Build finished successfully!"
echo "Generated packages in dist/:"
ls -lh dist/*.deb 2>/dev/null || true
echo ""
echo "To test installation on your system:"
echo "  sudo dpkg -i dist/*.deb"
