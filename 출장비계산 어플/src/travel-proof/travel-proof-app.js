import {
  buildFieldVisitExpensePasteRows,
  buildMonthlyProofGroups,
  canRetryFailedCapture,
  canRunCapture,
  createManualProofGroup,
  parseTravelProofTable,
  rememberFailedCapture,
  removeFailedCapture
} from "./travel-proof.js";
import {
  COUPANG_PROOF_FOLDERS,
  expenseLimitSummary,
  parseCoupangCaptureDates,
  receiptFileBaseName
} from "./coupang-proof.js";
import {
  CORPORATE_CARD_EXPENSE_ITEMS,
  CORPORATE_CARD_TARGET_SHEETS,
  corporateCardAllowanceType,
  normalizeCorporateCardEntry,
  parseCorporateCardPaste
} from "./corporate-card.js";
import {
  GENERAL_TRAVEL_ITEMS,
  TRAVEL_SHEET_COLUMN_SPANS,
  buildCorporateCardFieldVisitPasteRows,
  buildCorporateCardGeneralTravelPasteRows,
  buildCorporateCardPasteRows,
  buildGeneralTravelPasteRows,
  normalizeManualExpenseEntry
} from "./expense-excel.js";
import {
  HIPASS_TOLL_FOLDER,
  buildTollExpensePasteRows,
  isNoHipassTollResult
} from "./hipass-toll.js";
import {
  EXTRA_PROOF_FOLDER_ALIASES,
  groupProofImagesByDate,
  proofMonthDirectoryPath,
  proofSubfolder,
  proofTypeFromFileName,
  selectedMonthKey
} from "./proof-ppt.js";
import { buildWeekdayCalendarMonth } from "./korean-business-calendar.js";
import { initInitialSetup, isInitialSetupCompleted, writeInitialSetup } from "./initial-setup.js";

const now = new Date();
const PPT_IMAGE_DIRECT_SIZE_LIMIT = 1_200_000;
const PPT_IMAGE_MAX_SIDE = 2200;
const PPT_IMAGE_JPEG_QUALITY = 0.88;
const AUTO_PREVIEW_DELAY_MS = 450;
const AUTO_PROOF_PREVIEW_DELAY_MS = 350;
const GENERAL_TRAVEL_STORAGE_KEY = "travel-proof:general-travel-entries";
const FUEL_ROWS_STORAGE_KEY = "travel-proof:fuel-rows";
const TOLL_ROWS_STORAGE_KEY = "travel-proof:toll-rows";
const APP_SETTINGS_STORAGE_KEY = "travel-proof:app-settings";
const PERSISTENT_APP_STATE_ENDPOINT = "/api/travel-proof/app-state";
const FAST_CAPTURE_ENABLED = new URLSearchParams(window.location.search).get("captureMode") !== "legacy";
const PROTOTYPE_PREVIEW = new URLSearchParams(window.location.search).get("prototype") === "1";
const PAGE_META = Object.freeze({
  distance: {
    title: "거리 유류대 통행료 캡처",
    icon: "ph-gas-pump",
    description: "출장 경로와 날짜별 유가·통행료 증빙을 자동으로 준비합니다.",
    help: "거리·유가·통행료 중 필요한 항목을 선택하고 캡처 시작을 누르세요."
  },
  coupang: {
    title: "조활비·소모품비 대시보드",
    icon: "ph-receipt",
    description: "쿠팡 증빙을 캡처하고 조활비·소모품비 사용 내역을 관리합니다.",
    help: "인원과 캡처 날짜를 입력한 뒤 결과를 확인하고 필요한 내역을 확정하세요."
  },
  "excel-export": {
    title: "지출결의서 Excel 제작",
    icon: "ph-file-xls",
    description: "출장과 법인카드 내역을 회사 엑셀에 붙여넣을 형태로 정리합니다.",
    help: "법인카드 표를 읽고 항목을 분류한 뒤 각 결과 카드에서 복사하세요."
  },
  ppt: {
    title: "증빙자료 PPT 제작",
    icon: "ph-presentation-chart",
    description: "날짜별 증빙을 확인하고 증빙자료 PPT를 제작합니다.",
    help: "먼저 미리보기로 거리·유가와 추가증빙을 확인한 뒤 PPT를 생성하세요."
  },
  storage: {
    title: "설정",
    icon: "ph-gear-six",
    description: "저장 위치와 앱에서 반복 사용하는 기준값을 관리합니다.",
    help: "필요한 설정을 바꾸고 저장자료를 정리하세요."
  }
});
const oilCapturePromises = new Map();
const STORAGE_CLEANUP_FOLDERS = [
  "거리캡처",
  "유가캡처",
  HIPASS_TOLL_FOLDER,
  ...EXTRA_PROOF_FOLDER_ALIASES,
  COUPANG_PROOF_FOLDERS.welfare,
  COUPANG_PROOF_FOLDERS.supply,
  COUPANG_PROOF_FOLDERS.other,
  COUPANG_PROOF_FOLDERS.review,
  "PPT"
];
const STORAGE_SETTING_GROUPS = [
  {
    key: "distanceOil",
    label: "거리유류대통행료",
    keys: ["route", "oil", "toll", "extra"]
  },
  {
    key: "coupangExpenses",
    label: "조활비·소모품비",
    keys: ["coupang", "welfare", "supply", "review", "ledger"]
  },
  {
    key: "ppt",
    label: "증빙자료 PPT 제작",
    keys: ["ppt"]
  }
];
let autoPreviewTimer = null;
let autoProofPreviewTimer = null;
let persistentAppStateTimer = null;
// 서버 백업 복원(hydrate)이 끝나기 전에는 저장하지 않습니다.
// (복원 전 빈 localStorage가 서버 백업 파일을 덮어써 기록이 사라지는 것을 방지)
let appStateHydrated = false;
const EXCEL_FIELD_PREVIEW_LIMIT = 5;
const CORPORATE_CARD_PREVIEW_LIMIT = 6;
// 헤더 정렬·필터 칩 관련 모듈 상수 (초기 렌더 전에 초기화되도록 최상단에 선언)
const EXCEL_PREVIEW_SORT_PREFIX = "excelPreview:";
const LEDGER_TYPE_SORT_RANK = { welfare: 0, supply: 1, other: 2, review: 3 };
// 조활비·소모품비는 선임/팀장(manager)만 사용합니다. 강사(instructor)에게는 메뉴를 숨깁니다.
const MANAGER_ONLY_PAGES = new Set(["coupang"]);
const LEDGER_FILTER_CHIPS = [
  ["all", "전체"],
  ["welfare", "조활비"],
  ["supply", "소모품비"],
  ["other", "기타"]
];

const state = {
  groups: [],
  errors: [],
  failedJobs: [],
  fuelRows: [],
  tollRows: [],
  tollBatchResults: new Map(),
  coupangEntries: [],
  ledgerEntries: [],
  corporateCardEntries: [],
  generalTravelEntries: [],
  excelPasteRows: {},
  excelPreviewCollapsed: {},
  fieldVisitPreviewExpanded: false,
  corporateCardListExpanded: false,
  captureProofPreviewGroups: [],
  captureProofPreviewImages: [],
  captureProofPreviewMonthKey: "",
  captureProofSelectedNames: new Set(),
  captureProofActiveName: "",
  captureProofExpandedDates: {},
  captureProofCardCollapsed: true,
  storedCaptureResultLogs: [],
  captureResultLogs: [],
  captureResultFilter: "all",
  captureLogExpandedDates: {},
  captureModalImages: [],
  captureModalIndex: -1,
  corporateCardSort: { key: "dateKey", direction: "asc" },
  ledgerSort: { key: "dateKey", direction: "asc" },
  excelPreviewSort: {
    general: { key: "dateKey", direction: "asc" },
    field: { key: "dateKey", direction: "asc" },
    corporate: { key: "dateKey", direction: "asc" }
  },
  ledgerTypeFilter: "all",
  storageSettings: {},
  effectiveStorageRoots: {},
  personalStorage: { configured: false, driveOnline: false, pendingFiles: 0 },
  duplicateCandidates: [],
  directoryHandle: null,
  pendingBrowserDriveHandle: null,
  running: false,
  captureTargets: {
    toll: true,
    route: true,
    oil: true
  },
  captureStats: {
    total: 0,
    success: 0,
    failure: 0,
    skipped: 0
  }
};

const elements = {
  yearInput: document.querySelector("#yearInput"),
  monthInput: document.querySelector("#monthInput"),
  startInput: document.querySelector("#startInput"),
  destinationInput: document.querySelector("#destinationInput"),
  tableInput: document.querySelector("#tableInput"),
  manualDateSelect: document.querySelector("#manualDateSelect"),
  manualWaypoint1Input: document.querySelector("#manualWaypoint1Input"),
  manualWaypoint2Input: document.querySelector("#manualWaypoint2Input"),
  addManualWaypointButton: document.querySelector("#addManualWaypointButton"),
  previewButton: document.querySelector("#previewButton"),
  chooseFolderButton: document.querySelector("#chooseFolderButton"),
  runButton: document.querySelector("#runButton"),
  captureTargetInputs: document.querySelectorAll("[id^='captureTarget']"),
  retryFailedButton: document.querySelector("#retryFailedButton"),
  createPptButton: document.querySelector("#createPptButton"),
  previewPptButton: document.querySelector("#previewPptButton"),
  pptMonthInput: document.querySelector("#pptMonthInput"),
  refreshStorageButton: document.querySelector("#refreshStorageButton"),
  refreshStoragePreviewButton: document.querySelector("#refreshStoragePreviewButton"),
  storagePreviewPanel: document.querySelector("#storagePreviewPanel"),
  runCoupangButton: document.querySelector("#runCoupangButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  prevMonthButton: document.querySelector("#prevMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  todayMonthButton: document.querySelector("#todayMonthButton"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  crossMonthNotice: document.querySelector("#crossMonthNotice"),
  folderLabel: document.querySelector("#folderLabel"),
  previewList: document.querySelector("#previewList"),
  previewCount: document.querySelector("#previewCount"),
  captureResultSummary: document.querySelector("#captureResultSummary"),
  captureResultDetail: document.querySelector("#captureResultDetail"),
  successList: document.querySelector("#successList"),
  errorList: document.querySelector("#errorList"),
  captureLogCard: document.querySelector(".capture-log-card"),
  captureProofPreviewList: document.querySelector("#captureProofPreviewList"),
  captureProofPreviewSummary: document.querySelector("#captureProofPreviewSummary"),
  refreshCaptureProofPreviewButton: document.querySelector("#refreshCaptureProofPreviewButton"),
  captureProofCard: document.querySelector(".capture-proof-card"),
  captureProofHeading: document.querySelector(".capture-proof-heading"),
  toggleCaptureProofCardButton: document.querySelector("#toggleCaptureProofCardButton"),
  progressBar: document.querySelector("#progressBar"),
  pageTitle: document.querySelector("#pageTitle"),
  captureResultPanel: document.querySelector("#captureResultPanel"),
  captureResultFoldSummary: document.querySelector("#captureResultFoldSummary"),
  pptStatus: document.querySelector("#pptStatus"),
  coupangPeopleInput: document.querySelector("#coupangPeopleInput"),
  coupangDatesInput: document.querySelector("#coupangDatesInput"),
  coupangLimitSummary: document.querySelector("#coupangLimitSummary"),
  welfareLimitCard: document.querySelector("#welfareLimitCard"),
  welfarePeriodTitle: document.querySelector("#welfarePeriodTitle"),
  welfareRemainingCard: document.querySelector("#welfareRemainingCard"),
  welfareUsageText: document.querySelector("#welfareUsageText"),
  welfareUsagePercent: document.querySelector("#welfareUsagePercent"),
  welfareProgressBar: document.querySelector("#welfareProgressBar"),
  supplyLimitCard: document.querySelector("#supplyLimitCard"),
  supplyPeriodTitle: document.querySelector("#supplyPeriodTitle"),
  supplyRemainingCard: document.querySelector("#supplyRemainingCard"),
  supplyUsageText: document.querySelector("#supplyUsageText"),
  supplyUsagePercent: document.querySelector("#supplyUsagePercent"),
  supplyProgressBar: document.querySelector("#supplyProgressBar"),
  coupangResultList: document.querySelector("#coupangResultList"),
  coupangErrorList: document.querySelector("#coupangErrorList"),
  refreshLedgerButton: document.querySelector("#refreshLedgerButton"),
  ledgerMonthInput: document.querySelector("#ledgerMonthInput"),
  welfareYearInput: document.querySelector("#welfareYearInput"),
  welfareQuarterSelect: document.querySelector("#welfareQuarterSelect"),
  supplyYearInput: document.querySelector("#supplyYearInput"),
  supplyMonthSelect: document.querySelector("#supplyMonthSelect"),
  manualExpenseDateInput: document.querySelector("#manualExpenseDateInput"),
  manualExpenseTypeSelect: document.querySelector("#manualExpenseTypeSelect"),
  manualExpenseAmountInput: document.querySelector("#manualExpenseAmountInput"),
  manualExpenseMemoInput: document.querySelector("#manualExpenseMemoInput"),
  manualExpensePathInput: document.querySelector("#manualExpensePathInput"),
  addManualExpenseButton: document.querySelector("#addManualExpenseButton"),
  toggleManualExpenseButton: document.querySelector("#toggleManualExpenseButton"),
  manualExpenseCard: document.querySelector("#manualExpenseCard"),
  ledgerSummaryGrid: document.querySelector("#ledgerSummaryGrid"),
  ledgerEntryList: document.querySelector("#ledgerEntryList"),
  corporateCardInput: document.querySelector("#corporateCardInput"),
  parseCorporateCardButton: document.querySelector("#parseCorporateCardButton"),
  corporateCardErrorList: document.querySelector("#corporateCardErrorList"),
  corporateCardEntryList: document.querySelector("#corporateCardEntryList"),
  corporateCardEntryMore: document.querySelector("#corporateCardEntryMore"),
  corporateCardSummary: document.querySelector("#corporateCardSummary"),
  refreshExcelPasteButton: document.querySelector("#refreshExcelPasteButton"),
  excelYearInput: document.querySelector("#excelYearInput"),
  excelMonthSelect: document.querySelector("#excelMonthSelect"),
  generalTravelDateInput: document.querySelector("#generalTravelDateInput"),
  generalTravelItemSelect: document.querySelector("#generalTravelItemSelect"),
  generalTravelPlaceInput: document.querySelector("#generalTravelPlaceInput"),
  generalTravelAmountInput: document.querySelector("#generalTravelAmountInput"),
  generalTravelSummaryInput: document.querySelector("#generalTravelSummaryInput"),
  generalTravelNoteInput: document.querySelector("#generalTravelNoteInput"),
  addGeneralTravelButton: document.querySelector("#addGeneralTravelButton"),
  generalTravelPreviewBadge: document.querySelector("#generalTravelPreviewBadge"),
  fieldVisitPreviewBadge: document.querySelector("#fieldVisitPreviewBadge"),
  corporateCardPreviewBadge: document.querySelector("#corporateCardPreviewBadge"),
  generalTravelPreviewBody: document.querySelector("#generalTravelPreviewBody"),
  fieldVisitPreviewBody: document.querySelector("#fieldVisitPreviewBody"),
  corporateCardPreviewBody: document.querySelector("#corporateCardPreviewBody"),
  fieldVisitPreviewMore: document.querySelector("#fieldVisitPreviewMore"),
  directExcelPathInput: document.querySelector("#directExcelPathInput"),
  writeDirectExcelButton: document.querySelector("#writeDirectExcelButton"),
  excelPasteStatus: document.querySelector("#excelPasteStatus"),
  pptPreviewList: document.querySelector("#pptPreviewList"),
  storagePreviewList: document.querySelector("#storagePreviewList"),
  ledgerFilterChips: document.querySelector("#ledgerFilterChips"),
  settingsStartInput: document.querySelector("#settingsStartInput"),
  settingsDestinationInput: document.querySelector("#settingsDestinationInput"),
  settingsAuthorNameInput: document.querySelector("#settingsAuthorNameInput"),
  settingsPeopleInput: document.querySelector("#settingsPeopleInput"),
  settingsSupplyLimitInput: document.querySelector("#settingsSupplyLimitInput"),
  settingsStoragePathPreview: document.querySelector("#settingsStoragePathPreview"),
  settingsStoragePreviewText: document.querySelector("#settingsStoragePreviewText"),
  settingsWelfarePreview: document.querySelector("#settingsWelfarePreview"),
  settingsRoleButtons: document.querySelectorAll("[data-settings-role]"),
  settingsPeopleStepButtons: document.querySelectorAll("[data-settings-people-step]"),
  settingsRoutePreviews: document.querySelectorAll("[data-settings-route-preview]"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  settingChooseFolderButton: document.querySelector("#settingChooseFolderButton"),
  settingsStatus: document.querySelector("#settingsStatus"),
  imageModal: document.querySelector("#imageModal"),
  imageModalImg: document.querySelector("#imageModalImg"),
  imageModalClose: document.querySelector("#imageModalClose"),
  deleteFolderSelect: document.querySelector("#deleteFolderSelect"),
  scanDuplicatesButton: document.querySelector("#scanDuplicatesButton"),
  deleteDuplicatesButton: document.querySelector("#deleteDuplicatesButton"),
  clearFolderButton: document.querySelector("#clearFolderButton"),
  storageCleanupStatus: document.querySelector("#storageCleanupStatus"),
  storageSettingsGrid: document.querySelector("#storageSettingsGrid"),
  saveStorageSettingsButton: document.querySelector("#saveStorageSettingsButton"),
  storageSettingsStatus: document.querySelector("#storageSettingsStatus"),
  navItems: document.querySelectorAll("[data-page-target]"),
  pagePanels: document.querySelectorAll("[data-page-panel]"),
  browserStatus: document.querySelector("#browserStatus"),
  updateRefreshButton: document.querySelector("#updateRefreshButton")
};

Object.assign(elements, {
  onboardingOverlay: document.querySelector("#onboardingOverlay"),
  personalDriveRootInput: document.querySelector("#personalDriveRootInput"),
  updateRootInput: document.querySelector("#updateRootInput"),
  updateRootField: document.querySelector("#updateRootField"),
  browsePersonalDriveButton: document.querySelector("#browsePersonalDriveButton"),
  browseUpdateRootButton: document.querySelector("#browseUpdateRootButton"),
  savePersonalDriveButton: document.querySelector("#savePersonalDriveButton"),
  cancelOnboardingButton: document.querySelector("#cancelOnboardingButton"),
  onboardingStatus: document.querySelector("#onboardingStatus"),
  prerequisiteGrid: document.querySelector("#prerequisiteGrid"),
  storageHealthBanner: document.querySelector("#storageHealthBanner"),
  storageHealthTitle: document.querySelector("#storageHealthTitle"),
  storageHealthDetail: document.querySelector("#storageHealthDetail"),
  syncPendingButton: document.querySelector("#syncPendingButton")
});
elements.appVersionLabel = document.querySelector("#appVersionLabel");
elements.appVersionBadge = document.querySelector("#appVersionBadge");
elements.updateStatusLabel = document.querySelector("#updateStatusLabel");

const appSettings = readAppSettings();
elements.yearInput.value = String(now.getFullYear());
elements.monthInput.value = String(now.getMonth() + 1);
if (elements.pptMonthInput) elements.pptMonthInput.value = todayInputValue(now).slice(0, 7);
elements.startInput.value = appSettings.defaultStart || "태왕디아너스오페라";
elements.destinationInput.value = appSettings.defaultDestination || "태왕디아너스오페라";
elements.manualDateSelect.value = todayInputValue(now);
if (elements.ledgerMonthInput) elements.ledgerMonthInput.value = todayInputValue(now).slice(0, 7);
if (elements.welfareYearInput) elements.welfareYearInput.value = String(now.getFullYear());
if (elements.welfareQuarterSelect) elements.welfareQuarterSelect.value = String(Math.floor(now.getMonth() / 3) + 1);
if (elements.supplyYearInput) elements.supplyYearInput.value = String(now.getFullYear());
if (elements.supplyMonthSelect) elements.supplyMonthSelect.value = String(now.getMonth() + 1);
if (elements.excelYearInput) elements.excelYearInput.value = String(now.getFullYear());
if (elements.excelMonthSelect) elements.excelMonthSelect.value = String(now.getMonth() + 1);
elements.manualExpenseDateInput.value = todayInputValue(now);
elements.settingsStartInput.value = elements.startInput.value;
elements.settingsDestinationInput.value = elements.destinationInput.value;
if (elements.settingsAuthorNameInput) elements.settingsAuthorNameInput.value = appSettings.authorName || "";
elements.coupangPeopleInput.value = appSettings.welfarePeople || elements.coupangPeopleInput.value;
elements.settingsPeopleInput.value = elements.coupangPeopleInput.value;
renderSettingsRoleButtons(appSettings.userRole || "manager");
applyRoleMenuVisibility(appSettings.userRole || "manager");
refreshSettingsPreview();

elements.previewButton.addEventListener("click", preview);
elements.chooseFolderButton.addEventListener("click", chooseFolder);
elements.settingChooseFolderButton?.addEventListener("click", chooseFolder);
elements.settingsRoleButtons?.forEach((button) => {
  button.addEventListener("click", () => {
    // 설정 화면에는 별도 저장 버튼이 없으므로 선택 즉시 저장하고 메뉴에 반영합니다.
    const nextRole = button.dataset.settingsRole;
    writeAppSettings({ ...readAppSettings(), userRole: nextRole });
    renderSettingsRoleButtons(nextRole);
    applyRoleMenuVisibility(nextRole);
    if (elements.settingsStatus) {
      elements.settingsStatus.textContent = nextRole === "manager"
        ? "선임 / 팀장으로 설정했습니다. 조활비·소모품비 메뉴를 사용할 수 있습니다."
        : "강사로 설정했습니다. 조활비·소모품비 메뉴는 표시되지 않습니다.";
    }
  });
});
elements.settingsPeopleStepButtons?.forEach((button) => {
  button.addEventListener("click", () => {
    const nextValue = Math.max(1, (Number(elements.coupangPeopleInput.value) || 1) + Number(button.dataset.settingsPeopleStep || 0));
    elements.coupangPeopleInput.value = String(nextValue);
    elements.settingsPeopleInput.value = String(nextValue);
    refreshSettingsPreview();
  });
});
elements.coupangPeopleInput?.addEventListener("input", () => {
  elements.settingsPeopleInput.value = elements.coupangPeopleInput.value || "3";
  refreshSettingsPreview();
});
elements.settingsStartInput?.addEventListener("input", refreshSettingsPreview);
elements.settingsDestinationInput?.addEventListener("input", refreshSettingsPreview);
elements.browsePersonalDriveButton?.addEventListener("click", () => browseDesktopDirectory(elements.personalDriveRootInput, "본인 Google Drive 폴더 선택"));
elements.browseUpdateRootButton?.addEventListener("click", () => browseDesktopDirectory(elements.updateRootInput, "앱 업데이트 공유 폴더 선택"));
elements.savePersonalDriveButton?.addEventListener("click", savePersonalDrive);
elements.updateRefreshButton?.addEventListener("click", refreshUpdatedApp);
elements.cancelOnboardingButton?.addEventListener("click", () => {
  if (state.personalStorage?.configured) elements.onboardingOverlay.hidden = true;
});
elements.syncPendingButton?.addEventListener("click", syncPendingStorage);
elements.runButton.addEventListener("click", runCapture);
elements.captureTargetInputs?.forEach((input) => {
  input.addEventListener("change", () => {
    syncCaptureTargetsFromInputs();
    updateRunButton();
  });
});
elements.retryFailedButton.addEventListener("click", retryFailedCapture);
document.querySelector("#distanceHelpButton")?.addEventListener("click", (event) => {
  const note = document.querySelector("#distanceHelpNote");
  if (!note) return;
  note.hidden = !note.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!note.hidden));
});
elements.createPptButton.addEventListener("click", createProofPpt);
elements.previewPptButton.addEventListener("click", previewProofPpt);
elements.pptMonthInput?.addEventListener("change", previewProofPpt);
elements.refreshStorageButton?.addEventListener("click", () => {
  if (elements.storagePreviewPanel) {
    elements.storagePreviewPanel.open = true;
  }
  refreshStoragePreview();
});
elements.refreshStoragePreviewButton?.addEventListener("click", refreshStoragePreview);
elements.runCoupangButton.addEventListener("click", runCoupangCapture);
elements.refreshLedgerButton?.addEventListener("click", loadExpenseLedger);
elements.addManualExpenseButton?.addEventListener("click", addManualExpenseEntry);
elements.toggleManualExpenseButton?.addEventListener("click", () => {
  if (!elements.manualExpenseCard) return;
  elements.manualExpenseCard.open = !elements.manualExpenseCard.open;
  elements.toggleManualExpenseButton.setAttribute("aria-expanded", String(elements.manualExpenseCard.open));
});
elements.manualExpenseCard?.addEventListener("toggle", () => {
  elements.toggleManualExpenseButton?.setAttribute("aria-expanded", String(elements.manualExpenseCard.open));
});
elements.parseCorporateCardButton?.addEventListener("click", parseAndSaveCorporateCardEntries);
elements.corporateCardEntryList?.addEventListener("change", handleCorporateCardTableChange);
elements.corporateCardEntryList?.addEventListener("focusout", handleCorporateCardMemoBlur);
elements.corporateCardEntryList?.addEventListener("click", handleCorporateCardTableClick);
elements.refreshExcelPasteButton?.addEventListener("click", renderExcelPasteOutputs);
elements.excelYearInput?.addEventListener("input", handleExcelMonthChange);
elements.excelMonthSelect?.addEventListener("change", handleExcelMonthChange);
elements.addGeneralTravelButton?.addEventListener("click", addGeneralTravelEntry);
elements.writeDirectExcelButton?.addEventListener("click", writeDirectExcelWorkbook);
document.addEventListener("click", handleExcelPreviewClick);
document.addEventListener("click", handleCollapsiblePanelClick);
document.addEventListener("click", handleExcelWorkflowCardClick);
document.addEventListener("keydown", handleCollapsiblePanelKeydown);
document.addEventListener("click", handlePasteOutputCopyClick);
document.addEventListener("click", handleSortHeaderClick);
// F5 또는 좌측 상단 로고 클릭으로 새로고침
document.addEventListener("keydown", (event) => {
  if (event.key === "F5") {
    event.preventDefault();
    reloadApp();
  }
});
document.querySelector(".brand")?.addEventListener("click", reloadApp);
document.addEventListener("keydown", handleSortHeaderKeydown);
document.addEventListener("keydown", handleImageModalKeydown);
elements.saveStorageSettingsButton?.addEventListener("click", saveStorageSettings);
elements.addManualWaypointButton.addEventListener("click", addManualWaypointGroup);
elements.loadSampleButton.addEventListener("click", loadSample);
elements.tableInput.addEventListener("input", scheduleAutoPreview);
elements.yearInput.addEventListener("input", handleVisibleMonthChange);
elements.monthInput.addEventListener("input", handleVisibleMonthChange);
elements.startInput.addEventListener("input", scheduleAutoPreview);
elements.destinationInput.addEventListener("input", scheduleAutoPreview);
elements.prevMonthButton.addEventListener("click", () => shiftVisibleMonth(-1));
elements.nextMonthButton.addEventListener("click", () => shiftVisibleMonth(1));
elements.todayMonthButton.addEventListener("click", goToCurrentMonth);
elements.scanDuplicatesButton?.addEventListener("click", scanDuplicateFiles);
elements.deleteDuplicatesButton?.addEventListener("click", deleteDuplicateFiles);
elements.clearFolderButton?.addEventListener("click", clearSelectedProofFolder);
elements.coupangPeopleInput.addEventListener("input", () => {
  renderCoupangLimitSummary();
  renderLedger();
});
elements.ledgerMonthInput?.addEventListener("input", renderLedger);
elements.ledgerFilterChips?.addEventListener("click", handleLedgerFilterChipClick);
for (const periodInput of [
  elements.welfareYearInput,
  elements.welfareQuarterSelect,
  elements.supplyYearInput,
  elements.supplyMonthSelect
]) {
  periodInput?.addEventListener("input", () => {
    renderCoupangLimitSummary();
    renderLedger();
  });
}
elements.saveSettingsButton?.addEventListener("click", applySettings);
elements.imageModalClose?.addEventListener("click", closeImageModal);
elements.imageModal?.addEventListener("click", (event) => {
  if (event.target === elements.imageModal) {
    closeImageModal();
  }
});
elements.pptPreviewList.addEventListener("click", handleProofPreviewActionClick);
elements.pptPreviewList.addEventListener("click", handlePreviewImageClick);
elements.storagePreviewList.addEventListener("click", handlePreviewImageClick);
elements.captureLogCard?.addEventListener("click", handleCaptureLogClick);
elements.captureProofPreviewList?.addEventListener("click", handleCaptureProofPreviewActionClick);
elements.captureProofPreviewList?.addEventListener("click", handlePreviewImageClick);
elements.refreshCaptureProofPreviewButton?.addEventListener("click", () => renderCaptureProofPreview());
elements.toggleCaptureProofCardButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleCaptureProofCard();
});
elements.captureProofHeading?.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  toggleCaptureProofCard();
});
elements.ledgerEntryList?.addEventListener("click", handleLedgerActionClick);
elements.ledgerEntryList?.addEventListener("change", handleLedgerFieldChange);
elements.ledgerEntryList?.addEventListener("focusout", handleLedgerMemoBlur);
elements.coupangResultList?.addEventListener("click", handleLedgerActionClick);
for (const navItem of elements.navItems) {
  navItem.addEventListener("click", () => {
    activatePage(navItem.dataset.pageTarget);
    navItem.closest("details")?.removeAttribute("open");
  });
}
for (const summaryLink of document.querySelectorAll("[data-summary-target]")) {
  summaryLink.addEventListener("click", () => {
    if (summaryLink.dataset.summaryTarget === "capture-result") {
      elements.captureResultPanel.open = true;
      elements.captureResultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    document.querySelector("#tripInputPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
setupAllowancePeriodControls();
setupExcelInputCollapse();
renderCoupangLimitSummary();
renderStorageSettings();
renderLedger();
renderPreview();
renderCaptureProofPreview();
initializeExcelExportInputs();
loadManualExcelEntries();
renderExcelPasteOutputs();
loadStorageInfo();
loadExpenseLedger();
loadCorporateCardLedger();
loadPersonalStorage();
initializeDesktopBridge();
initializeInitialSetup();
hydratePersistentAppState();

if (!("showDirectoryPicker" in window) && !window.desktopBridge) {
  elements.browserStatus.textContent = "서버 저장";
  elements.chooseFolderButton.disabled = true;
  elements.folderLabel.textContent = "기본 저장소를 확인하는 중입니다.";
} else {
  elements.browserStatus.textContent = "준비됨";
  elements.folderLabel.textContent = "기본 저장소를 확인하는 중입니다. 필요할 때만 다른 폴더를 선택하세요.";
}

function setupAllowancePeriodControls() {
  const balanceGrid = document.querySelector(".allowance-balance-grid");
  const toolbar = document.querySelector(".ledger-period-toolbar");
  const welfareCard = document.querySelector(".welfare-card");
  const supplyCard = document.querySelector(".supply-card");
  if (!balanceGrid || !toolbar || !welfareCard || !supplyCard) {
    return;
  }

  const [welfareFieldset, supplyFieldset] = toolbar.querySelectorAll("fieldset");
  if (!welfareFieldset || !supplyFieldset) {
    return;
  }

  const makeShell = (card, fieldset, modifier) => {
    if (card.parentElement?.classList.contains("allowance-card-shell")) {
      return;
    }
    const shell = document.createElement("div");
    shell.className = `allowance-card-shell ${modifier}`;
    const control = document.createElement("div");
    control.className = "allowance-period-control";
    control.append(fieldset);
    card.before(shell);
    shell.append(control, card);
  };

  makeShell(welfareCard, welfareFieldset, "welfare-period-shell");
  makeShell(supplyCard, supplyFieldset, "supply-period-shell");
  toolbar.hidden = true;
}

function setupExcelInputCollapse() {
}

async function loadPersonalStorage() {
  try {
    const [storageResponse, prerequisiteResponse] = await Promise.all([
      fetch("/api/travel-proof/personal-storage"),
      fetch("/api/travel-proof/prerequisites")
    ]);
    const storageData = await storageResponse.json();
    const prerequisiteData = await prerequisiteResponse.json();
    if (!storageData.ok) throw new Error(storageData.message || "개인 저장소 정보를 읽을 수 없습니다.");

    const settings = storageData.settings || {};
    state.personalStorage = storageData.status || { configured: false, driveOnline: false, pendingFiles: 0 };
    elements.personalDriveRootInput.value = settings.driveRoot || "";
    elements.updateRootInput.value = settings.updateRoot || "";
    renderPrerequisites(prerequisiteData.prerequisites || {});
    renderPersonalStorageStatus();
    const shouldRequireDesktopOnboarding = Boolean(window.desktopBridge) && !state.personalStorage.configured;
    elements.onboardingOverlay.hidden = PROTOTYPE_PREVIEW || !shouldRequireDesktopOnboarding;
    elements.cancelOnboardingButton.hidden = !state.personalStorage.configured;
    updateRunButton();
  } catch (error) {
    elements.onboardingOverlay.hidden = PROTOTYPE_PREVIEW || !window.desktopBridge;
    elements.onboardingStatus.textContent = `초기 설정 확인 실패: ${error.message}`;
  }
}

async function initializeDesktopBridge() {
  if (!window.desktopBridge) {
    elements.updateRootField.hidden = true;
    if (elements.appVersionBadge) elements.appVersionBadge.textContent = "개발 모드";
    return;
  }
  elements.updateRootField.hidden = true;
  const [appInfo, updateStatus] = await Promise.all([
    window.desktopBridge.getAppInfo(),
    window.desktopBridge.getUpdateStatus()
  ]);
  elements.appVersionLabel.textContent = `버전 ${appInfo.version} · 개인 저장 모드`;
  if (elements.appVersionBadge) elements.appVersionBadge.textContent = `버전 ${appInfo.version}`;
  renderDesktopUpdateStatus(updateStatus);
  window.desktopBridge.onUpdateStatus(renderDesktopUpdateStatus);
}

async function fetchDefaultStoragePath() {
  try {
    const response = await fetch("/api/travel-proof/default-storage-path");
    const data = await response.json();
    return data.ok ? data.path || "" : "";
  } catch {
    return "";
  }
}

async function initializeInitialSetup() {
  const mount = document.querySelector("#initialSetupRoot");
  if (!mount) {
    return;
  }
  const settings = readAppSettings();
  const defaultStoragePath = await fetchDefaultStoragePath();
  const serverSetup = await fetchServerInitialSetup();
  const initialSetup = initInitialSetup({
    mount,
    defaults: {
      userName: settings.authorName || "",
      branchName: settings.branchName || "",
      defaultStartLocation: settings.defaultStart || "",
      defaultEndLocation: settings.defaultDestination || "",
      teamMemberCount: Number(settings.welfarePeople) || 0,
      storagePath: settings.storagePath || defaultStoragePath
    },
    selectDirectory: async (currentPath) => {
      if (window.desktopBridge?.selectDirectory) {
        return window.desktopBridge.selectDirectory({ title: "저장 폴더 선택" });
      }
      try {
        const response = await fetch("/api/travel-proof/select-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "저장 폴더 선택", initialPath: currentPath || defaultStoragePath })
        });
        const data = await response.json();
        return data.ok ? data.path || "" : "";
      } catch {
        return "";
      }
    },
    onComplete: applyInitialSetupResult
  });
  document.querySelector("#reopenInitialSetupButton")?.addEventListener("click", () => initialSetup.open());
  if (serverSetup?.completed && !isInitialSetupCompleted()) {
    writeInitialSetup({
      userName: settings.authorName || "",
      branchName: settings.branchName || "",
      defaultStartLocation: settings.defaultStart || "",
      defaultEndLocation: settings.defaultDestination || "",
      teamMemberCount: Number(settings.welfarePeople) || 3,
      storagePath: serverSetup.storagePath || settings.storagePath || defaultStoragePath,
      isInitialSetupCompleted: true
    });
  }
  if (!PROTOTYPE_PREVIEW && !isInitialSetupCompleted()) {
    initialSetup.open();
  }
}

async function fetchServerInitialSetup() {
  try {
    const response = await fetch("/api/travel-proof/personal-storage");
    const data = await response.json();
    if (!data.ok) return { completed: false, storagePath: "" };
    return {
      completed: Boolean(data.status?.configured || data.settings?.onboardingComplete),
      storagePath: data.settings?.driveRoot || ""
    };
  } catch {
    return { completed: false, storagePath: "" };
  }
}

function applyInitialSetupResult(setup) {
  const previousSettings = readAppSettings();
  writeAppSettings({
    ...previousSettings,
    defaultStart: setup.defaultStartLocation || previousSettings.defaultStart,
    defaultDestination: setup.defaultEndLocation || previousSettings.defaultDestination,
    authorName: setup.userName,
    branchName: setup.branchName,
    userRole: setup.userRole,
    storagePath: setup.storagePath,
    welfarePeople: setup.userRole === "manager" ? String(setup.teamMemberCount) : previousSettings.welfarePeople
  });
  const applied = readAppSettings();
  elements.startInput.value = applied.defaultStart || elements.startInput.value;
  elements.destinationInput.value = applied.defaultDestination || elements.destinationInput.value;
  elements.settingsStartInput.value = elements.startInput.value;
  elements.settingsDestinationInput.value = elements.destinationInput.value;
  if (elements.settingsAuthorNameInput) elements.settingsAuthorNameInput.value = applied.authorName || "";
  renderSettingsRoleButtons(applied.userRole || "manager");
  applyRoleMenuVisibility(applied.userRole || "manager");
  refreshSettingsPreview();
  refreshSettingsStoragePreview(setup.storagePath || "");
  if (applied.welfarePeople) {
    elements.coupangPeopleInput.value = applied.welfarePeople;
    elements.settingsPeopleInput.value = applied.welfarePeople;
  }
  refreshSettingsPreview();
  renderCoupangLimitSummary();
  renderLedger();
  renderExcelPasteOutputs();
  scheduleAutoPreview();
  elements.browserStatus.textContent = "초기 설정 완료";
  connectInitialSetupStorage(setup.storagePath);
}

async function connectInitialSetupStorage(storagePath) {
  const path = String(storagePath || "").trim();
  if (!path || !/^[a-zA-Z]:[\\/]/.test(path)) {
    return;
  }
  try {
    const response = await fetch("/api/travel-proof/personal-storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driveRoot: path, monthKey: resolveSelectedMonthKey() })
    });
    const data = await response.json();
    if (!data.ok) {
      return;
    }
    state.personalStorage = data.status;
    elements.onboardingOverlay.hidden = true;
    await loadStorageInfo();
    renderPersonalStorageStatus();
    updateRunButton();
  } catch {
    // 저장 폴더 연결은 선택 사항이므로 실패해도 초기 설정 완료를 막지 않는다.
  }
}

// 같은 버전 안내를 반복해서 띄우지 않도록 기억합니다.
let notifiedUpdateVersion = "";

function notifyUpdateAvailable(status = {}) {
  const version = status.manifest?.version || "";
  if (status.state !== "ready" || !version || notifiedUpdateVersion === version) {
    return;
  }
  notifiedUpdateVersion = version;
  const install = window.confirm(
    `새 버전 ${version}이(가) 나왔습니다.\n\n지금 업데이트할까요?\n확인을 누르면 앱이 종료되고 설치가 진행된 뒤 자동으로 다시 시작됩니다.`
  );
  if (install && window.desktopBridge?.installUpdate) {
    window.desktopBridge.installUpdate();
  }
}

function renderDesktopUpdateStatus(status = {}) {
  notifyUpdateAvailable(status);
  if (!elements.updateStatusLabel) return;
  elements.updateStatusLabel.textContent = status.message || "업데이트 확인 전";
  elements.updateStatusLabel.title = status.message || "";
  if (elements.updateRefreshButton && window.desktopBridge) {
    const hasUpdate = status.state === "ready";
    const buttonLabel = hasUpdate
      ? "업데이트 설치"
      : status.state === "installing"
        ? "설치 중"
        : status.state === "current"
          ? "최신 버전"
          : status.state === "error" || status.state === "rejected"
            ? "확인 필요"
            : "업데이트 확인 전";
    const buttonIcon = hasUpdate ? "ph-download-simple" : status.state === "installing" ? "ph-spinner-gap" : "ph-check-circle";
    elements.updateRefreshButton.innerHTML = `<i class="ph ${buttonIcon}" aria-hidden="true"></i> ${buttonLabel}`;
    elements.updateRefreshButton.disabled = !hasUpdate;
  }
}

async function refreshUpdatedApp() {
  if (!elements.updateRefreshButton) return;
  elements.updateRefreshButton.disabled = true;
  elements.updateRefreshButton.innerHTML = '<i class="ph ph-spinner-gap" aria-hidden="true"></i> 확인 중';
  if (elements.updateStatusLabel) {
    elements.updateStatusLabel.textContent = "업데이트 확인 중";
  }
  try {
    if (window.desktopBridge?.checkForUpdates) {
      const status = await window.desktopBridge.checkForUpdates();
      renderDesktopUpdateStatus(status);
      if (status?.state === "ready" && window.desktopBridge.installUpdate) {
        elements.updateRefreshButton.innerHTML = '<i class="ph ph-spinner-gap" aria-hidden="true"></i> 설치 준비';
        elements.updateStatusLabel.textContent = "앱을 종료하고 업데이트를 설치합니다.";
        await window.desktopBridge.installUpdate();
      } else {
        renderDesktopUpdateStatus(status);
      }
      return;
    }
    const response = await fetch("/api/travel-proof/update-refresh", { method: "POST" });
    if (response.status === 404) {
      throw new Error("현재 실행 중인 서버가 아직 이전 버전입니다. 이번 한 번만 앱을 재시작해 주세요.");
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("갱신 응답을 읽지 못했습니다. 앱 재시작 후 다시 시도해 주세요.");
    }
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message || "업데이트 갱신 실패");
    }
    window.location.reload();
  } catch (error) {
    elements.updateRefreshButton.disabled = false;
    elements.updateRefreshButton.innerHTML = '<i class="ph ph-arrows-clockwise" aria-hidden="true"></i> 업데이트 확인';
    if (elements.updateStatusLabel) {
      elements.updateStatusLabel.textContent = `확인 실패: ${error.message}`;
      elements.updateStatusLabel.title = error.message;
    }
  }
}

function renderPrerequisites(prerequisites) {
  for (const key of ["windows", "chrome", "googleDrive"]) {
    const element = elements.prerequisiteGrid?.querySelector(`[data-prerequisite="${key}"]`);
    if (!element) continue;
    element.textContent = prerequisites[key] ? "준비됨" : (key === "googleDrive" ? "폴더 선택 필요" : "설치 필요");
    element.classList.toggle("status-confirmed", Boolean(prerequisites[key]));
  }
}

async function browseDesktopDirectory(input, title) {
  if (window.desktopBridge?.selectDirectory) {
    const selected = await window.desktopBridge.selectDirectory({ title });
    if (selected) input.value = selected;
    return;
  }
  if (input === elements.personalDriveRootInput && "showDirectoryPicker" in window) {
    try {
      const selected = await window.showDirectoryPicker({ mode: "readwrite" });
      const outputHandle = selected.name === "출장비증빙"
        ? selected
        : await selected.getDirectoryHandle("출장비증빙", { create: true });
      state.pendingBrowserDriveHandle = outputHandle;
      input.value = `${selected.name} / 출장비증빙`;
      elements.onboardingStatus.textContent = "폴더를 선택했습니다. 브라우저 보안상 이 연결은 현재 실행 중에만 유지됩니다.";
    } catch (error) {
      if (error.name !== "AbortError") elements.onboardingStatus.textContent = `폴더 선택 실패: ${error.message}`;
    }
    return;
  }
  input.focus();
  elements.onboardingStatus.textContent = "설치형 앱에서는 폴더 선택 창이 열립니다. 현재는 Drive 경로를 직접 입력해 주세요.";
}

async function savePersonalDrive() {
  if (!window.desktopBridge && state.pendingBrowserDriveHandle) {
    try {
      const monthKey = resolveSelectedMonthKey();
      const monthDirectory = await state.pendingBrowserDriveHandle.getDirectoryHandle(monthKey, { create: true });
      await ensureBrowserProofFolders(monthDirectory);
      state.directoryHandle = state.pendingBrowserDriveHandle;
      state.personalStorage = { configured: true, driveOnline: true, pendingFiles: 0, browserSession: true };
      elements.onboardingOverlay.hidden = true;
      elements.cancelOnboardingButton.hidden = false;
      elements.folderLabel.textContent = `브라우저 저장소: ${elements.personalDriveRootInput.value} · 현재 실행 중에만 연결됩니다.`;
      elements.browserStatus.textContent = "Drive 직접 저장";
      updateRunButton();
      scheduleProofPreviews();
    } catch (error) {
      elements.onboardingStatus.textContent = `Drive 연결 실패: ${error.message}`;
    }
    return;
  }
  const driveRoot = elements.personalDriveRootInput.value.trim();
  if (!driveRoot) {
    elements.onboardingStatus.textContent = "본인 Google Drive 폴더를 선택해 주세요.";
    return;
  }
  elements.savePersonalDriveButton.disabled = true;
  elements.onboardingStatus.textContent = "폴더 쓰기 권한과 월별 저장 구조를 확인하는 중입니다.";
  try {
    const response = await fetch("/api/travel-proof/personal-storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driveRoot,
        updateRoot: elements.updateRootInput.value.trim(),
        monthKey: resolveSelectedMonthKey()
      })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message);
    state.personalStorage = data.status;
    elements.onboardingOverlay.hidden = true;
    if (data.warning) addError(data.warning);
    await loadStorageInfo();
    renderPersonalStorageStatus();
    updateRunButton();
  } catch (error) {
    elements.onboardingStatus.textContent = `Drive 연결 실패: ${error.message}`;
  } finally {
    elements.savePersonalDriveButton.disabled = false;
  }
}

