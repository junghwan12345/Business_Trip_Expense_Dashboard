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
  proofTypeFromFileName,
  selectedMonthKey
} from "./proof-ppt.js";
import { buildWeekdayCalendarMonth } from "./korean-business-calendar.js";

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
const DEFAULT_DIRECT_EXCEL_PATH = "G:\\내 드라이브\\출장비증빙\\출장비 양식.xlsx";
const FAST_CAPTURE_ENABLED = new URLSearchParams(window.location.search).get("captureMode") !== "legacy";
const PROTOTYPE_PREVIEW = new URLSearchParams(window.location.search).get("prototype") === "1";
const PAGE_META = Object.freeze({
  distance: {
    title: "거리 유류대 통행료 캡처",
    icon: "ph-gas-pump",
    description: "출장 경로와 날짜별 유가·통행료 증빙을 자동으로 준비합니다.",
    help: "엑셀표를 붙여넣고 일정을 확인한 뒤 캡처 시작을 누르세요."
  },
  coupang: {
    title: "조활비·소모품비 대시보드",
    icon: "ph-receipt",
    description: "쿠팡 증빙을 캡처하고 조활비·소모품비 사용 내역을 관리합니다.",
    help: "인원과 캡처 날짜를 입력한 뒤 결과를 확인하고 필요한 내역을 확정하세요."
  },
  "excel-export": {
    title: "엑셀 작성",
    icon: "ph-file-xls",
    description: "출장과 법인카드 내역을 회사 엑셀에 붙여넣을 형태로 정리합니다.",
    help: "법인카드 표를 읽고 항목을 분류한 뒤 각 결과 카드에서 복사하세요."
  },
  ppt: {
    title: "지출결의서 PPT",
    icon: "ph-presentation-chart",
    description: "날짜별 증빙을 확인하고 지출결의서 PPT를 생성합니다.",
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
    label: "지출결의서 PPT",
    keys: ["ppt"]
  }
];
let autoPreviewTimer = null;
let autoProofPreviewTimer = null;
const EXCEL_FIELD_PREVIEW_LIMIT = 5;
const CORPORATE_CARD_PREVIEW_LIMIT = 6;

const state = {
  groups: [],
  errors: [],
  failedJobs: [],
  fuelRows: [],
  tollRows: [],
  coupangEntries: [],
  ledgerEntries: [],
  corporateCardEntries: [],
  generalTravelEntries: [],
  excelPasteRows: {},
  excelPreviewCollapsed: {},
  fieldVisitPreviewExpanded: false,
  corporateCardListExpanded: false,
  storageSettings: {},
  effectiveStorageRoots: {},
  personalStorage: { configured: false, driveOnline: false, pendingFiles: 0 },
  duplicateCandidates: [],
  directoryHandle: null,
  pendingBrowserDriveHandle: null,
  running: false,
  captureStats: {
    total: 0,
    success: 0,
    failure: 0
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
  retryFailedButton: document.querySelector("#retryFailedButton"),
  createPptButton: document.querySelector("#createPptButton"),
  previewPptButton: document.querySelector("#previewPptButton"),
  refreshStorageButton: document.querySelector("#refreshStorageButton"),
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
  refreshCorporateCardButton: document.querySelector("#refreshCorporateCardButton"),
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
  ledgerTypeFilter: document.querySelector("#ledgerTypeFilter"),
  settingsStartInput: document.querySelector("#settingsStartInput"),
  settingsDestinationInput: document.querySelector("#settingsDestinationInput"),
  settingsAuthorNameInput: document.querySelector("#settingsAuthorNameInput"),
  settingsPeopleInput: document.querySelector("#settingsPeopleInput"),
  settingsSupplyLimitInput: document.querySelector("#settingsSupplyLimitInput"),
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
  browserStatus: document.querySelector("#browserStatus")
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
elements.updateStatusLabel = document.querySelector("#updateStatusLabel");

const appSettings = readAppSettings();
elements.yearInput.value = String(now.getFullYear());
elements.monthInput.value = String(now.getMonth() + 1);
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
if (elements.directExcelPathInput && !elements.directExcelPathInput.value) {
  elements.directExcelPathInput.value = DEFAULT_DIRECT_EXCEL_PATH;
}

elements.previewButton.addEventListener("click", preview);
elements.chooseFolderButton.addEventListener("click", chooseFolder);
elements.settingChooseFolderButton?.addEventListener("click", chooseFolder);
elements.browsePersonalDriveButton?.addEventListener("click", () => browseDesktopDirectory(elements.personalDriveRootInput, "본인 Google Drive 폴더 선택"));
elements.browseUpdateRootButton?.addEventListener("click", () => browseDesktopDirectory(elements.updateRootInput, "앱 업데이트 공유 폴더 선택"));
elements.savePersonalDriveButton?.addEventListener("click", savePersonalDrive);
elements.cancelOnboardingButton?.addEventListener("click", () => {
  if (state.personalStorage?.configured) elements.onboardingOverlay.hidden = true;
});
elements.syncPendingButton?.addEventListener("click", syncPendingStorage);
elements.runButton.addEventListener("click", runCapture);
elements.retryFailedButton.addEventListener("click", retryFailedCapture);
document.querySelector("#distanceHelpButton")?.addEventListener("click", (event) => {
  const note = document.querySelector("#distanceHelpNote");
  if (!note) return;
  note.hidden = !note.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!note.hidden));
});
elements.createPptButton.addEventListener("click", createProofPpt);
elements.previewPptButton.addEventListener("click", previewProofPpt);
elements.refreshStorageButton.addEventListener("click", refreshStoragePreview);
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
elements.refreshCorporateCardButton?.addEventListener("click", loadCorporateCardLedger);
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
document.addEventListener("keydown", handleCollapsiblePanelKeydown);
document.addEventListener("click", handlePasteOutputCopyClick);
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
elements.ledgerTypeFilter?.addEventListener("change", renderLedger);
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
initializeExcelExportInputs();
loadManualExcelEntries();
renderExcelPasteOutputs();
loadStorageInfo();
loadExpenseLedger();
loadCorporateCardLedger();
loadPersonalStorage();
initializeDesktopBridge();

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
    return;
  }
  const [appInfo, updateStatus] = await Promise.all([
    window.desktopBridge.getAppInfo(),
    window.desktopBridge.getUpdateStatus()
  ]);
  elements.appVersionLabel.textContent = `버전 ${appInfo.version} · 개인 저장 모드`;
  renderDesktopUpdateStatus(updateStatus);
  window.desktopBridge.onUpdateStatus(renderDesktopUpdateStatus);
}

