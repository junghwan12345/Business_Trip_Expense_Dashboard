# 설치 중 실행 중인 실제 출장비 앱 프로세스만 종료합니다.
$ErrorActionPreference = "SilentlyContinue"

$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$installRoots = @(
  (Join-Path $localAppData "Programs\business-trip-proof"),
  (Join-Path $localAppData "Programs\출장비 증빙 정리")
)
$dataRoot = Join-Path $localAppData "BusinessTripProof"
$deadline = (Get-Date).AddSeconds(20)
$logPath = Join-Path $dataRoot "update-cleanup.log"

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
"[$(Get-Date -Format o)] cleanup start" | Add-Content -Path $logPath -Encoding UTF8

do {
  $matched = @()
  foreach ($process in @(Get-CimInstance Win32_Process)) {
    $path = [string]$process.ExecutablePath
    if (-not $path) { continue }

    foreach ($installRoot in $installRoots) {
      if ($path.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $matched += $process
        break
      }
    }
  }

  foreach ($process in $matched) {
    "[$(Get-Date -Format o)] stop pid=$($process.ProcessId) name=$($process.Name) path=$($process.ExecutablePath)" | Add-Content -Path $logPath -Encoding UTF8
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if ($matched.Count -eq 0) { break }
  Start-Sleep -Milliseconds 700
} while ((Get-Date) -lt $deadline)

"[$(Get-Date -Format o)] cleanup end" | Add-Content -Path $logPath -Encoding UTF8
Start-Sleep -Milliseconds 900