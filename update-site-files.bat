@echo off
setlocal

set "REPO_DIR=C:\Users\koppe\OneDrive\Documents\GitHub\Pixelworkdesign.git"
set "DOWNLOAD_INDEX=C:\Users\koppe\Downloads\index.html"

echo Pixelworkdesign site updater
echo.
echo Repo folder:
echo   %REPO_DIR%
echo.

if not exist "%REPO_DIR%\" (
  echo Repo folder was not found.
  pause
  exit /b 1
)

if exist "%DOWNLOAD_INDEX%" (
  echo Found downloaded index.html:
  echo   %DOWNLOAD_INDEX%
  echo.
  set /p "COPY_INDEX=Copy this file into the repo as index.html? Type Y to copy: "
  if /I "%COPY_INDEX%"=="Y" (
    copy /Y "%DOWNLOAD_INDEX%" "%REPO_DIR%\index.html"
  )
) else (
  echo No downloaded index.html found at:
  echo   %DOWNLOAD_INDEX%
)

echo.
echo Files currently in the repo:
dir /B "%REPO_DIR%\index.html" "%REPO_DIR%\favicon.ico" "%REPO_DIR%\favicon.svg" "%REPO_DIR%\favicon.png" 2>nul

echo.
echo Opening the repo folder.
echo Use GitHub Desktop: File ^> Add local repository ^> choose this folder.
echo Then commit and push the changes to lepokinternational-spec/Pixelworkdesign.
start "" "%REPO_DIR%"

pause
