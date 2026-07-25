@REM electron-builder가 npm ls JSON을 읽을 수 있게 연결하는 빌드용 shim
@echo off
node "%~dp0npm-ls-shim.cjs" %*
