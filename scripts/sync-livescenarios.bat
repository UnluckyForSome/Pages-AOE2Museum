@echo off
REM ============================================================================
REM  sync-livescenarios.bat
REM
REM  Publishes your local livescenarios\ folder to production R2 + D1.
REM  Detailed step-by-step output is printed by sync-livescenarios.ps1.
REM
REM  BEFORE FIRST RUN:
REM    npm run db:migrate:scenarios:v5
REM    npm run deploy
REM    set SYNC_SECRET=<same as: wrangler secret put SYNC_SECRET>
REM    rclone remote "livescenarios:scenarios" -> R2 bucket "scenarios"
REM
REM  PIPELINE (3 steps):
REM    1. Reconcile  - sync disk <-> R2 (pull missing catalog files, dedupe, push)
REM    2. POST sync  - Worker updates D1 rows to match R2 keys
REM    3. Backfill   - parse unparsed scenarios into D1 + minimaps
REM
REM  OPTIONAL ENV VARS:
REM    SYNC_SECRET       (required) bearer token for POST /api/scenarios/sync
REM    SITE_URL          default https://aoe2museum.com
REM    SKIP_RECONCILE=1  only run steps 2+3 (after a successful reconcile)
REM
REM  Run from cmd so you can scroll:  scripts\sync-livescenarios.bat
REM  Double-click also works (pauses at end).
REM ============================================================================

setlocal
cd /d "%~dp0.."

echo.
echo ============================================================================
echo   sync-livescenarios
echo ============================================================================
echo   Repo : %CD%
echo   Local: %CD%\livescenarios
echo.

if "%SYNC_SECRET%"=="" (
  echo [ERROR] SYNC_SECRET is not set.
  echo.
  echo   In this cmd window, run:
  echo     set SYNC_SECRET=your-token
  echo     scripts\sync-livescenarios.bat
  echo.
  echo   Token must match production:
  echo     wrangler secret put SYNC_SECRET
  echo.
  set EXITCODE=1
  goto :done
)

set RCLONE_REMOTE=livescenarios:scenarios
if not defined SITE_URL set SITE_URL=https://aoe2museum.com

echo   R2 via rclone : %RCLONE_REMOTE%
echo   Worker        : %SITE_URL%
if defined SKIP_RECONCILE (
  echo   Mode          : skip reconcile ^(POST sync + backfill only^)
) else (
  echo   Mode          : full pipeline ^(reconcile + POST sync + backfill^)
)
if "%WRANGLER_D1_LOCAL%"=="1" (
  echo   wrangler      : LOCAL D1/R2 ^(WRANGLER_D1_LOCAL=1^)
) else (
  echo   wrangler      : remote production D1/R2
)
echo.
echo Starting PowerShell pipeline...
echo.

set PS_ARGS=-RcloneRemote "%RCLONE_REMOTE%" -SiteUrl "%SITE_URL%"
if defined SKIP_RECONCILE set PS_ARGS=%PS_ARGS% -SkipReconcile

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-livescenarios.ps1" %PS_ARGS%
set EXITCODE=%ERRORLEVEL%

:done
echo.
if %EXITCODE% neq 0 (
  echo ============================================================================
  echo   FAILED ^(exit code %EXITCODE%^)
  echo ============================================================================
) else (
  echo ============================================================================
  echo   SUCCESS
  echo ============================================================================
)
echo.
pause
exit /b %EXITCODE%
