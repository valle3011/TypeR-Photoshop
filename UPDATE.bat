@echo off
rem === TypeR - Update fuer Photoshop (Windows) ===
rem Laedt die neueste TypeR-Setup.exe von GitHub und spielt sie ein.
rem Ohne Internet wird die mitgelieferte release\TypeR-Setup.exe benutzt.
rem Funktioniert auch als einzelne Datei. Einfach doppelklicken.
rem   UPDATE.bat /force   = auch installieren, wenn schon aktuell
rem   UPDATE.bat /check   = nur die Versionen anzeigen
setlocal enableextensions enabledelayedexpansion
chcp 65001 >nul

set "REPO=valle3011/TypeR-Photoshop"
set "URL=https://github.com/%REPO%/releases/latest/download/TypeR-Setup.exe"
set "TMPEXE=%TEMP%\TypeR-Setup-update.exe"
set "LOCALEXE=%~dp0release\TypeR-Setup.exe"
set "COMMON=%CommonProgramW6432%"
if not defined COMMON set "COMMON=%CommonProgramFiles%"
set "EXTERNAL=%COMMON%\Adobe\UXP\Plugins\External"

echo ============================================
echo   TypeR fuer Photoshop - Update
echo ============================================
echo.

rem --- installierte Version (Ordnername com.typer.photoshop_X.Y.Z) ---
set "INSTALLED="
if exist "%EXTERNAL%\" (
  for /d %%D in ("%EXTERNAL%\com.typer.photoshop_*") do (
    set "N=%%~nxD"
    set "INSTALLED=!N:com.typer.photoshop_=!"
  )
)
if defined INSTALLED (echo Installiert:   %INSTALLED%) else (echo Installiert:   - ^(nicht gefunden^))

rem --- neueste Version auf GitHub (Weiterleitung .../tag/vX.Y.Z) ---
set "LATEST="
set "LOC="
for /f "delims=" %%A in ('curl.exe -sL -o NUL -w "%%{url_effective}" "https://github.com/%REPO%/releases/latest" 2^>nul') do set "LOC=%%A"
if defined LOC (
  rem die Adresse endet auf /tag/vX.Y.Z - der letzte Teil ist die Version
  set "PARTS=!LOC:/= !"
  for %%T in (!PARTS!) do set "LAST=%%T"
  if /i "!LAST:~0,1!"=="v" (set "LATEST=!LAST:~1!") else (set "LATEST=")
)
if defined LATEST (echo Neueste:       %LATEST%) else (echo Neueste:       ^(GitHub nicht erreichbar^))
echo.
if /i "%~1"=="/check" goto :end

if /i not "%~1"=="/force" if defined INSTALLED if defined LATEST if "%INSTALLED%"=="%LATEST%" (
  echo TypeR ist schon aktuell.
  echo Zum erneuten Installieren:  UPDATE.bat /force
  goto :done
)

rem --- neueste Setup laden, sonst die mitgelieferte nehmen ---
set "SETUP="
echo Lade die neueste Version von GitHub ...
curl.exe -fsSL -o "%TMPEXE%" "%URL%" 2>nul
if not errorlevel 1 if exist "%TMPEXE%" set "SETUP=%TMPEXE%"
if not defined SETUP (
  if exist "%LOCALEXE%" (
    echo GitHub nicht erreichbar - benutze die mitgelieferte release\TypeR-Setup.exe.
    set "SETUP=%LOCALEXE%"
  ) else (
    echo [FEHLER] Download fehlgeschlagen und keine release\TypeR-Setup.exe gefunden.
    echo Von Hand herunterladen: %URL%
    goto :fail
  )
)

echo Starte das Setup ... ^(Windows fragt evtl. nach Administratorrechten - "Ja"^)
start "" /wait "%SETUP%"
if exist "%TMPEXE%" del /q "%TMPEXE%" >nul 2>&1

echo.
echo ============================================
echo   FERTIG - das Setup hat sein Ergebnis angezeigt.
echo ============================================
echo.
echo Photoshop neu starten, dann: Plugins - TypeR - TypeR
echo Unten im TypeR-Panel steht die Version - sie muss die neue sein.
echo.
goto :done

:fail
echo.
echo [ABBRUCH] Update nicht abgeschlossen.
echo.

:done
pause
:end
endlocal
