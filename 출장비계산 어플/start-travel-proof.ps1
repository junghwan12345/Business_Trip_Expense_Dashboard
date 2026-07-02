$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$port = 4173

Set-Location $PSScriptRoot

$connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
  $processId = $connection.OwningProcess
  if ($processId -and $processId -ne $PID) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path $node)) {
  $node = "node"
}

Write-Host "출장비 증빙 캡처: http://localhost:$port/travel-proof.html"
& $node server.mjs
