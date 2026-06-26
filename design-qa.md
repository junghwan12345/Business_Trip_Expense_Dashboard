# 조활비·소모품비 대시보드 UI QA

## Reference

- `C:\Users\배정환\Downloads\ChatGPT Image 2026년 6월 25일 오후 04_03_34.png`

## Checked implementation

- URL: `http://localhost:4173/travel-proof.html`
- Screen: `조활비·소모품비 대시보드`
- Screenshot: `coupang-dashboard-1366.png`
- Bottom-state screenshot: `coupang-dashboard-bottom-1366.png`

## Result

- 상단 조활비/소모품비 카드가 2열, 동일 높이, progress 포함 구조로 표시됨.
- 조활비/소모품비 사용 금액과 한도는 각 progress 영역의 우측 상단에 표시됨.
- 쿠팡 캡처/처리 결과 영역이 1366px 화면에서 2열로 유지됨.
- 결과 빈 상태 문구가 표시됨.
- 월별 현황과 사용 이력 영역이 별도 카드로 분리됨.
- 사용자 요청에 따라 월별 현황 카드, 조회월 선택, 새로고침, 요약 5개 카드는 화면에서 제거됨.
- 수기 내역 추가 폼은 접힘/펼침 구조로 동작함.
- 사용 이력은 날짜/구분/금액/품목/증빙/관리 표 구조로 렌더링됨.
- 기존 버튼/입력 ID와 데이터 처리 흐름은 유지됨.
- `npm.cmd test`: 117 passed.

final result: passed