async function syncPendingStorage() {
  elements.syncPendingButton.disabled = true;
  try {
    const response = await fetch("/api/travel-proof/personal-storage/sync", { method: "POST" });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message);
    state.personalStorage = data.status;
    renderPersonalStorageStatus();
    elements.browserStatus.textContent = data.moved ? `대기자료 ${data.moved}개 동기화` : "동기화 완료";
  } catch (error) {
    elements.storageHealthDetail.textContent = `동기화 실패: ${error.message}`;
  } finally {
    elements.syncPendingButton.disabled = false;
  }
}

function renderPersonalStorageStatus() {
  const status = state.personalStorage || {};
  const hasWarning = status.usingFallback || Number(status.pendingFiles) > 0;
  elements.storageHealthBanner.hidden = !hasWarning;
  if (!hasWarning) return;
  elements.storageHealthTitle.textContent = status.usingFallback ? "Drive 연결이 끊겨 임시 보관 중" : "동기화 대기자료가 있습니다";
  elements.storageHealthDetail.textContent = `${Number(status.pendingFiles) || 0}개 파일을 본인 Drive로 옮길 수 있습니다.`;
  elements.syncPendingButton.disabled = status.usingFallback;
}

async function loadStorageInfo() {
  try {
    const response = await fetch("/api/travel-proof/storage-info");
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message || "저장소 정보를 읽을 수 없습니다.");
    }
    const storage = data.storage;
    state.storageSettings = data.storageSettings || {};
    state.effectiveStorageRoots = data.effectiveStorageRoots || {};
    renderStorageSettings();
    refreshSettingsStoragePreview(storage.outputRoot || "");
    if (storage.storageType === "googleDrive") {
      elements.folderLabel.textContent = `기본 저장소: Google Drive 동기화 폴더 (${storage.outputRoot})`;
      elements.browserStatus.textContent = "Drive 저장";
    } else if (storage.storageType === "custom") {
      elements.folderLabel.textContent = `기본 저장소: ${storage.outputRoot}`;
      elements.browserStatus.textContent = "사용자 저장";
    } else {
      elements.folderLabel.textContent = `Google Drive 폴더를 찾지 못해 앱 폴더에 저장합니다: ${storage.outputRoot}`;
      elements.browserStatus.textContent = "로컬 저장";
    }
    await renderCaptureProofPreview();
  } catch (error) {
    elements.folderLabel.textContent = `기본 저장소 확인 실패: ${error.message}`;
  }
}

function renderStorageSettings() {
  if (!elements.storageSettingsGrid) {
    return;
  }
  elements.storageSettingsGrid.innerHTML = "";
  for (const group of STORAGE_SETTING_GROUPS) {
    const configuredValues = group.keys
      .map((key) => state.storageSettings[key])
      .filter(Boolean);
    const uniqueConfigured = [...new Set(configuredValues)];
    const value = uniqueConfigured.length === 1 ? uniqueConfigured[0] : "";
    const placeholderValues = group.keys
      .map((key) => state.effectiveStorageRoots[key])
      .filter(Boolean);
    const uniquePlaceholders = [...new Set(placeholderValues)];
    const placeholder = uniqueConfigured.length > 1
      ? "여러 저장소가 섞여 있습니다. 저장하면 입력값으로 통일됩니다."
      : uniquePlaceholders[0] || "기본 저장소";
    const row = document.createElement("label");
    row.className = "storage-setting-row";
    row.innerHTML = `
      <span>${group.label}</span>
      <input data-storage-group="${group.key}" type="text" value="${escapeAttribute(value)}" placeholder="${escapeAttribute(placeholder)}" />
    `;
    elements.storageSettingsGrid.append(row);
  }
}

async function saveStorageSettings() {
  const storageSettings = {};
  for (const input of elements.storageSettingsGrid.querySelectorAll("[data-storage-group]")) {
    const value = input.value.trim();
    const group = STORAGE_SETTING_GROUPS.find((candidate) => candidate.key === input.dataset.storageGroup);
    if (!group) {
      continue;
    }
    if (value) {
      for (const key of group.keys) {
        storageSettings[key] = value;
      }
    }
  }
  elements.storageSettingsStatus.innerHTML = "";
  try {
    const response = await fetch("/api/travel-proof/storage-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageSettings })
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message);
    }
    state.storageSettings = data.storageSettings || {};
    state.effectiveStorageRoots = data.effectiveStorageRoots || {};
    renderStorageSettings();
    renderStorageSettingsStatus(["저장소 설정을 저장했습니다."], "success");
  } catch (error) {
    renderStorageSettingsStatus([`저장소 설정 실패: ${error.message}`], "error");
  }
}

function renderStorageSettingsStatus(messages, type = "") {
  elements.storageSettingsStatus.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.className = type;
    item.textContent = message;
    elements.storageSettingsStatus.append(item);
  }
}

async function preview({ silent = false } = {}) {
  if (!elements.tableInput.value.trim()) {
    const manualGroups = state.groups.filter((group) => group.manual);
    state.groups = manualGroups;
    state.errors = [];
    renderPreview();
    updateRunButton();
    return;
  }

  if (!silent) {
    clearLists();
    setBusy(true, "표를 읽는 중...");
  }

  try {
    const payload = getFormPayload();
    const data = await readPreviewPayload(payload);

    const manualGroups = state.groups.filter((group) => group.manual);
    state.groups = data.groups.concat(manualGroups);
    state.errors = data.errors;
    if (!silent) {
      state.failedJobs = [];
      state.captureStats = emptyCaptureStats(state.groups.length);
      renderFuelOutput();
    }
    renderPreview();
    if (!silent) {
      renderKnownErrors();
    }
    renderManualDateOptions();
    updateRunButton();
  } catch (error) {
    if (!silent) {
      addError(error.message);
    } else {
      elements.captureResultDetail.textContent = error.message;
    }
  } finally {
    if (!silent) {
      setBusy(false);
    }
  }
}

function scheduleAutoPreview() {
  clearTimeout(autoPreviewTimer);
  autoPreviewTimer = setTimeout(() => {
    if (!state.running) {
      preview({ silent: true });
    }
  }, AUTO_PREVIEW_DELAY_MS);
}

function handleVisibleMonthChange() {
  renderPreview();
  scheduleAutoPreview();
  scheduleProofPreviews();
  renderCaptureProofPreview();
}

function shiftVisibleMonth(delta) {
  const monthKey = resolveSelectedMonthKey() || todayInputValue(now).slice(0, 7);
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  elements.yearInput.value = String(date.getFullYear());
  elements.monthInput.value = String(date.getMonth() + 1);
  handleVisibleMonthChange();
}

function goToCurrentMonth() {
  elements.yearInput.value = String(now.getFullYear());
  elements.monthInput.value = String(now.getMonth() + 1);
  handleVisibleMonthChange();
}

function scheduleProofPreviews() {
  clearTimeout(autoProofPreviewTimer);
  autoProofPreviewTimer = setTimeout(() => {
    refreshAutomaticProofPreviews();
  }, AUTO_PROOF_PREVIEW_DELAY_MS);
}

async function refreshAutomaticProofPreviews() {
  if (!state.directoryHandle) {
    if (elements.pptPreviewList) {
      elements.pptPreviewList.innerHTML = `<p class="folder-label">저장 폴더를 선택하면 기준 월 자료를 자동으로 미리봅니다.</p>`;
    }
    if (elements.storagePreviewList) {
      elements.storagePreviewList.innerHTML = `<p class="folder-label">저장 폴더를 선택하면 기준 월 자료를 자동으로 미리봅니다.</p>`;
    }
    return;
  }
  await Promise.all([
    renderProofImagePreview(elements.pptPreviewList, {
      emptyMessage: "PPT로 묶을 증빙 이미지를 찾지 못했습니다.",
      allowDelete: true,
      monthKey: selectedPptMonthKey()
    }),
    renderProofImagePreview(elements.storagePreviewList, {
      emptyMessage: "기준 월 저장자료를 찾지 못했습니다."
    })
  ]);
}

// 캡처가 끝나면 자동화용 Chrome 창을 닫고 앱 창을 앞으로 가져옵니다.
async function finishAutomationSession() {
  try {
    await fetch("/api/travel-proof/close-automation-browser", { method: "POST" });
  } catch {}
  try {
    await window.desktopBridge?.focusWindow?.();
  } catch {}
}

// 캡처 중 창을 닫는 등으로 화면이 멈췄을 때 앱을 다시 불러옵니다.
function reloadApp() {
  if (state.running && !window.confirm("캡처가 진행 중입니다. 새로고침할까요?")) {
    return;
  }
  window.location.reload();
}

function isManagerOnlyPageAllowed(pageName, role) {
  return !MANAGER_ONLY_PAGES.has(pageName) || (role || "manager") === "manager";
}

