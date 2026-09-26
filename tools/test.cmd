@echo off
rem Run the test suite with the out-of-tree dev dependencies.
set DEV=%LOCALAPPDATA%\typer-ps-dev
node "%DEV%\node_modules\vitest\vitest.mjs" run %*
