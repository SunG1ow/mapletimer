@echo off
rem Build KeyHoldAlarm.exe with the C# compiler that ships with Windows (.NET Framework 4).
rem Nothing is downloaded or installed.
setlocal
cd /d "%~dp0"

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found. .NET Framework 4 is required.
  pause
  exit /b 1
)

"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 /out:KeyHoldAlarm.exe /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll KeyHoldAlarm.cs
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo [OK] KeyHoldAlarm.exe created. Double-click it to run.
pause
