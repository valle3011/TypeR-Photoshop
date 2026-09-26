@echo off
rem === TypeR - Installer fuer Photoshop (Windows) ===
rem Installiert (oder aktualisiert) das Plugin. Einfach doppelklicken.
rem Benutzt Adobes eigenen Plugin-Installer (kommt mit der Creative Cloud App).
setlocal enableextensions
chcp 65001 >nul

set "CCX=%~dp0release\TypeR.ccx"
set "UPIA=%CommonProgramFiles%\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"

echo ============================================
echo   TypeR fuer Photoshop - Installation
echo ============================================
echo.

if not exist "%CCX%" (
  echo [FEHLER] release\TypeR.ccx nicht gefunden.
  echo Bitte den ganzen Ordner behalten, nicht nur diese Datei.
  goto :fail
)

if not exist "%UPIA%" goto :no_upia

echo Alte Version entfernen (falls vorhanden) ...
"%UPIA%" /remove "TypeR" >nul 2>&1

echo Installiere TypeR ...
"%UPIA%" /install "%CCX%"
if errorlevel 1 goto :try_open

echo.
echo ============================================
echo   FERTIG - TypeR ist installiert.
echo ============================================
echo.
echo Photoshop neu starten, dann: Plugins - TypeR - TypeR
echo.
goto :done

:no_upia
echo Adobes Plugin-Installer wurde nicht gefunden.
:try_open
echo Oeffne die Plugin-Datei mit der Creative Cloud App ...
echo (dort die Installation bestaetigen)
start "" "%CCX%"
if errorlevel 1 goto :manual
echo.
echo Nach der Bestaetigung Photoshop neu starten,
echo dann: Plugins - TypeR - TypeR
echo.
goto :done

:manual
echo.
echo Die Datei konnte nicht geoeffnet werden. Moeglichkeiten:
echo  1. Creative Cloud Desktop App installieren und dieses Skript erneut starten.
echo  2. UXP Developer Tool: "Add Plugin" - release\plugin\manifest.json - "Load".
goto :fail

:fail
echo.
echo [ABBRUCH] Installation nicht abgeschlossen.
echo.

:done
pause
endlocal
