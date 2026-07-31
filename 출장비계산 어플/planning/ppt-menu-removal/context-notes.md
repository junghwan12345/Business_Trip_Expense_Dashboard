# 증빙자료 PPT 메뉴 제거 결정 기록

- 이번 변경은 기능 삭제가 아니라 사용자 진입 메뉴 제거다.
- 복구가 필요하면 `travel-proof.html`의 사이드바와 우측 상단 간편 메뉴에 `data-page-target="ppt"` 버튼을 다시 추가하면 된다.
- `ppt-workspace`, `PAGE_META.ppt`, PPT 생성 이벤트, 서버 API, 저장 폴더 설정은 그대로 유지한다.
- 기능을 별도 커밋으로 남겨 메뉴 제거만 독립적으로 되돌릴 수 있게 한다.
- `data-page-target="ppt"` 진입점이 0개이고 `data-page-panel="ppt"`와 `createPptButton`이 유지되는 것을 확인했다.
- 전체 Node 테스트 118개가 통과했다.
