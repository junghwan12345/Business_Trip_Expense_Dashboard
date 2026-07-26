# 설치 전 실행 중인 출장비 앱 프로세스를 정리합니다.
$ErrorActionPreference = "SilentlyContinue"

$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$installRoots = @(
  (Join-Path $localAppData "Programs\business-trip-proof"),
  (Join-Path $localAppData "Programs\출장비 증빙 정리")
)
$dataRoot = Join-Path $localAppData "BusinessTripProof"
$matchTexts = @(
  "business-trip-proof",
  "BusinessTripProof",
  "출장비 증빙 정리"
) + $installRoots
$safeInstallerPattern = "BusinessTripProof-*-Setup.exe"
$deadline = (Get-Date).AddSeconds(45)
$logPath = Join-Path $dataRoot "update-cleanup.log"

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
"[$(Get-Date -Format o)] cleanup start" | Add-Content -Path $logPath -Encoding UTF8

do {
  $matched = @()
  $processes = Get-CimInstance Win32_Process
  foreach ($process in $processes) {
    $path = [string]$process.ExecutablePath
    $commandLine = [string]$process.CommandLine
    $name = [string]$process.Name

    if ($name -like $safeInstallerPattern -or $path -like "*\$safeInstallerPattern") {
      continue
    }

    $hit = $false
    foreach ($text in $matchTexts) {
      if (-not $text) {
        continue
      }
      if (
        $path.IndexOf($text, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $commandLine.IndexOf($text, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $name.IndexOf($text, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      ) {
        $hit = $true
        break
      }
    }

    if ($hit) {
      $matched += $process
    }
  }

  foreach ($process in $matched) {
    "[$(Get-Date -Format o)] stop pid=$($process.ProcessId) name=$($process.Name) path=$($process.ExecutablePath)" | Add-Content -Path $logPath -Encoding UTF8
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if ($matched.Count -eq 0) {
    break
  }
  Start-Sleep -Milliseconds 900
} while ((Get-Date) -lt $deadline)

"[$(Get-Date -Format o)] cleanup end" | Add-Content -Path $logPath -Encoding UTF8
Start-Sleep -Milliseconds 1200