function applyRoleMenuVisibility(role = readAppSettings().userRole || "manager") {
  for (const navItem of elements.navItems) {
    const target = navItem.dataset.pageTarget;
    if (!MANAGER_ONLY_PAGES.has(target)) continue;
    navItem.hidden = !isManagerOnlyPageAllowed(target, role);
  }
  // 숨긴 메뉴를 보고 있었다면 기본 화면으로 이동시킵니다.
  const activePage = document.body.dataset.activePage;
  if (activePage && !isManagerOnlyPageAllowed(activePage, role)) {
    activatePage("distance");
  }
}

function activatePage(pageName) {
  if (!isManagerOnlyPageAllowed(pageName, readAppSettings().userRole)) {
    pageName = "distance";
  }
  for (const navItem of elements.navItems) {
    navItem.classList.toggle("active", navItem.dataset.pageTarget === pageName);
  }
  for (const panel of elements.pagePanels) {
    panel.classList.toggle("active", panel.dataset.pagePanel === pageName);
  }
  const pageMeta = PAGE_META[pageName] || PAGE_META.distance;
  if (elements.pageTitle) elements.pageTitle.textContent = pageMeta.title;
  const pageIcon = document.querySelector("#pageIcon");
  if (pageIcon) pageIcon.className = `ph ${pageMeta.icon}`;
  const pageDescription = document.querySelector("#pageDescription");
  if (pageDescription) pageDescription.textContent = pageMeta.description;
  const helpNote = document.querySelector("#distanceHelpNote");
  if (helpNote) helpNote.textContent = pageMeta.help;
  document.body.dataset.activePage = pageName;
  if (pageName === "ppt" || pageName === "storage") {
    scheduleProofPreviews();
  }
}

function addManualWaypointGroup() {
  const dateKey = elements.manualDateSelect.value;
  const waypointNames = [
    elements.manualWaypoint1Input.value,
    elements.manualWaypoint2Input.value
  ];

  try {
    const group = createManualProofGroup({
      dateKey,
      start: elements.startInput.value,
      destination: elements.destinationInput.value,
      waypointNames
    });
    group.fileBaseName = nextUniqueGroupFileBaseName(group.fileBaseName);
    state.groups = state.groups.concat(group);
    state.captureStats = emptyCaptureStats(state.groups.length);
    elements.manualWaypoint1Input.value = "";
    elements.manualWaypoint2Input.value = "";
    renderPreview();
    updateRunButton();
  } catch (error) {
    addError(error.message);
  }
}

async function chooseFolder() {
  elements.onboardingOverlay.hidden = false;
  elements.cancelOnboardingButton.hidden = !state.personalStorage?.configured;
  elements.onboardingStatus.textContent = "본인 Google Drive 폴더를 변경할 수 있습니다. 기존 증빙은 자동으로 삭제하거나 이동하지 않습니다.";
}

async function runCapture() {
  if (!state.groups.length || !canSave() || state.running) {
    return;
  }
  const captureTargets = currentCaptureTargets();
  if (!hasSelectedCaptureTarget(captureTargets)) {
    addError("캡처할 항목을 1개 이상 선택해주세요.");
    return;
  }

  state.running = true;
  state.failedJobs = [];
  oilCapturePromises.clear();
  state.captureStats = emptyCaptureStats(state.groups.length);
  clearLists();
  renderFuelOutput();
  renderKnownErrors();
  renderCaptureResult();
  setBusy(true, "캡처 중...");
  elements.progressBar.max = state.groups.length;
  elements.progressBar.value = 0;
  await refreshMissingProofRowsForGroups(state.groups);
  if (captureTargets.toll) await prepareTollBatchResults(state.groups);

  for (const group of state.groups) {
    try {
      const captureStatus = captureCompletionStatus(group, captureTargets);
      if (captureStatus.complete) {
        addSuccess(`${group.dateKey} 요청한 내용은 이미 처리가 완료된 내용입니다.`);
        state.captureStats.skipped += 1;
        continue;
      }
      const result = await captureGroup(group, captureStatus, captureTargets);
      upsertFuelRows(result.fuelRows);
      upsertTollRows(result.tollRows);
      renderFuelOutput();
      addCaptureStatusMessages(group, result);
      addTollCaptureStatus(group, result);
      if (captureResultHasFailure(result)) {
        state.failedJobs = rememberFailedCapture(state.failedJobs, group, result.tollError || "캡처 일부 실패");
        state.captureStats.failure += 1;
        if (elements.captureResultPanel) elements.captureResultPanel.open = true;
      } else {
        state.captureStats.success += 1;
      }
    } catch (error) {
      state.failedJobs = rememberFailedCapture(state.failedJobs, group, error.message);
      addError(`${group.dateKey}: ${error.message}`);
      state.captureStats.failure += 1;
      if (elements.captureResultPanel) elements.captureResultPanel.open = true;
    } finally {
      elements.progressBar.value += 1;
      renderCaptureResult();
      updateRetryButton();
    }
  }

  state.running = false;
  setBusy(false);
  updateRetryButton();
  await finishAutomationSession();
  await renderCaptureProofPreview();
  showCaptureSummaryAlert();
}

async function retryFailedCapture() {
  if (!canRetryFailedCapture({ failedCount: state.failedJobs.length, running: state.running })) {
    return;
  }
  const captureTargets = currentCaptureTargets();
  if (!hasSelectedCaptureTarget(captureTargets)) {
    addError("캡처할 항목을 1개 이상 선택해주세요.");
    return;
  }

  const retryGroups = state.failedJobs.map((entry) => entry.group);
  state.running = true;
  if (elements.errorList) elements.errorList.innerHTML = "";
  state.captureResultLogs = [];
  state.captureLogExpandedDates = {};
  state.captureResultFilter = "all";
  state.captureStats = emptyCaptureStats(retryGroups.length);
  renderCaptureResult();
  setBusy(true, "실패건 재실행 중...");
  elements.progressBar.max = retryGroups.length;
  elements.progressBar.value = 0;
  await refreshMissingProofRowsForGroups(retryGroups);
  if (captureTargets.toll) await prepareTollBatchResults(retryGroups);

  await runCaptureGroups(retryGroups, { retry: true, captureTargets });

  state.running = false;
  setBusy(false);
  updateRetryButton();
  await finishAutomationSession();
  await renderCaptureProofPreview();
  showCaptureSummaryAlert();
}

async function runCaptureGroups(groups, { retry = false, captureTargets = currentCaptureTargets() } = {}) {
  await refreshMissingProofRowsForGroups(groups);
  if (captureTargets.toll) await prepareTollBatchResults(groups);
  for (const group of groups) {
    try {
      const captureStatus = captureCompletionStatus(group, captureTargets);
      if (captureStatus.complete) {
        state.failedJobs = removeFailedCapture(state.failedJobs, group);
        addSuccess(`${group.dateKey} 요청한 내용은 이미 처리가 완료된 내용입니다.`);
        state.captureStats.skipped += 1;
        continue;
      }
      const result = await captureGroup(group, captureStatus, captureTargets);
      state.failedJobs = removeFailedCapture(state.failedJobs, group);
      upsertFuelRows(result.fuelRows);
      upsertTollRows(result.tollRows);
      renderFuelOutput();
      addCaptureStatusMessages(group, result, retry);
      addTollCaptureStatus(group, result, retry);
      if (captureResultHasFailure(result)) {
        state.failedJobs = rememberFailedCapture(state.failedJobs, group, result.tollError || "캡처 일부 실패");
        state.captureStats.failure += 1;
        if (elements.captureResultPanel) elements.captureResultPanel.open = true;
      } else {
        state.captureStats.success += 1;
      }
    } catch (error) {
      state.failedJobs = rememberFailedCapture(state.failedJobs, group, error.message);
      addError(`${group.dateKey}: ${error.message}`);
      state.captureStats.failure += 1;
      if (elements.captureResultPanel) elements.captureResultPanel.open = true;
    } finally {
      elements.progressBar.value += 1;
      renderCaptureResult();
      updateRetryButton();
    }
  }
}

async function captureGroup(group, completionStatus = captureCompletionStatus(group), captureTargets = currentCaptureTargets()) {
  const job = createBrowserJob(group);
  const shouldUseServerSave = !state.directoryHandle;
  const shouldCaptureRoute = captureTargets.route && !completionStatus.routeOilComplete;
  const shouldCaptureOil = captureTargets.oil && !completionStatus.routeOilComplete;
  let routeResult = null;
  let oilResult = null;
  let tollResult = null;

  if (captureTargets.toll && !completionStatus.tollComplete) {
    tollResult = await captureTollProof(group, shouldUseServerSave).catch((error) => ({
      error: error.message
    }));
  }

  if (shouldCaptureRoute && shouldCaptureOil) {
    [routeResult, oilResult] = await Promise.all([
      captureRouteProof(group, job, shouldUseServerSave),
      FAST_CAPTURE_ENABLED
        ? getCachedOilProof(group, shouldUseServerSave)
        : captureOilProof(group, shouldUseServerSave)
    ]);
  } else if (shouldCaptureRoute) {
    routeResult = await captureRouteProof(group, job, shouldUseServerSave);
  } else if (shouldCaptureOil) {
    oilResult = FAST_CAPTURE_ENABLED
      ? await getCachedOilProof(group, shouldUseServerSave)
      : await captureOilProof(group, shouldUseServerSave);
  }

  const fuelRows = buildFuelRowsFromCaptureParts(group, { routeResult, oilResult });
  const tollRows = tollResult && !tollResult.error && !isNoHipassTollResult(tollResult)
    ? buildTollExpensePasteRows([{ group, dateKey: group.dateKey, amountWon: tollResult.amountWon, savedPath: tollResult.savedPath }])
    : tollResult && !tollResult.error
      ? [{ key: `${fuelGroupKey(group)}:toll`, dateKey: group.dateKey, amount: 0, noToll: true, text: "" }]
      : [];

  return {
    routeSelected: captureTargets.route,
    oilSelected: captureTargets.oil,
    tollSelected: captureTargets.toll,
    routeSkipped: captureTargets.route && !shouldCaptureRoute,
    oilSkipped: captureTargets.oil && !shouldCaptureOil,
    tollSkipped: captureTargets.toll && completionStatus.tollComplete,
    routeSavedPath: routeResult?.savedPath || "",
    oilSavedPath: oilResult?.savedPath || "",
    tollSavedPath: tollResult?.savedPath || "",
    tollAmountWon: tollResult?.amountWon || 0,
    tollCount: tollResult?.count || 0,
    tollNoResult: Boolean(tollResult && !tollResult.error && isNoHipassTollResult(tollResult)),
    tollError: tollResult?.error || "",
    fuelRows,
    tollRows
  };
}

function captureResultHasFailure(result) {
  return Boolean(result?.tollError);
}

async function captureRouteProof(group, job, shouldUseServerSave) {
  const routeResponse = await fetch(shouldUseServerSave ? "/api/travel-proof/capture-save" : "/api/travel-proof/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, fastCapture: FAST_CAPTURE_ENABLED })
  });
  const routeData = await routeResponse.json();
  if (!routeData.ok) {
    throw new Error(routeData.message);
  }

  const savedPath = shouldUseServerSave
    ? routeData.result.savedPath
    : await saveScreenshot(group.monthKey, "거리캡처", group.fileBaseName, routeData.result.imageBase64);
  if (!routeData.result.distanceKm) {
    throw new Error(`${group.dateKey} 이동거리를 읽을 수 없습니다.`);
  }

  return { savedPath, distanceKm: routeData.result.distanceKm };
}

function getCachedOilProof(group, shouldUseServerSave) {
  const key = `${group.dateKey}:${shouldUseServerSave ? "server" : "folder"}`;
  if (oilCapturePromises.has(key)) return oilCapturePromises.get(key);

  const promise = captureOilProof(group, shouldUseServerSave).catch((error) => {
    if (oilCapturePromises.get(key) === promise) oilCapturePromises.delete(key);
    throw error;
  });
  oilCapturePromises.set(key, promise);
  return promise;
}

async function captureOilProof(group, shouldUseServerSave) {
  const oilResponse = await fetch(shouldUseServerSave ? "/api/travel-proof/oil-capture-save" : "/api/travel-proof/oil-capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateKey: group.dateKey, fastCapture: FAST_CAPTURE_ENABLED })
  });
  const oilData = await oilResponse.json();
  if (!oilData.ok) {
    throw new Error(oilData.message);
  }
  if (!oilData.result.fuelPriceWon) {
    throw new Error(`${group.dateKey} 휘발유 유가를 읽을 수 없습니다.`);
  }

  const savedPath = shouldUseServerSave
    ? oilData.result.savedPath
    : await saveScreenshot(group.monthKey, "유가캡처", oilData.result.fileName.replace(/\.png$/i, ""), oilData.result.imageBase64);
  return { savedPath, fuelPriceWon: oilData.result.fuelPriceWon };
}

async function captureTollProof(group, shouldUseServerSave) {
  const batchResult = state.tollBatchResults.get(group.dateKey);
  if (batchResult) {
    return batchResult;
  }

  const tollResponse = await fetch(shouldUseServerSave ? "/api/travel-proof/toll-capture-save" : "/api/travel-proof/toll-capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateKey: group.dateKey, fastCapture: FAST_CAPTURE_ENABLED })
  });
  const tollData = await tollResponse.json();
  if (!tollData.ok) {
    throw new Error(tollData.message);
  }
  if (isNoHipassTollResult(tollData.result)) {
    return tollData.result;
  }

  const savedPath = shouldUseServerSave
    ? tollData.result.savedPath
    : await saveScreenshot(group.monthKey, HIPASS_TOLL_FOLDER, tollData.result.fileName.replace(/\.png$/i, ""), tollData.result.imageBase64);
  return { ...tollData.result, savedPath };
}

function buildFuelRowsFromCaptureParts(group, { routeResult = null, oilResult = null } = {}) {
  const draft = existingFuelCaptureDraft(group);
  const distanceKm = Number(routeResult?.distanceKm || draft.distanceKm || 0);
  const fuelPriceWon = Number(oilResult?.fuelPriceWon || draft.fuelPriceWon || 0);
  const routeSavedPath = routeResult?.savedPath || draft.routeSavedPath || "";
  const oilSavedPath = oilResult?.savedPath || draft.oilSavedPath || "";

  if (distanceKm && fuelPriceWon) {
    return buildFieldVisitExpensePasteRows([{ group, distanceKm, fuelPriceWon }]).map((row) => ({
      ...row,
      distanceKm,
      fuelPriceWon,
      routeSavedPath,
      oilSavedPath
    }));
  }

  if (!distanceKm && !fuelPriceWon && !routeSavedPath && !oilSavedPath) {
    return [];
  }

  return [{
    key: fuelCaptureDraftKey(group),
    dateKey: group.dateKey,
    monthKey: group.monthKey,
    distanceKm,
    fuelPriceWon,
    routeSavedPath,
    oilSavedPath,
    pendingFuelCapture: true
  }];
}

function existingFuelCaptureDraft(group) {
  const draft = state.fuelRows.find((row) => row.key === fuelCaptureDraftKey(group));
  return {
    distanceKm: Number(draft?.distanceKm || 0),
    fuelPriceWon: Number(draft?.fuelPriceWon || 0),
    routeSavedPath: draft?.routeSavedPath || "",
    oilSavedPath: draft?.oilSavedPath || ""
  };
}

async function prepareTollBatchResults(groups = []) {
  state.tollBatchResults = new Map();
  const shouldUseServerSave = !state.directoryHandle;
  if (!shouldUseServerSave) return;
  const dateKeys = [...new Set(groups
    .filter((group) => group?.dateKey && !captureCompletionStatus(group).tollComplete)
    .map((group) => group.dateKey))]
    .sort();
  if (dateKeys.length <= 1) return;

  const response = await fetch("/api/travel-proof/toll-capture-batch-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateKeys, fastCapture: FAST_CAPTURE_ENABLED })
  }).catch((error) => ({ ok: false, error }));
  if (!response.ok) {
    addError(`통행료 기간 조회 실패: ${response.error?.message || "기존 날짜별 조회로 진행합니다."}`);
    return;
  }
  const data = await response.json();
  if (!data.ok) {
    addError(`통행료 기간 조회 실패: ${data.message || "기존 날짜별 조회로 진행합니다."}`);
    return;
  }
  for (const result of data.results || []) {
    if (result?.dateKey) state.tollBatchResults.set(result.dateKey, result);
  }
}

async function runCoupangCapture() {
  if (state.running) {
    return;
  }

  const dateKeys = parseCoupangCaptureDates(elements.coupangDatesInput.value, {
    year: selectedCaptureYear()
  });

  elements.coupangResultList.innerHTML = "";
  elements.coupangErrorList.innerHTML = "";

  if (!dateKeys.length) {
    addCoupangError("캡처할 날짜를 입력해 주세요. 예: 05/21, 2026-06-10");
    return;
  }

  state.running = true;
  setBusy(true, "쿠팡 거래명세서 캡처 중...");
  try {
    const shouldUseServerSave = !state.directoryHandle;
    const response = await fetch(shouldUseServerSave ? "/api/travel-proof/coupang-capture-save" : "/api/travel-proof/coupang-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateKeys })
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message);
    }

    const savedEntries = [];
    for (const receipt of data.result.results || []) {
      const ledgerId = coupangLedgerEntryId(receipt);
      const existingEntry = state.ledgerEntries.find((entry) => entry.id === ledgerId);
      if (existingEntry) {
        const entry = {
          ...receipt,
          savedPath: existingEntry.savedPath || receipt.savedPath || "",
          savedFileName: existingEntry.savedFileName || receipt.savedFileName || receipt.fileName,
          duplicate: true
        };
        addCoupangResult(entry);
        savedEntries.push(entry);
        continue;
      }
      const monthKey = (receipt.dateKey || receipt.requestedDateKey || "").slice(0, 7);
      const savedPath = shouldUseServerSave ? receipt.savedPath : await saveCoupangReceipt(monthKey, receipt);
      const entry = {
        ...receipt,
        savedPath
      };
      state.coupangEntries.push(entry);
      addCoupangResult(entry);
      savedEntries.push(entry);
    }

    const ledgerEntries = savedEntries
      .filter((receipt) => Number(receipt.amountWon) > 0)
      .filter((receipt) => !receipt.duplicate)
      .map(receiptToLedgerEntry);
    if (ledgerEntries.length) {
      await upsertLedgerEntries(ledgerEntries);
    } else if (data.result.ledger?.entries) {
      state.ledgerEntries = data.result.ledger.entries;
    }

    for (const failure of data.result.failures || []) {
      addCoupangError(`${failure.dateKey}: ${failure.message}`);
    }

    await loadExpenseLedger();
    renderCoupangLimitSummary();
  } catch (error) {
    addCoupangError(`쿠팡 캡처 실패: ${error.message}`);
  } finally {
    state.running = false;
    setBusy(false);
    await finishAutomationSession();
  }
}

async function saveCoupangReceipt(monthKey, receipt) {
  const monthDirectory = await state.directoryHandle.getDirectoryHandle(monthKey, { create: true });
  await ensureCoupangProofFolders(monthDirectory);
  const folderName = COUPANG_PROOF_FOLDERS[receipt.category] || COUPANG_PROOF_FOLDERS.review;
  const targetDirectory = await monthDirectory.getDirectoryHandle(folderName, { create: true });
  const baseName = receiptFileBaseName({
    dateKey: receipt.dateKey,
    amountWon: receipt.amountWon,
    site: "쿠팡"
  });
  const fileName = await nextAvailableFileName(targetDirectory, `${baseName}.png`);
  const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(base64ToBlob(receipt.imageBase64, "image/png"));
  await writable.close();
  return `${monthKey}/${folderName}/${fileName}`;
}

async function ensureCoupangProofFolders(monthDirectory) {
  await Promise.all(Object.values(COUPANG_PROOF_FOLDERS)
    .map((folder) => monthDirectory.getDirectoryHandle(folder, { create: true })));
}

function getFormPayload() {
  return {
    year: Number(elements.yearInput.value),
    month: Number(elements.monthInput.value),
    start: elements.startInput.value.trim(),
    destination: elements.destinationInput.value.trim(),
    tableText: elements.tableInput.value
  };
}

function renderPreview() {
  renderTravelSummary();
  renderCaptureResult();
  renderCalendarHeader();
  renderCrossMonthNotice();
  elements.previewList.innerHTML = "";
  elements.previewList.append(renderRouteCalendar());
}

function renderTravelSummary() {
  const manualCount = state.groups.filter((group) => group.manual).length;
  const excelCount = state.groups.length - manualCount;
  elements.previewCount.textContent = `현장지원 ${excelCount}건 / 출장 ${manualCount}건`;
  const totalElement = elements.previewCount.nextElementSibling;
  if (totalElement) {
    totalElement.textContent = `총 ${state.groups.length}건`;
  }
}

function renderCaptureResult() {
  const resultLogs = currentCaptureResultLogs();
  const successCount = resultLogs.filter((log) => log.status === "success").length;
  const failureCount = resultLogs.filter((log) => log.status === "error").length;
  const total = state.captureStats.total || state.groups.length || 0;
  const completed = state.captureStats.success + state.captureStats.failure + state.captureStats.skipped;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  elements.captureResultSummary.textContent = `${percent}%`;
  elements.captureResultDetail.textContent = `성공 ${successCount}건 · 실패 ${failureCount}건`;
  if (elements.captureResultFoldSummary) {
    elements.captureResultFoldSummary.textContent = `성공 ${successCount}건 · 실패 ${failureCount}건`;
  }
  renderCaptureLogPanel(resultLogs);
}

function emptyCaptureStats(total = 0) {
  return {
    total,
    success: 0,
    failure: 0,
    skipped: 0
  };
}

function currentCaptureResultLogs() {
  const storedKeys = new Set(state.storedCaptureResultLogs.map(captureResultLogKey));
  const runtimeLogs = state.captureResultLogs
    .map((log) => ({ ...log, status: log.status === "skipped" ? "success" : log.status }))
    .filter((log) => log.status === "error" || !storedKeys.has(captureResultLogKey(log)));
  return [...state.storedCaptureResultLogs, ...runtimeLogs];
}

function captureResultLogKey(log) {
  return `${log.dateKey || ""}:${log.type || ""}`;
}

function renderCaptureLogPanel(resultLogs = currentCaptureResultLogs()) {
  if (!elements.captureLogCard) return;
  const logs = filterCaptureLogs(resultLogs);
  const groupedLogs = groupCaptureLogsByDate(logs);
  const successCount = resultLogs.filter((log) => log.status === "success").length;
  const failureCount = resultLogs.filter((log) => log.status === "error").length;
  const summary = `성공 ${successCount}건 · 실패 ${failureCount}건`;
  elements.captureLogCard.innerHTML = `
    <div class="capture-log-header">
      <strong>처리 결과</strong>
      <span>${escapeHtml(summary)}</span>
    </div>
    <div class="capture-log-filters" role="tablist" aria-label="캡처 결과 필터">
      ${[
        ["all", "전체"],
        ["success", "성공"],
        ["error", "실패"]
      ].map(([value, label]) => `
        <button type="button" class="${state.captureResultFilter === value ? "active" : ""}" data-capture-log-filter="${value}">${label}</button>
      `).join("")}
    </div>
    <div class="capture-log-groups">
      ${groupedLogs.length ? groupedLogs.map(renderCaptureLogGroup).join("") : `<p class="folder-label">표시할 처리 결과가 없습니다.</p>`}
    </div>
  `;
}

function filterCaptureLogs(logs) {
  if (state.captureResultFilter === "all") return logs;
  return logs.filter((log) => log.status === state.captureResultFilter);
}

function groupCaptureLogsByDate(logs) {
  const groups = new Map();
  for (const log of logs) {
    const key = log.dateKey || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return String(b).localeCompare(String(a));
    })
    .map(([dateKey, items]) => ({ dateKey, items }));
}

function renderCaptureLogGroup(group) {
  const expanded = state.captureLogExpandedDates[group.dateKey] !== false;
  const dateLabel = group.dateKey === "unknown" ? "기타 안내" : formatKoreanDateLabel(group.dateKey);
  return `
    <article class="capture-log-group ${expanded ? "is-expanded" : ""}">
      <button class="capture-log-date-button" type="button" data-capture-log-date="${escapeAttribute(group.dateKey)}">
        <span>${expanded ? "▼" : "▶"} ${escapeHtml(dateLabel)} · ${group.items.length}건</span>
      </button>
      ${expanded ? `
        <ul>
          ${group.items.map((log) => `
            <li class="capture-log-item ${escapeAttribute(log.status)}" title="${escapeAttribute(log.rawMessage)}">
              <span class="capture-log-dot" aria-hidden="true"></span>
              <span class="capture-log-type ${log.type ? `type-${escapeAttribute(log.type)}` : "is-empty"}">${escapeHtml(captureLogTypeLabel(log.type))}</span>
              <span class="capture-log-message">${escapeHtml(log.displayMessage)}</span>
              <span class="capture-log-status">${escapeHtml(captureLogStatusLabel(log.status))}</span>
            </li>
          `).join("")}
        </ul>
      ` : ""}
    </article>
  `;
}

function captureLogStatusLabel(status) {
  if (status === "error") return "실패";
  return "성공";
}

function captureLogTypeLabel(type) {
  return { route: "거리", oil: "유가", toll: "통행료" }[type] || "";
}

function handleCaptureLogClick(event) {
  const filterButton = event.target.closest("[data-capture-log-filter]");
  if (filterButton) {
    state.captureResultFilter = filterButton.dataset.captureLogFilter || "all";
    renderCaptureLogPanel();
    return;
  }
  const dateButton = event.target.closest("[data-capture-log-date]");
  if (!dateButton) return;
  const dateKey = dateButton.dataset.captureLogDate;
  state.captureLogExpandedDates[dateKey] = state.captureLogExpandedDates[dateKey] === false;
  renderCaptureLogPanel();
}

function rememberCaptureLog(message, status) {
  const rawMessage = String(message || "");
  if (/삭제된 증빙자료|캡처 이미지 .*삭제/.test(rawMessage)) return;
  const dateKey = parseDateKeyFromText(rawMessage) || "unknown";
  if (!(dateKey in state.captureLogExpandedDates)) state.captureLogExpandedDates[dateKey] = true;
  state.captureResultLogs.push({
    id: `${Date.now()}-${state.captureResultLogs.length}`,
    status,
    dateKey,
    type: captureLogTypeFromText(rawMessage),
    rawMessage,
    displayMessage: simplifyCaptureLogMessage(rawMessage, status)
  });
  renderCaptureLogPanel();
}

function captureLogTypeFromText(text) {
  const value = String(text || "");
  if (/통행료|하이패스|toll/i.test(value)) return "toll";
  if (/유가|oil/i.test(value)) return "oil";
  if (/거리|경로|유류|route/i.test(value)) return "route";
  return "";
}

