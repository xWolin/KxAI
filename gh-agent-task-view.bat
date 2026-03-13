@echo off
cd /d "%~dp0"

set TASK_ID=%~1
if "%TASK_ID%"=="" (
    echo.
    echo   GitHub Agent Task Viewer for xWolin/KxAI
    echo   ----------------------------------------
    set /p TASK_ID="  Pull request number, session ID, or URL: "
)

if "%TASK_ID%"=="" (
    echo.
    echo   Error: task identifier is required.
    pause
    exit /b 1
)

gh agent-task view "%TASK_ID%" --repo xWolin/KxAI
pause