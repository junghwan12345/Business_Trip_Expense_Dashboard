import {
  buildFuelExpensePasteRows,
  canRetryFailedCapture,
  canRunCapture,
  createManualProofGroup,
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
  EXTRA_PROOF_FOLDER_ALIASES,
  groupProofImagesByDate,
  proofMonthDirectoryPath,
  proofTypeFromFileName,
  selectedMonthKey
} from "./proof-ppt.js";

const now = new Date();
const PPT_IMAGE_DIRECT_SIZE_LIMIT = 1_200_000;
const PPT_IMAGE_MAX_SIDE = 2200;
const PPT_IMAGE_JPEG_QUALITY = 0.88;
const AUTO_PREVIEW_DELAY_MS = 450;
const AUTO_PROOF_PREVIEW_DELAY_MS = 350;
const STORAGE_CLEANUP_FOLDERS = [
  "거리캡처",
  "유가캡처",
  ...EXTRA_PROOF_FOLDER_ALIASES,
  COUPANG_PROOF_FOLDERS.welfare,
  COUPANG_PROOF_FOLDERS.supply,
  COUPANG_PROOF_FOLDERS.review,
  "PPT"
];
const STORAGE_SETTING_LABELS = {
  route: "거리캡처",
  oil: "유가캡처",
  extra: "추가증빙",
  coupang: "쿠팡 거래명세서",
  welfare: "조활비",
  supply: "소모품비",
  review: "확인필요",
  ppt: "PPT",
  ledger: "장부 JSON"
};
let autoPreviewTimer = null;
let autoProofPreviewTimer = null;

