@echo off
rem Candym - demarre le serveur local et ouvre le site.
chcp 65001 >nul
title Candym
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable. Installe-le depuis https://nodejs.org ^(version 22.5 ou plus^).
  echo.
  pause
  exit /b 1
)

rem Installe ou complete les dependances si besoin (premiere utilisation ou mise a jour).
call npm ls --omit=dev >nul 2>nul
if errorlevel 1 (
  echo Installation des dependances...
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo [ERREUR] L'installation a echoue.
    pause
    exit /b 1
  )
)

echo Demarrage du serveur sur http://localhost:3400
echo Laisse cette fenetre ouverte pendant l'utilisation (et a l'heure des envois programmes).
echo Ferme-la ou fais Ctrl+C pour arreter.
echo.

rem Laisse au serveur le temps de demarrer avant d'ouvrir le navigateur.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3400"

call npm start

echo.
echo Le serveur s'est arrete.
pause
