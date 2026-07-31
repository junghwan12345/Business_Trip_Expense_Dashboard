# 정식 앱 1.1.19 배포 기록

- 배포 전 정식 버전은 `1.1.18`이고 로컬 `main`은 `business-trip/main`보다 기능 커밋 2개 앞서 있다.
- 다음 패치 버전은 `1.1.19`로 정한다.
- 릴리스 설명은 `지출결의서 증빙 시트 자동 생성 및 PPT 메뉴 정리`로 사용한다.
- 업데이트 개인키 `private/update-private-key.pem`과 공개키 `build/update-public-key.pem`이 존재한다.
- `gh` CLI의 기존 GitHub 토큰은 만료된 상태다. Git push 자격 증명과 연결된 GitHub 수단을 순서대로 확인한다.
- 빌드나 게시 과정에서 생성되는 검증용 임시 파일은 정리하되 기존 `dist`의 과거 버전 설치파일은 삭제하지 않는다.
- 1.1.19 버전으로 자바스크립트 및 PowerShell 구문 검사를 통과했다.
- `node --test tests/*.test.mjs` 실행 결과 전체 118개 테스트가 통과했다.
- `npm.cmd run build:win`으로 1.1.19 Windows 설치파일을 생성했다. 설치파일 크기는 121,800,059바이트다.
- 패키징된 `app.asar`의 버전은 1.1.19이며, 증빙 시트 모듈과 서버 연결 코드가 포함됐다.
- 패키징된 화면에는 PPT 메뉴가 없고 복구용 PPT 화면 코드는 보존돼 있다.
- 설치파일 SHA-256은 `cbd7ab22bd516979cb32c2dfaf528aec41be1b3c92e2a730a898a0fbc5f73e8b`다.
- `validateUpdateManifest`로 1.1.18 기준 업데이트 manifest의 해시와 전자서명을 검증했고 `verified` 결과를 확인했다.