const state = {
  groups: [],
  errors: [],
  failedJobs: [],
  fuelRows: [],
  coupangEntries: [],
  ledgerEntries: [],
  storageSettings: {},
  effectiveStorageRoots: {},
  duplicateCandidates: [],
  directoryHandle: null,
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
  copyFuelOutputButton: document.querySelector("#copyFuelOutputButton"),
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
  fuelOutput: document.querySelector("#fuelOutput"),
  pptStatus: document.querySelector("#pptStatus"),
  coupangPeopleInput: document.querySelector("#coupangPeopleInput"),
  coupangDatesInput: document.querySelector("#coupangDatesInput"),
  coupangLimitSummary: document.querySelector("#coupangLimitSummary"),
  welfareLimitCard: document.querySelector("#welfareLimitCard"),
  welfareRemainingCard: document.querySelector("#welfareRemainingCard"),
  supplyLimitCard: document.querySelector("#supplyLimitCard"),
  supplyRemainingCard: document.querySelector("#supplyRemainingCard"),
  coupangResultList: document.querySelector("#coupangResultList"),
  coupangErrorList: document.querySelector("#coupangErrorList"),
  refreshLedgerButton: document.querySelector("#refreshLedgerButton"),
  ledgerMonthInput: document.querySelector("#ledgerMonthInput"),
  manualExpenseDateInput: document.querySelector("#manualExpenseDateInput"),
  manualExpenseTypeSelect: document.querySelector("#manualExpenseTypeSelect"),
  manualExpenseAmountInput: document.querySelector("#manualExpenseAmountInput"),
  manualExpenseMemoInput: document.querySelector("#manualExpenseMemoInput"),
  manualExpensePathInput: document.querySelector("#manualExpensePathInput"),
  addManualExpenseButton: document.querySelector("#addManualExpenseButton"),
  ledgerSummaryGrid: document.querySelector("#ledgerSummaryGrid"),
  ledgerEntryList: document.querySelector("#ledgerEntryList"),
  pptPreviewList: document.querySelector("#pptPreviewList"),
  storagePreviewList: document.querySelector("#storagePreviewList"),
  settingsStartInput: document.querySelector("#settingsStartInput"),
  settingsDestinationInput: document.querySelector("#settingsDestinationInput"),
  settingsPeopleInput: document.querySelector("#settingsPeopleInput"),
  settingsSupplyLimitInput: document.querySelector("#settingsSupplyLimitInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
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

elements.yearInput.value = String(now.getFullYear());
elements.monthInput.value = String(now.getMonth() + 1);
elements.startInput.value = "태왕디아너스오페라";
elements.destinationInput.value = "태왕디아너스오페라";
elements.manualDateSelect.value = todayInputValue(now);
elements.ledgerMonthInput.value = todayInputValue(now).slice(0, 7);
elements.manualExpenseDateInput.value = todayInputValue(now);
elements.settingsStartInput.value = elements.startInput.value;
elements.settingsDestinationInput.value = elements.destinationInput.value;
elements.settingsPeopleInput.value = elements.coupangPeopleInput.value;

elements.previewButton.addEventListener("click", preview);
elements.chooseFolderButton.addEventListener("click", chooseFolder);
elements.runButton.addEventListener("click", runCapture);
elements.retryFailedButton.addEventListener("click", retryFailedCapture);
elements.copyFuelOutputButton.addEventListener("click", copyFuelOutput);
elements.createPptButton.addEventListener("click", createProofPpt);
elements.previewPptButton.addEventListener("click", previewProofPpt);
elements.refreshStorageButton.addEventListener("click", refreshStoragePreview);
elements.runCoupangButton.addEventListener("click", runCoupangCapture);
elements.refreshLedgerButton?.addEventListener("click", loadExpenseLedger);
elements.addManualExpenseButton?.addEventListener("click", addManualExpenseEntry);
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
elements.scanDuplicatesButton.addEventListener("click", scanDuplicateFiles);
elements.deleteDuplicatesButton.addEventListener("click", deleteDuplicateFiles);
elements.clearFolderButton.addEventListener("click", clearSelectedProofFolder);
elements.coupangPeopleInput.addEventListener("input", () => {
  renderCoupangLimitSummary();
  renderLedger();
});
elements.ledgerMonthInput?.addEventListener("input", renderLedger);
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
elements.coupangResultList?.addEventListener("click", handleLedgerActionClick);
for (const navItem of elements.navItems) {
  navItem.addEventListener("click", () => activatePage(navItem.dataset.pageTarget));
}
renderCoupangLimitSummary();
renderStorageSettings();
renderLedger();
renderPreview();
loadStorageInfo();
loadExpenseLedger();

if (!("showDirectoryPicker" in window)) {
  elements.browserStatus.textContent = "서버 저장";
  elements.chooseFolderButton.disabled = true;
  elements.folderLabel.textContent = "기본 저장소를 확인하는 중입니다.";
} else {
  elements.browserStatus.textContent = "준비됨";
  elements.folderLabel.textContent = "기본 저장소를 확인하는 중입니다. 필요할 때만 다른 폴더를 선택하세요.";
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
  for (const [key, label] of Object.entries(STORAGE_SETTING_LABELS)) {
    const row = document.createElement("label");
    row.className = "storage-setting-row";
    row.innerHTML = `
      <span>${label}</span>
      <input data-storage-key="${key}" type="text" value="${escapeAttribute(state.storageSettings[key] || "")}" placeholder="${escapeAttribute(state.effectiveStorageRoots[key] || "기본 저장소")}" />
    `;
    elements.storageSettingsGrid.append(row);
  }
}

async function saveStorageSettings() {
  const storageSettings = {};
  for (const input of elements.storageSettingsGrid.querySelectorAll("[data-storage-key]")) {
    const value = input.value.trim();
    if (value) {
      storageSettings[input.dataset.storageKey] = value;
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
    const response = await fetch("/api/travel-proof/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message);
    }

    const manualGroups = state.groups.filter((group) => group.manual);
    state.groups = data.groups.concat(manualGroups);
    state.errors = data.errors;
    if (!silent) {
      state.failedJobs = [];
      state.fuelRows = [];
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
      emptyMessage: "PPT로 묶을 증빙 이미지를 찾지 못했습니다."
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
  try {
    state.directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    elements.folderLabel.textContent = `선택 폴더: ${state.directoryHandle.name} · 이 폴더를 우선 사용합니다.`;
    state.duplicateCandidates = [];
    renderStorageCleanupStatus([]);
    updateRunButton();
    scheduleProofPreviews();
  } catch (error) {
    if (error.name !== "AbortError") {
      addError(`저장 폴더 선택 실패: ${error.message}`);
    }
  }
}

async function runCapture() {
  if (!state.groups.length || !canSave() || state.running) {
    return;
  }

  state.running = true;
  state.failedJobs = [];
  state.fuelRows = [];
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
      const result = await captureGroup(group);
      upsertFuelRow(result.fuelRow);
      renderFuelOutput();
      addSuccess(`${group.dateKey} 저장 완료: ${result.routeSavedPath}`);
      addSuccess(`${group.dateKey} 유가 저장 완료: ${result.oilSavedPath}`);
      state.captureStats.success += 1;
    } catch (error) {
      state.failedJobs = rememberFailedCapture(state.failedJobs, group, error.message);
      addError(`${group.dateKey}: ${error.message}`);
      state.captureStats.failure += 1;
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
      const result = await captureGroup(group);
      state.failedJobs = removeFailedCapture(state.failedJobs, group);
      upsertFuelRow(result.fuelRow);
      renderFuelOutput();
      addSuccess(`${group.dateKey} ${retry ? "재실행 " : ""}저장 완료: ${result.routeSavedPath}`);
      addSuccess(`${group.dateKey} ${retry ? "재실행 " : ""}유가 저장 완료: ${result.oilSavedPath}`);
      state.captureStats.success += 1;
    } catch (error) {
      state.failedJobs = rememberFailedCapture(state.failedJobs, group, error.message);
      addError(`${group.dateKey}: ${error.message}`);
      state.captureStats.failure += 1;
    } finally {
      elements.progressBar.value += 1;
      renderCaptureResult();
      updateRetryButton();
    }
  }
}

async function captureGroup(group) {
  const job = createBrowserJob(group);
  const shouldUseServerSave = !state.directoryHandle;
  const routeResponse = await fetch(shouldUseServerSave ? "/api/travel-proof/capture-save" : "/api/travel-proof/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job })
  });
  const routeData = await routeResponse.json();
  if (!routeData.ok) {
    throw new Error(routeData.message);
  }

  const routeSavedPath = shouldUseServerSave
    ? routeData.result.savedPath
    : await saveScreenshot(group.monthKey, "거리캡처", group.fileBaseName, routeData.result.imageBase64);
  if (!routeData.result.distanceKm) {
    throw new Error(`${group.dateKey} 이동거리를 읽을 수 없습니다.`);
  }

  const oilResponse = await fetch(shouldUseServerSave ? "/api/travel-proof/oil-capture-save" : "/api/travel-proof/oil-capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateKey: group.dateKey })
  });
  const oilData = await oilResponse.json();
  if (!oilData.ok) {
    throw new Error(oilData.message);
  }
  if (!oilData.result.fuelPriceWon) {
    throw new Error(`${group.dateKey} 휘발유 유가를 읽을 수 없습니다.`);
  }

  const oilSavedPath = shouldUseServerSave
    ? oilData.result.savedPath
    : await saveScreenshot(group.monthKey, "유가캡처", oilData.result.fileName.replace(/\.png$/i, ""), oilData.result.imageBase64);

  const [fuelRow] = buildFuelExpensePasteRows([{
    group,
    distanceKm: routeData.result.distanceKm,
    fuelPriceWon: oilData.result.fuelPriceWon
  }]);

  return {
    routeSavedPath,
    oilSavedPath,
    fuelRow
  };
}

async function runCoupangCapture() {
  if (state.running) {
    return;
  }

  const dateKeys = parseCoupangCaptureDates(elements.coupangDatesInput.value, {
    year: now.getFullYear()
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

    const ledgerEntries = savedEntries.map(receiptToLedgerEntry);
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
  elements.previewCount.textContent = `현지방 ${excelCount}건 / 출장 ${manualCount}건`;
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

  const weekHeader = document.createElement("div");
  weekHeader.className = "calendar-weekdays";
  for (const dayName of ["일", "월", "화", "수", "목", "금", "토"]) {
    const item = document.createElement("div");
    item.textContent = dayName;
    weekHeader.append(item);
  }
  calendar.append(weekHeader);

  const year = Number(elements.yearInput.value);
  const month = Number(elements.monthInput.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const empty = document.createElement("p");
    empty.className = "folder-label";
    empty.textContent = "기준 연도와 월을 확인해 주세요.";
    calendar.append(empty);
    return calendar;
  }

  const groupsByDate = new Map();
  for (const group of state.groups) {
    if (!groupsByDate.has(group.dateKey)) {
      groupsByDate.set(group.dateKey, []);
    }
    groupsByDate.get(group.dateKey).push(group);
  }

  const days = document.createElement("div");
  days.className = "calendar-days";
  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);
  const leadingBlankCount = firstDate.getDay();

  for (let index = 0; index < leadingBlankCount; index += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-day is-empty";
    days.append(blank);
  }

  for (let day = 1; day <= lastDate.getDate(); day += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("article");
    cell.className = "calendar-day";
    cell.innerHTML = `<div class="calendar-date">${day}</div>`;
    for (const group of groupsByDate.get(dateKey) || []) {
      cell.append(renderCalendarGroup(group));
    }
    days.append(cell);
  }

  calendar.append(days);
  return calendar;
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
    <strong>${group.manual ? "출장" : `현지방${region ? `(${escapeHtml(region)})` : ""}`}</strong>
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
  elements.storageCleanupStatus.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.className = type;
    item.textContent = message;
    elements.storageCleanupStatus.append(item);
  }
}

async function renderProofImagePreview(targetElement, { emptyMessage, allowDelete = false }) {
  targetElement.innerHTML = "";
  const monthKey = resolveSelectedMonthKey();
  if (!monthKey) {
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
    if (!groups.length) {
      targetElement.innerHTML = `<p class="folder-label">${emptyMessage}</p>`;
      return;
    }
    for (const group of groups) {
      targetElement.append(renderProofPreviewCard(group, { allowDelete }));
    }
  } catch (error) {
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
    if (!groups.length) {
      targetElement.innerHTML = `<p class="folder-label">${emptyMessage}</p>`;
    } else {
      for (const group of groups) {
        targetElement.append(renderProofPreviewCard(group, { allowDelete }));
      }
    }

    if ((data.result.unmatchedImages || []).length) {
      targetElement.append(renderUnmatchedProofCard(data.result.unmatchedImages));
    }
  } catch (error) {
    targetElement.innerHTML = `<p class="folder-label error">미리보기 실패: ${escapeHtml(error.message)}</p>`;
  }
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
    ...(group.extra || []).map((image) => ({ ...image, label: "추가증빙" })),
    ...(group.welfare || []).map((image) => ({ ...image, label: "조활비" })),
    ...(group.supply || []).map((image) => ({ ...image, label: "소모품비" })),
    ...(group.review || []).map((image) => ({ ...image, label: "확인필요" }))
  ];
  card.innerHTML = `
    <div class="proof-preview-title">
      <strong>${group.dateKey}</strong>
      <span>${allImages.length}개 자료</span>
    </div>
    <div class="proof-thumb-grid">
      ${allImages.map((image) => `
        <figure>
          <img src="${image.dataUri}" alt="${escapeHtml(image.name)}" data-preview-image="${image.dataUri}" data-preview-caption="${escapeHtml(`${image.label} · ${image.name}`)}" />
          <figcaption>${escapeHtml(image.label)} · ${escapeHtml(image.name.split("/").at(-1) || image.name)}</figcaption>
          ${allowDelete ? `<button class="ghost-button compact danger proof-delete-button" type="button" data-proof-delete="${escapeAttribute(image.name)}">삭제</button>` : ""}
        </figure>
      `).join("")}
    </div>
  `;
  return card;
}