function parseDateKeyFromText(text) {
  const match = String(text || "").match(/20\d{2}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function simplifyCaptureLogMessage(message, status = "success") {
  const text = String(message || "").replace(/^20\d{2}-\d{2}-\d{2}\s*/, "").replace(/^:\s*/, "").trim();
  if (/이미 처리/.test(text)) return text.includes("통행료") ? "통행료 이미 처리 완료" : text.includes("거리") ? "거리·유류대 이미 처리 완료" : "이미 처리 완료";
  if (/통행료 없음/.test(text)) return "통행료 없음 확인";
  if (/통행료 저장 완료/.test(text)) return "통행료 이미지 저장 완료";
  if (/거리 저장 완료/.test(text)) return "거리 이미지 저장 완료";
  if (/유가 저장 완료/.test(text)) return "유가 이미지 저장 완료";
  if (/거리·유류대 처리 완료/.test(text)) return "거리·유류대 처리 완료";
  if (/재실행/.test(text)) return "재실행 필요";
  if (status === "error") return captureFailureReason(text);
  return text.replace(/[A-Z]:\\[^ ]+/g, "저장 경로").replace(/\s+/g, " ").slice(0, 48);
}

function captureFailureReason(text) {
  if (/로그인|인증/.test(text)) return "로그인 확인이 필요합니다.";
  if (/거리|경로/.test(text)) return "거리 경로를 찾지 못했습니다.";
  if (/유가|oil/i.test(text)) return "유가 정보를 확인하지 못했습니다.";
  if (/통행료|하이패스|toll/i.test(text)) return "통행료 정보를 확인하지 못했습니다.";
  return text.replace(/[A-Z]:\\[^ ]+/g, "").replace(/\s+/g, " ").slice(0, 48) || "캡처에 실패했습니다.";
}

function showCaptureSummaryAlert() {
  const { success, failure, skipped } = state.captureStats;
  const lines = [
    failure ? "캡처 일부 실패" : "캡처 처리 완료",
    `성공 ${success + skipped}건`,
    `실패 ${failure}건`
  ];
  if (failure) {
    lines.push("실패 건 재실행 버튼을 눌러 다시 시도할 수 있습니다.");
  }
  window.alert(lines.join("\n"));
}

function renderRouteCalendar() {
  const calendar = document.createElement("div");
  calendar.className = "route-calendar";

  const year = Number(elements.yearInput.value);
  const month = Number(elements.monthInput.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const empty = document.createElement("p");
    empty.className = "folder-label";
    empty.textContent = "기준 연도와 월을 확인해 주세요.";
    calendar.append(empty);
    return calendar;
  }

  const calendarMonth = buildWeekdayCalendarMonth(year, month, state.groups);
  if (calendarMonth.weekendGroups.length) {
    calendar.append(renderWeekendScheduleNotice(calendarMonth.weekendGroups));
  }

  const weekHeader = document.createElement("div");
  weekHeader.className = "calendar-weekdays";
  for (const dayName of calendarMonth.weekdayNames) {
    const item = document.createElement("div");
    item.textContent = dayName;
    weekHeader.append(item);
  }
  calendar.append(weekHeader);

  const days = document.createElement("div");
  days.className = "calendar-days";
  for (let index = 0; index < calendarMonth.leadingBlankCount; index += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-day is-empty";
    days.append(blank);
  }

  for (const day of calendarMonth.days) {
    const cell = document.createElement("article");
    cell.className = `calendar-day${day.holidayName ? " is-holiday" : ""}${day.groups.length ? " has-schedule" : ""}`;
    const dateHeader = document.createElement("div");
    dateHeader.className = "calendar-date-row";
    dateHeader.innerHTML = `<span class="calendar-date">${day.day}</span>`;
    if (day.holidayName) {
      const holiday = document.createElement("small");
      holiday.className = "calendar-holiday";
      holiday.textContent = day.holidayName;
      dateHeader.append(holiday);
    }
    cell.append(dateHeader);
    for (const group of day.groups) {
      cell.append(renderCalendarGroup(group));
    }
    days.append(cell);
  }

  calendar.append(days);
  return calendar;
}

function renderWeekendScheduleNotice(groups) {
  const notice = document.createElement("aside");
  notice.className = "weekend-schedule-notice";
  const dates = [...new Set(groups.map((group) => group.dateKey))].sort();
  notice.innerHTML = `
    <div>
      <strong>주말 일정 ${groups.length}건</strong>
      <span>${dates.map((dateKey) => escapeHtml(dateKey.slice(5).replace("-", "/"))).join(", ")}</span>
    </div>
    <small>달력에서는 숨기지만 캡처 대상에는 포함됩니다.</small>
  `;
  return notice;
}

function renderCalendarHeader() {
  const monthKey = resolveSelectedMonthKey();
  elements.calendarMonthLabel.textContent = monthKey ? `${monthKey.slice(0, 4)}년 ${Number(monthKey.slice(5, 7))}월` : "보기 월 확인";
}

function renderCrossMonthNotice() {
  const selectedMonth = resolveSelectedMonthKey();
  const months = groupMonthsInRouteData().filter((monthKey) => monthKey !== selectedMonth);
  elements.crossMonthNotice.innerHTML = "";
  if (!months.length) {
    return;
  }

  for (const monthKey of months) {
    const button = document.createElement("button");
    button.className = "month-chip";
    button.type = "button";
    button.textContent = `${monthKey} 자료 ${routeGroupCountForMonth(monthKey)}건`;
    button.addEventListener("click", () => setVisibleMonth(monthKey));
    elements.crossMonthNotice.append(button);
  }
}

function setVisibleMonth(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return;
  }
  elements.yearInput.value = match[1];
  elements.monthInput.value = String(Number(match[2]));
  handleVisibleMonthChange();
}

function groupMonthsInRouteData() {
  return [...new Set(state.groups
    .map((group) => String(group.dateKey || "").slice(0, 7))
    .filter((monthKey) => /^\d{4}-\d{2}$/.test(monthKey)))]
    .sort();
}

function routeGroupCountForMonth(monthKey) {
  return state.groups.filter((group) => String(group.dateKey || "").startsWith(`${monthKey}-`)).length;
}

function renderCalendarGroup(group) {
  const item = document.createElement("div");
  item.className = `calendar-entry ${group.manual ? "is-manual" : "is-excel"}`;
  const lines = group.manual
    ? group.waypoints.map((waypoint) => waypoint.searchName)
    : group.waypoints.map((waypoint) => `${waypoint.timeOfDay}: ${waypoint.dealerName || waypoint.posName || waypoint.searchName}`);
  const region = group.manual ? "" : routeRegionLabel(group);

  item.innerHTML = `
    <strong>${group.manual ? "출장" : `현장지원${region ? `(${escapeHtml(region)})` : ""}`}</strong>
    ${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
  `;
  return item;
}

function routeRegionLabel(group) {
  const regions = [...new Set((group.waypoints || [])
    .map((waypoint) => regionFromAddress(waypoint.posAddress || waypoint.fallbackAddress || ""))
    .filter(Boolean))];
  if (!regions.length) {
    return "";
  }
  return regions.length === 1 ? regions[0] : regions.join("/");
}

function regionFromAddress(address) {
  const value = String(address || "").trim();
  if (!value) {
    return "";
  }
  const cityMatch = value.match(/^(대구|부산|울산|광주|대전|서울|인천|세종|제주)\s*([^\s]+)?/);
  if (cityMatch) {
    return cityMatch[1];
  }
  const provinceCityMatch = value.match(/^(경북|경남|전북|전남|충북|충남|강원|경기|제주)\s+([^\s]+)/);
  if (provinceCityMatch) {
    const province = provinceCityMatch[1];
    const city = provinceCityMatch[2].replace(/[시군]$/, "");
    if (province === "경북" && ["포항", "구미"].includes(city)) {
      return city;
    }
    return `${province} ${city}`;
  }
  return value.split(/\s+/).slice(0, 2).join(" ");
}

function nextUniqueGroupFileBaseName(fileBaseName) {
  const used = new Set(state.groups.map((group) => group.fileBaseName));
  if (!used.has(fileBaseName)) {
    return fileBaseName;
  }

  let attempt = 2;
  let candidate = `${fileBaseName}_${String(attempt).padStart(2, "0")}`;
  while (used.has(candidate)) {
    attempt += 1;
    candidate = `${fileBaseName}_${String(attempt).padStart(2, "0")}`;
  }
  return candidate;
}

function renderManualDateOptions() {
  elements.manualDateSelect.disabled = false;
  elements.addManualWaypointButton.disabled = false;
}

function renderKnownErrors() {
  for (const error of state.errors) {
    addError(`${error.dateKey || "입력 오류"}: ${error.message}`);
  }
}

function createBrowserJob(group) {
  return {
    id: group.dateKey,
    dateKey: group.dateKey,
    outputFileName: `${group.fileBaseName}.png`,
    route: {
      start: group.start,
      destination: group.destination,
      waypoints: group.waypoints
    }
  };
}

async function saveScreenshot(monthKey, proofFolder, fileBaseName, imageBase64) {
  const monthDirectory = await state.directoryHandle.getDirectoryHandle(monthKey, { create: true });
  await ensureBrowserProofFolders(monthDirectory);
  const targetDirectory = await monthDirectory.getDirectoryHandle(proofFolder, { create: true });
  const fileName = await nextAvailableFileName(targetDirectory, `${fileBaseName}.png`);
  const fileHandle = await targetDirectory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(base64ToBlob(imageBase64, "image/png"));
  await writable.close();
  return `${monthKey}/${proofFolder}/${fileName}`;
}

async function nextAvailableFileName(directoryHandle, preferredName) {
  const extensionMatch = preferredName.match(/(\.[^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1] : "";
  const stem = extension ? preferredName.slice(0, -extension.length) : preferredName;
  let attempt = 1;
  let fileName = preferredName;

  while (true) {
    try {
      await directoryHandle.getFileHandle(fileName, { create: false });
      attempt += 1;
      fileName = `${stem}_${String(attempt).padStart(2, "0")}${extension}`;
    } catch {
      return fileName;
    }
  }
}

async function ensureBrowserProofFolders(monthDirectory) {
  await Promise.all([
    monthDirectory.getDirectoryHandle("거리캡처", { create: true }),
    monthDirectory.getDirectoryHandle("유가캡처", { create: true }),
    monthDirectory.getDirectoryHandle("추가증빙", { create: true }),
    monthDirectory.getDirectoryHandle(COUPANG_PROOF_FOLDERS.welfare, { create: true }),
    monthDirectory.getDirectoryHandle(COUPANG_PROOF_FOLDERS.supply, { create: true }),
    monthDirectory.getDirectoryHandle(COUPANG_PROOF_FOLDERS.other, { create: true }),
    monthDirectory.getDirectoryHandle(COUPANG_PROOF_FOLDERS.review, { create: true }),
    monthDirectory.getDirectoryHandle("엑셀자료", { create: true }),
    monthDirectory.getDirectoryHandle("PPT", { create: true })
  ]);
}

async function createProofPpt() {
  if (state.running) {
    return;
  }

  const monthKey = selectedPptMonthKey();
  if (!monthKey) {
    addError("PPT를 만들 기준 연도와 월을 확인해 주세요.");
    return;
  }
  setBusy(true, "PPT 생성 중...");
  try {
    if (state.directoryHandle) {
      const monthDirectory = await resolveBrowserProofMonthDirectory(state.directoryHandle, monthKey);
      const images = await collectBrowserProofImages(monthDirectory, monthKey);
      if (!images.length) {
        throw new Error(`${monthKey} 폴더에서 PPT로 만들 증빙 이미지를 찾지 못했습니다.`);
      }
      const response = await fetch("/api/travel-proof/ppt-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey, images })
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.message);
      }

      const pptDirectory = await monthDirectory.getDirectoryHandle("PPT", { create: true });
      const fileName = await nextAvailableFileName(pptDirectory, data.result.fileName);
      const fileHandle = await pptDirectory.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(base64ToBlob(data.result.pptBase64, "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
      await writable.close();
      elements.pptStatus.textContent = `PPT 저장 완료: ${monthKey}/PPT/${fileName}`;
    } else {
      const response = await fetch("/api/travel-proof/ppt-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey })
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.message);
      }
      elements.pptStatus.textContent = `PPT 저장 완료: ${data.result.savedPath}`;
    }
  } catch (error) {
    addError(`PPT 생성 실패: ${error.message}`);
    elements.pptStatus.textContent = "PPT 생성 실패";
  } finally {
    setBusy(false);
  }
}

async function previewProofPpt() {
  await renderProofImagePreview(elements.pptPreviewList, {
    emptyMessage: "PPT로 묶을 증빙 이미지를 찾지 못했습니다.",
    allowDelete: true,
    monthKey: selectedPptMonthKey()
  });
}

async function refreshStoragePreview() {
  await renderProofImagePreview(elements.storagePreviewList, {
    emptyMessage: "기준 월 저장자료를 찾지 못했습니다."
  });
}

async function scanDuplicateFiles() {
  if (!elements.deleteDuplicatesButton) return;
  elements.deleteDuplicatesButton.disabled = true;
  state.duplicateCandidates = [];
  renderStorageCleanupStatus(["중복 파일을 찾는 중입니다."]);

  try {
    const monthDirectory = await selectedBrowserMonthDirectoryForCleanup();
    const files = await collectCleanupFiles(monthDirectory);
    const candidates = duplicateCleanupCandidates(files);
    state.duplicateCandidates = candidates;
    elements.deleteDuplicatesButton.disabled = !candidates.length;
    renderStorageCleanupStatus(candidates.length
      ? candidates.map((file) => `삭제 후보: ${file.relativePath}`)
      : ["중복 후보가 없습니다."]);
  } catch (error) {
    renderStorageCleanupStatus([`중복 확인 실패: ${error.message}`], "error");
  }
}

async function deleteDuplicateFiles() {
  if (!state.duplicateCandidates.length) {
    return;
  }
  const confirmed = window.confirm(`중복 후보 ${state.duplicateCandidates.length}개 파일을 삭제할까요?`);
  if (!confirmed) {
    return;
  }

  const deleted = [];
  const failures = [];
  for (const file of state.duplicateCandidates) {
    try {
      await file.parent.removeEntry(file.name);
      deleted.push(file.relativePath);
    } catch (error) {
      failures.push(`${file.relativePath}: ${error.message}`);
    }
  }

  state.duplicateCandidates = [];
  elements.deleteDuplicatesButton.disabled = true;
  renderStorageCleanupStatus([
    ...deleted.map((path) => `삭제 완료: ${path}`),
    ...failures.map((message) => `삭제 실패: ${message}`)
  ], failures.length ? "error" : "success");
  scheduleProofPreviews();
}

async function clearSelectedProofFolder() {
  if (!elements.deleteFolderSelect) return;
  const folderName = elements.deleteFolderSelect.value;
  try {
    const monthDirectory = await selectedBrowserMonthDirectoryForCleanup();
    const folder = await monthDirectory.getDirectoryHandle(folderName, { create: false });
    const entries = [];
    for await (const [name] of folder.entries()) {
      entries.push(name);
    }
    if (!entries.length) {
      renderStorageCleanupStatus([`${folderName} 폴더에 삭제할 파일이 없습니다.`]);
      return;
    }

    const confirmed = window.confirm(`${resolveSelectedMonthKey()}/${folderName} 폴더 안의 ${entries.length}개 항목을 모두 삭제할까요?`);
    if (!confirmed) {
      return;
    }

    for (const name of entries) {
      await folder.removeEntry(name, { recursive: true });
    }
    renderStorageCleanupStatus([`${folderName} 폴더 ${entries.length}개 항목 삭제 완료`], "success");
    scheduleProofPreviews();
  } catch (error) {
    renderStorageCleanupStatus([`폴더 삭제 실패: ${error.message}`], "error");
  }
}

async function selectedBrowserMonthDirectoryForCleanup() {
  if (!state.directoryHandle) {
    throw new Error("먼저 저장 폴더를 선택해 주세요.");
  }
  const monthKey = resolveSelectedMonthKey();
  if (!monthKey) {
    throw new Error("보기 연도와 월을 확인해 주세요.");
  }
  return resolveBrowserProofMonthDirectory(state.directoryHandle, monthKey);
}

async function collectCleanupFiles(monthDirectory) {
  const files = [];
  const seenFolders = new Set();
  for (const folderName of STORAGE_CLEANUP_FOLDERS) {
    if (seenFolders.has(folderName)) {
      continue;
    }
    seenFolders.add(folderName);
    try {
      const folder = await monthDirectory.getDirectoryHandle(folderName, { create: false });
      files.push(...await collectCleanupFilesFromDirectory(folder, folderName));
    } catch {
      // Missing proof folders are normal.
    }
  }
  return files;
}

async function collectCleanupFilesFromDirectory(directory, prefix) {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    const relativePath = `${prefix}/${name}`;
    if (handle.kind === "directory") {
      files.push(...await collectCleanupFilesFromDirectory(handle, relativePath));
      continue;
    }
    files.push({
      name,
      parent: directory,
      relativePath,
      duplicateKey: duplicateFileKey(relativePath)
    });
  }
  return files;
}

function duplicateCleanupCandidates(files) {
  const groups = new Map();
  for (const file of files) {
    if (!groups.has(file.duplicateKey)) {
      groups.set(file.duplicateKey, []);
    }
    groups.get(file.duplicateKey).push(file);
  }

  const candidates = [];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    if (sorted.length > 1) {
      candidates.push(...sorted.slice(1));
      continue;
    }
    if (/_\d{2}\.[^.]+$/i.test(sorted[0].name)) {
      candidates.push(sorted[0]);
    }
  }
  return candidates;
}

function duplicateFileKey(relativePath) {
  return String(relativePath || "")
    .replace(/_\d{2}(?=\.[^.]+$)/i, "")
    .toLowerCase();
}

function renderStorageCleanupStatus(messages, type = "") {
  if (!elements.storageCleanupStatus) return;
  elements.storageCleanupStatus.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.className = type;
    item.textContent = message;
    elements.storageCleanupStatus.append(item);
  }
  const messageText = messages.join(" ");
  const summary = type === "error"
    ? "확인 필요"
    : /찾는 중|확인 중/.test(messageText)
      ? "검사 중"
      : /삭제 완료|정리 완료/.test(messageText)
        ? "정리 완료"
        : /없습니다|후보가 없습니다/.test(messageText)
          ? "정상"
          : messages.length
            ? "확인 완료"
            : "확인 전";
  setWorkspaceMetric("storageCleanupState", summary);
}

async function readPreviewPayload(payload) {
  try {
    const response = await fetch("/api/travel-proof/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message);
    }
    return data;
  } catch (serverError) {
    const rows = parseTravelProofTable(payload.tableText);
    const groups = buildMonthlyProofGroups(rows, {
      year: payload.year,
      month: payload.month,
      start: payload.start,
      destination: payload.destination
    });
    return {
      ok: true,
      groups: groups.valid,
      errors: groups.errors,
      rowCount: rows.length,
      previewSource: "browser",
      serverMessage: serverError.message
    };
  }
}

async function renderProofImagePreview(targetElement, { emptyMessage, allowDelete = false, monthKey = resolveSelectedMonthKey() }) {
  targetElement.innerHTML = "";
  if (!monthKey) {
    updateProofWorkspaceSummary(targetElement, []);
    targetElement.innerHTML = `<p class="folder-label">기준 연도와 월을 확인해 주세요.</p>`;
    return;
  }
  if (!state.directoryHandle) {
    await renderServerProofImagePreview(targetElement, monthKey, emptyMessage, { allowDelete });
    return;
  }

  try {
    const monthDirectory = await resolveBrowserProofMonthDirectory(state.directoryHandle, monthKey);
    const images = await collectBrowserProofImages(monthDirectory, monthKey);
    const groups = groupProofImagesByDate(images, monthKey);
    updateProofWorkspaceSummary(targetElement, groups);
    if (!groups.length) {
      targetElement.innerHTML = `<p class="folder-label">${emptyMessage}</p>`;
      return;
    }
    if (allowDelete) {
      targetElement.append(renderProofBulkDeleteToolbar());
    }
    for (const group of groups) {
      targetElement.append(renderProofPreviewCard(group, { allowDelete }));
    }
  } catch (error) {
    updateProofWorkspaceSummary(targetElement, [], { failed: true });
    targetElement.innerHTML = `<p class="folder-label error">미리보기 실패: ${escapeHtml(error.message)}</p>`;
  }
}

async function renderServerProofImagePreview(targetElement, monthKey, emptyMessage, { allowDelete = false } = {}) {
  try {
    const response = await fetch("/api/travel-proof/ppt-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthKey })
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message);
    }

    const groups = data.result.groups || [];
    const unmatchedImages = data.result.unmatchedImages || [];
    updateProofWorkspaceSummary(targetElement, groups, { unmatchedCount: unmatchedImages.length });
    if (!groups.length) {
      targetElement.innerHTML = `<p class="folder-label">${emptyMessage}</p>`;
    } else {
      if (allowDelete) {
        targetElement.append(renderProofBulkDeleteToolbar());
      }
      for (const group of groups) {
        targetElement.append(renderProofPreviewCard(group, { allowDelete }));
      }
    }

    if (unmatchedImages.length) {
      targetElement.append(renderUnmatchedProofCard(unmatchedImages));
    }
  } catch (error) {
    updateProofWorkspaceSummary(targetElement, [], { failed: true });
    targetElement.innerHTML = `<p class="folder-label error">미리보기 실패: ${escapeHtml(error.message)}</p>`;
  }
}

function updateProofWorkspaceSummary(targetElement, groups, { unmatchedCount = 0, failed = false } = {}) {
  const imageCount = groups.reduce((total, group) => total + ["route", "oil", "toll", "extra", "welfare", "supply", "other", "review"]
    .reduce((count, key) => count + (group[key] || []).length, 0), 0) + unmatchedCount;

  if (targetElement === elements.pptPreviewList) {
    const missingCount = groups.reduce((count, group) =>
      count + ((group.route || []).length ? 0 : 1) + ((group.oil || []).length ? 0 : 1), 0);
    setWorkspaceMetric("pptProofDateCount", `${groups.length}일`);
    setWorkspaceMetric("pptMissingCount", `${missingCount}건`);
    setWorkspaceMetric("pptReadyState", failed ? "확인 실패" : (!groups.length ? "자료 없음" : (missingCount ? "보완 필요" : "생성 가능")));
  }

  if (targetElement === elements.storagePreviewList) {
    setWorkspaceMetric("storageFileCount", `${imageCount}개`);
    setWorkspaceMetric("storageDateCount", `${groups.length}일`);
  }
}

function setWorkspaceMetric(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = value;
}

function renderProofBulkDeleteToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "proof-preview-toolbar";
  toolbar.innerHTML = `
    <button class="secondary-button compact danger-button" type="button" data-proof-delete-selected>선택 파일 삭제</button>
    <span class="folder-label">삭제할 이미지를 체크한 뒤 한 번에 정리할 수 있습니다.</span>
  `;
  return toolbar;
}

function renderUnmatchedProofCard(images) {
  const card = document.createElement("article");
  card.className = "proof-preview-card";
  card.innerHTML = `
    <div class="proof-preview-title">
      <strong>날짜 인식 안 됨</strong>
      <span>${images.length}개 자료</span>
    </div>
    <ul class="unmatched-proof-list">
      ${images.map((image) => `<li>${escapeHtml(image.name)}</li>`).join("")}
    </ul>
    <p class="folder-label">파일명이나 폴더명에 2026-05-19, 26-05-19, 05-19, 5월 19일 형식의 날짜를 넣으면 PPT에 자동으로 들어갑니다.</p>
  `;
  return card;
}

function renderProofPreviewCard(group, { allowDelete = false } = {}) {
  const card = document.createElement("article");
  card.className = "proof-preview-card";
  const allImages = [
    ...(group.route || []).map((image) => ({ ...image, label: "거리" })),
    ...(group.oil || []).map((image) => ({ ...image, label: "유가" })),
    ...(group.toll || []).map((image) => ({ ...image, label: "통행료" })),
    ...(group.extra || []).map((image) => ({ ...image, label: "일반출장" })),
    ...(group.welfare || []).map((image) => ({ ...image, label: "조활비" })),
    ...(group.supply || []).map((image) => ({ ...image, label: "소모품비" })),
    ...(group.other || []).map((image) => ({ ...image, label: "기타" })),
    ...(group.review || []).map((image) => ({ ...image, label: "확인필요" }))
  ];
  card.innerHTML = `
    <div class="proof-preview-title">
      <strong>${group.dateKey}</strong>
      <span>${allImages.length}개 자료</span>
    </div>
    <div class="proof-thumb-grid">
      ${allImages.map((image) => `
        <figure class="proof-type-${escapeAttribute(image.type || "extra")}">
          ${allowDelete ? `
            <label class="proof-select-row">
              <input type="checkbox" data-proof-select="${escapeAttribute(image.name)}" />
              <span>선택</span>
            </label>
          ` : ""}
          <img src="${image.dataUri}" alt="${escapeHtml(image.name)}" data-preview-image="${image.dataUri}" data-preview-caption="${escapeHtml(`${image.label} · ${image.name}`)}" />
          <figcaption><span class="proof-type-chip">${escapeHtml(image.label)}</span><span class="proof-file-name">${escapeHtml(image.name.split("/").at(-1) || image.name)}</span></figcaption>
          ${allowDelete ? `<button class="ghost-button compact danger proof-delete-button" type="button" data-proof-delete="${escapeAttribute(image.name)}">삭제</button>` : ""}
        </figure>
      `).join("")}
    </div>
  `;
  return card;
}

async function renderCaptureProofPreview() {
  if (!elements.captureProofPreviewList) return;
  const monthKey = resolveSelectedMonthKey();
  elements.captureProofPreviewList.innerHTML = `<p class="folder-label">캡처 이미지를 불러오는 중입니다.</p>`;
  if (elements.captureProofPreviewSummary) {
    elements.captureProofPreviewSummary.textContent = "불러오는 중";
  }
  if (!monthKey) {
    elements.captureProofPreviewList.innerHTML = `<p class="folder-label">조회할 년도와 월을 선택해 주세요.</p>`;
    if (elements.captureProofPreviewSummary) elements.captureProofPreviewSummary.textContent = "저장된 이미지 0개";
    return;
  }

  try {
    const groups = state.directoryHandle
      ? await readBrowserCaptureProofGroups(monthKey)
      : await readServerCaptureProofGroups(monthKey);
    renderCaptureProofPreviewGroups(groups, monthKey);
  } catch (error) {
    elements.captureProofPreviewList.innerHTML = `<p class="folder-label error">캡처 이미지 확인 실패: ${escapeHtml(error.message)}</p>`;
    if (elements.captureProofPreviewSummary) elements.captureProofPreviewSummary.textContent = "확인 실패";
  }
}

async function readServerCaptureProofGroups(monthKey) {
  const response = await fetch("/api/travel-proof/ppt-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthKey })
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message);
  }
  return filterCaptureProofGroups(data.result.groups || []);
}

async function readBrowserCaptureProofGroups(monthKey) {
  const monthDirectory = await resolveBrowserProofMonthDirectory(state.directoryHandle, monthKey);
  const images = await collectBrowserProofImages(monthDirectory, monthKey);
  return filterCaptureProofGroups(groupProofImagesByDate(images, monthKey));
}

function filterCaptureProofGroups(groups = []) {
  return (groups || [])
    .map((group) => ({
      dateKey: group.dateKey,
      route: group.route || [],
      oil: group.oil || [],
      toll: group.toll || []
    }))
    .filter((group) => captureProofImagesForGroup(group).length > 0);
}

