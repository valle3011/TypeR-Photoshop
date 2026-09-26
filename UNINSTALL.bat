@echo off
rem === TypeR - Deinstallation (Windows) ===
rem Entfernt das Plugin. Einstellungen und Presets bleiben erhalten, falls
rem es spaeter wieder installiert wird.
setlocal enableextensions
chcp 65001 >nul

set "UPIA=%CommonProgramFiles%\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"

echo ============================================
echo   TypeR fuer Photoshop - Deinstallation
echo ============================================
echo.

if not exist "%UPIA%" (
  echo Adobes Plugin-Installer wurde nicht gefunden.
  echo Deinstallieren ueber die Creative Cloud App: Stock und Marketplace -
  echo Plugins - Verwalten - TypeR - Deinstallieren.
  goto :done
)

"%UPIA%" /remove "TypeR"
if errorlevel 1 (
  echo.
  echo [HINWEIS] TypeR war nicht installiert oder konnte nicht entfernt werden.
  goto :done
)
echo.
echo FERTIG - TypeR wurde entfernt. Photoshop neu starten.

:done
echo.
pause
endlocal
