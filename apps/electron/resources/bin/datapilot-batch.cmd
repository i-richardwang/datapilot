@echo off
set "CRAFT_BUN_BIN=%CRAFT_BUN%"
if "%CRAFT_BUN_BIN%"=="" set "CRAFT_BUN_BIN=bun"
"%CRAFT_BUN_BIN%" run "%CRAFT_BATCH_CLI_ENTRY%" %*