function renderCaptureProofPreviewGroups(groups, monthKey) {
  if (state.captureProofPreviewMonthKey !== monthKey) {
    state.captureProofExpandedDates = {};
    state.captureProofSelectedNames = new Set();
  }
  state.captureProofPreviewGroups = groups;
  state.captureProofPreviewMonthKey = monthKey;
  state.captureProofPreviewImages = flattenCaptureProofGroups(groups);
  state.storedCaptureResultLogs = buildStoredCaptureResultLogs(state.captureProofPreviewImages);
  const imageNames = new Set(state.captureProofPreviewImages.map((image) => image.name));
  state.captureProofSelectedNames = new Set([...state.captureProofSelectedNames].filter((name) => imageNames.has(name)));
  initializeCaptureProofExpandedDates(groups);
  const selectedCount = state.captureProofSelectedNames.size;
  if (elements.captureProofPreviewSummary) {
    elements.captureProofPreviewSummary.textContent = `${periodMonthLabel(monthKey)} · 이미지 ${state.captureProofPreviewImages.length}개`;
  }
  renderCaptureResult();
  elements.captureProofPreviewList.innerHTML = "";
  const failureNotice = renderCaptureProofFailureNotice();
  if (!groups.length) {
    if (failureNotice) elements.captureProofPreviewList.append(failureNotice);
    elements.captureProofPreviewList.insertAdjacentHTML("beforeend", `<p class="folder-label">선택한 월에 저장된 거리/유가/통행료 이미지가 없습니다.</p>`);
    renderCaptureProofCardCollapse();
    return;
  }
  if (failureNotice) elements.captureProofPreviewList.append(failureNotice);
  elements.captureProofPreviewList.append(renderCaptureProofToolbar());
  const board = document.createElement("div");
  board.className = "capture-proof-board";
  const gallery = document.createElement("div");
  gallery.className = "capture-proof-gallery";
  for (const group of groups) {
    gallery.append(renderCaptureProofPreviewCard(group));
  }
  board.append(gallery);
  elements.captureProofPreviewList.append(board);
  renderCaptureProofCardCollapse();
}

function toggleCaptureProofCard() {
  state.captureProofCardCollapsed = !state.captureProofCardCollapsed;
  renderCaptureProofCardCollapse();
}

function renderCaptureProofCardCollapse() {
  if (!elements.captureProofCard) return;
  elements.captureProofCard.classList.toggle("is-collapsed", state.captureProofCardCollapsed);
  if (elements.toggleCaptureProofCardButton) {
    elements.toggleCaptureProofCardButton.textContent = state.captureProofCardCollapsed ? "펼치기" : "접기";
    elements.toggleCaptureProofCardButton.setAttribute("aria-expanded", String(!state.captureProofCardCollapsed));
  }
}

function renderCaptureProofFailureNotice() {
  const failures = currentCaptureResultLogs().filter((log) => log.status === "error");
  if (!failures.length) return null;
  const notice = document.createElement("div");
  notice.className = "capture-proof-failure-notice";
  const firstFailure = failures[0];
  notice.innerHTML = `
    <strong>실패 ${failures.length}건</strong>
    <span title="${escapeAttribute(firstFailure.rawMessage)}">${escapeHtml(firstFailure.displayMessage || "실패한 항목이 있습니다.")}</span>
  `;
  return notice;
}

function renderCaptureProofToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "capture-proof-toolbar";
  const selectedCount = state.captureProofSelectedNames.size;
  toolbar.innerHTML = `
    <small class="capture-proof-toolbar-hint">이미지를 클릭하면 크게 볼 수 있습니다.</small>
    <div class="capture-proof-toolbar-actions">
      <span class="capture-proof-selected-count">${selectedCount}개 선택됨</span>
      <button class="secondary-button compact danger-button" type="button" data-capture-proof-delete-selected ${selectedCount ? "" : "disabled"}><i class="ph ph-trash" aria-hidden="true"></i> 선택 삭제</button>
    </div>
  `;
  return toolbar;
}

function renderCaptureProofPreviewCard(group) {
  const card = document.createElement("article");
  const expanded = state.captureProofExpandedDates[group.dateKey] !== false;
  card.className = `capture-proof-date-card ${expanded ? "is-expanded" : ""}`;
  const images = captureProofImagesForGroup(group).map((image) => ({
    ...image,
    dateKey: image.dateKey || group.dateKey,
    dateLabel: formatKoreanDateLabel(image.dateKey || group.dateKey),
    displayName: image.name?.split(/[\\/]/).at(-1) || image.name || "-"
  }));
  const allSelected = images.length > 0 && images.every((image) => state.captureProofSelectedNames.has(image.name));
  card.innerHTML = `
    <div class="capture-proof-date-title" data-capture-proof-toggle-date="${escapeAttribute(group.dateKey)}">
      <button type="button" data-capture-proof-toggle-date="${escapeAttribute(group.dateKey)}">
        <span>${expanded ? "▼" : "▶"} ${escapeHtml(formatKoreanDateWithWeekday(group.dateKey))} · ${images.length}개</span>
      </button>
      <label class="capture-date-select-all">
        <input type="checkbox" data-capture-proof-select-date="${escapeAttribute(group.dateKey)}" ${allSelected ? "checked" : ""} />
        <span>전체 선택</span>
      </label>
    </div>
    <div class="capture-proof-thumb-grid" ${expanded ? "" : "hidden"}>
      ${images.map((image) => `
        <figure class="proof-type-${escapeAttribute(image.type || "extra")} ${state.captureProofSelectedNames.has(image.name) ? "is-selected" : ""}" data-capture-proof-card="${escapeAttribute(image.name)}">
          <label class="proof-select-row" title="선택">
            <input type="checkbox" data-capture-proof-select="${escapeAttribute(image.name)}" ${state.captureProofSelectedNames.has(image.name) ? "checked" : ""} />
            <span>선택</span>
          </label>
          <img src="${image.dataUri}" alt="${escapeHtml(image.name)}" data-preview-image="${image.dataUri}" data-preview-caption="${escapeAttribute(captureProofCaption(image))}" data-capture-proof-modal="${escapeAttribute(image.name)}" />
          <figcaption>
            <span class="proof-type-chip">${escapeHtml(image.label)}</span>
          </figcaption>
        </figure>
      `).join("")}
    </div>
  `;
  return card;
}

function initializeCaptureProofExpandedDates(groups = []) {
  if (!groups.length) return;
  const newestDateKey = [...groups].map((group) => group.dateKey).sort().at(-1);
  for (const group of groups) {
    if (!(group.dateKey in state.captureProofExpandedDates)) {
      state.captureProofExpandedDates[group.dateKey] = groups.length <= 2 || group.dateKey === newestDateKey;
    }
  }
}

function flattenCaptureProofGroups(groups = []) {
  return groups.flatMap((group) => captureProofImagesForGroup(group).map((image) => ({
    ...image,
    dateKey: image.dateKey || group.dateKey,
    dateLabel: formatKoreanDateLabel(image.dateKey || group.dateKey),
    displayName: image.name?.split(/[\\/]/).at(-1) || image.name || "-"
  })));
}

function captureProofImagesForGroup(group) {
  return [
    ...(group.route || []).map((image) => ({ ...image, label: "거리", type: "route" })),
    ...(group.oil || []).map((image) => ({ ...image, label: "유가", type: "oil" })),
    ...(group.toll || []).map((image) => ({ ...image, label: "통행료", type: "toll" }))
  ];
}

function buildStoredCaptureResultLogs(images = []) {
  return images.map((image) => ({
    id: `stored-${image.dateKey}-${image.type}-${image.name}`,
    status: "success",
    dateKey: image.dateKey,
    type: image.type,
    rawMessage: `${image.dateKey} ${image.label} 증빙 저장 완료`,
    displayMessage: `${image.label} 증빙 저장 완료`
  }));
}

function captureProofCaption(image) {
  return [
    image.label || "캡처 이미지",
    image.dateLabel || formatKoreanDateLabel(image.dateKey),
    image.displayName || image.name?.split(/[\\/]/).at(-1) || image.name
  ].filter(Boolean).join("\n");
}

function formatFileSize(sizeBytes) {
  const size = Number(sizeBytes || 0);
  if (!size) return "-";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function formatKoreanDateLabel(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || "-";
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}

function formatKoreanDateWithWeekday(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey || "-";
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${Number(match[2])}월 ${Number(match[3])}일 (${weekdays[date.getDay()]})`;
}

async function handleCaptureProofPreviewActionClick(event) {
  const selectedButton = event.target.closest("[data-capture-proof-delete-selected]");
  if (selectedButton) {
    event.preventDefault();
    event.stopPropagation();
    const selectedNames = [...state.captureProofSelectedNames];
    if (!selectedNames.length) {
      addError("삭제할 캡처 이미지를 먼저 선택해 주세요.");
      return;
    }
    if (!window.confirm(`선택한 캡처 이미지 ${selectedNames.length}개를 삭제할까요?`)) return;
    await deleteCaptureProofImages(selectedNames);
    return;
  }

  const refreshButton = event.target.closest("[data-capture-proof-refresh]");
  if (refreshButton) {
    event.preventDefault();
    event.stopPropagation();
    await renderCaptureProofPreview();
    return;
  }

  const dateSelectInput = event.target.closest("[data-capture-proof-select-date]");
  if (dateSelectInput) {
    event.stopPropagation();
    const dateKey = dateSelectInput.dataset.captureProofSelectDate;
    const group = state.captureProofPreviewGroups.find((item) => item.dateKey === dateKey);
    const images = captureProofImagesForGroup(group || {});
    for (const image of images) {
      if (dateSelectInput.checked) {
        state.captureProofSelectedNames.add(image.name);
      } else {
        state.captureProofSelectedNames.delete(image.name);
      }
    }
    renderCaptureProofPreviewGroups(state.captureProofPreviewGroups, state.captureProofPreviewMonthKey);
    return;
  }

  const dateToggleButton = event.target.closest("[data-capture-proof-toggle-date]");
  if (dateToggleButton) {
    event.preventDefault();
    event.stopPropagation();
    const dateKey = dateToggleButton.dataset.captureProofToggleDate;
    state.captureProofExpandedDates[dateKey] = state.captureProofExpandedDates[dateKey] === false;
    renderCaptureProofPreviewGroups(state.captureProofPreviewGroups, state.captureProofPreviewMonthKey);
    return;
  }

  const selectInput = event.target.closest("[data-capture-proof-select]");
  if (selectInput) {
    event.stopPropagation();
    const imageName = selectInput.dataset.captureProofSelect;
    if (selectInput.checked) {
      state.captureProofSelectedNames.add(imageName);
    } else {
      state.captureProofSelectedNames.delete(imageName);
    }
    renderCaptureProofPreviewGroups(state.captureProofPreviewGroups, state.captureProofPreviewMonthKey);
    return;
  }
}

async function deleteCaptureProofImages(imageNames) {
  const monthKey = resolveSelectedMonthKey();
  try {
    await deleteProofImages(imageNames, { monthKey });
    imageNames.forEach((name) => state.captureProofSelectedNames.delete(name));
    await refreshMissingProofRowsForGroups(state.groups);
    await renderCaptureProofPreview();
  } catch (error) {
    window.alert(`캡처 이미지 삭제에 실패했습니다. ${error.message}`);
  }
}

async function handleProofPreviewActionClick(event) {
  const selectedButton = event.target.closest("[data-proof-delete-selected]");
  if (selectedButton) {
    event.preventDefault();
    event.stopPropagation();
    const selectedNames = [...elements.pptPreviewList.querySelectorAll("[data-proof-select]:checked")]
      .map((input) => input.dataset.proofSelect)
      .filter(Boolean);
    if (!selectedNames.length) {
      elements.pptStatus.textContent = "삭제할 이미지를 먼저 선택해 주세요.";
      return;
    }
    const confirmed = window.confirm(`선택한 파일 ${selectedNames.length}개를 삭제할까요?`);
    if (!confirmed) {
      return;
    }
    try {
      await deleteProofImages(selectedNames);
      await previewProofPpt();
      elements.pptStatus.textContent = `선택 파일 ${selectedNames.length}개 삭제 완료`;
    } catch (error) {
      addError(`PPT 미리보기 선택 삭제 실패: ${error.message}`);
    }
    return;
  }

  const button = event.target.closest("[data-proof-delete]");
  if (!button) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const imageName = button.dataset.proofDelete;
  const confirmed = window.confirm(`${imageName} 파일을 삭제할까요?`);
  if (!confirmed) {
    return;
  }
  try {
    await deleteProofImages([imageName]);
    await previewProofPpt();
    elements.pptStatus.textContent = `삭제 완료: ${imageName}`;
  } catch (error) {
    addError(`PPT 미리보기 파일 삭제 실패: ${error.message}`);
  }
}

async function deleteProofImages(imageNames, { monthKey = selectedPptMonthKey() } = {}) {
  for (const imageName of imageNames) {
    if (state.directoryHandle) {
      await deleteBrowserProofImage(imageName, { monthKey });
    } else {
      await deleteServerProofImage(imageName, { monthKey });
    }
  }
}

async function deleteServerProofImage(imageName, { monthKey = selectedPptMonthKey() } = {}) {
  const response = await fetch("/api/travel-proof/proof-image-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthKey, name: imageName })
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message);
  }
}

async function deleteBrowserProofImage(imageName, { monthKey = selectedPptMonthKey() } = {}) {
  const monthDirectory = await resolveBrowserProofMonthDirectory(state.directoryHandle, monthKey);
  const parts = String(imageName || "").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("삭제할 파일명이 올바르지 않습니다.");
  }

  let directory = monthDirectory;
  for (const segment of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create: false });
  }
  await directory.removeEntry(parts.at(-1));
}

function handlePreviewImageClick(event) {
  const image = event.target.closest("[data-preview-image]");
  if (!image) {
    return;
  }
  if (image.closest("#captureProofPreviewList")) {
    event.preventDefault();
    event.stopPropagation();
    const imageName = image.dataset.captureProofModal;
    const index = state.captureProofPreviewImages.findIndex((item) => item.name === imageName);
    if (index >= 0) {
      openCaptureImageModal(index);
      return;
    }
  }
  state.captureModalImages = [];
  state.captureModalIndex = -1;
  openImageModal(image.dataset.previewImage, image.dataset.previewCaption || image.alt || "");
  updateImageModalNavigation();
}

function openImageModal(src, caption) {
  if (!elements.imageModal || !elements.imageModalImg) {
    return;
  }
  ensureImageModalControls();
  elements.imageModalImg.src = src;
  elements.imageModalImg.alt = caption || "증빙 이미지 확대보기";
  const captionElement = elements.imageModal.querySelector("[data-image-modal-caption]");
  if (captionElement) captionElement.textContent = caption || "";
  elements.imageModal.hidden = false;
}

function openCaptureImageModal(index) {
  const image = state.captureProofPreviewImages[index];
  if (!image) return;
  state.captureModalImages = state.captureProofPreviewImages;
  state.captureModalIndex = index;
  openImageModal(image.dataUri, captureProofCaption(image));
  updateImageModalNavigation();
}

function closeImageModal() {
  if (!elements.imageModal || !elements.imageModalImg) {
    return;
  }
  elements.imageModal.hidden = true;
  elements.imageModalImg.removeAttribute("src");
  state.captureModalImages = [];
  state.captureModalIndex = -1;
  updateImageModalNavigation();
}

function ensureImageModalControls() {
  if (!elements.imageModal || elements.imageModal.querySelector("[data-image-modal-caption]")) return;
  const prevButton = document.createElement("button");
  prevButton.className = "image-modal-nav previous";
  prevButton.type = "button";
  prevButton.dataset.imageModalPrev = "true";
  prevButton.textContent = "‹";
  const nextButton = document.createElement("button");
  nextButton.className = "image-modal-nav next";
  nextButton.type = "button";
  nextButton.dataset.imageModalNext = "true";
  nextButton.textContent = "›";
  const caption = document.createElement("div");
  caption.className = "image-modal-caption";
  caption.dataset.imageModalCaption = "true";
  elements.imageModal.append(prevButton, nextButton, caption);
  prevButton.addEventListener("click", () => moveCaptureImageModal(-1));
  nextButton.addEventListener("click", () => moveCaptureImageModal(1));
}

function updateImageModalNavigation() {
  if (!elements.imageModal) return;
  const canMove = state.captureModalImages.length > 1 && state.captureModalIndex >= 0;
  for (const button of elements.imageModal.querySelectorAll("[data-image-modal-prev], [data-image-modal-next]")) {
    button.hidden = !canMove;
  }
}

function moveCaptureImageModal(direction) {
  if (!state.captureModalImages.length) return;
  const nextIndex = (state.captureModalIndex + direction + state.captureModalImages.length) % state.captureModalImages.length;
  openCaptureImageModal(nextIndex);
}

function handleImageModalKeydown(event) {
  if (!elements.imageModal || elements.imageModal.hidden) return;
  if (event.key === "Escape") {
    closeImageModal();
    return;
  }
  if (event.key === "ArrowLeft") {
    moveCaptureImageModal(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    moveCaptureImageModal(1);
  }
}

function applySettings() {
  const defaultStart = elements.settingsStartInput.value.trim() || "태왕디아너스오페라";
  const defaultDestination = elements.settingsDestinationInput.value.trim() || "태왕디아너스오페라";
  const authorName = elements.settingsAuthorNameInput?.value?.trim() || "";
  const userRole = document.querySelector("[data-settings-role].is-selected")?.dataset.settingsRole || readAppSettings().userRole || "manager";
  elements.startInput.value = defaultStart;
  elements.destinationInput.value = defaultDestination;
  elements.settingsPeopleInput.value = elements.coupangPeopleInput.value || "3";
  writeAppSettings({
    ...readAppSettings(),
    defaultStart,
    defaultDestination,
    welfarePeople: elements.settingsPeopleInput.value,
    authorName,
    userRole
  });
  renderSettingsRoleButtons(userRole);
  applyRoleMenuVisibility(userRole);
  refreshSettingsPreview();
  renderCoupangLimitSummary();
  renderLedger();
  renderExcelPasteOutputs();
  scheduleAutoPreview();
  elements.settingsStatus.textContent = "설정을 저장하고 현재 입력값에 반영했습니다.";
}

function renderSettingsRoleButtons(role) {
  const selectedRole = role || "manager";
  elements.settingsRoleButtons?.forEach((button) => {
    const isSelected = button.dataset.settingsRole === selectedRole;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function refreshSettingsPreview() {
  const routePreviewValues = {
    start: elements.settingsStartInput?.value?.trim() || "기본 출발지",
    end: elements.settingsDestinationInput?.value?.trim() || "기본 도착지"
  };
  elements.settingsRoutePreviews?.forEach((preview) => {
    preview.textContent = routePreviewValues[preview.dataset.settingsRoutePreview] || "";
  });
  if (elements.settingsWelfarePreview) {
    const people = Number(elements.coupangPeopleInput?.value) || 3;
    elements.settingsWelfarePreview.textContent = `${(people * 50000).toLocaleString("ko-KR")}원`;
  }
}

function refreshSettingsStoragePreview(path = "") {
  const cleanPath = String(path || "").trim();
  if (elements.settingsStoragePathPreview) {
    elements.settingsStoragePathPreview.value = cleanPath;
  }
  if (elements.settingsStoragePreviewText) {
    elements.settingsStoragePreviewText.textContent = cleanPath || "저장 폴더 선택 후 자료를 확인할 수 있습니다.";
  }
}

async function resolveBrowserProofMonthDirectory(directoryHandle, monthKey) {
  const entryNames = [];
  for await (const [name] of directoryHandle.entries()) {
    entryNames.push(name);
  }

  const path = proofMonthDirectoryPath({
    selectedFolderName: directoryHandle.name,
    entryNames,
    monthKey
  });
  if (!path) {
    throw new Error(`선택한 폴더에서 ${monthKey} 폴더를 찾지 못했습니다.`);
  }

  let currentDirectory = directoryHandle;
  for (const segment of path) {
    try {
      currentDirectory = await currentDirectory.getDirectoryHandle(segment, { create: false });
    } catch {
      throw new Error(`선택한 폴더에서 ${[...path].join("/")} 폴더를 찾지 못했습니다.`);
    }
  }
  return currentDirectory;
}

async function collectBrowserProofImages(monthDirectory, monthKey) {
  const folders = [
    ["route", "거리캡처"],
    ["oil", "유가캡처"],
    ["toll", HIPASS_TOLL_FOLDER],
    ...EXTRA_PROOF_FOLDER_ALIASES.map((folderName) => ["extra", folderName]),
    ["welfare", COUPANG_PROOF_FOLDERS.welfare],
    ["supply", COUPANG_PROOF_FOLDERS.supply],
    ["other", COUPANG_PROOF_FOLDERS.other],
    ["review", COUPANG_PROOF_FOLDERS.review]
  ];
  const images = [];
  const seenFolders = new Set();

  for (const [type, folderName] of folders) {
    if (seenFolders.has(folderName)) {
      continue;
    }
    seenFolders.add(folderName);
    let directory;
    try {
      directory = await monthDirectory.getDirectoryHandle(folderName, { create: false });
    } catch {
      continue;
    }
    images.push(...await collectImagesFromDirectory(directory, type, folderName));
  }

  for await (const [name, handle] of monthDirectory.entries()) {
    if (handle.kind !== "file" || !/\.(png|jpe?g|webp)$/i.test(name)) {
      continue;
    }
    const file = await handle.getFile();
    images.push({
      type: proofTypeFromFileName(name, "route"),
      name,
      dataUri: await fileToPresentationDataUri(file)
    });
  }

  return images;
}

async function collectImagesFromDirectory(directory, type, prefix = "") {
  const images = [];
  for await (const [name, handle] of directory.entries()) {
    const imageName = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      images.push(...await collectImagesFromDirectory(handle, type, imageName));
      continue;
    }
    if (handle.kind !== "file" || !/\.(png|jpe?g|webp)$/i.test(name)) {
      continue;
    }
    const file = await handle.getFile();
    images.push({
      type,
      name: imageName,
      dataUri: await fileToPresentationDataUri(file)
    });
  }
  return images;
}

async function fileToPresentationDataUri(file) {
  if (file.size <= PPT_IMAGE_DIRECT_SIZE_LIMIT || !file.type.startsWith("image/")) {
    return fileToDataUri(file);
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PPT_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size <= PPT_IMAGE_DIRECT_SIZE_LIMIT * 2) {
      bitmap.close?.();
      return fileToDataUri(file);
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("이미지 용량을 줄일 수 없습니다."));
        }
      }, "image/jpeg", PPT_IMAGE_JPEG_QUALITY);
    });
    return fileToDataUri(blob);
  } catch {
    return fileToDataUri(file);
  }
}

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function resolveSelectedMonthKey() {
  return selectedMonthKey(elements.yearInput.value, elements.monthInput.value);
}

function selectedPptMonthKey() {
  const value = String(elements.pptMonthInput?.value || "").trim();
  return /^\d{4}-\d{2}$/.test(value) ? value : resolveSelectedMonthKey();
}

function todayInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function updateRunButton() {
  elements.runButton.disabled = !canSave()
    || !hasSelectedCaptureTarget(currentCaptureTargets())
    || !canRunCapture({ groupCount: state.groups.length, running: state.running });
  updateRetryButton();
}

function syncCaptureTargetsFromInputs() {
  for (const input of elements.captureTargetInputs || []) {
    if (input.value in state.captureTargets) {
      state.captureTargets[input.value] = input.checked;
    }
  }
}

function currentCaptureTargets() {
  syncCaptureTargetsFromInputs();
  return { ...state.captureTargets };
}

function hasSelectedCaptureTarget(captureTargets) {
  return Boolean(captureTargets?.toll || captureTargets?.route || captureTargets?.oil);
}

function updateRetryButton() {
  elements.retryFailedButton.disabled = !canRetryFailedCapture({
    failedCount: state.failedJobs.length,
    running: state.running
  });
}

function clearLists() {
  state.captureResultLogs = [];
  state.captureLogExpandedDates = {};
  state.captureResultFilter = "all";
  if (elements.successList) elements.successList.innerHTML = "";
  if (elements.errorList) elements.errorList.innerHTML = "";
  elements.progressBar.value = 0;
  renderCaptureLogPanel();
}

function fuelGroupKey(group) {
  return String(group?.fileBaseName || group?.dateKey || "").trim();
}

function fuelCaptureDraftKey(group) {
  const key = fuelGroupKey(group);
  return key ? `${key}:capture-draft` : "";
}

async function refreshMissingProofRowsForGroups(groups = []) {
  if (!groups.length) return;
  const groupKeys = new Set(groups.map(fuelGroupKey).filter(Boolean));
  let removedFuel = 0;
  let removedToll = 0;

  for (const key of groupKeys) {
    const group = groups.find((item) => fuelGroupKey(item) === key);
    const groupFuelRows = state.fuelRows.filter((row) => !row.pendingFuelCapture && (row.key === key || row.key === `${key}:activity`));
    const routePaths = uniqueProofPaths(groupFuelRows.map((row) => row.routeSavedPath));
    const oilPaths = uniqueProofPaths(groupFuelRows.map((row) => row.oilSavedPath));
    const routeExists = await proofEvidenceExists({
      paths: routePaths,
      fallback: group ? expectedProofCandidate(group, "route") : null
    });
    const oilExists = await proofEvidenceExists({
      paths: oilPaths,
      fallback: group ? expectedProofCandidate(group, "oil") : null
    });
    if (groupFuelRows.length && (!routeExists || !oilExists)) {
      state.fuelRows = state.fuelRows.filter((row) => row.key !== key && row.key !== `${key}:activity`);
      removedFuel += groupFuelRows.length;
    }

    const draftKey = group ? fuelCaptureDraftKey(group) : "";
    const draft = state.fuelRows.find((row) => row.key === draftKey);
    if (draft) {
      const nextDraft = { ...draft };
      if (draft.routeSavedPath) {
        const draftRouteExists = await proofEvidenceExists({
          paths: [draft.routeSavedPath],
          fallback: group ? expectedProofCandidate(group, "route") : null
        });
        if (!draftRouteExists) {
          nextDraft.distanceKm = 0;
          nextDraft.routeSavedPath = "";
        }
      }
      if (draft.oilSavedPath) {
        const draftOilExists = await proofEvidenceExists({
          paths: [draft.oilSavedPath],
          fallback: group ? expectedProofCandidate(group, "oil") : null
        });
        if (!draftOilExists) {
          nextDraft.fuelPriceWon = 0;
          nextDraft.oilSavedPath = "";
        }
      }
      const hasDraftValue = nextDraft.distanceKm || nextDraft.fuelPriceWon || nextDraft.routeSavedPath || nextDraft.oilSavedPath;
      const draftChanged = JSON.stringify(nextDraft) !== JSON.stringify(draft);
      if (draftChanged || !hasDraftValue) {
        state.fuelRows = hasDraftValue
          ? state.fuelRows.map((row) => row.key === draftKey ? nextDraft : row)
          : state.fuelRows.filter((row) => row.key !== draftKey);
        removedFuel += 1;
      }
    }

    const tollKey = `${key}:toll`;
    const tollRows = state.tollRows.filter((row) => row.key === tollKey);
    const tollPaths = uniqueProofPaths(tollRows.map((row) => row.savedPath));
    const tollExists = await proofEvidenceExists({
      paths: tollPaths,
      fallback: group ? expectedProofCandidate(group, "toll") : null
    });
    if (tollRows.length && !tollExists) {
      state.tollRows = state.tollRows.filter((row) => row.key !== tollKey);
      removedToll += tollRows.length;
    }
  }

  if (removedFuel) writeLocalEntries(FUEL_ROWS_STORAGE_KEY, state.fuelRows);
  if (removedToll) writeLocalEntries(TOLL_ROWS_STORAGE_KEY, state.tollRows);
  if (removedFuel || removedToll) {
    renderFuelOutput();
    addError(`삭제된 증빙자료 ${removedFuel + removedToll}건을 확인했습니다. 누락된 항목은 다시 캡처합니다.`);
  }
}

function uniqueProofPaths(paths = []) {
  return [...new Set(paths.map((path) => String(path || "").trim()).filter(Boolean))];
}

async function proofEvidenceExists({ paths = [], fallback = null } = {}) {
  const knownPaths = uniqueProofPaths(paths);
  if (knownPaths.length) {
    return (await Promise.all(knownPaths.map((path) => proofPathExists(path)))).every(Boolean);
  }
  if (!fallback) return false;
  return proofCandidateExists(fallback);
}

function expectedProofCandidate(group, type) {
  if (!group?.monthKey) return null;
  if (type === "route") {
    return {
      type,
      monthKey: group.monthKey,
      folder: proofSubfolder("route"),
      fileName: `${fuelGroupKey(group)}.png`
    };
  }
  if (type === "oil") {
    return {
      type,
      monthKey: group.monthKey,
      folder: proofSubfolder("oil"),
      fileName: `oil-${group.dateKey}.png`
    };
  }
  if (type === "toll") {
    return {
      type,
      monthKey: group.monthKey,
      folder: HIPASS_TOLL_FOLDER,
      fileName: `toll-${group.dateKey}.png`
    };
  }
  return null;
}

async function proofCandidateExists(candidate) {
  if (!candidate) return false;
  const relativePath = [candidate.monthKey, candidate.folder, candidate.fileName].filter(Boolean).join("/");
  if (state.directoryHandle) {
    return browserProofPathExists(relativePath);
  }
  return serverProofCandidateExists(candidate);
}

async function proofPathExists(path) {
  if (!path) return false;
  if (state.directoryHandle && !isLikelyAbsolutePath(path)) {
    return browserProofPathExists(path);
  }
  return serverProofPathExists(path);
}

function isLikelyAbsolutePath(path) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

async function serverProofPathExists(path) {
  try {
    const response = await fetch("/api/travel-proof/proof-file-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [path] })
    });
    const data = await response.json();
    return Boolean(data.ok && data.result?.paths?.[path]);
  } catch {
    return true;
  }
}

async function serverProofCandidateExists(candidate) {
  try {
    const response = await fetch("/api/travel-proof/proof-file-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: [candidate] })
    });
    const data = await response.json();
    const key = candidateKey(candidate);
    return Boolean(data.ok && data.result?.candidates?.[key]);
  } catch {
    return true;
  }
}

function candidateKey(candidate) {
  return [candidate?.monthKey, candidate?.folder, candidate?.fileName].filter(Boolean).join("/");
}

async function browserProofPathExists(path) {
  try {
    const parts = String(path || "").split(/[\\/]/).filter(Boolean);
    let directory = state.directoryHandle;
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part);
    }
    await directory.getFileHandle(parts.at(-1));
    return true;
  } catch {
    return false;
  }
}

function captureCompletionStatus(group, captureTargets = currentCaptureTargets()) {
  const key = fuelGroupKey(group);
  if (!key) {
    return { complete: false, routeOilComplete: false, tollComplete: false };
  }
  const keys = new Set(state.fuelRows.map((row) => row.key));
  const tollKeys = new Set(state.tollRows.map((row) => row.key));
  const routeOilComplete = keys.has(key) && keys.has(`${key}:activity`);
  const tollComplete = tollKeys.has(`${key}:toll`);
  const routeOilSelected = Boolean(captureTargets.route || captureTargets.oil);
  const selectedRouteOilComplete = !routeOilSelected || routeOilComplete;
  const selectedTollComplete = !captureTargets.toll || tollComplete;
  return {
    complete: hasSelectedCaptureTarget(captureTargets) && selectedRouteOilComplete && selectedTollComplete,
    routeOilComplete,
    tollComplete
  };
}

function hasCompletedFuelRows(group) {
  return captureCompletionStatus(group).complete;
}

function upsertFuelRow(fuelRow) {
  const isCompletedFuelRow = fuelRow?.key && !fuelRow.pendingFuelCapture;
  const draftKey = isCompletedFuelRow ? fuelCaptureDraftKey({ fileBaseName: String(fuelRow.key).replace(/:activity$/, "") }) : "";
  state.fuelRows = state.fuelRows
    .filter((row) => row.key !== fuelRow.key && (!draftKey || row.key !== draftKey))
    .concat(fuelRow)
    .sort((left, right) => (left.dateKey.localeCompare(right.dateKey) || left.key.localeCompare(right.key)));
  writeLocalEntries(FUEL_ROWS_STORAGE_KEY, state.fuelRows);
}

function upsertFuelRows(fuelRows) {
  for (const fuelRow of fuelRows || []) {
    upsertFuelRow(fuelRow);
  }
}

function upsertTollRow(tollRow) {
  state.tollRows = state.tollRows
    .filter((row) => row.key !== tollRow.key)
    .concat(tollRow)
    .sort((left, right) => (left.dateKey.localeCompare(right.dateKey) || left.key.localeCompare(right.key)));
  writeLocalEntries(TOLL_ROWS_STORAGE_KEY, state.tollRows);
}

function upsertTollRows(tollRows) {
  for (const tollRow of tollRows || []) {
    upsertTollRow(tollRow);
  }
}

function addTollCaptureStatus(group, result, retry = false) {
  if (!result.tollSelected) {
    return;
  }
  const prefix = `${group.dateKey} ${retry ? "재실행 " : ""}`;
  if (result.tollSkipped) {
    addSuccess(`${prefix}통행료 이미 처리 완료`);
    return;
  }
  if (result.tollError) {
    addError(`${prefix}통행료 조회 실패: ${result.tollError}`);
    return;
  }
  if (result.tollNoResult) {
    addSuccess(`${prefix}통행료 없음 확인`);
    return;
  }
  if (result.tollAmountWon > 0) {
    addSuccess(`${prefix}통행료 저장 완료: ${result.tollSavedPath || `${result.tollAmountWon.toLocaleString("ko-KR")}원`}`);
  }
}

function addCaptureStatusMessages(group, result, retry = false) {
  if (!result.routeSelected && !result.oilSelected) {
    return;
  }
  const prefix = `${group.dateKey} ${retry ? "재실행 " : ""}`;
  if (result.routeSkipped) addSuccess(`${prefix}거리 이미 처리 완료`);
  if (result.oilSkipped) addSuccess(`${prefix}유가 이미 처리 완료`);
  if (result.routeSavedPath) {
    addSuccess(`${prefix}거리 저장 완료: ${result.routeSavedPath}`);
  }
  if (result.oilSavedPath) {
    addSuccess(`${prefix}유가 저장 완료: ${result.oilSavedPath}`);
  }
}

function renderFuelOutput() {
  renderExcelPasteOutputs();
}

function initializeExcelExportInputs() {
  fillSelect(elements.generalTravelItemSelect, GENERAL_TRAVEL_ITEMS);
  if (elements.generalTravelDateInput) {
    elements.generalTravelDateInput.value = todayInputValue(now);
  }
}

function loadManualExcelEntries() {
  state.generalTravelEntries = readLocalEntries(GENERAL_TRAVEL_STORAGE_KEY);
  state.fuelRows = readLocalEntries(FUEL_ROWS_STORAGE_KEY);
  state.tollRows = readLocalEntries(TOLL_ROWS_STORAGE_KEY);
}

function addGeneralTravelEntry() {
  const entry = normalizeManualExpenseEntry({
    dateKey: elements.generalTravelDateInput.value,
    item: elements.generalTravelItemSelect.value,
    place: elements.generalTravelPlaceInput.value,
    amountWon: elements.generalTravelAmountInput.value,
    summary: elements.generalTravelSummaryInput.value,
    note: elements.generalTravelNoteInput.value
  }, "general");
  if (!entry.dateKey || !entry.item || !entry.amountWon) {
    renderExcelPasteStatus(["일반출장 사용일자, 항목, 금액을 확인해 주세요."], "error");
    return;
  }
  state.generalTravelEntries = state.generalTravelEntries.concat(entry);
  writeLocalEntries(GENERAL_TRAVEL_STORAGE_KEY, state.generalTravelEntries);
  clearManualInputs([
    elements.generalTravelPlaceInput,
    elements.generalTravelAmountInput,
    elements.generalTravelSummaryInput,
    elements.generalTravelNoteInput
  ]);
  renderExcelPasteOutputs();
}

function renderExcelPasteOutputs() {
  const monthKey = selectedExcelMonthKey();
  const visibleCorporateEntries = filterRowsByMonth(state.corporateCardEntries, monthKey);
  const cardGeneralRows = buildCorporateCardGeneralTravelPasteRows(visibleCorporateEntries);
  const cardFieldVisitRows = buildCorporateCardFieldVisitPasteRows(visibleCorporateEntries);
  const generalRows = buildGeneralTravelPasteRows(filterRowsByMonth(state.generalTravelEntries, monthKey)).concat(cardGeneralRows);
  const tollOutputRows = filterRowsByMonth(state.tollRows, monthKey).filter((row) => row.text);
  const fieldVisitRows = sortPasteRowsByDate(filterRowsByMonth(state.fuelRows, monthKey).filter((row) => row.text).concat(tollOutputRows, cardFieldVisitRows))
    .map(normalizeTravelSheetClipboardRow);
  const corporateRows = buildCorporateCardPasteRows(visibleCorporateEntries);

  state.excelPasteRows = {
    generalTravelPasteOutput: generalRows,
    fieldVisitPasteOutput: fieldVisitRows,
    corporateCardPasteOutput: corporateRows
  };
  renderExcelPreviewCards({ generalRows, fieldVisitRows, corporateRows });
  setWorkspaceMetric("excelOutputCount", `${generalRows.length + fieldVisitRows.length + corporateRows.length}행`);

  const missingCardItemCount = visibleCorporateEntries
    .filter((entry) => entry.targetSheet !== "excluded" && entry.status !== "excluded" && entry.category !== "excluded" && !entry.expenseItem)
    .length;
  if (missingCardItemCount) {
    renderExcelPasteStatus([`법인카드 ${missingCardItemCount}건은 엑셀 항목을 선택해야 출력됩니다.`], "error");
  } else {
    renderExcelPasteStatus([]);
  }
}

function handleExcelMonthChange() {
  state.fieldVisitPreviewExpanded = false;
  state.corporateCardListExpanded = false;
  renderCorporateCardEntries();
  renderExcelPasteOutputs();
}

function handleExcelPreviewClick(event) {
  const toggleTarget = event.target.closest("[data-excel-card-toggle], .excel-review-card-heading");
  if (toggleTarget) {
    const key = toggleTarget.dataset.excelCardToggle || toggleTarget.closest("[data-excel-preview-card]")?.dataset.excelPreviewCard;
    if (!key) {
      return;
    }
    state.excelPreviewCollapsed[key] = !state.excelPreviewCollapsed[key];
    renderExcelPreviewCardsFromState();
    return;
  }

  const moreButton = event.target.closest("[data-field-preview-more]");
  if (moreButton) {
    state.fieldVisitPreviewExpanded = !state.fieldVisitPreviewExpanded;
    renderExcelPreviewCardsFromState();
  }
}

function handleCollapsiblePanelClick(event) {
  const corporateMoreButton = event.target.closest("[data-corporate-card-list-more]");
  if (corporateMoreButton) {
    state.corporateCardListExpanded = !state.corporateCardListExpanded;
    renderCorporateCardEntries();
    return;
  }

  const heading = event.target.closest("[data-collapsible-heading]");
  if (!heading || isInteractivePanelTarget(event.target)) {
    return;
  }
  toggleCollapsiblePanel(heading);
}

function handleCollapsiblePanelKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const heading = event.target.closest("[data-collapsible-heading]");
  if (!heading) {
    return;
  }
  event.preventDefault();
  toggleCollapsiblePanel(heading);
}

function toggleCollapsiblePanel(heading) {
  const panel = heading.closest("[data-collapsible-panel]");
  if (!panel) {
    return;
  }
  const groupName = panel.dataset.collapseGroup;
  const nextCollapsed = !panel.classList.contains("is-collapsed");
  const panels = groupName
    ? [...document.querySelectorAll(`[data-collapsible-panel][data-collapse-group="${CSS.escape(groupName)}"]`)]
    : [panel];
  for (const targetPanel of panels) {
    targetPanel.classList.toggle("is-collapsed", nextCollapsed);
    const targetHeading = targetPanel.querySelector("[data-collapsible-heading]");
    targetHeading?.setAttribute("aria-expanded", String(!nextCollapsed));
  }
}

function isInteractivePanelTarget(target) {
  return Boolean(target.closest("button, input, select, textarea, label, a"));
}

function renderExcelPreviewCardsFromState() {
  renderExcelPreviewCards({
    generalRows: state.excelPasteRows.generalTravelPasteOutput || [],
    fieldVisitRows: state.excelPasteRows.fieldVisitPasteOutput || [],
    corporateRows: state.excelPasteRows.corporateCardPasteOutput || []
  });
}

function renderExcelPreviewCards({ generalRows = [], fieldVisitRows = [], corporateRows = [] } = {}) {
  renderExcelPreviewCard({
    key: "general",
    rows: generalRows,
    badgeElement: elements.generalTravelPreviewBadge,
    bodyElement: elements.generalTravelPreviewBody,
    emptyMessage: "등록된 일반출장 내역이 없습니다."
  });
  renderExcelPreviewCard({
    key: "field",
    rows: fieldVisitRows,
    badgeElement: elements.fieldVisitPreviewBadge,
    bodyElement: elements.fieldVisitPreviewBody,
    moreElement: elements.fieldVisitPreviewMore,
    emptyMessage: "등록된 현장지원 내역이 없습니다.",
    limit: EXCEL_FIELD_PREVIEW_LIMIT
  });
  renderExcelPreviewCard({
    key: "corporate",
    rows: corporateRows,
    badgeElement: elements.corporateCardPreviewBadge,
    bodyElement: elements.corporateCardPreviewBody,
    emptyMessage: "등록된 조활비/소모품비/기타 내역이 없습니다."
  });
}

function renderExcelPreviewCard({ key, rows, badgeElement, bodyElement, moreElement = null, emptyMessage, limit = 0 }) {
  const previewRows = (rows || []).map(toExcelPreviewRow);
  const totalWon = previewRows.reduce((sum, row) => sum + row.amountWon, 0);
  const sortState = state.excelPreviewSort[key];
  const sortedRows = sortState ? sortEntriesForDisplay(previewRows, sortState) : previewRows;
  const isCollapsed = Boolean(state.excelPreviewCollapsed[key]);
  const card = document.querySelector(`[data-excel-preview-card="${key}"]`);
  const toggle = document.querySelector(`[data-excel-card-toggle="${key}"]`);
  if (badgeElement) {
    badgeElement.textContent = `${previewRows.length}건 · ${formatWon(totalWon)}원`;
  }
  if (card) {
    card.classList.toggle("is-collapsed", isCollapsed);
  }
  if (toggle) {
    const icon = toggle.querySelector("i");
    if (icon) {
      icon.className = `ph ${isCollapsed ? "ph-caret-down" : "ph-caret-up"}`;
    }
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
  }
  if (!bodyElement) {
    return;
  }
  if (!previewRows.length) {
    bodyElement.innerHTML = `<div class="excel-preview-empty">${escapeHtml(emptyMessage)}</div>`;
    if (moreElement) moreElement.innerHTML = "";
    return;
  }
  const visibleRows = limit && !state.fieldVisitPreviewExpanded ? sortedRows.slice(0, limit) : sortedRows;
  bodyElement.innerHTML = renderExcelPreviewTable(visibleRows, key);
  if (sortState) {
    applySortIndicators(`${EXCEL_PREVIEW_SORT_PREFIX}${key}`, sortState);
  }
  if (!moreElement) {
    return;
  }
  if (previewRows.length <= limit) {
    moreElement.innerHTML = "";
    return;
  }
  const remaining = Math.max(0, previewRows.length - limit);
  const label = state.fieldVisitPreviewExpanded ? "접기" : `+ ${remaining}건 더 보기`;
  const icon = state.fieldVisitPreviewExpanded ? "ph-caret-up" : "ph-caret-down";
  moreElement.innerHTML = `<button class="excel-preview-more-button" type="button" data-field-preview-more>${escapeHtml(label)} <i class="ph ${icon}"></i></button>`;
}

function renderExcelPreviewTable(rows, cardKey = "") {
  const sortTable = cardKey ? `${EXCEL_PREVIEW_SORT_PREFIX}${cardKey}` : "";
  const sortableHead = (label, sortKey) => sortTable
    ? `<th class="sortable-th" data-sort-table="${sortTable}" data-sort-key="${sortKey}" role="button" tabindex="0">${label} <span class="sort-indicator" aria-hidden="true">⇅</span></th>`
    : `<th>${label}</th>`;
  return `
    <div class="excel-preview-table-wrap">
      <table class="excel-preview-table">
        <colgroup>
          <col class="excel-preview-date" />
          <col class="excel-preview-category" />
          <col class="excel-preview-place" />
          <col class="excel-preview-amount" />
          <col class="excel-preview-detail" />
        </colgroup>
        <thead>
          <tr>
            ${sortableHead("날짜", "dateKey")}
            ${sortableHead("구분", "category")}
            <th>사용처</th>
            ${sortableHead("금액", "amountWon")}
            <th>내용/비고</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderExcelPreviewRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderExcelPreviewRow(row) {
  return `
    <tr>
      <td class="excel-preview-date-cell">${escapeHtml(row.dateKey || "-")}</td>
      <td><span class="excel-category-pill type-${escapeAttribute(categoryClassName(row.category))}">${escapeHtml(row.category || "-")}</span></td>
      <td class="excel-preview-truncate" title="${escapeAttribute(row.place)}">${escapeHtml(row.place || "-")}</td>
      <td class="excel-preview-amount-cell">${formatWon(row.amountWon)}원</td>
      <td class="excel-preview-truncate" title="${escapeAttribute(row.detail)}">${escapeHtml(row.detail || "-")}</td>
    </tr>
  `;
}

function toExcelPreviewRow(row) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const amountWon = Number(row?.amountWon || row?.amount || parseWonText(cells[3])) || 0;
  const summary = row?.summary || row?.memo || cells[4] || "";
  const note = row?.note || cells[5] || "";
  return {
    dateKey: row?.dateKey || cells[0] || "",
    category: row?.item || row?.expenseItem || row?.categoryLabel || cells[1] || "",
    place: row?.place || row?.merchantName || cells[2] || "",
    amountWon,
    detail: [summary, note].filter(Boolean).join(" / ")
  };
}

function categoryClassName(category) {
  const text = String(category || "");
  if (text.includes("유류")) return "fuel";
  if (text.includes("활동")) return "activity";
  if (text.includes("통행")) return "toll";
  if (text.includes("소모")) return "supply";
  if (text.includes("조직") || text.includes("조활")) return "welfare";
  if (text.includes("기타")) return "other";
  if (text.includes("우편")) return "post";
  if (text.includes("항공") || text.includes("철도")) return "transport";
  return "default";
}

function selectedExcelMonthKey() {
  const fallback = resolveSelectedMonthKey() || todayInputValue(now).slice(0, 7);
  const [fallbackYearText, fallbackMonthText] = fallback.split("-");
  const year = clampYear(elements.excelYearInput?.value, Number(fallbackYearText) || now.getFullYear());
  const month = clampNumber(elements.excelMonthSelect?.value, 1, 12, Number(fallbackMonthText) || now.getMonth() + 1);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function excelMonthLabel(monthKey) {
  return `${Number(String(monthKey || "").slice(5, 7)) || now.getMonth() + 1}월`;
}

function filterRowsByMonth(rows = [], monthKey = selectedExcelMonthKey()) {
  return (rows || []).filter((row) => String(row?.dateKey || "").startsWith(`${monthKey}-`));
}

function sortPasteRowsByDate(rows = []) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftDate = String(left.row?.dateKey || "").trim();
      const rightDate = String(right.row?.dateKey || "").trim();
      return leftDate.localeCompare(rightDate) || left.index - right.index;
    })
    .map((item) => item.row);
}

