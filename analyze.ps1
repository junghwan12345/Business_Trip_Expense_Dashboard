# Codex crash analysis - read-only diagnostics
$ErrorActionPreference = 'SilentlyContinue'
$desktop = Join-Path $env:USERPROFILE 'Desktop'
$dmp = Get-ChildItem $desktop -Recurse -Filter '9428a285*.dmp' | Select-Object -First 1
$dir = $dmp.DirectoryName

# 1) Extract module paths embedded in the crash dump (UTF-16 strings)
$bytes = [IO.File]::ReadAllBytes($dmp.FullName)
$u = [Text.Encoding]::Unicode.GetString($bytes)
[regex]::Matches($u, '[A-Za-z]:\\[^\x00-\x1f"<>|?*]{3,260}?\.(dll|exe|sys)') |
    ForEach-Object { $_.Value } | Sort-Object -Unique |
    Out-File (Join-Path $dir 'modules.txt') -Encoding UTF8

# 2) Windows Application log - Application Error (1000) entries with faulting module
Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000} -MaxEvents 30 |
    ForEach-Object { '[' + $_.TimeCreated + ']' + [Environment]::NewLine + $_.Message + [Environment]::NewLine + '------' } |
    Out-File (Join-Path $dir 'events.txt') -Encoding UTF8

# 3) Codex-related processes currently alive
Get-Process | Where-Object { $_.Name -match 'codex|crashpad' } |
    Select-Object Name, Id, Path | Format-List |
    Out-File (Join-Path $dir 'processes.txt') -Encoding UTF8

'done ' + (Get-Date) | Out-File (Join-Path $dir 'analysis_done.txt') -Encoding UTF8
