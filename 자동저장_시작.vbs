Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\auto_save.ps1""", 0, False
MsgBox "자동저장 시작됨! 5분마다 GitHub에 자동으로 저장됩니다.", 64, "자동저장"