function renderDesktopUpdateStatus(status = {}) {
  if (!elements.updateStatusLabel) return;
  elements.updateStatusLabel.textContent = status.message || "업데이트 확인 전";
  elements.updateStatusLabel.title = status.message || "";
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
      allowDelete: true
    }),
    renderProofImagePreview(elements.storagePreviewList, {
      emptyMessage: "기준 월 저장자료를 찾지 못했습니다."
    })
  ]);
}

function activatePage(pageName) {
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

  for (const group of state.groups) {
    try {
      const captureStatus = captureCompletionStatus(group);
      if (captureStatus.complete) {
        addSuccess(`${group.dateKey} 요청한 내용은 이미 처리가 완료된 내용입니다.`);
        state.captureStats.success += 1;
        continue;
      }
      const result = await captureGroup(group, captureStatus);
      upsertFuelRows(result.fuelRows);
      upsertTollRows(result.tollRows);
      renderFuelOutput();
      addCaptureStatusMessages(group, result);
      addTollCaptureStatus(group, result);
      state.captureStats.success += 1;
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
}

async function retryFailedCapture() {
  if (!canRetryFailedCapture({ failedCount: state.failedJobs.length, running: state.running })) {
    return;
  }

  const retryGroups = state.failedJobs.map((entry) => entry.group);
  state.running = true;
  elements.errorList.innerHTML = "";
  state.captureStats = emptyCaptureStats(retryGroups.length);
  renderCaptureResult();
  setBusy(true, "실패건 재실행 중...");
  elements.progressBar.max = retryGroups.length;
  elements.progressBar.value = 0;

  await runCaptureGroups(retryGroups, { retry: true });

  state.running = false;
  setBusy(false);
}

async function runCaptureGroups(groups, { retry = false } = {}) {
  for (const group of groups) {
    try {
      const captureStatus = captureCompletionStatus(group);
      if (captureStatus.complete) {
        state.failedJobs = removeFailedCapture(state.failedJobs, group);
        addSuccess(`${group.dateKey} 요청한 내용은 이미 처리가 완료된 내용입니다.`);
        state.captureStats.success += 1;
        continue;
      }
      const result = await captureGroup(group, captureStatus);
      state.failedJobs = removeFailedCapture(state.failedJobs, group);
      upsertFuelRows(result.fuelRows);
      upsertTollRows(result.tollRows);
      renderFuelOutput();
      addCaptureStatusMessages(group, result, retry);
      addTollCaptureStatus(group, result, retry);
      state.captureStats.success += 1;
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

async function captureGroup(group, completionStatus = captureCompletionStatus(group)) {
  const job = createBrowserJob(group);
  const shouldUseServerSave = !state.directoryHandle;
  const shouldCaptureRouteOil = !completionStatus.routeOilComplete;
  const [routeResult, oilResult, tollResult] = await Promise.all([
    shouldCaptureRouteOil
      ? captureRouteProof(group, job, shouldUseServerSave)
      : Promise.resolve(null),
    shouldCaptureRouteOil
      ? (FAST_CAPTURE_ENABLED
        ? getCachedOilProof(group, shouldUseServerSave)
        : captureOilProof(group, shouldUseServerSave))
      : Promise.resolve(null),
    completionStatus.tollComplete
      ? Promise.resolve(null)
      : captureTollProof(group, shouldUseServerSave).catch((error) => ({
        error: error.message
      }))
  ]);

  const fuelRows = shouldCaptureRouteOil ? buildFieldVisitExpensePasteRows([{
    group,
    distanceKm: routeResult.distanceKm,
    fuelPriceWon: oilResult.fuelPriceWon
  }]) : [];
  const tollRows = tollResult && !tollResult.error && !isNoHipassTollResult(tollResult)
    ? buildTollExpensePasteRows([{ group, dateKey: group.dateKey, amountWon: tollResult.amountWon, savedPath: tollResult.savedPath }])
    : tollResult && !tollResult.error
      ? [{ key: `${fuelGroupKey(group)}:toll`, dateKey: group.dateKey, amount: 0, noToll: true, text: "" }]
      : [];

  return {
    routeSkipped: !shouldCaptureRouteOil,
    oilSkipped: !shouldCaptureRouteOil,
    tollSkipped: completionStatus.tollComplete,
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
  const total = state.captureStats.total || state.groups.length || 0;
  const completed = state.captureStats.success + state.captureStats.failure;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  elements.captureResultSummary.textContent = `${percent}%`;
  elements.captureResultDetail.textContent = `성공 ${state.captureStats.success}건 · 실패 ${state.captureStats.failure}건`;
  if (elements.captureResultFoldSummary) {
    elements.captureResultFoldSummary.textContent = `성공 ${state.captureStats.success}건 · 실패 ${state.captureStats.failure}건`;
  }
}

function emptyCaptureStats(total = 0) {
  return {
    total,
    success: 0,
    failure: 0
  };
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

  const monthKey = resolveSelectedMonthKey();
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
    allowDelete: true
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

async function renderProofImagePreview(targetElement, { emptyMessage, allowDelete = false }) {
  targetElement.innerHTML = "";
  const monthKey = resolveSelectedMonthKey();
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

async function deleteProofImages(imageNames) {
  for (const imageName of imageNames) {
    if (state.directoryHandle) {
      await deleteBrowserProofImage(imageName);
    } else {
      await deleteServerProofImage(imageName);
    }
  }
}

async function deleteServerProofImage(imageName) {
  const monthKey = resolveSelectedMonthKey();
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

async function deleteBrowserProofImage(imageName) {
  const monthKey = resolveSelectedMonthKey();
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
  openImageModal(image.dataset.previewImage, image.dataset.previewCaption || image.alt || "");
}

function openImageModal(src, caption) {
  if (!elements.imageModal || !elements.imageModalImg) {
    return;
  }
  elements.imageModalImg.src = src;
  elements.imageModalImg.alt = caption || "증빙 이미지 확대보기";
  elements.imageModal.hidden = false;
}

function closeImageModal() {
  if (!elements.imageModal || !elements.imageModalImg) {
    return;
  }
  elements.imageModal.hidden = true;
  elements.imageModalImg.removeAttribute("src");
}

function applySettings() {
  const defaultStart = elements.settingsStartInput.value.trim() || "태왕디아너스오페라";
  const defaultDestination = elements.settingsDestinationInput.value.trim() || "태왕디아너스오페라";
  const authorName = elements.settingsAuthorNameInput?.value?.trim() || "";
  elements.startInput.value = defaultStart;
  elements.destinationInput.value = defaultDestination;
  elements.settingsPeopleInput.value = elements.coupangPeopleInput.value || "3";
  writeAppSettings({
    ...readAppSettings(),
    defaultStart,
    defaultDestination,
    welfarePeople: elements.settingsPeopleInput.value,
    authorName
  });
  renderCoupangLimitSummary();
  renderLedger();
  renderExcelPasteOutputs();
  scheduleAutoPreview();
  elements.settingsStatus.textContent = "설정을 저장하고 현재 입력값에 반영했습니다.";
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
  elements.runButton.disabled = !canSave() || !canRunCapture({ groupCount: state.groups.length, running: state.running });
  updateRetryButton();
}

function updateRetryButton() {
  elements.retryFailedButton.disabled = !canRetryFailedCapture({
    failedCount: state.failedJobs.length,
    running: state.running
  });
}

function clearLists() {
  elements.successList.innerHTML = "";
  elements.errorList.innerHTML = "";
  elements.progressBar.value = 0;
}

function fuelGroupKey(group) {
  return String(group?.fileBaseName || group?.dateKey || "").trim();
}

function captureCompletionStatus(group) {
  const key = fuelGroupKey(group);
  if (!key) {
    return { complete: false, routeOilComplete: false, tollComplete: false };
  }
  const keys = new Set(state.fuelRows.map((row) => row.key));
  const tollKeys = new Set(state.tollRows.map((row) => row.key));
  const routeOilComplete = keys.has(key) && keys.has(`${key}:activity`);
  const tollComplete = tollKeys.has(`${key}:toll`);
  return {
    complete: routeOilComplete && tollComplete,
    routeOilComplete,
    tollComplete
  };
}

function hasCompletedFuelRows(group) {
  return captureCompletionStatus(group).complete;
}

function upsertFuelRow(fuelRow) {
  state.fuelRows = state.fuelRows
    .filter((row) => row.key !== fuelRow.key)
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
  const prefix = `${group.dateKey} ${retry ? "재실행 " : ""}`;
  if (result.routeSkipped && result.oilSkipped) {
    addSuccess(`${prefix}거리·유류대 이미 처리 완료`);
    return;
  }
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
  const fieldVisitRows = sortPasteRowsByDate(filterRowsByMonth(state.fuelRows, monthKey).concat(tollOutputRows, cardFieldVisitRows))
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
  const isCollapsed = panel.classList.toggle("is-collapsed");
  heading.setAttribute("aria-expanded", String(!isCollapsed));
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
  const visibleRows = limit && !state.fieldVisitPreviewExpanded ? previewRows.slice(0, limit) : previewRows;
  bodyElement.innerHTML = renderExcelPreviewTable(visibleRows);
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

function renderExcelPreviewTable(rows) {
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
            <th>날짜</th>
            <th>구분</th>
            <th>사용처</th>
            <th>금액</th>
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
  const sourcePath = elements.directExcelPathInput?.value?.trim() || DEFAULT_DIRECT_EXCEL_PATH;
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
  renderExcelPasteStatus([`${excelMonthLabel(monthKey)} 출장비 엑셀을 만들고 있습니다. 잠시만 기다려 주세요.`], "success");
  try {
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
    renderExcelPasteStatus([
      `출장비 엑셀 생성 완료: 일반출장 ${result.generalTravelCount || 0}행 · 현장지원 ${result.fieldVisitCount || 0}행 · 조활비/소모품비/기타 ${result.corporateCardCount || 0}행`,
      `저장 위치: ${result.outputPath || "바탕화면"}`
    ], "success");
  } catch (error) {
    renderExcelPasteStatus([`출장비 엑셀 만들기 실패: ${error.message}`], "error");
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

function renderCorporateCardEntries() {
  if (!elements.corporateCardEntryList) {
    return;
  }
  elements.corporateCardEntryList.innerHTML = "";
  if (elements.corporateCardEntryMore) {
    elements.corporateCardEntryMore.innerHTML = "";
  }
  const monthKey = selectedExcelMonthKey();
  const allEntries = [...state.corporateCardEntries];
  const entries = filterRowsByMonth(allEntries, monthKey).sort((left, right) =>
    String(right.dateKey).localeCompare(String(left.dateKey)) ||
    String(left.merchantName).localeCompare(String(right.merchantName))
  );
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

function visibleLedgerEntries(periods) {
  const monthKey = periods.supply.monthKey;
  const quarter = periods.welfare;
  const selectedYears = new Set([String(quarter.year), String(periods.supply.year)]);
  const typeFilter = elements.ledgerTypeFilter?.value || "all";
  return [...new Map(effectiveLedgerEntries()
    .filter((entry) =>
      (entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)) ||
      (entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end) ||
      (["other", "review"].includes(entry.type) && selectedYears.has(String(entry.dateKey || "").slice(0, 4)))
    )
    .filter((entry) => typeFilter === "all" || entry.type === typeFilter)
    .map((entry) => [entry.id, entry])).values()]
    .sort((left, right) => String(right.dateKey).localeCompare(String(left.dateKey)));
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
  const periods = selectedLedgerPeriods();
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
        <select class="ledger-type-select" data-ledger-field="type" data-ledger-id="${escapeAttribute(entry.id)}">
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
  elements.welfareLimitCard.textContent = `${formatWon(welfareLimit)}원`;
  elements.welfareRemainingCard.textContent = `${formatWon(welfareRemaining)}원`;
  if (elements.welfareUsageText) elements.welfareUsageText.textContent = `사용 ${formatWon(welfareUsed)}원 / 한도 ${formatWon(welfareLimit)}원`;
  if (elements.welfareUsagePercent) elements.welfareUsagePercent.textContent = `${welfarePercent}%`;
  if (elements.welfareProgressBar) elements.welfareProgressBar.style.width = `${welfarePercent}%`;
  elements.supplyLimitCard.textContent = `${formatWon(supplyLimit)}원`;
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
  elements.welfareLimitCard.textContent = `${formatWon(welfareLimit)}원`;
  elements.welfareRemainingCard.textContent = `${formatWon(welfareRemaining)}원`;
  if (elements.welfareUsageText) elements.welfareUsageText.textContent = `사용 ${formatWon(welfareUsed)}원 / 한도 ${formatWon(welfareLimit)}원`;
  if (elements.welfareUsagePercent) elements.welfareUsagePercent.textContent = `${welfarePercent}%`;
  if (elements.welfareProgressBar) elements.welfareProgressBar.style.width = `${welfarePercent}%`;
  elements.supplyLimitCard.textContent = `${formatWon(supplyLimit)}원`;
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
  const item = document.createElement("li");
  item.className = "success";
  item.textContent = message;
  elements.successList.append(item);
}

function addError(message) {
  const item = document.createElement("li");
  item.className = "error";
  item.textContent = message;
  elements.errorList.append(item);
}

function setBusy(isBusy, label = "") {
  elements.previewButton.disabled = isBusy;
  elements.chooseFolderButton.disabled = isBusy || (!("showDirectoryPicker" in window) && !window.desktopBridge);
  elements.runButton.disabled = isBusy || !canRunCapture({ groupCount: state.groups.length, running: state.running });
  elements.createPptButton.disabled = isBusy;
  elements.previewPptButton.disabled = isBusy;
  elements.refreshStorageButton.disabled = isBusy;
  if (elements.scanDuplicatesButton) elements.scanDuplicatesButton.disabled = isBusy;
  if (elements.clearFolderButton) elements.clearFolderButton.disabled = isBusy;
  if (elements.deleteDuplicatesButton) elements.deleteDuplicatesButton.disabled = isBusy || !state.duplicateCandidates.length;
  elements.runCoupangButton.disabled = isBusy;
  if (elements.refreshLedgerButton) elements.refreshLedgerButton.disabled = isBusy;
  if (elements.addManualExpenseButton) elements.addManualExpenseButton.disabled = isBusy;
  if (elements.parseCorporateCardButton) elements.parseCorporateCardButton.disabled = isBusy;
  if (elements.refreshCorporateCardButton) elements.refreshCorporateCardButton.disabled = isBusy;
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
    "대리점명\tPOS코드\tPOS명\t유형요약\tPOS주소\t날짜\t시간",
    "하이라이트 대구\tP045763\t동성로3가_중앙파출소점\t위탁지원\t대구 중구 동성로 1 (동성로3가)\t05/08(금)\t오후",
    "(주)후(WHO)\tP267248\t율하동_율하광장점\t위탁지원\t대구 동구 안심로22길 46 (율하동)\t05/08(금)\t오전",
    "(주)후(WHO)\tP571347\t양덕동_포항법원사거리점\t일반판매점\t경북 포항시 북구 장량중앙로 52 LGU+동 1층(양덕동)\t05/12(화)\t오후",
    "(주)후(WHO)\tP320414\t두호동_두호사거리점\t위탁지원\t경북 포항시 북구 두호로 32 (두호동)\t05/12(화)\t오전"
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