function normalizeTravelSheetClipboardRow(row) {
  if (Array.isArray(row?.cells) && Array.isArray(row?.columnSpans)) {
    return row;
  }
  const parts = String(row?.text || "").split("\t");
  if (parts.length !== 8) {
    return row;
  }
  return {
    ...row,
    cells: [parts[0], parts[1], parts[3], parts[5], parts[6], parts[7]],
    columnSpans: TRAVEL_SHEET_COLUMN_SPANS
  };
}

async function handlePasteOutputCopyClick(event) {
  const button = event.target.closest("[data-copy-paste-target]");
  if (!button) {
    return;
  }
  const target = document.querySelector(`#${button.dataset.copyPasteTarget}`);
  if (!target?.value) {
    renderExcelPasteStatus(["복사할 붙여넣기 결과가 없습니다."], "error");
    return;
  }
  await navigator.clipboard.writeText(target.value);
  renderExcelPasteStatus(["붙여넣기 결과를 복사했습니다."], "success");
}

async function writeDirectExcelWorkbook() {
  renderExcelPasteOutputs();
  const sourcePath = elements.directExcelPathInput?.value?.trim() || "";
  const monthKey = selectedExcelMonthKey();
  const authorName = elements.settingsAuthorNameInput?.value?.trim() || readAppSettings().authorName || "";
  if (!authorName) {
    renderExcelPasteStatus(["설정 메뉴에서 작성자 이름을 먼저 입력해 주세요."], "error");
    return;
  }
  const payload = {
    sourcePath,
    monthKey,
    authorName,
    generalTravelRows: (state.excelPasteRows.generalTravelPasteOutput || []).map(travelRowForExcelWrite),
    fieldVisitRows: (state.excelPasteRows.fieldVisitPasteOutput || []).map(travelRowForExcelWrite),
    corporateCardRows: (state.excelPasteRows.corporateCardPasteOutput || []).map(corporateRowForExcelWrite)
  };
  const totalRows = payload.generalTravelRows.length + payload.fieldVisitRows.length + payload.corporateCardRows.length;
  if (!totalRows) {
    renderExcelPasteStatus(["선택한 월에 작성할 내역이 없습니다."], "error");
    return;
  }
  if (elements.writeDirectExcelButton) {
    elements.writeDirectExcelButton.disabled = true;
  }
  renderExcelPasteStatus([`${excelMonthLabel(monthKey)} 지출결의서를 만들고 있습니다. 잠시만 기다려 주세요.`], "success");
  try {
    if (state.directoryHandle) {
      let proofImages = [];
      try {
        const monthDirectory = await resolveBrowserProofMonthDirectory(state.directoryHandle, monthKey);
        proofImages = await collectBrowserProofImages(monthDirectory, monthKey);
      } catch {
        proofImages = [];
      }
      payload.proofImageMode = "uploaded";
      payload.proofImages = proofImages;
    } else {
      payload.proofImageMode = "storage";
    }

    const response = await fetch("/api/travel-proof/excel-write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await readApiJson(response, "엑셀 직접 작성 API를 찾지 못했습니다. 앱 서버를 재시작해 주세요.");
    if (!data.ok) {
      throw new Error(data.message);
    }
    const result = data.result || {};
    const messages = [
      `지출결의서 생성 완료: 일반출장 ${result.generalTravelCount || 0}행 · 현장지원 ${result.fieldVisitCount || 0}행 · 조활비/소모품비/기타 ${result.corporateCardCount || 0}행`,
      `증빙 시트: ${result.proofBlockCount || 0}개 묶음 · 이미지 ${result.proofImageCount || 0}장`,
      `저장 위치: ${result.outputPath || "바탕화면"}`
    ];
    if (result.proofReviewCount) {
      messages.push(`증빙 ${result.proofReviewCount}건은 제목 또는 날짜 확인이 필요합니다.`);
    }
    if (result.proofImageFailureCount) {
      messages.push(`증빙 이미지 ${result.proofImageFailureCount}장은 Excel에 넣지 못했습니다.`);
    }
    renderExcelPasteStatus(messages, "success");
  } catch (error) {
    renderExcelPasteStatus([`지출결의서 만들기 실패: ${error.message}`], "error");
  } finally {
    if (elements.writeDirectExcelButton) {
      elements.writeDirectExcelButton.disabled = false;
    }
  }
}

function travelRowForExcelWrite(row) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  return {
    dateKey: row?.dateKey || cells[0] || "",
    item: row?.item || row?.expenseItem || cells[1] || "",
    place: row?.place || row?.merchantName || cells[2] || "",
    amountWon: Number(row?.amountWon || row?.amount || parseWonText(cells[3])),
    summary: row?.summary || cells[4] || "",
    note: row?.note || cells[5] || ""
  };
}

function corporateRowForExcelWrite(row) {
  return {
    dateKey: row?.dateKey || "",
    item: row?.expenseItem || row?.item || "",
    place: row?.merchantName || row?.place || "",
    amountWon: Number(row?.amountWon || row?.amount || 0),
    summary: row?.summary || row?.memo || row?.industryName || "",
    note: row?.note || ""
  };
}

function parseWonText(value) {
  return Number(String(value || "").replace(/[^0-9-]/g, "")) || 0;
}

function renderExcelPasteStatus(messages, type = "") {
  if (!elements.excelPasteStatus) {
    return;
  }
  elements.excelPasteStatus.hidden = !messages.length;
  elements.excelPasteStatus.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.className = type;
    item.textContent = message;
    elements.excelPasteStatus.append(item);
  }
}

function fillSelect(select, options) {
  if (!select) {
    return;
  }
  select.innerHTML = options
    .map((option) => `<option value="${escapeAttribute(option)}">${escapeHtml(option)}</option>`)
    .join("");
}

function readLocalEntries(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalEntries(key, entries) {
  localStorage.setItem(key, JSON.stringify(entries || []));
  schedulePersistentAppStateSave();
}

function readAppSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAppSettings(settings) {
  localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings || {}));
  schedulePersistentAppStateSave();
}

function schedulePersistentAppStateSave() {
  if (PROTOTYPE_PREVIEW) {
    return;
  }
  window.clearTimeout(persistentAppStateTimer);
  persistentAppStateTimer = window.setTimeout(savePersistentAppState, 250);
}

async function savePersistentAppState() {
  if (!appStateHydrated) {
    return;
  }
  try {
    await fetch(PERSISTENT_APP_STATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          updatedAt: new Date().toISOString(),
          appSettings: readAppSettings(),
          generalTravelEntries: readLocalEntries(GENERAL_TRAVEL_STORAGE_KEY),
          fuelRows: readLocalEntries(FUEL_ROWS_STORAGE_KEY),
          tollRows: readLocalEntries(TOLL_ROWS_STORAGE_KEY)
        }
      })
    });
  } catch {}
}

async function hydratePersistentAppState() {
  if (PROTOTYPE_PREVIEW) {
    appStateHydrated = true;
    return;
  }
  try {
    const response = await fetch(PERSISTENT_APP_STATE_ENDPOINT);
    const data = await response.json();
    if (data.ok && data.state && mergePersistentAppState(data.state)) {
      applyHydratedAppState();
    }
  } catch {}
  // 서버 백업을 읽어 복원을 마친 뒤에야 저장을 허용합니다.
  appStateHydrated = true;
  schedulePersistentAppStateSave();
}

function mergePersistentAppState(persistedState) {
  let changed = false;
  const currentSettings = readAppSettings();
  const persistedSettings = persistedState.appSettings && typeof persistedState.appSettings === "object" && !Array.isArray(persistedState.appSettings)
    ? persistedState.appSettings
    : {};
  const mergedSettings = { ...persistedSettings, ...currentSettings };
  if (Object.keys(persistedSettings).length && JSON.stringify(mergedSettings) !== JSON.stringify(currentSettings)) {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
    changed = true;
  }

  const entryMappings = [
    [GENERAL_TRAVEL_STORAGE_KEY, persistedState.generalTravelEntries],
    [FUEL_ROWS_STORAGE_KEY, persistedState.fuelRows],
    [TOLL_ROWS_STORAGE_KEY, persistedState.tollRows]
  ];
  for (const [key, persistedEntries] of entryMappings) {
    const currentEntries = readLocalEntries(key);
    if (!currentEntries.length && Array.isArray(persistedEntries) && persistedEntries.length) {
      localStorage.setItem(key, JSON.stringify(persistedEntries));
      changed = true;
    }
  }
  return changed;
}

