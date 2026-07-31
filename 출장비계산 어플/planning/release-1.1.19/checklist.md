# 정식 앱 1.1.19 배포 체크리스트

- [x] 현재 정식 버전과 배포 절차를 확인한다.
- [x] `package.json` 버전을 `1.1.19`로 갱신한다.
- [x] 전체 테스트와 문법 검사를 통과한다.
- [x] `BusinessTripProof-1.1.19-Setup.exe`를 생성한다.
- [x] 설치파일에 새 증빙 기능 코드가 포함됐는지 확인한다.
- [x] 서명된 `release-manifest.json`을 생성하고 해시·서명을 검증한다.
- [ ] 버전 변경을 별도 커밋으로 기록한다.
- [ ] `business-trip/main`에 새 커밋을 올린다.
- [ ] GitHub Release `v1.1.19`를 만들고 설치파일과 manifest를 게시한다.
- [ ] 원격 다운로드 파일과 최신 manifest를 검증한다.
