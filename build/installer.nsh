!macro customInstall
  CreateDirectory "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}"
  CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\BusinessTripProof\updates\${VERSION}\BusinessTripProof-${VERSION}-Setup.exe"
!macroend
