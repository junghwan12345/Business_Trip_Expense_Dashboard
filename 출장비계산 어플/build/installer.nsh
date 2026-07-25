!macro customInit
  nsExec::ExecToLog 'taskkill /F /T /IM "출장비 증빙 정리.exe"'
!macroend

!macro customInstall
  CreateDirectory "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}"
  CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}\BusinessTripProof-${VERSION}-Setup.exe"
!macroend
