@echo off
setlocal
echo Building QuickCart Desktop Windows .exe installer and portable build...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-win-exe.ps1" -Target all
if %errorlevel% neq 0 (
  echo.
  echo Build failed with exit code %errorlevel%.
  pause
  exit /b %errorlevel%
)
echo.
echo Done! Check apps\desktop\release for your .exe files.
pause
