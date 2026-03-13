@echo off
cd /d "%~dp0"

set FOUND=
for /f "delims=" %%L in ('gh agent-task list') do (
	echo %%L | findstr /I /C:"xWolin/KxAI" >nul
	if not errorlevel 1 (
		echo %%L
		set FOUND=1
	)
)

if not defined FOUND (
	echo.
	echo   No GitHub agent tasks found for xWolin/KxAI.
)

pause