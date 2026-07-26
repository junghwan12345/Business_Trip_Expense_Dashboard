# 설치 전 실행 중인 출장비 앱 프로세스를 정리합니다.
$ErrorActionPreference = "SilentlyContinue"

$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$roots = @(
  (Join-Path $localAppData "Programs\business-trip-proof"),
  (Join-Path $localAppData "Programs\출장비 증빙 정리")
)
$processNames = @("business-trip-proof", "출장비 증빙 정리")
$deadline = (Get-Date).AddSeconds(30)

do {
  $matched = @()
  foreach ($process in Get-Process) {
    $matchesName = $processNames -contains $process.ProcessName
    $path = $null
    try {
      $path = $process.Path
    } catch {}

    $matchesPath = $false
    if ($path) {
      foreach ($root in $roots) {
        if ($path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
          $matchesPath = $true
          break
        }
      }
    }

    if ($matchesName -or $matchesPath) {
      $matched += $process
    }
  }

  foreach ($process in $matched) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  if ($matched.Count -eq 0) {
    break
  }
  Start-Sleep -Milliseconds 800
} while ((Get-Date) -lt $deadline)

Start-Sleep -Milliseconds 1000
