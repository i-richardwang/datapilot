@echo off
rem datapilot — agent-facing CLI wrapper (Windows).
rem
rem By default, runs the legacy craft-cli at %DATAPILOT_CLI_ENTRY%.
rem When DATAPILOT_UNIFIED_CLI is truthy (1, true, yes, on), dispatches to the
rem unified CLI at %DATAPILOT_UNIFIED_CLI_ENTRY% instead. The flag is off by
rem default — legacy behavior is byte-for-byte preserved.
rem
rem If DATAPILOT_UNIFIED_CLI is truthy but DATAPILOT_UNIFIED_CLI_ENTRY is
rem unset, the wrapper exits non-zero rather than silently falling back.
set "DATAPILOT_BUN_BIN=%DATAPILOT_BUN%"
if "%DATAPILOT_BUN_BIN%"=="" set "DATAPILOT_BUN_BIN=bun"
if "%DATAPILOT_CLI_JSON_ONLY%"=="" set "DATAPILOT_CLI_JSON_ONLY=1"
set "_CLI_ENTRY=%DATAPILOT_CLI_ENTRY%"
set "_UNIFIED=0"
if /I "%DATAPILOT_UNIFIED_CLI%"=="1"    set "_UNIFIED=1"
if /I "%DATAPILOT_UNIFIED_CLI%"=="true" set "_UNIFIED=1"
if /I "%DATAPILOT_UNIFIED_CLI%"=="yes"  set "_UNIFIED=1"
if /I "%DATAPILOT_UNIFIED_CLI%"=="on"   set "_UNIFIED=1"
if "%_UNIFIED%"=="1" (
  if not defined DATAPILOT_UNIFIED_CLI_ENTRY (
    echo datapilot: DATAPILOT_UNIFIED_CLI=%DATAPILOT_UNIFIED_CLI% but DATAPILOT_UNIFIED_CLI_ENTRY is not set 1>&2
    exit /b 1
  )
  set "_CLI_ENTRY=%DATAPILOT_UNIFIED_CLI_ENTRY%"
)
"%DATAPILOT_BUN_BIN%" run "%_CLI_ENTRY%" %*
