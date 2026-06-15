# header + entropy check - read-only
$desktop = Join-Path $env:USERPROFILE 'Desktop'
$dmp = Get-ChildItem $desktop -Recurse -Filter '9428a285*.dmp' | Select-Object -First 1
$dir = $dmp.DirectoryName
$log = Join-Path $dir 'header.txt'

$fs = [IO.File]::OpenRead($dmp.FullName)
$buf = New-Object byte[] 256
[void]$fs.Read($buf, 0, 256)
$fs.Close()

'first 256 bytes hex:' | Out-File $log -Encoding UTF8
($buf | ForEach-Object { $_.ToString('x2') }) -join ' ' | Out-File $log -Append -Encoding UTF8
'ascii view:' | Out-File $log -Append -Encoding UTF8
(($buf | ForEach-Object { if ($_ -ge 32 -and $_ -le 126) { [char]$_ } else { '.' } }) -join '') | Out-File $log -Append -Encoding UTF8

# zero-byte ratio of first 1MB
$fs = [IO.File]::OpenRead($dmp.FullName)
$mb = New-Object byte[] 1048576
[void]$fs.Read($mb, 0, 1048576)
$fs.Close()
$zeros = ($mb | Where-Object { $_ -eq 0 }).Count
"zero bytes in first 1MB: $zeros / 1048576" | Out-File $log -Append -Encoding UTF8
