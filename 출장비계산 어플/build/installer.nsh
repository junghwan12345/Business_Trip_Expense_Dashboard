!macro customInit
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$ErrorActionPreference = ''SilentlyContinue''; $$root = Join-Path $$env:LOCALAPPDATA ''Programs\business-trip-proof''; Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 1500"'
!macroend

!macro customInstall
  CreateDirectory "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}"
  CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}\BusinessTripProof-${VERSION}-Setup.exe"
!macroend
