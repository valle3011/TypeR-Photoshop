#!/bin/bash
# TypeR - installer for Photoshop (macOS). Double-click in Finder.
# Installs or updates the plugin with Adobe's own plugin installer.
cd "$(dirname "$0")"
CCX="$PWD/release/TypeR.ccx"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

echo "=== TypeR for Photoshop - installation ==="
if [ ! -f "$CCX" ]; then
  echo "[ERROR] release/TypeR.ccx not found - keep the whole folder."
  read -r -p "Press Enter to close." _
  exit 1
fi

if [ -x "$UPIA" ]; then
  "$UPIA" --remove "TypeR" >/dev/null 2>&1
  if "$UPIA" --install "$CCX"; then
    echo "DONE - restart Photoshop, then: Plugins > TypeR > TypeR"
    read -r -p "Press Enter to close." _
    exit 0
  fi
fi

echo "Opening the plugin with the Creative Cloud app - confirm the installation there."
open "$CCX"
read -r -p "Press Enter to close." _