async function handleProofPreviewActionClick(event) {
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
    if (state.directoryHandle) {
      await deleteBrowserProofImage(imageName);
    } else {
      await deleteServerProofImage(imageName);
    }
    await previewProofPpt();
    elements.pptStatus.textContent = `삭제 완료: ${imageName}`;
  } catch (error) {
    addError(`PPT 미리보기 파일 삭제 실패: ${error.message}`);
  }
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
  elements.startInput.value = elements.settingsStartInput.value.trim();
  elements.destinationInput.value = elements.settingsDestinationInput.value.trim();
  elements.coupangPeopleInput.value = elements.settingsPeopleInput.value || "3";
  renderCoupangLimitSummary();
  elements.settingsStatus.textContent = "설정을 현재 입력값에 반영했습니다.";
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
    ...EXTRA_PROOF_FOLDER_ALIASES.map((folderName) => ["extra", folderName]),
    ["welfare", COUPANG_PROOF_FOLDERS.welfare],
    ["supply", COUPANG_PROOF_FOLDERS.supply],
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
  elements.runButton.disabled = !canRunCapture({ groupCount: state.groups.length, running: state.running });
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

function upsertFuelRow(fuelRow) {
  state.fuelRows = state.fuelRows
    .filter((row) => row.key !== fuelRow.key)
    .concat(fuelRow)
    .sort((left, right) => (left.dateKey.localeCompare(right.dateKey) || left.key.localeCompare(right.key)));
}