function applyHydratedAppState() {
  const settings = readAppSettings();
  elements.startInput.value = settings.defaultStart || elements.startInput.value || "태왕디아너스오페라";
  elements.destinationInput.value = settings.defaultDestination || elements.destinationInput.value || "태왕디아너스오페라";
  elements.settingsStartInput.value = elements.startInput.value;
  elements.settingsDestinationInput.value = elements.destinationInput.value;
  if (elements.settingsAuthorNameInput) elements.settingsAuthorNameInput.value = settings.authorName || "";
  if (settings.welfarePeople) {
    elements.coupangPeopleInput.value = settings.welfarePeople;
    elements.settingsPeopleInput.value = settings.welfarePeople;
  }
  renderSettingsRoleButtons(settings.userRole || "manager");
  applyRoleMenuVisibility(settings.userRole || "manager");
  state.generalTravelEntries = readLocalEntries(GENERAL_TRAVEL_STORAGE_KEY);
  state.fuelRows = readLocalEntries(FUEL_ROWS_STORAGE_KEY);
  state.tollRows = readLocalEntries(TOLL_ROWS_STORAGE_KEY);
  refreshSettingsPreview();
  renderCoupangLimitSummary();
  renderLedger();
  renderExcelPasteOutputs();
  renderPreview();
  scheduleAutoPreview();
}

function clearManualInputs(inputs) {
  for (const input of inputs) {
    if (input) {
      input.value = "";
    }
  }
}

async function parseAndSaveCorporateCardEntries() {
  renderCorporateCardErrors([]);
  const parsed = parseCorporateCardPaste(elements.corporateCardInput.value, {
    year: Number(elements.yearInput.value) || now.getFullYear()
  });
  renderCorporateCardErrors(parsed.errors || []);
  if (!parsed.entries.length) {
    elements.browserStatus.textContent = "저장할 법인카드 내역이 없습니다.";
    renderCorporateCardEntries();
    return;
  }

  const existingKeys = new Set(state.corporateCardEntries.map(corporateCardDateAmountKey));
  const batchKeys = new Set();
  const entries = parsed.entries
    .map((entry) => normalizeCorporateCardEntry(entry))
    .filter((entry) => {
      const key = corporateCardDateAmountKey(entry);
      if (existingKeys.has(key) || batchKeys.has(key)) {
        return false;
      }
      batchKeys.add(key);
      return true;
    });
  if (!entries.length) {
    elements.browserStatus.textContent = "같은 날짜와 금액의 법인카드 내역은 이미 저장되어 있습니다.";
    renderCorporateCardEntries();
    return;
  }
  try {
    await upsertCorporateCardEntries(entries);
    elements.browserStatus.textContent = `법인카드 내역 ${entries.length}건을 저장했습니다.`;
  } catch (error) {
    renderCorporateCardErrors([{ message: `법인카드 내역 저장 실패: ${error.message}` }]);
  }
}

async function loadCorporateCardLedger() {
  if (!elements.corporateCardEntryList) {
    return;
  }
  try {
    const response = await fetch("/api/travel-proof/corporate-card-ledger");
    const data = await readApiJson(response, "법인카드 저장 API를 찾지 못했습니다. 앱 서버를 재시작해 주세요.");
    if (!data.ok) {
      throw new Error(data.message);
    }
    state.corporateCardEntries = data.ledger?.entries || [];
    await syncCorporateCardAllowanceLedgerEntries();
    renderCorporateCardEntries();
    renderExcelPasteOutputs();
  } catch (error) {
    renderCorporateCardErrors([{ message: `법인카드 내역 불러오기 실패: ${error.message}` }]);
  }
}

async function upsertCorporateCardEntries(entries) {
  const response = await fetch("/api/travel-proof/corporate-card-ledger/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries })
  });
  const data = await readApiJson(response, "법인카드 저장 API를 찾지 못했습니다. 앱 서버를 재시작해 주세요.");
  if (!data.ok) {
    throw new Error(data.message);
  }
  state.corporateCardEntries = data.ledger?.entries || [];
  await syncCorporateCardAllowanceLedgerEntries();
  renderCorporateCardEntries();
  renderExcelPasteOutputs();
}

async function deleteCorporateCardEntry(id) {
  const response = await fetch("/api/travel-proof/corporate-card-ledger/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const data = await readApiJson(response, "법인카드 삭제 API를 찾지 못했습니다. 앱 서버를 재시작해 주세요.");
  if (!data.ok) {
    throw new Error(data.message);
  }
  state.corporateCardEntries = data.ledger?.entries || [];
  await syncCorporateCardAllowanceLedgerEntries();
  renderCorporateCardEntries();
  renderExcelPasteOutputs();
}

async function syncCorporateCardAllowanceLedgerEntries() {
  const wantedEntries = state.corporateCardEntries
    .map(corporateCardAllowanceLedgerEntry)
    .filter(Boolean);
  const wantedIds = new Set(wantedEntries.map((entry) => entry.id));
  const duplicateIds = new Set(wantedEntries
    .filter((entry) => hasMatchingCoupangLedgerEntry(entry))
    .map((entry) => entry.id));
  const staleIds = state.ledgerEntries
    .filter((entry) => entry.source === "corporateCard" && (!wantedIds.has(entry.id) || duplicateIds.has(entry.id)))
    .map((entry) => entry.id);
  const upsertEntries = wantedEntries.filter((entry) => !duplicateIds.has(entry.id));

  if (staleIds.length) {
    await deleteLedgerEntries(staleIds, { render: false });
  }
  if (upsertEntries.length) {
    await upsertLedgerEntries(upsertEntries, { render: false });
  }
  if (staleIds.length || upsertEntries.length) {
    renderLedger();
    renderCoupangLimitSummary();
  }
}

function corporateCardAllowanceLedgerEntry(entry) {
  const type = corporateCardAllowanceType(entry);
  if (!type || entry?.status === "excluded" || entry?.targetSheet === "excluded") {
    return null;
  }
  const amountWon = Number(entry?.amountWon) || 0;
  if (!entry?.dateKey || !amountWon) {
    return null;
  }
  return {
    id: `corporate-card:${entry.id}`,
    dateKey: entry.dateKey,
    type,
    source: "corporateCard",
    amountWon,
    items: [
      entry.expenseItem,
      entry.merchantName,
      entry.summary || entry.industryName
    ].filter(Boolean),
    memo: [entry.note, entry.memo].filter(Boolean).join(" / "),
    status: "confirmed",
    savedPath: ""
  };
}

function corporateCardDateAmountKey(entry) {
  if (entry?.sourceType === "publicTransit") {
    return `${entry?.dateKey || ""}:${Number(entry?.amountWon) || 0}:${entry?.merchantName || ""}:${entry?.note || ""}`;
  }
  return `${entry?.dateKey || ""}:${Number(entry?.amountWon) || 0}`;
}

function hasMatchingCoupangLedgerEntry(entry, entries = state.ledgerEntries) {
  return entries.some((candidate) =>
    candidate.source === "coupang" &&
    candidate.dateKey === entry.dateKey &&
    Number(candidate.amountWon) === Number(entry.amountWon)
  );
}

function matchingCoupangLedgerEntry(entry, entries = state.ledgerEntries) {
  return entries.find((candidate) =>
    candidate.source === "coupang" &&
    candidate.dateKey === entry.dateKey &&
    Number(candidate.amountWon) === Number(entry.amountWon) &&
    Array.isArray(candidate.items) &&
    candidate.items.length
  );
}

function effectiveLedgerEntries(entries = state.ledgerEntries) {
  return entries.filter((entry) =>
    !(entry.source === "corporateCard" && hasMatchingCoupangLedgerEntry(entry, entries))
  );
}

function corporateCardStatusSortRank(entry) {
  if (entry.status === "excluded") return 2;
  if (entry.status === "confirmed") return 1;
  return 0;
}

function compareSortableEntries(a, b, key) {
  if (key === "amountWon") {
    return (Number(a.amountWon) || 0) - (Number(b.amountWon) || 0);
  }
  if (key === "status") {
    return corporateCardStatusSortRank(a) - corporateCardStatusSortRank(b);
  }
  if (key === "type") {
    return (LEDGER_TYPE_SORT_RANK[a.type] ?? 99) - (LEDGER_TYPE_SORT_RANK[b.type] ?? 99);
  }
  return String(a[key] || "").localeCompare(String(b[key] || ""));
}

// 헤더 클릭 정렬용 공통 정렬 함수. 1차 기준이 같으면 날짜·이름으로 보조 정렬.
function sortEntriesForDisplay(entries, sort) {
  const direction = sort?.direction === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const primary = compareSortableEntries(a, b, sort?.key || "dateKey") * direction;
    if (primary !== 0) {
      return primary;
    }
    return String(a.dateKey || "").localeCompare(String(b.dateKey || "")) ||
      String(a.merchantName || a.type || "").localeCompare(String(b.merchantName || b.type || ""));
  });
}

// 정렬 가능한 헤더의 위/아래 표시(⇅ ▲ ▼)를 현재 정렬 상태에 맞춰 갱신합니다.
function applySortIndicators(tableName, sort) {
  for (const th of document.querySelectorAll(`[data-sort-table="${tableName}"]`)) {
    const indicator = th.querySelector(".sort-indicator");
    if (!indicator) {
      continue;
    }
    if (th.dataset.sortKey === sort.key) {
      indicator.textContent = sort.direction === "desc" ? "▼" : "▲";
      indicator.classList.add("is-active");
      th.setAttribute("aria-sort", sort.direction === "desc" ? "descending" : "ascending");
    } else {
      indicator.textContent = "⇅";
      indicator.classList.remove("is-active");
      th.removeAttribute("aria-sort");
    }
  }
}

function sortStateForTable(tableName) {
  if (tableName === "corporateCard") {
    return state.corporateCardSort;
  }
  if (tableName === "ledger") {
    return state.ledgerSort;
  }
  if (tableName?.startsWith(EXCEL_PREVIEW_SORT_PREFIX)) {
    return state.excelPreviewSort[tableName.slice(EXCEL_PREVIEW_SORT_PREFIX.length)] || null;
  }
  return null;
}

function rerenderSortedTable(tableName) {
  if (tableName === "corporateCard") {
    renderCorporateCardEntries();
  } else if (tableName === "ledger") {
    renderLedger();
  } else if (tableName?.startsWith(EXCEL_PREVIEW_SORT_PREFIX)) {
    renderExcelPreviewCardsFromState();
  }
}

function handleSortHeaderClick(event) {
  const th = event.target.closest("[data-sort-key][data-sort-table]");
  if (!th) {
    return;
  }
  const tableName = th.dataset.sortTable;
  const sortState = sortStateForTable(tableName);
  if (!sortState) {
    return;
  }
  if (sortState.key === th.dataset.sortKey) {
    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
  } else {
    sortState.key = th.dataset.sortKey;
    sortState.direction = "asc";
  }
  rerenderSortedTable(tableName);
}

function handleSortHeaderKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  if (!event.target.closest?.("[data-sort-key][data-sort-table]")) {
    return;
  }
  event.preventDefault();
  handleSortHeaderClick(event);
}

function renderCorporateCardEntries() {
  if (!elements.corporateCardEntryList) {
    return;
  }
  applySortIndicators("corporateCard", state.corporateCardSort);
  elements.corporateCardEntryList.innerHTML = "";
  if (elements.corporateCardEntryMore) {
    elements.corporateCardEntryMore.innerHTML = "";
  }
  const monthKey = selectedExcelMonthKey();
  const allEntries = [...state.corporateCardEntries];
  const entries = sortEntriesForDisplay(filterRowsByMonth(allEntries, monthKey), state.corporateCardSort);
  const reviewCount = entries.filter((entry) =>
    entry.status === "review" ||
    (entry.targetSheet !== "excluded" && entry.status !== "excluded" && entry.category !== "excluded" && !entry.expenseItem)
  ).length;
  setWorkspaceMetric("excelCardCount", `${entries.length}건`);
  setWorkspaceMetric("excelReviewCount", `${reviewCount}건`);

  if (elements.corporateCardSummary) {
    elements.corporateCardSummary.textContent = `${excelMonthLabel(monthKey)} 내역 ${entries.length}건 · 전체 저장 ${allEntries.length}건 · 확인필요 ${reviewCount}건`;
  }

  if (!entries.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="10">선택한 월에 저장된 법인카드 내역이 없습니다.</td>`;
    elements.corporateCardEntryList.append(row);
    return;
  }

  const visibleEntries = state.corporateCardListExpanded ? entries : entries.slice(0, CORPORATE_CARD_PREVIEW_LIMIT);
  for (const entry of visibleEntries) {
    const targetSheet = corporateCardTargetSheetValue(entry.targetSheet);
    const expenseItem = corporateCardExpenseOptionsForTarget(targetSheet).includes(entry.expenseItem)
      ? entry.expenseItem
      : "";
    const row = document.createElement("tr");
    row.dataset.corporateCardId = entry.id;
    row.innerHTML = `
      <td>${escapeHtml(entry.dateKey)}</td>
      <td>${escapeHtml(entry.merchantName)}</td>
      <td>${escapeHtml(entry.industryName || "")}</td>
      <td class="amount-cell">${formatWon(entry.amountWon)}원</td>
      <td>
        <select data-corporate-card-field="targetSheet">
          ${corporateCardTargetSheetOptions(targetSheet)}
        </select>
      </td>
      <td>
        <select data-corporate-card-field="expenseItem">
          <option value="">선택</option>
          ${corporateCardExpenseItemOptions(expenseItem, targetSheet)}
        </select>
      </td>
      <td>
        <input class="memo-input" data-corporate-card-field="summary" type="text" value="${escapeAttribute(entry.summary || entry.memo || entry.industryName || "")}" placeholder="적요" />
      </td>
      <td>
        <input class="memo-input" data-corporate-card-field="note" type="text" value="${escapeAttribute(entry.note || "")}" placeholder="비고" />
      </td>
      <td class="status-cell ${corporateCardStatusClass(entry)}">${corporateCardStatusLabel(entry)}</td>
      <td>
        <button class="ghost-button compact danger" type="button" data-corporate-card-action="delete">삭제</button>
      </td>
    `;
    elements.corporateCardEntryList.append(row);
  }
  renderCorporateCardEntryMore(entries.length, visibleEntries.length);
}

function renderCorporateCardEntryMore(totalCount, visibleCount) {
  if (!elements.corporateCardEntryMore || totalCount <= CORPORATE_CARD_PREVIEW_LIMIT) {
    return;
  }
  const hiddenCount = Math.max(0, totalCount - CORPORATE_CARD_PREVIEW_LIMIT);
  const label = state.corporateCardListExpanded ? "접기" : `+ ${hiddenCount}건 더 보기`;
  const icon = state.corporateCardListExpanded ? "ph-caret-up" : "ph-caret-down";
  elements.corporateCardEntryMore.innerHTML = `
    <button class="corporate-card-more-button" type="button" data-corporate-card-list-more>
      ${escapeHtml(label)} <i class="ph ${icon}"></i>
    </button>
  `;
}

async function readApiJson(response, notFoundMessage) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  if (response.status === 404) {
    throw new Error(notFoundMessage);
  }
  throw new Error(text || `서버 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
}

async function handleCorporateCardTableChange(event) {
  const field = event.target.dataset.corporateCardField;
  if (field !== "targetSheet" && field !== "expenseItem") {
    return;
  }
  const row = event.target.closest("[data-corporate-card-id]");
  if (field === "targetSheet") {
    syncCorporateCardExpenseItemSelect(row);
  }
  const entry = corporateCardEntryFromRow(row);
  if (!entry) {
    return;
  }
  try {
    await upsertCorporateCardEntries([entry]);
    elements.browserStatus.textContent = "법인카드 분류를 저장했습니다.";
  } catch (error) {
    renderCorporateCardErrors([{ message: `분류 저장 실패: ${error.message}` }]);
  }
}

async function handleCorporateCardMemoBlur(event) {
  if (!["summary", "note"].includes(event.target.dataset.corporateCardField)) {
    return;
  }
  const row = event.target.closest("[data-corporate-card-id]");
  const entry = corporateCardEntryFromRow(row);
  if (!entry) {
    return;
  }
  const previous = state.corporateCardEntries.find((candidate) => candidate.id === entry.id);
  if ((previous?.summary || "") === entry.summary &&
      (previous?.note || "") === entry.note) {
    return;
  }
  try {
    await upsertCorporateCardEntries([entry]);
    elements.browserStatus.textContent = "법인카드 내용을 저장했습니다.";
  } catch (error) {
    renderCorporateCardErrors([{ message: `내용 저장 실패: ${error.message}` }]);
  }
}

async function handleCorporateCardTableClick(event) {
  const button = event.target.closest("[data-corporate-card-action]");
  if (!button) {
    return;
  }
  const row = button.closest("[data-corporate-card-id]");
  const id = row?.dataset.corporateCardId;
  if (!id) {
    return;
  }
  try {
    await deleteCorporateCardEntry(id);
    elements.browserStatus.textContent = "법인카드 내역을 삭제했습니다.";
  } catch (error) {
    renderCorporateCardErrors([{ message: `삭제 실패: ${error.message}` }]);
  }
}

function corporateCardEntryFromRow(row) {
  if (!row) {
    return null;
  }
  const entry = state.corporateCardEntries.find((candidate) => candidate.id === row.dataset.corporateCardId);
  if (!entry) {
    return null;
  }
  const targetSheet = corporateCardTargetSheetValue(row.querySelector('[data-corporate-card-field="targetSheet"]')?.value);
  const selectedExpenseItem = row.querySelector('[data-corporate-card-field="expenseItem"]')?.value || "";
  const expenseItem = corporateCardExpenseOptionsForTarget(targetSheet).includes(selectedExpenseItem)
    ? selectedExpenseItem
    : "";
  const summary = row.querySelector('[data-corporate-card-field="summary"]')?.value || "";
  const note = row.querySelector('[data-corporate-card-field="note"]')?.value || "";
  return normalizeCorporateCardEntry({
    ...entry,
    targetSheet,
    category: targetSheet === "excluded" ? "excluded" : "review",
    expenseItem,
    summary,
    note,
    memo: "",
    status: corporateCardStatusForTarget(targetSheet, expenseItem)
  });
}

function renderCorporateCardErrors(errors) {
  if (!elements.corporateCardErrorList) {
    return;
  }
  elements.corporateCardErrorList.innerHTML = "";
  elements.corporateCardErrorList.hidden = !errors.length;
  if (!errors.length) {
    return;
  }
  for (const error of errors) {
    const item = document.createElement("li");
    item.className = "error";
    item.textContent = error.message || String(error);
    elements.corporateCardErrorList.append(item);
  }
}

function corporateCardTargetSheetOptions(selected) {
  const selectedValue = corporateCardTargetSheetValue(selected);
  return Object.entries(CORPORATE_CARD_TARGET_SHEETS)
    .map(([value, label]) => `<option value="${escapeAttribute(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function corporateCardExpenseItemOptions(selected, targetSheet = "corporateCard") {
  if (targetSheet === "excluded") {
    return "";
  }
  return corporateCardExpenseOptionsForTarget(targetSheet)
    .map((value) => `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`)
    .join("");
}

function corporateCardExpenseOptionsForTarget(targetSheet = "corporateCard") {
  const target = corporateCardTargetSheetValue(targetSheet);
  if (target === "excluded") {
    return [];
  }
  return target === "corporateCard" ? CORPORATE_CARD_EXPENSE_ITEMS : GENERAL_TRAVEL_ITEMS;
}

function syncCorporateCardExpenseItemSelect(row) {
  const select = row?.querySelector('[data-corporate-card-field="expenseItem"]');
  if (!select) {
    return;
  }
  const targetSheet = corporateCardTargetSheetValue(row.querySelector('[data-corporate-card-field="targetSheet"]')?.value);
  const currentValue = select.value;
  const nextValue = corporateCardExpenseOptionsForTarget(targetSheet).includes(currentValue) ? currentValue : "";
  select.innerHTML = `
    <option value="">선택</option>
    ${corporateCardExpenseItemOptions(nextValue, targetSheet)}
  `;
  select.value = nextValue;
}

function corporateCardTargetSheetValue(value) {
  return CORPORATE_CARD_TARGET_SHEETS[value] ? value : "corporateCard";
}

function corporateCardStatusForTarget(targetSheet, expenseItem) {
  if (targetSheet === "excluded") {
    return "excluded";
  }
  return expenseItem ? "confirmed" : "review";
}

function corporateCardStatusLabel(entry) {
  if (entry.status === "excluded") {
    return "제외";
  }
  if (entry.status === "confirmed") {
    return "분류완료";
  }
  return "확인필요";
}

function corporateCardStatusClass(entry) {
  if (entry.status === "excluded") {
    return "status-excluded";
  }
  if (entry.status === "confirmed") {
    return "status-confirmed";
  }
  return "";
}

function renderLedgerLegacy() {
  if (!elements.ledgerEntryList) {
    return;
  }
  const monthKey = elements.ledgerMonthInput?.value || resolveSelectedMonthKey() || todayInputValue(now).slice(0, 7);
  const quarter = quarterRangeForMonth(monthKey);
  const confirmed = state.ledgerEntries.filter((entry) => entry.status === "confirmed");
  const monthEntries = state.ledgerEntries.filter((entry) => entry.dateKey?.startsWith(`${monthKey}-`));
  const quarterEntries = state.ledgerEntries.filter((entry) => entry.dateKey >= quarter.start && entry.dateKey <= quarter.end);
  const supplyUsed = sumLedger(confirmed.filter((entry) => entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)));
  const welfareUsed = sumLedger(confirmed.filter((entry) => entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end));
  const supplyLimit = Number(elements.settingsSupplyLimitInput.value) || 50000;
  const welfareLimit = (Number(elements.coupangPeopleInput.value) || 3) * 50000 * quarter.monthCount;
  const reviewCount = state.ledgerEntries.filter((entry) => entry.status === "review").length;

  if (elements.ledgerSummaryGrid) {
    elements.ledgerSummaryGrid.innerHTML = "";
    for (const card of [
      ["조회 월 소모품비", `${formatWon(supplyUsed)} / ${formatWon(supplyLimit)}원`, `${monthKey} 기준`, "supply"],
      ["조회 분기 조활비", `${formatWon(welfareUsed)} / ${formatWon(welfareLimit)}원`, `${quarter.label} 기준`, "welfare"],
      ["소모품비 잔액", `${formatWon(supplyLimit - supplyUsed)}원`, "월별 초기화", "supply"],
      ["조활비 잔액", `${formatWon(welfareLimit - welfareUsed)}원`, `${quarter.monthCount}개월 합산`, "welfare"],
      ["확인필요", `${reviewCount}건`, "확정 전까지 미차감", "review"]
    ]) {
      const item = document.createElement("article");
      item.className = `ledger-summary-card summary-${card[3]}`;
      item.innerHTML = `<span>${card[0]}</span><strong>${card[1]}</strong><span>${card[2]}</span>`;
      elements.ledgerSummaryGrid.append(item);
    }
  }

  const visibleEntries = [...new Map([...monthEntries, ...quarterEntries].map((entry) => [entry.id, entry])).values()]
    .sort((left, right) => String(right.dateKey).localeCompare(String(left.dateKey)));
  elements.ledgerEntryList.innerHTML = "";
  if (!visibleEntries.length) {
    const empty = document.createElement("tr");
    empty.className = "ledger-empty-row";
    empty.innerHTML = `<td colspan="6">아직 등록된 사용 이력이 없습니다.</td>`;
    elements.ledgerEntryList.append(empty);
    return;
  }
  for (const entry of visibleEntries) {
    const item = document.createElement("tr");
    item.className = entry.status;
    const itemText = (entry.items || []).join(", ") || entry.memo || "품목 없음";
    const evidenceText = entry.savedPath || (entry.source === "manual" ? "수기 입력" : "이미지 파일");
    item.innerHTML = `
      <td>${escapeHtml(entry.dateKey || "-")}</td>
      <td><span class="ledger-type-chip type-${escapeAttribute(entry.type || "review")}">${escapeHtml(categoryLabel(entry.type))}</span></td>
      <td class="amount-cell">${formatWon(entry.amountWon)}원</td>
      <td class="truncate-cell" title="${escapeAttribute(itemText)}">${escapeHtml(itemText)}</td>
      <td class="truncate-cell" title="${escapeAttribute(evidenceText)}">${escapeHtml(evidenceText)}</td>
      <td class="ledger-actions-cell">
        ${entry.status === "review" ? `
          <button class="text-action" type="button" data-ledger-action="confirm-welfare" data-ledger-id="${escapeAttribute(entry.id)}">조활비</button>
          <button class="text-action" type="button" data-ledger-action="confirm-supply" data-ledger-id="${escapeAttribute(entry.id)}">소모품비</button>
        ` : ""}
        <button class="text-action danger" type="button" data-ledger-action="delete" data-ledger-id="${escapeAttribute(entry.id)}">삭제</button>
      </td>
    `;
    elements.ledgerEntryList.append(item);
  }
}

function selectedLedgerPeriods() {
  const currentMonthKey = resolveSelectedMonthKey() || todayInputValue(now).slice(0, 7);
  const [fallbackYearText, fallbackMonthText] = currentMonthKey.split("-");
  const fallbackYear = Number(fallbackYearText) || now.getFullYear();
  const fallbackMonth = Number(fallbackMonthText) || now.getMonth() + 1;
  const welfareYear = clampYear(elements.welfareYearInput?.value, fallbackYear);
  const welfareQuarter = clampNumber(elements.welfareQuarterSelect?.value, 1, 4, Math.floor((fallbackMonth - 1) / 3) + 1);
  const supplyYear = clampYear(elements.supplyYearInput?.value, fallbackYear);
  const supplyMonth = clampNumber(elements.supplyMonthSelect?.value, 1, 12, fallbackMonth);
  return {
    welfare: quarterRangeForYearQuarter(welfareYear, welfareQuarter),
    supply: {
      year: supplyYear,
      month: supplyMonth,
      monthKey: `${supplyYear}-${String(supplyMonth).padStart(2, "0")}`,
      label: `${supplyMonth}월`
    }
  };
}

function selectedCaptureYear() {
  return clampYear(elements.supplyYearInput?.value || elements.welfareYearInput?.value, now.getFullYear());
}

function clampYear(value, fallbackYear) {
  return clampNumber(value, 2020, 2099, fallbackYear);
}

function clampNumber(value, min, max, fallbackValue) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return fallbackValue;
  }
  return number;
}

function quarterRangeForYearQuarter(year, quarter) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  let limitMonthCount = 3;
  if (year === currentYear && currentMonth >= startMonth && currentMonth <= endMonth) {
    limitMonthCount = currentMonth - startMonth + 1;
  } else if (year > currentYear || (year === currentYear && startMonth > currentMonth)) {
    limitMonthCount = 0;
  }
  return {
    year,
    quarter,
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${year}-${String(endMonth).padStart(2, "0")}-31`,
    label: `${year}년 ${quarter}분기`,
    shortLabel: `${quarter}분기`,
    monthCount: 3,
    limitMonthCount
  };
}

function welfareLimitForPeriod(period) {
  return (Number(elements.coupangPeopleInput.value) || 3) * 50000 * period.limitMonthCount;
}

function periodMonthLabel(monthKey) {
  return `${Number(String(monthKey || "").slice(5, 7)) || now.getMonth() + 1}월`;
}

// 선택한 조회 기간에 해당하는 사용 이력(구분 필터 적용 전, 중복 제거)
function periodLedgerEntries(periods) {
  const monthKey = periods.supply.monthKey;
  const quarter = periods.welfare;
  const selectedYears = new Set([String(quarter.year), String(periods.supply.year)]);
  return [...new Map(effectiveLedgerEntries()
    .filter((entry) =>
      (entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)) ||
      (entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end) ||
      (["other", "review"].includes(entry.type) && selectedYears.has(String(entry.dateKey || "").slice(0, 4)))
    )
    .map((entry) => [entry.id, entry])).values()];
}

