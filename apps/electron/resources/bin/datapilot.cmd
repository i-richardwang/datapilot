@echo off
rem datapilot — agent-facing CLI wrapper (Windows).
rem
rem By default, runs the unified CLI at %DATAPILOT_UNIFIED_CLI_ENTRY%.
rem Set DATAPILOT_UNIFIED_CLI=0 (or false/no/off) to fall back to the legacy
rem craft-cli at %DATAPILOT_CLI_ENTRY% for one release cycle.
rem
rem If the unified entry is unset (e.g. a packaged build that didn't stage the
rem unified bundle), the wrapper exits non-zero rather than silently falling
rem back to legacy. Set DATAPILOT_UNIFIED_CLI=0 explicitly to opt into legacy.
set "DATAPILOT_BUN_BIN=%DATAPILOT_BUN%"
if "%DATAPILOT_BUN_BIN%"=="" set "DATAPILOT_BUN_BIN=bun"
if "%DATAPILOT_CLI_JSON_ONLY%"=="" set "DATAPILOT_CLI_JSON_ONLY=1"
set "_USE_UNIFIED=1"
if /I "%DATAPILOT_UNIFIED_CLI%"=="0"     set "_USE_UNIFIED=0"
if /I "%DATAPILOT_UNIFIED_CLI%"=="false" set "_USE_UNIFIED=0"
if /I "%DATAPILOT_UNIFIED_CLI%"=="no"    set "_USE_UNIFIED=0"
if /I "%DATAPILOT_UNIFIED_CLI%"=="off"   set "_USE_UNIFIED=0"
if "%_USE_UNIFIED%"=="1" (
  if not defined DATAPILOT_UNIFIED_CLI_ENTRY (
    echo datapilot: DATAPILOT_UNIFIED_CLI_ENTRY is not set; cannot run the unified CLI. Set DATAPILOT_UNIFIED_CLI=0 to fall back to legacy. 1>&2
    exit /b 1
  )
  set "_CLI_ENTRY=%DATAPILOT_UNIFIED_CLI_ENTRY%"
) else (
  set "_CLI_ENTRY=%DATAPILOT_CLI_ENTRY%"
)
"%DATAPILOT_BUN_BIN%" run "%_CLI_ENTRY%" %*
