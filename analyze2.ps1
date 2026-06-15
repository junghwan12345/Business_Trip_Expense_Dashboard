# Codex dump module extraction v2 - read-only
$ErrorActionPreference = 'Continue'
$desktop = Join-Path $env:USERPROFILE 'Desktop'
$dmp = Get-ChildItem $desktop -Recurse -Filter '9428a285*.dmp' | Select-Object -First 1
$dir = $dmp.DirectoryName
$log = Join-Path $dir 'modules2.txt'

"dump: $($dmp.FullName)  size: $($dmp.Length)" | Out-File $log -Encoding UTF8

$bytes = [IO.File]::ReadAllBytes($dmp.FullName)
"bytes read: $($bytes.Length)" | Out-File $log -Append -Encoding UTF8

$pat = '[\x20-\x7e]{4,240}?\.(dll|exe|sys)'
$found = New-Object System.Collections.Generic.HashSet[string]

$a = [Text.Encoding]::ASCII.GetString($bytes)
foreach ($m in [regex]::Matches($a, $pat)) { [void]$found.Add('A: ' + $m.Value) }

$u0 = [Text.Encoding]::Unicode.GetString($bytes)
foreach ($m in [regex]::Matches($u0, $pat)) { [void]$found.Add('U0: ' + $m.Value) }

$u1 = [Text.Encoding]::Unicode.GetString($bytes, 1, $bytes.Length - 1)
foreach ($m in [regex]::Matches($u1, $pat)) { [void]$found.Add('U1: ' + $m.Value) }

"matches: $($found.Count)" | Out-File $log -Append -Encoding UTF8
$found | Sort-Object | Out-File $log -Append -Encoding UTF8
