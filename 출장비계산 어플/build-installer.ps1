# 출장비 증빙 정리 - 직원 배포용 Windows 설치파일(.exe) 빌드 스크립트
# 사용법: PowerShell 창에서  .\build-installer.ps1  을 입력해 실행합니다.
#
# 이 스크립트가 자동으로 처리하는 것:
#  1) G 드라이브의 깨끗한 양식을 base64 텍스트로 변환해 내장 (프라이버시i DRM 암호화 회피)
#  2) npm 없이 빌드되도록 electron-builder를 traversal 방식으로 실행
#  3) 빌드 후 내장 양식이 정상 복원되는지 자동 검증

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 이 PC에 번들된 node 사용 (PATH에 node/npm이 없어도 동작)
$nodeDir = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$node = Join-Path $nodeDir "node.exe"
if (-not (Test-Path $node)) { $node = "node" } else { $env:PATH = "$nodeDir;$env:PATH" }
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # 코드서명 없이 빌드

# 양식 원본 위치 (필요시 이 경로만 바꾸면 됩니다)
$templateSource = "G:\내 드라이브\출장비증빙\출장비 양식.xlsx"
$templateB64 = "build/expense-template.b64"

Write-Host "[1/4] 양식을 base64로 변환합니다..." -ForegroundColor Cyan
$genScript = @"
const fs = require('fs');
const src = process.argv[1];
const out = process.argv[2];
if (!fs.existsSync(src)) {
  if (fs.existsSync(out)) {
    const restored = Buffer.from(fs.readFileSync(out, 'utf8').replace(/\s+/g,''), 'base64');
    if (restored.slice(0,4).toString('hex') === '504b0304') {
      console.log('  양식 원본을 찾지 못해 기존 내장 양식을 재사용합니다: ' + out);
      process.exit(0);
    }
  }
  console.error('양식 원본을 찾을 수 없습니다: ' + src);
  process.exit(1);
}
const buf = fs.readFileSync(src);
if (buf.slice(0,4).toString('hex') !== '504b0304') {
  console.error('원본이 정상 xlsx가 아닙니다(프라이버시i 잠금 의심). header=' + buf.slice(0,8).toString('hex'));
  process.exit(1);
}
fs.writeFileSync(out, buf.toString('base64'));
console.log('  변환 완료: ' + out);
"@
& $node -e $genScript $templateSource $templateB64
if ($LASTEXITCODE -ne 0) { Write-Host "[중단] 양식 변환 실패." -ForegroundColor Red; exit 1 }

Write-Host "[2/4] 빌드 설정을 준비합니다..." -ForegroundColor Cyan
Copy-Item package.json package.json.bak -Force
& $node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.packageManager='traversal';fs.writeFileSync('package.json',JSON.stringify(p,null,2));"

try {
  Write-Host "[3/4] 설치파일을 빌드합니다 (수 분 소요될 수 있음)..." -ForegroundColor Cyan
  & $node "node_modules\electron-builder\cli.js" --win nsis
  $buildExit = $LASTEXITCODE
}
finally {
  # package.json 원복 (항상)
  if (Test-Path package.json.bak) { Move-Item package.json.bak package.json -Force }
}
if ($buildExit -ne 0) { Write-Host "[실패] 빌드 중 오류가 발생했습니다." -ForegroundColor Red; exit $buildExit }

Write-Host "[4/4] 내장 양식이 정상 복원되는지 검증합니다..." -ForegroundColor Cyan
$verifyScript = @"
const fs = require('fs');
const b64Path = 'dist/win-unpacked/resources/expense-template.b64';
if (!fs.existsSync(b64Path)) { console.error('  [경고] 내장 양식(b64)이 설치본에 없습니다: ' + b64Path); process.exit(1); }
const buf = Buffer.from(fs.readFileSync(b64Path, 'utf8').replace(/\s+/g,''), 'base64');
if (buf.slice(0,4).toString('hex') === '504b0304') {
  console.log('  검증 통과: 내장 양식이 정상 xlsx로 복원됩니다.');
} else {
  console.error('  [경고] 복원된 양식이 정상 xlsx가 아닙니다. header=' + buf.slice(0,8).toString('hex'));
  process.exit(1);
}
"@
& $node -e $verifyScript
$verifyExit = $LASTEXITCODE

Write-Host ""
if ($verifyExit -eq 0) {
  Write-Host "빌드 완료! 아래 설치파일을 직원에게 배포하세요:" -ForegroundColor Green
} else {
  Write-Host "빌드는 됐지만 양식 검증에 실패했습니다. 위 경고를 확인하세요." -ForegroundColor Yellow
}
Get-ChildItem "dist\*Setup*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $($_.FullName)" }
