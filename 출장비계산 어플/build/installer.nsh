!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\close-business-trip-proof.ps1 "${BUILD_RESOURCES_DIR}\close-business-trip-proof.ps1"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\close-business-trip-proof.ps1"'
!macroend

!macro customInstall
  CreateDirectory "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}"
  CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}\BusinessTripProof-${VERSION}-Setup.exe"
!macroend
