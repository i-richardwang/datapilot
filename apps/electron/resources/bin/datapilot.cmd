@echo off
rem datapilot — agent-facing CLI wrapper (Windows).
rem
rem Dispatches to the unified CLI entry at %DATAPILOT_CLI_ENTRY%.
set "DATAPILOT_BUN_BIN=%DATAPILOT_BUN%"
if "%DATAPILOT_BUN_BIN%"=="" set "DATAPILOT_BUN_BIN=bun"
if "%DATAPILOT_CLI_JSON_ONLY%"=="" set "DATAPILOT_CLI_JSON_ONLY=1"
"%DATAPILOT_BUN_BIN%" run "%DATAPILOT_CLI_ENTRY%" %*