function renderFuelOutput() {
  elements.fuelOutput.value = state.fuelRows.map((row) => row.text).join("\n");
  elements.copyFuelOutputButton.disabled = !elements.fuelOutput.value || state.running;
}

function renderLedger() {
  if (!elements.ledgerSummaryGrid || !elements.ledgerEntryList) {
    return;
  }
  const monthKey = elements.ledgerMonthInput.value || resolveSelectedMonthKey() || todayInputValue(now).slice(0, 7);
  const quarter = quarterRangeForMonth(monthKey);
  const confirmed = state.ledgerEntries.filter((entry) => entry.status === "confirmed");
  const monthEntries = state.ledgerEntries.filter((entry) => entry.dateKey?.startsWith(`${monthKey}-`));
  const quarterEntries = state.ledgerEntries.filter((entry) => entry.dateKey >= quarter.start && entry.dateKey <= quarter.end);
  const supplyUsed = sumLedger(confirmed.filter((entry) => entry.type === "supply" && entry.dateKey?.startsWith(`${monthKey}-`)));
  const welfareUsed = sumLedger(confirmed.filter((entry) => entry.type === "welfare" && entry.dateKey >= quarter.start && entry.dateKey <= quarter.end));
  const supplyLimit = Number(elements.settingsSupplyLimitInput.value) || 50000;
  const welfareLimit = (Number(elements.coupangPeopleInput.value) || 3) * 50000 * quarter.monthCount;
  const reviewCount = state.ledgerEntries.filter((entry) => entry.status === "review").length;

  elements.ledgerSummaryGrid.innerHTML = "";
  for (const card of [
    ["조회 월 소모품비", `${formatWon(supplyUsed)} / ${formatWon(supplyLimit)}원`, `${monthKey} 기준`],
    ["조회 분기 조활비", `${formatWon(welfareUsed)} / ${formatWon(welfareLimit)}원`, `${quarter.label} 기준`],
    ["소모품비 잔액", `${formatWon(supplyLimit - supplyUsed)}원`, "월별 초기화"],
    ["조활비 잔액", `${formatWon(welfareLimit - welfareUsed)}원`, `${quarter.monthCount}개월 합산`],
    ["확인필요", `${reviewCount}건`, "확정 전까지 미차감"]
  ]) {
    const item = document.createElement("article");
    item.className = "ledger-summary-card";
    item.innerHTML = `<span>${card[0]}</span><strong>${card[1]}</strong><span>${card[2]}</span>`;
    elements.ledgerSummaryGrid.append(item);
  }

  const visibleEntries = [...new Map([...monthEntries, ...quarterEntries].map((entry) => [entry.id, entry])).values()]
    .sort((left, right) => String(right.dateKey).localeCompare(String(left.dateKey)));
  elements.ledgerEntryList.innerHTML = "";
  if (!visibleEntries.length) {
    const empty = document.createElement("li");
    empty.textContent = "조회 기간에 등록된 이력이 없습니다.";
    elements.ledgerEntryList.append(empty);
    return;
  }
  for (const entry of visibleEntries) {
    const item = document.createElement("li");
    item.className = entry.status;
    const itemText = (entry.items || []).join(", ") || entry.memo || "품목 없음";
    item.innerHTML = `
      <strong>${entry.dateKey} · ${categoryLabel(entry.type)} · ${formatWon(entry.amountWon)}원 · ${entry.source === "manual" ? "수기" : "쿠팡"}</strong>
      <span>${escapeHtml(itemText)}${entry.savedPath ? ` · ${escapeHtml(entry.savedPath)}` : ""}</span>
      ${entry.status === "review" ? `
        <button class="ghost-button compact" type="button" data-ledger-action="confirm-welfare" data-ledger-id="${escapeAttribute(entry.id)}">조활비 확정</button>
        <button class="ghost-button compact" type="button" data-ledger-action="confirm-supply" data-ledger-id="${escapeAttribute(entry.id)}">소모품비 확정</button>
      ` : ""}
      <button class="ghost-button compact" type="button" data-ledger-action="delete" data-ledger-id="${escapeAttribute(entry.id)}">삭제</button>
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
      await confirmLedgerEntry(id, "welfare");
      markCoupangResultConfirmed(resultItem, "조활비");
    } else if (button.dataset.ledgerAction === "confirm-supply") {
      await confirmLedgerEntry(id, "supply");
      markCoupangResultConfirmed(resultItem, "소모품비");
    } else if (button.dataset.ledgerAction === "delete") {
      await deleteLedgerEntry(id);
      resultItem?.remove();
    }
  } catch (error) {
    addCoupangError(`장부 처리 실패: ${error.message}`);
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

function categoryLabel(type) {
  return type === "welfare" ? "조활비" : type === "supply" ? "소모품비" : "확인필요";
}

function receiptToLedgerEntry(receipt) {
  const type = receipt.category === "welfare" || receipt.category === "supply" ? receipt.category : "review";
  return {
    id: `coupang:${receipt.requestedDateKey || receipt.dateKey}:${receipt.amountWon || 0}:${receipt.savedFileName || receipt.fileName || receipt.savedPath || ""}`,
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
    renderLedger();
    renderCoupangLimitSummary();
  } catch (error) {
    addCoupangError(`장부 불러오기 실패: ${error.message}`);
  }
}

async function upsertLedgerEntries(entries) {
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
  renderLedger();
  renderCoupangLimitSummary();
}

async function addManualExpenseEntry() {
  const dateKey = elements.manualExpenseDateInput.value;
  const type = elements.manualExpenseTypeSelect.value;
  const amountWon = Number(elements.manualExpenseAmountInput.value);
  const memo = elements.manualExpenseMemoInput.value.trim();
  const savedPath = elements.manualExpensePathInput.value.trim();
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
    items: memo ? [memo] : [],
    memo,
    status: type === "review" ? "review" : "confirmed",
    savedPath
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

async function confirmLedgerEntry(id, type) {
  const entry = state.ledgerEntries.find((candidate) => candidate.id === id);
  if (!entry) {
    return;
  }
  await upsertLedgerEntries([{ ...entry, type, status: "confirmed" }]);
}

async function deleteLedgerEntry(id) {
  const response = await fetch("/api/travel-proof/expense-ledger/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message);
  }
  state.ledgerEntries = data.ledger?.entries || [];
  renderLedger();
  renderCoupangLimitSummary();
}

async function copyFuelOutput() {
  if (!elements.fuelOutput.value) {
    return;
  }
  await navigator.clipboard.writeText(elements.fuelOutput.value);
  elements.browserStatus.textContent = "유류대 결과를 복사했습니다.";
}

function renderCoupangLimitSummary() {
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
  elements.welfareLimitCard.textContent = `${formatWon(welfareLimit)}원`;
  elements.welfareRemainingCard.textContent = `${formatWon(welfareLimit - welfareUsed)}원`;
  elements.supplyLimitCard.textContent = `${formatWon(supplyLimit)}원`;
  elements.supplyRemainingCard.textContent = `${formatWon(supplyLimit - supplyUsed)}원`;
  if (elements.coupangLimitSummary) {
    elements.coupangLimitSummary.innerHTML = `
      <span>조활비: ${quarter.label} ${quarter.monthCount}개월 총 ${formatWon(welfareLimit)}원 중 ${formatWon(welfareLimit - welfareUsed)}원 남음</span>
      <span>소모품비: ${monthKey} 총 ${formatWon(supplyLimit)}원 중 ${formatWon(supplyLimit - supplyUsed)}원 남음</span>
    `;
  }
}

function addCoupangResult(entry) {
  const item = document.createElement("li");
  item.className = "success";
  const itemSummary = (entry.items || []).slice(0, 3).join(", ") || "품목 확인필요";
  const ledgerId = receiptToLedgerEntry(entry).id;
  item.dataset.ledgerResultId = ledgerId;
  item.innerHTML = `
    <strong>${entry.dateKey} · ${formatWon(entry.amountWon)}원 · ${escapeHtml(entry.categoryLabel || categoryLabel(entry.category))}</strong>
    <span>${escapeHtml(itemSummary)}${entry.savedPath ? ` · ${escapeHtml(entry.savedPath)}` : ""}</span>
    <div class="inline-actions">
      <button class="ghost-button compact" type="button" data-ledger-action="confirm-welfare" data-ledger-id="${escapeAttribute(ledgerId)}">조활비 확정</button>
      <button class="ghost-button compact" type="button" data-ledger-action="confirm-supply" data-ledger-id="${escapeAttribute(ledgerId)}">소모품비 확정</button>
      <button class="ghost-button compact danger" type="button" data-ledger-action="delete" data-ledger-id="${escapeAttribute(ledgerId)}">캡처파일 삭제</button>
    </div>
  `;
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
  elements.chooseFolderButton.disabled = isBusy || !("showDirectoryPicker" in window);
  elements.runButton.disabled = isBusy || !canRunCapture({ groupCount: state.groups.length, running: state.running });
  elements.createPptButton.disabled = isBusy;
  elements.previewPptButton.disabled = isBusy;
  elements.refreshStorageButton.disabled = isBusy;
  elements.scanDuplicatesButton.disabled = isBusy;
  elements.clearFolderButton.disabled = isBusy;
  elements.deleteDuplicatesButton.disabled = isBusy || !state.duplicateCandidates.length;
  elements.runCoupangButton.disabled = isBusy;
  if (elements.refreshLedgerButton) elements.refreshLedgerButton.disabled = isBusy;
  if (elements.addManualExpenseButton) elements.addManualExpenseButton.disabled = isBusy;
  if (elements.saveStorageSettingsButton) elements.saveStorageSettingsButton.disabled = isBusy;
  elements.manualDateSelect.disabled = isBusy;
  elements.manualWaypoint1Input.disabled = isBusy;
  elements.manualWaypoint2Input.disabled = isBusy;
  elements.addManualWaypointButton.disabled = isBusy;
  updateRetryButton();
  elements.copyFuelOutputButton.disabled = isBusy || !elements.fuelOutput.value;
  if (label) {
    elements.browserStatus.textContent = label;
  } else {
    elements.browserStatus.textContent = "준비됨";
  }
}

function canSave() {
  return true;
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
