# 출장비 증빙 정리

각 사용자가 본인 PC와 본인 Google Drive에서 거리·유가·쿠팡 증빙을 수집하고 엑셀 자료와 PPT까지 만드는 Windows 앱입니다. 중앙 서버나 공용 증빙 계정은 사용하지 않습니다.

## 실행

개발 중에는 PowerShell에서 아래 명령을 실행합니다.

```powershell
.\start-dashboard.ps1
```

브라우저에서 `http://localhost:4173/travel-proof.html`을 열면 됩니다. Electron 개발창은 `npm run desktop`으로 실행합니다.

## 개인 저장 방식

첫 실행에서 본인 Google Drive 데스크톱 동기화 폴더를 선택합니다. 앱은 그 아래 `출장비증빙/{연월}` 구조를 만들며 다른 사용자의 Drive에는 접근하지 않습니다. Drive가 끊기면 `%LOCALAPPDATA%\BusinessTripProof\pending-sync`에 임시 보관하고 연결 후 이동합니다.

## Windows 설치파일

```powershell
npm install
npm run build:win
```

`dist/BusinessTripProof-{버전}-Setup.exe`가 생성됩니다. 사용자 단위로 설치되며 앱 삭제 시 증빙과 개인 설정은 보존됩니다.

## 출장 증빙 빠른 캡처

출장 증빙 화면은 기본적으로 유가 HTML 선조회, 날짜별 유가 캐시, 거리·유가 병렬 처리, 작업 탭 재사용을 사용합니다. 이전 방식과 비교해야 할 때는 주소 뒤에 `?captureMode=legacy`를 붙여 실행하면 캐시·병렬 처리·탭 재사용을 끌 수 있습니다.

서버 전체에서 빠른 유가 탐색과 탭 재사용을 끄려면 실행 전에 `TRAVEL_PROOF_FAST_CAPTURE=0` 환경 변수를 설정합니다.

## Drive 원격 업데이트

최초 한 번 `npm run update:keys`로 서명키를 만듭니다. `private/update-private-key.pem`은 절대 공유하거나 Git에 추가하지 않습니다. 새 설치파일을 빌드한 후 다음 명령으로 직원들에게 읽기 공유된 Google Drive 업데이트 폴더에 게시합니다.

```powershell
npm run update:publish -- --version 1.1.0 --update-root "G:\내 드라이브\출장비앱-업데이트" --notes "개선 내용"
```

앱은 설치파일과 manifest의 해시·Ed25519 서명을 확인하고, 작업 종료 후 자동 설치합니다.

자세한 파일럿 절차는 [DISTRIBUTION.md](DISTRIBUTION.md)를 참고하세요.
