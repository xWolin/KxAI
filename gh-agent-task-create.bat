@echo off
cd /d "%~dp0"

set TASK_DESC=%*
if "%TASK_DESC%"=="" (
    echo.
    echo   GitHub Agent Task for xWolin/KxAI
    echo   ---------------------------------
    set /p TASK_DESC="  Task description: "
)

if "%TASK_DESC%"=="" (
    echo.
    echo   Error: task description is required.
    pause
    exit /b 1
)

gh agent-task create "%TASK_DESC%" --repo xWolin/KxAI --follow
pause