function visibleLedgerEntries(periods) {
  const typeFilter = state.ledgerTypeFilter || "all";
  const filtered = periodLedgerEntries(periods)
    .filter((entry) => typeFilter === "all" || entry.type === typeFilter);
  return sortEntriesForDisplay(filtered, state.ledgerSort);
}

// 사용 이력 구분 필터 칩(전체/조활비/소모품비/기타 + 확인필요)을 건수와 함께 렌더링합니다.
function renderLedgerFilterChips(periods) {
  if (!elements.ledgerFilterChips) {
    return;
  }
  const entries = periodLedgerEntries(periods);
  const counts = { all: entries.length };
  for (const entry of entries) {
    counts[entry.type] = (counts[entry.type] || 0) + 1;
  }
  const chipDefs = [...LEDGER_FILTER_CHIPS];
  if ((counts.review || 0) > 0 || state.ledgerTypeFilter === "review") {
    chipDefs.push(["review", "확인필요"]);
  }
  // 현재 필터가 목록에 없으면(건수가 0이 되어 사라진 경우) 전체로 되돌립니다.
  if (!chipDefs.some(([value]) => value === state.ledgerTypeFilter)) {
    state.ledgerTypeFilter = "all";
  }
  elements.ledgerFilterChips.innerHTML = chipDefs.map(([value, label]) => {
    const count = value === "all" ? counts.all : (counts[value] || 0);
    const isActive = (state.ledgerTypeFilter || "all") === value;
    return `<button type="button" class="ledger-filter-chip type-${value}${isActive ? " is-active" : ""}" data-ledger-filter="${value}" role="tab" aria-selected="${isActive}">${label} <span class="chip-count">${count}</span></button>`;
  }).join("");
}

function handleLedgerFilterChipClick(event) {
  const chip = event.target.closest("[data-ledger-filter]");
  if (!chip) {
    return;
  }
  state.ledgerTypeFilter = chip.dataset.ledgerFilter;
  renderLedger();
}

function ledgerTypeOptions(selectedType) {
  return [
    ["welfare", "조활비"],
    ["supply", "소모품비"],
    ["other", "기타"]
  ].map(([value, label]) =>
    `<option value="${value}"${selectedType === value ? " selected" : ""}>${label}</option>`
  ).join("");
}

function renderLedger() {
  if (!elements.ledgerEntryList) return;
  applySortIndicators("ledger", state.ledgerSort);
  const periods = selectedLedgerPeriods();
  renderLedgerFilterChips(periods);
  const monthKey = periods.supply.monthKey;
  const quarter = periods.welfare;
  const ledgerEntries = effectiveLedgerEntries();
  const confirmed = ledgerEntries.filter((entry) => entry.status === "confirmed");
  const supplyUsed = sumLedger(confirmed.filter((entry) => entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)));
  const welfareUsed = sumLedger(confirmed.filter((entry) => entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end));
  const supplyLimit = Number(elements.settingsSupplyLimitInput.value) || 50000;
  const welfareLimit = welfareLimitForPeriod(quarter);
  const visibleEntries = visibleLedgerEntries(periods);
  const reviewCount = visibleEntries.filter((entry) => entry.status === "review").length;

  if (elements.ledgerSummaryGrid) {
    elements.ledgerSummaryGrid.innerHTML = "";
    for (const card of [
      [`${periodMonthLabel(monthKey)} 소모품비`, `${formatWon(supplyUsed)} / ${formatWon(supplyLimit)}원`, "월 기준", "supply"],
      [`${quarter.shortLabel} 조활비`, `${formatWon(welfareUsed)} / ${formatWon(welfareLimit)}원`, `${quarter.limitMonthCount}개월 한도`, "welfare"],
      ["소모품비 잔액", `${formatWon(supplyLimit - supplyUsed)}원`, "월 한도 기준", "supply"],
      ["조활비 잔액", `${formatWon(welfareLimit - welfareUsed)}원`, `${quarter.shortLabel} 누적`, "welfare"],
      ["확인필요", `${reviewCount}건`, "확정 전까지 미차감", "review"]
    ]) {
      const item = document.createElement("article");
      item.className = `ledger-summary-card summary-${card[3]}`;
      item.innerHTML = `<span>${card[0]}</span><strong>${card[1]}</strong><span>${card[2]}</span>`;
      elements.ledgerSummaryGrid.append(item);
    }
  }

  elements.ledgerEntryList.innerHTML = "";
  if (!visibleEntries.length) {
    const empty = document.createElement("tr");
    empty.className = "ledger-empty-row";
    empty.innerHTML = `<td colspan="6">아직 등록된 사용 이력이 없습니다.</td>`;
    elements.ledgerEntryList.append(empty);
    return;
  }

  for (const entry of visibleEntries) {
    const item = document.createElement("tr");
    item.className = entry.status;
    const displayItems = matchingCoupangLedgerEntry(entry)?.items || entry.items || [];
    const itemText = displayItems.join(", ") || "항목 없음";
    item.innerHTML = `
      <td>${escapeHtml(entry.dateKey || "-")}</td>
      <td>
        <select class="ledger-type-select ledger-type-${escapeAttribute(entry.type)}" data-ledger-field="type" data-ledger-id="${escapeAttribute(entry.id)}">
          ${ledgerTypeOptions(entry.type)}
        </select>
      </td>
      <td class="amount-cell">${formatWon(entry.amountWon)}원</td>
      <td class="truncate-cell" title="${escapeAttribute(itemText)}">${escapeHtml(itemText)}</td>
      <td>
        <input class="ledger-memo-input" data-ledger-field="memo" data-ledger-id="${escapeAttribute(entry.id)}" type="text" value="${escapeAttribute(entry.memo || "")}" placeholder="메모 입력" />
      </td>
      <td class="ledger-actions-cell">
        <button class="text-action danger" type="button" data-ledger-action="delete" data-ledger-id="${escapeAttribute(entry.id)}">삭제</button>
      </td>
    `;
    elements.ledgerEntryList.append(item);
  }
}

async function handleLedgerActionClick(event) {
  const button = event.target.closest("[data-ledger-action]");
  if (!button) {
    return;
  }
  const id = button.dataset.ledgerId;
  const resultItem = button.closest("[data-ledger-result-id]");
  try {
    if (button.dataset.ledgerAction === "confirm-welfare") {
      await confirmLedgerEntry(id, "welfare", resultItem);
      markCoupangResultConfirmed(resultItem, "조활비");
    } else if (button.dataset.ledgerAction === "confirm-supply") {
      await confirmLedgerEntry(id, "supply", resultItem);
      markCoupangResultConfirmed(resultItem, "소모품비");
    } else if (button.dataset.ledgerAction === "confirm-other") {
      await confirmLedgerEntry(id, "other", resultItem);
      markCoupangResultConfirmed(resultItem, "기타");
    } else if (button.dataset.ledgerAction === "delete") {
      await deleteLedgerEntry(id);
      resultItem?.remove();
    }
  } catch (error) {
    addCoupangError(`장부 처리 실패: ${error.message}`);
  }
}

async function handleLedgerFieldChange(event) {
  const field = event.target.closest("[data-ledger-field]");
  if (!field) return;
  const id = field.dataset.ledgerId;
  const entry = state.ledgerEntries.find((candidate) => candidate.id === id);
  if (!entry) return;
  if (field.dataset.ledgerField === "type") {
    await updateLedgerEntry({ ...entry, type: field.value, status: "confirmed" }, { optimistic: true });
  } else if (field.dataset.ledgerField === "memo") {
    await updateLedgerEntry({ ...entry, memo: field.value.trim() });
  }
}

async function handleLedgerMemoBlur(event) {
  const field = event.target.closest('[data-ledger-field="memo"]');
  if (!field) return;
  const id = field.dataset.ledgerId;
  const entry = state.ledgerEntries.find((candidate) => candidate.id === id);
  if (!entry || String(entry.memo || "") === field.value.trim()) return;
  await updateLedgerEntry({ ...entry, memo: field.value.trim() });
}

async function updateLedgerEntry(entry, { optimistic = false } = {}) {
  const previousEntries = state.ledgerEntries;
  if (optimistic) {
    state.ledgerEntries = state.ledgerEntries.map((candidate) =>
      candidate.id === entry.id ? { ...candidate, ...entry } : candidate
    );
    renderLedger();
    renderCoupangLimitSummary();
  }
  try {
    await upsertLedgerEntries([entry]);
  } catch (error) {
    if (optimistic) {
      state.ledgerEntries = previousEntries;
      renderLedger();
      renderCoupangLimitSummary();
    }
    addCoupangError(`사용 이력 저장 실패: ${error.message}`);
  }
}

function markCoupangResultConfirmed(resultItem, label) {
  if (!resultItem) {
    return;
  }
  resultItem.classList.add("confirmed");
  const actions = resultItem.querySelector(".inline-actions");
  if (actions) {
    actions.innerHTML = `<span class="folder-label">${label}로 확정되었습니다.</span>`;
  }
}

function sumLedger(entries) {
  return entries.reduce((sum, entry) => sum + (Number(entry.amountWon) || 0), 0);
}

function quarterRangeForMonth(monthKey) {
  const [yearText, monthText] = String(monthKey || "").split("-");
  const year = Number(yearText) || now.getFullYear();
  const month = Number(monthText) || now.getMonth() + 1;
  const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${year}-${String(endMonth).padStart(2, "0")}-31`,
    label: `${year}년 ${startMonth}~${endMonth}월`,
    monthCount: endMonth - startMonth + 1
  };
}

function categoryLabelOld(type) {
  return type === "welfare" ? "조활비" : type === "supply" ? "소모품비" : "확인필요";
}

function categoryLabel(type) {
  return type === "welfare" ? "조활비" : type === "supply" ? "소모품비" : type === "other" ? "기타" : "확인필요";
}

function receiptToLedgerEntry(receipt) {
  const type = receipt.category === "welfare" || receipt.category === "supply" ? receipt.category : "review";
  return {
    id: coupangLedgerEntryId(receipt),
    dateKey: receipt.dateKey || receipt.requestedDateKey || "",
    type,
    source: "coupang",
    amountWon: receipt.amountWon || 0,
    items: receipt.items || [],
    memo: receipt.reasons?.length ? `분류 근거: ${receipt.reasons.join(", ")}` : "",
    status: type === "review" ? "review" : "confirmed",
    savedPath: receipt.savedPath || ""
  };
}

function coupangLedgerEntryId(receipt) {
  return `coupang:${receipt.orderId || receipt.requestedDateKey || receipt.dateKey}:${receipt.amountWon || 0}:${receipt.dateKey || ""}`;
}

async function loadExpenseLedger() {
  try {
    const response = await fetch("/api/travel-proof/expense-ledger");
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message);
    }
    state.ledgerEntries = data.ledger?.entries || [];
    state.coupangEntries = state.ledgerEntries
      .filter((entry) => entry.source === "coupang")
      .map((entry) => ({
        ...entry,
        category: entry.type,
        categoryLabel: categoryLabel(entry.type),
        amountWon: entry.amountWon
      }));
    if (state.corporateCardEntries.length) {
      await syncCorporateCardAllowanceLedgerEntries();
    }
    renderLedger();
    renderCoupangLimitSummary();
  } catch (error) {
    addCoupangError(`장부 불러오기 실패: ${error.message}`);
  }
}

async function upsertLedgerEntries(entries, { render = true } = {}) {
  const response = await fetch("/api/travel-proof/expense-ledger/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries })
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message);
  }
  state.ledgerEntries = data.ledger?.entries || [];
  if (render) {
    renderLedger();
    renderCoupangLimitSummary();
  }
}

async function addManualExpenseEntry() {
  const dateKey = elements.manualExpenseDateInput.value;
  const type = elements.manualExpenseTypeSelect.value;
  const amountWon = Number(elements.manualExpenseAmountInput.value);
  const itemMemo = elements.manualExpenseMemoInput.value.trim();
  const userMemo = elements.manualExpensePathInput.value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !amountWon) {
    addCoupangError("수기 내역 날짜와 금액을 확인해 주세요.");
    return;
  }
  const entry = {
    id: `manual:${dateKey}:${Date.now()}`,
    dateKey,
    type,
    source: "manual",
    amountWon,
    items: itemMemo ? [itemMemo] : [],
    memo: userMemo,
    status: type === "review" ? "review" : "confirmed",
    savedPath: ""
  };
  try {
    await upsertLedgerEntries([entry]);
    elements.manualExpenseAmountInput.value = "";
    elements.manualExpenseMemoInput.value = "";
    elements.manualExpensePathInput.value = "";
  } catch (error) {
    addCoupangError(`수기 내역 저장 실패: ${error.message}`);
  }
}

async function confirmLedgerEntry(id, type, resultItem = null) {
  const entry = state.ledgerEntries.find((candidate) => candidate.id === id) || ledgerEntryFromResultItem(resultItem, id);
  if (!entry) {
    throw new Error("수정할 사용 이력을 찾지 못했습니다. 사용 이력을 새로고침한 뒤 다시 시도해 주세요.");
  }
  await upsertLedgerEntries([{ ...entry, type, status: "confirmed" }]);
}

function ledgerEntryFromResultItem(resultItem, id) {
  if (!resultItem) {
    return null;
  }
  const amountWon = Number(resultItem.dataset.ledgerAmountWon || 0);
  const dateKey = resultItem.dataset.ledgerDateKey || "";
  if (!id || !dateKey || !amountWon) {
    return null;
  }
  return {
    id,
    dateKey,
    type: resultItem.dataset.ledgerType || "review",
    source: "coupang",
    amountWon,
    items: parseLedgerItemsDataset(resultItem.dataset.ledgerItems),
    memo: resultItem.dataset.ledgerMemo || "",
    status: "review",
    savedPath: resultItem.dataset.ledgerSavedPath || ""
  };
}

function parseLedgerItemsDataset(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function deleteLedgerEntry(id) {
  await deleteLedgerEntries([id]);
}

async function deleteLedgerEntries(ids, { render = true } = {}) {
  const response = await fetch("/api/travel-proof/expense-ledger/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message);
  }
  state.ledgerEntries = data.ledger?.entries || [];
  if (render) {
    renderLedger();
    renderCoupangLimitSummary();
  }
}

function renderCoupangLimitSummaryOld() {
  const monthKey = elements.ledgerMonthInput?.value || resolveSelectedMonthKey() || todayInputValue(now).slice(0, 7);
  const quarter = quarterRangeForMonth(monthKey);
  const confirmedEntries = state.ledgerEntries.filter((entry) => entry.status === "confirmed");
  const welfareUsed = sumLedger(confirmedEntries.filter((entry) =>
    entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end
  ));
  const supplyUsed = sumLedger(confirmedEntries.filter((entry) =>
    entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)
  ));
  const welfareLimit = (Number(elements.coupangPeopleInput.value) || 3) * 50000 * quarter.monthCount;
  const supplyLimit = Number(elements.settingsSupplyLimitInput.value) || 50000;
  const welfareRemaining = welfareLimit - welfareUsed;
  const supplyRemaining = supplyLimit - supplyUsed;
  const welfarePercent = usagePercent(welfareUsed, welfareLimit);
  const supplyPercent = usagePercent(supplyUsed, supplyLimit);
  if (elements.welfareLimitCard) elements.welfareLimitCard.textContent = `${formatWon(welfareLimit)}원`;
  elements.welfareRemainingCard.textContent = `${formatWon(welfareRemaining)}원`;
  if (elements.welfareUsageText) elements.welfareUsageText.textContent = `사용 ${formatWon(welfareUsed)}원 / 한도 ${formatWon(welfareLimit)}원`;
  if (elements.welfareUsagePercent) elements.welfareUsagePercent.textContent = `${welfarePercent}%`;
  if (elements.welfareProgressBar) elements.welfareProgressBar.style.width = `${welfarePercent}%`;
  if (elements.supplyLimitCard) elements.supplyLimitCard.textContent = `${formatWon(supplyLimit)}원`;
  elements.supplyRemainingCard.textContent = `${formatWon(supplyRemaining)}원`;
  if (elements.supplyUsageText) elements.supplyUsageText.textContent = `사용 ${formatWon(supplyUsed)}원 / 한도 ${formatWon(supplyLimit)}원`;
  if (elements.supplyUsagePercent) elements.supplyUsagePercent.textContent = `${supplyPercent}%`;
  if (elements.supplyProgressBar) elements.supplyProgressBar.style.width = `${supplyPercent}%`;
  if (elements.coupangLimitSummary) {
    elements.coupangLimitSummary.innerHTML = `
      <span>조활비: ${quarter.label} ${quarter.monthCount}개월 총 ${formatWon(welfareLimit)}원 중 ${formatWon(welfareLimit - welfareUsed)}원 남음</span>
      <span>소모품비: ${monthKey} 총 ${formatWon(supplyLimit)}원 중 ${formatWon(supplyLimit - supplyUsed)}원 남음</span>
    `;
  }
}

function renderCoupangLimitSummary() {
  const periods = selectedLedgerPeriods();
  const monthKey = periods.supply.monthKey;
  const quarter = periods.welfare;
  const confirmedEntries = effectiveLedgerEntries().filter((entry) => entry.status === "confirmed");
  const welfareUsed = sumLedger(confirmedEntries.filter((entry) =>
    entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end
  ));
  const supplyUsed = sumLedger(confirmedEntries.filter((entry) =>
    entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)
  ));
  const welfareLimit = welfareLimitForPeriod(quarter);
  const supplyLimit = Number(elements.settingsSupplyLimitInput.value) || 50000;
  const welfareRemaining = welfareLimit - welfareUsed;
  const supplyRemaining = supplyLimit - supplyUsed;
  const welfarePercent = usagePercent(welfareUsed, welfareLimit);
  const supplyPercent = usagePercent(supplyUsed, supplyLimit);

  if (elements.welfarePeriodTitle) elements.welfarePeriodTitle.textContent = `${quarter.shortLabel} 조활비`;
  if (elements.supplyPeriodTitle) elements.supplyPeriodTitle.textContent = `${periodMonthLabel(monthKey)} 소모품비`;
  if (elements.welfareLimitCard) elements.welfareLimitCard.textContent = `${formatWon(welfareLimit)}원`;
  elements.welfareRemainingCard.textContent = `${formatWon(welfareRemaining)}원`;
  if (elements.welfareUsageText) elements.welfareUsageText.textContent = `사용 ${formatWon(welfareUsed)}원 / 한도 ${formatWon(welfareLimit)}원`;
  if (elements.welfareUsagePercent) elements.welfareUsagePercent.textContent = `${welfarePercent}%`;
  if (elements.welfareProgressBar) elements.welfareProgressBar.style.width = `${welfarePercent}%`;
  if (elements.supplyLimitCard) elements.supplyLimitCard.textContent = `${formatWon(supplyLimit)}원`;
  elements.supplyRemainingCard.textContent = `${formatWon(supplyRemaining)}원`;
  if (elements.supplyUsageText) elements.supplyUsageText.textContent = `사용 ${formatWon(supplyUsed)}원 / 한도 ${formatWon(supplyLimit)}원`;
  if (elements.supplyUsagePercent) elements.supplyUsagePercent.textContent = `${supplyPercent}%`;
  if (elements.supplyProgressBar) elements.supplyProgressBar.style.width = `${supplyPercent}%`;
  if (elements.coupangLimitSummary) {
    elements.coupangLimitSummary.innerHTML = `
      <span>조활비: ${quarter.shortLabel} ${quarter.limitMonthCount}개월 한도 ${formatWon(welfareLimit)}원 중 ${formatWon(welfareRemaining)}원 남음</span>
      <span>소모품비: ${periodMonthLabel(monthKey)} 한도 ${formatWon(supplyLimit)}원 중 ${formatWon(supplyRemaining)}원 남음</span>
    `;
  }
}

function addCoupangResult(entry) {
  const item = document.createElement("li");
  item.className = "success";
  const itemSummary = (entry.items || []).slice(0, 3).join(", ") || "품목 확인필요";
  const ledgerId = receiptToLedgerEntry(entry).id;
  const hasAmount = Number(entry.amountWon) > 0;
  item.dataset.ledgerResultId = ledgerId;
  item.dataset.ledgerDateKey = entry.dateKey || entry.requestedDateKey || "";
  item.dataset.ledgerAmountWon = String(Number(entry.amountWon) || 0);
  item.dataset.ledgerType = ["welfare", "supply", "other", "review"].includes(entry.category) ? entry.category : "review";
  item.dataset.ledgerItems = JSON.stringify(entry.items || []);
  item.dataset.ledgerMemo = entry.reasons?.length ? `분류 근거: ${entry.reasons.join(", ")}` : "";
  item.dataset.ledgerSavedPath = entry.savedPath || "";
  item.innerHTML = `
    <strong>${entry.dateKey} · ${formatWon(entry.amountWon)}원 · ${escapeHtml(entry.categoryLabel || categoryLabel(entry.category))}</strong>
    <span>${escapeHtml(itemSummary)}${entry.savedPath ? ` · ${escapeHtml(entry.savedPath)}` : ""}</span>
    <div class="inline-actions">
      <button class="ghost-button compact" type="button" data-ledger-action="confirm-welfare" data-ledger-id="${escapeAttribute(ledgerId)}">조활비 확정</button>
      <button class="ghost-button compact" type="button" data-ledger-action="confirm-supply" data-ledger-id="${escapeAttribute(ledgerId)}">소모품비 확정</button>
      <button class="ghost-button compact" type="button" data-ledger-action="confirm-other" data-ledger-id="${escapeAttribute(ledgerId)}">기타 확정</button>
      <button class="ghost-button compact danger" type="button" data-ledger-action="delete" data-ledger-id="${escapeAttribute(ledgerId)}">캡처파일 삭제</button>
    </div>
  `;
  if (!hasAmount) {
    const actions = item.querySelector(".inline-actions");
    if (actions) {
      actions.innerHTML = `<span class="folder-label">\uae08\uc561\uc744 \uc77d\uc9c0 \ubabb\ud574 \uc0ac\uc6a9 \uc774\ub825 \uc790\ub3d9\ub4f1\ub85d\uc744 \uac74\ub108\ub6f0\uc5c8\uc2b5\ub2c8\ub2e4.</span>`;
    }
  }
  elements.coupangResultList.append(item);
}

function addCoupangError(message) {
  const item = document.createElement("li");
  item.className = "error";
  item.textContent = message;
  elements.coupangErrorList.append(item);
}

function formatWon(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
}

function addSuccess(message) {
  rememberCaptureLog(message, "success");
}

function handleExcelWorkflowCardClick(event) {
  const card = event.target.closest("[data-excel-workflow-target]");
  if (!card) return;
  const target = card.dataset.excelWorkflowTarget;
  const panel = document.querySelector(`[data-excel-step-panel="${target}"]`);
  if (!panel) return;
  panel.classList.remove("is-collapsed");
  const heading = panel.querySelector("[data-collapsible-heading]");
  if (heading) heading.setAttribute("aria-expanded", "true");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function addError(message) {
  rememberCaptureLog(message, "error");
}

function setBusy(isBusy, label = "") {
  elements.previewButton.disabled = isBusy;
  elements.chooseFolderButton.disabled = isBusy || (!("showDirectoryPicker" in window) && !window.desktopBridge);
  elements.runButton.disabled = isBusy
    || !hasSelectedCaptureTarget(currentCaptureTargets())
    || !canRunCapture({ groupCount: state.groups.length, running: state.running });
  elements.createPptButton.disabled = isBusy;
  elements.previewPptButton.disabled = isBusy;
  if (elements.pptMonthInput) elements.pptMonthInput.disabled = isBusy;
  if (elements.refreshStorageButton) elements.refreshStorageButton.disabled = isBusy;
  if (elements.refreshStoragePreviewButton) elements.refreshStoragePreviewButton.disabled = isBusy;
  if (elements.scanDuplicatesButton) elements.scanDuplicatesButton.disabled = isBusy;
  if (elements.clearFolderButton) elements.clearFolderButton.disabled = isBusy;
  if (elements.deleteDuplicatesButton) elements.deleteDuplicatesButton.disabled = isBusy || !state.duplicateCandidates.length;
  elements.runCoupangButton.disabled = isBusy;
  if (elements.refreshLedgerButton) elements.refreshLedgerButton.disabled = isBusy;
  if (elements.addManualExpenseButton) elements.addManualExpenseButton.disabled = isBusy;
  if (elements.parseCorporateCardButton) elements.parseCorporateCardButton.disabled = isBusy;
  if (elements.saveStorageSettingsButton) elements.saveStorageSettingsButton.disabled = isBusy;
  elements.manualDateSelect.disabled = isBusy;
  elements.manualWaypoint1Input.disabled = isBusy;
  elements.manualWaypoint2Input.disabled = isBusy;
  elements.addManualWaypointButton.disabled = isBusy;
  updateRetryButton();
  if (label) {
    elements.browserStatus.textContent = label;
  } else {
    elements.browserStatus.textContent = "준비됨";
  }
}

function canSave() {
  return true;
}

function usagePercent(used, limit) {
  const value = Number(limit) > 0 ? Math.round((Number(used) / Number(limit)) * 100) : 0;
  return Math.max(0, Math.min(100, value));
}

function loadSample() {
  elements.tableInput.value = [
    "NO.\t담당\t영업팀\t대리점코드\t대리점명\tPOS코드\tPOS명\t유형요약\tPOS주소\t대표자\t대표자 연락처\t마케터\t마케터 연락처\t지사\t강사\t날짜\t시간\t비고\tFamily\tPet\tEasy2\tKids\t인테리어유형\t지역\t50km↑\t윈도우시트",
    "313\t경북\t경북동부소매\t316622\t㈜후(WHO)\tP005327\t중방동_다이소점\t위탁지원\t경북 경산시 중앙로 73 (중방동)\t김샘플\t010-0000-1001\t이샘플\t010-0000-2001\t대구\t배정환\t07/02(목)\t오후\t\t\t\t\t\t01.스마트\t경북 경산시\t\t",
    "314\t경북\t경북동부소매\t316622\t㈜후(WHO)\tP301664\t하양읍_가톨릭대점\t일반전매점\t경북 경산시 하양읍 하양로 58\t김샘플\t010-0000-1001\t이샘플\t010-0000-2001\t대구\t배정환\t07/02(목)\t오전\t\t\tO\tO\t\t11. 고객경험혁신 A\t경북 경산시\t\t",
    "330\t경북\t경북북부소매\t312739\t빌리프\tP810343\t감삼동_서남시장점\t일반전매점\t대구 달서구 달구벌대로 1649 감삼동 (감삼동)\t박샘플\t010-0000-1002\t정샘플\t010-0000-2002\t대구\t배정환\t07/03(금)\t오후\t\t\t\t\t\t01.스마트\t대구 달서구\t\t",
    "331\t경북\t경북북부소매\t312790\t성원\tP203181\t감삼동_본리초등학교점\t임차지원2\t대구 달서구 와룡로 123 101동 1층 1호 (감삼동, 죽전역동화아이위시)\t최샘플\t010-0000-1003\t한샘플\t010-0000-2003\t대구\t배정환\t07/03(금)\t오전\t\t\t\t\t\t\t대구 달서구\t\t"
  ].join("\n");
  scheduleAutoPreview();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
