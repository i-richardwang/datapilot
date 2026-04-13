@echo off
rem Deprecated: use 'datapilot batch' instead.
set "DATAPILOT_BUN_BIN=%DATAPILOT_BUN%"
if "%DATAPILOT_BUN_BIN%"=="" set "DATAPILOT_BUN_BIN=bun"
"%DATAPILOT_BUN_BIN%" run "%DATAPILOT_CLI_ENTRY%" batch %*
