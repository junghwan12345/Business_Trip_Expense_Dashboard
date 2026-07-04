// 최초 실행용 초기 설정 마법사 모달을 렌더링하고 상태를 관리하는 모듈
const INITIAL_SETUP_STORAGE_KEY = "travel-proof:initial-setup";
const SUPPLIES_MONTHLY_BUDGET = 50000;
const ACTIVITY_BUDGET_PER_PERSON = 50000;

const ASSET_BASE = "./src/assets/onboarding";
const ASSET_VERSION = "clean-20260703";
const ASSETS = Object.freeze({
  roleManager: `${ASSET_BASE}/role-manager.png?v=${ASSET_VERSION}`,
  roleInstructor: `${ASSET_BASE}/role-instructor.png?v=${ASSET_VERSION}`,
  avatarMale: `${ASSET_BASE}/avatar-male.png?v=${ASSET_VERSION}`,
  avatarFemale: `${ASSET_BASE}/avatar-female.png?v=${ASSET_VERSION}`,
  folderCute: `${ASSET_BASE}/folder-cute.png?v=${ASSET_VERSION}`,
  routeCar: `${ASSET_BASE}/route-car.png?v=${ASSET_VERSION}`,
  completeCheck: `${ASSET_BASE}/complete-check.png?v=${ASSET_VERSION}`,
  excelIcon: `${ASSET_BASE}/excel-icon.png?v=${ASSET_VERSION}`,
  pptIcon: `${ASSET_BASE}/ppt-icon.png?v=${ASSET_VERSION}`
});

const STEP_DEFINITIONS = Object.freeze([
  { id: "role", label: "역할 선택", subtitle: "처음 사용 전 역할을 선택해주세요." },
  { id: "info", label: "기본 정보 입력", subtitle: "사용자 정보를 입력해 주세요." },
  { id: "trip", label: "기본 출장 설정", subtitle: "기본 출장 정보를 설정해 주세요." },
  { id: "budget", label: "조활비/소모품비 설정", subtitle: "조활비/소모품비 기준을 설정해 주세요.", managerOnly: true },
  { id: "storage", label: "저장소 설정", subtitle: "저장할 폴더를 설정해 주세요." },
  { id: "complete", label: "완료", subtitle: "모든 설정이 완료되었어요." }
]);

export function readInitialSetup() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INITIAL_SETUP_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeInitialSetup(setup) {
  localStorage.setItem(INITIAL_SETUP_STORAGE_KEY, JSON.stringify(setup || {}));
}

export function isInitialSetupCompleted() {
  return readInitialSetup().isInitialSetupCompleted === true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatWon(amount) {
  return `${Number(amount || 0).toLocaleString("ko-KR")}`;
}

export function createInitialSetupState(defaults = {}) {
  const saved = readInitialSetup();
  return {
    currentStep: 0,
    userRole: saved.userRole || "manager",
    gender: saved.gender || "male",
    userName: saved.userName || defaults.userName || "배정환",
    branchName: saved.branchName || defaults.branchName || "네오아이즈 대구지사",
    defaultStartLocation: saved.defaultStartLocation || defaults.defaultStartLocation || "네오아이즈 대구교육장",
    defaultEndLocation: saved.defaultEndLocation || defaults.defaultEndLocation || "대전지사",
    teamMemberCount: Number(saved.teamMemberCount) || Number(defaults.teamMemberCount) || 3,
    storagePath: saved.storagePath || defaults.storagePath || "",
    isInitialSetupCompleted: saved.isInitialSetupCompleted === true
  };
}

export function initInitialSetup({ mount, defaults = {}, selectDirectory, onComplete } = {}) {
  if (!mount) {
    throw new Error("초기 설정 모달을 붙일 mount 요소가 필요합니다.");
  }

  let state = createInitialSetupState(defaults);

  const overlay = document.createElement("div");
  overlay.className = "setup-overlay";
  overlay.id = "initialSetupOverlay";
  overlay.hidden = true;
  mount.append(overlay);

  function visibleSteps() {
    return STEP_DEFINITIONS.filter((step) => !step.managerOnly || state.userRole === "manager");
  }

  function currentStepDefinition() {
    return visibleSteps()[state.currentStep];
  }

  function monthlyActivityBudget() {
    return state.teamMemberCount * ACTIVITY_BUDGET_PER_PERSON;
  }

  function open() {
    state = createInitialSetupState(defaults);
    state.currentStep = 0;
    overlay.hidden = false;
    render();
  }

  function close() {
    overlay.hidden = true;
  }

  function goNext() {
    const steps = visibleSteps();
    if (state.currentStep < steps.length - 1) {
      state.currentStep += 1;
      render();
    }
  }

  function goPrev() {
    if (state.currentStep > 0) {
      state.currentStep -= 1;
      render();
    }
  }

  function complete() {
    const setup = {
      userRole: state.userRole,
      gender: state.gender,
      userName: state.userName.trim() || "사용자",
      branchName: state.branchName.trim(),
      defaultStartLocation: state.defaultStartLocation.trim(),
      defaultEndLocation: state.defaultEndLocation.trim(),
      teamMemberCount: state.teamMemberCount,
      monthlyActivityBudget: monthlyActivityBudget(),
      quarterlyActivityBudget: monthlyActivityBudget() * 3,
      monthlySuppliesBudget: SUPPLIES_MONTHLY_BUDGET,
      storagePath: state.storagePath.trim() || defaults.storagePath || "",
      isInitialSetupCompleted: true
    };
    writeInitialSetup(setup);
    state.isInitialSetupCompleted = true;
    close();
    onComplete?.(setup);
  }

  function renderStepper() {
    const steps = visibleSteps();
    return `
      <ol class="setup-stepper" aria-label="초기 설정 진행 단계">
        ${steps
          .map((step, index) => {
            const status = index < state.currentStep ? "done" : index === state.currentStep ? "current" : "upcoming";
            const circle = status === "done" ? '<i class="ph-fill ph-check"></i>' : String(index + 1);
            const connector = index < steps.length - 1 ? '<span class="setup-stepper-line" aria-hidden="true"></span>' : "";
            return `
              <li class="setup-stepper-item is-${status}">
                <span class="setup-stepper-node">
                  <span class="setup-stepper-circle">${circle}</span>
                  ${connector}
                </span>
                <span class="setup-stepper-label">${escapeHtml(step.label)}</span>
              </li>`;
          })
          .join("")}
      </ol>`;
  }

  function renderRoleStep() {
    const roleCard = (role, image, title, description) => `
      <button type="button" class="setup-select-card setup-role-card ${state.userRole === role ? "is-selected" : ""}" data-setup-role="${role}">
        <span class="setup-select-check" aria-hidden="true"><i class="ph-fill ph-check"></i></span>
        <img src="${image}" alt="${escapeHtml(title)} 캐릭터" class="setup-role-image" />
        <strong>${escapeHtml(title)}</strong>
        ${description ? `<small>${escapeHtml(description)}</small>` : ""}
      </button>`;
    const genderCard = (gender, image, title) => `
      <button type="button" class="setup-select-card setup-gender-card ${state.gender === gender ? "is-selected" : ""}" data-setup-gender="${gender}">
        <span class="setup-select-check" aria-hidden="true"><i class="ph-fill ph-check"></i></span>
        <img src="${image}" alt="${escapeHtml(title)} 아바타" class="setup-gender-avatar" />
        <strong>${escapeHtml(title)}</strong>
      </button>`;
    return `
      <div class="setup-role-grid">
        ${roleCard("manager", ASSETS.roleManager, "선임 / 팀장", "각 지사별 예산을 추가 설정할 수 있습니다.")}
        ${roleCard("instructor", ASSETS.roleInstructor, "강사", "")}
      </div>
      <div class="setup-gender-grid">
        ${genderCard("male", ASSETS.avatarMale, "남성")}
        ${genderCard("female", ASSETS.avatarFemale, "여성")}
      </div>
      <p class="setup-footnote"><i class="ph ph-info"></i>역할은 설정 메뉴에서 변경할 수 있습니다.</p>`;
  }

  function renderRoleSummaryCard() {
    const roleLabel = state.userRole === "manager" ? "선임 / 팀장" : "강사";
    const roleImage = state.userRole === "manager" ? ASSETS.roleManager : ASSETS.roleInstructor;
    const roleNote = state.userRole === "manager" ? "각 지사별 예산을 설정할 수 있습니다." : "출장 증빙 문서를 간편하게 만들 수 있습니다.";
    return `
      <div class="setup-role-summary">
        <img src="${roleImage}" alt="" aria-hidden="true" />
        <div>
          <strong>선택 역할: <em>${escapeHtml(roleLabel)}</em></strong>
          <span>${escapeHtml(roleNote)}</span>
        </div>
      </div>`;
  }

  function documentMonthLabels() {
    const nowDate = new Date();
    const excelMonth = nowDate.getMonth() + 1;
    const pptMonth = excelMonth === 1 ? 12 : excelMonth - 1;
    return { excelMonth, pptMonth };
  }

  function renderInfoStep() {
    const { excelMonth, pptMonth } = documentMonthLabels();
    const owner = state.userName.trim() || "사용자";
    return `
      ${renderRoleSummaryCard()}
      <section class="setup-card">
        <h3 class="setup-card-title"><span class="setup-card-icon"><i class="ph-fill ph-user"></i></span>기본 정보</h3>
        <div class="setup-field-rows">
          <label class="setup-field-row">
            <span>사용자 이름</span>
            <input type="text" class="setup-input" data-setup-field="userName" value="${escapeHtml(state.userName)}" placeholder="예: 배정환" />
          </label>
          <label class="setup-field-row">
            <span>소속/지점명</span>
            <input type="text" class="setup-input" data-setup-field="branchName" value="${escapeHtml(state.branchName)}" placeholder="예: 네오아이즈 대구지사" />
          </label>
        </div>
      </section>
      <section class="setup-card">
        <h3 class="setup-card-title"><span class="setup-card-icon"><i class="ph-fill ph-file-text"></i></span>문서 파일명 미리보기</h3>
        <div class="setup-filename-list">
          <div class="setup-filename-row">
            <img src="${ASSETS.excelIcon}" alt="엑셀 아이콘" />
            <span data-setup-preview="excel">별첨양식_통합 지출결의서_${excelMonth}월_${escapeHtml(owner)}</span>
          </div>
          <div class="setup-filename-row">
            <img src="${ASSETS.pptIcon}" alt="PPT 아이콘" />
            <span data-setup-preview="ppt">별첨양식_통합 지출결의서_증빙영수증_${pptMonth}월_${escapeHtml(owner)}</span>
          </div>
        </div>
      </section>`;
  }

  function renderTripStep() {
    return `
      <section class="setup-card setup-trip-card">
        <img src="${ASSETS.routeCar}" alt="출발지에서 도착지로 이동하는 자동차 일러스트" class="setup-trip-image" />
        <h3 class="setup-trip-title">기본 출장 설정</h3>
        <div class="setup-field-stack">
          <label class="setup-field">
            <span>기본 출발지</span>
            <span class="setup-input-pill">
              <i class="ph-fill ph-map-pin"></i>
              <input type="text" data-setup-field="defaultStartLocation" value="${escapeHtml(state.defaultStartLocation)}" placeholder="예: 네오아이즈 대구교육장" />
            </span>
          </label>
          <label class="setup-field">
            <span>기본 도착지</span>
            <span class="setup-input-pill">
              <i class="ph-fill ph-map-pin"></i>
              <input type="text" data-setup-field="defaultEndLocation" value="${escapeHtml(state.defaultEndLocation)}" placeholder="예: 대전지사" />
            </span>
          </label>
        </div>
        <p class="setup-infobox"><i class="ph-fill ph-info"></i>네이버 거리측정 캡처 시 기본값으로 불러오며, 필요 시 언제든 수정할 수 있습니다.</p>
      </section>`;
  }

  function renderBudgetStep() {
    const monthly = monthlyActivityBudget();
    return `
      ${renderRoleSummaryCard()}
      <section class="setup-card">
        <h3 class="setup-card-title">조활비/소모품비 설정</h3>
        <div class="setup-budget-grid">
          <div class="setup-budget-card setup-team-card">
            <span class="setup-budget-heading">팀원 수</span>
            <div class="setup-counter">
              <button type="button" class="setup-counter-button" data-setup-count="-1" aria-label="팀원 수 줄이기"><i class="ph ph-minus"></i></button>
              <strong><b data-setup-team-count>${state.teamMemberCount}</b>명</strong>
              <button type="button" class="setup-counter-button" data-setup-count="1" aria-label="팀원 수 늘리기"><i class="ph ph-plus"></i></button>
            </div>
          </div>
          <div class="setup-budget-card setup-activity-card">
            <span class="setup-budget-heading"><i class="ph-fill ph-users-three"></i>조직활성화비</span>
            <p class="setup-budget-amount">월 <strong data-setup-monthly-budget>${formatWon(monthly)}</strong> 원</p>
            <span class="setup-budget-badge" data-setup-quarterly-budget>분기 최대 ${formatWon(monthly * 3)}원</span>
          </div>
          <div class="setup-budget-card setup-supply-card">
            <span class="setup-budget-heading"><i class="ph-fill ph-package"></i>소모품비</span>
            <p class="setup-budget-amount">월 <strong>${formatWon(SUPPLIES_MONTHLY_BUDGET)}</strong> 원</p>
            <span class="setup-budget-badge is-neutral">매월 1일 초기화</span>
          </div>
        </div>
        <p class="setup-infobox"><i class="ph-fill ph-info"></i>팀원 수 × 50,000원 × 월 수 기준으로 자동 계산됩니다.</p>
      </section>`;
  }

  function renderStorageStep() {
    const pathValue = state.storagePath || defaults.storagePath || "";
    if (!state.storagePath && pathValue) {
      state.storagePath = pathValue;
    }
    return `
      <section class="setup-card">
        <h3 class="setup-card-title"><span class="setup-card-icon"><i class="ph-fill ph-folder"></i></span>저장소 설정</h3>
        <div class="setup-storage-card">
          <div class="setup-storage-figure">
            <img src="${ASSETS.folderCute}" alt="보라색 폴더 캐릭터" class="setup-storage-image" />
            <span class="setup-storage-ready" data-setup-storage-ready ${pathValue.trim() ? "" : "hidden"} aria-label="폴더 준비 완료"><i class="ph-fill ph-check"></i></span>
          </div>
          <div class="setup-storage-body">
            <strong>내 PC 폴더</strong>
            <span>모든 데이터는 내 PC에 안전하게 저장됩니다.</span>
            <div class="setup-storage-path-row">
              <input type="text" class="setup-input" data-setup-field="storagePath" value="${escapeHtml(pathValue)}" placeholder="예: C:\\Users\\사용자\\Desktop\\자동출장증빙" />
              <button type="button" class="setup-secondary-button" data-setup-action="browse-storage">폴더 선택</button>
            </div>
            <p class="setup-storage-hint-line"><i class="ph ph-info"></i>폴더 미선택 시 바탕화면에 기본 폴더가 생성됩니다.</p>
          </div>
        </div>
        <p class="setup-save-list-title">선택한 폴더에 저장될 항목</p>
        <div class="setup-save-list">
          <div class="setup-save-row">
            <span class="setup-save-icon receipt"><i class="ph-fill ph-image"></i></span>
            <strong>출장 증빙 이미지</strong>
            <span>거리/유가/통행료/영수증 등의 캡처 이미지 파일</span>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
          </div>
          <div class="setup-save-row">
            <img src="${ASSETS.excelIcon}" alt="" aria-hidden="true" class="setup-save-image" />
            <strong>지출결의서 엑셀</strong>
            <span>지출결의서 엑셀 파일</span>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
          </div>
          <div class="setup-save-row">
            <img src="${ASSETS.pptIcon}" alt="" aria-hidden="true" class="setup-save-image" />
            <strong>증빙영수증 PPT</strong>
            <span>증빙영수증 요약 PPT 파일</span>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
          </div>
        </div>
        <p class="setup-footnote"><i class="ph ph-info"></i>선택한 폴더에 문서와 증빙 파일이 저장됩니다.</p>
      </section>`;
  }

  function renderCompleteStep() {
    return `
      <div class="setup-complete">
        <img src="${ASSETS.completeCheck}" alt="설정 완료 축하 이미지" class="setup-complete-image" />
        <h3>초기 설정이 완료되었습니다!</h3>
        <p>이제 출장집을 바로 사용할 수 있어요.</p>
        <div class="setup-infobox setup-complete-infobox">
          <i class="ph-fill ph-info"></i>
          <ul>
            <li>설정은 나중에 다시 바꿀 수 있어요.</li>
            <li>이제 바로 출장집을 시작할 수 있어요.</li>
          </ul>
        </div>
      </div>`;
  }

  function renderBody() {
    switch (currentStepDefinition().id) {
      case "role": return renderRoleStep();
      case "info": return renderInfoStep();
      case "trip": return renderTripStep();
      case "budget": return renderBudgetStep();
      case "storage": return renderStorageStep();
      case "complete": return renderCompleteStep();
      default: return "";
    }
  }

  function render() {
    const steps = visibleSteps();
    const step = currentStepDefinition();
    const isFirst = state.currentStep === 0;
    const isLast = state.currentStep === steps.length - 1;
    overlay.innerHTML = `
      <section class="setup-modal" role="dialog" aria-modal="true" aria-labelledby="initialSetupTitle">
        <button type="button" class="setup-close-button" data-setup-action="close" aria-label="초기 설정 닫기"><i class="ph ph-x"></i></button>
        <header class="setup-modal-header">
          <h2 id="initialSetupTitle">초기 설정</h2>
          <p>${escapeHtml(step.subtitle)}</p>
          ${renderStepper()}
        </header>
        <div class="setup-modal-body">${renderBody()}</div>
        <footer class="setup-modal-footer">
          <button type="button" class="setup-secondary-button" data-setup-action="prev" ${isFirst ? "hidden" : ""}>이전</button>
          ${isLast
            ? '<button type="button" class="setup-primary-button" data-setup-action="complete">출장집 시작하기</button>'
            : '<button type="button" class="setup-primary-button" data-setup-action="next">다음</button>'}
        </footer>
      </section>`;
  }

  function refreshFileNamePreviews() {
    const { excelMonth, pptMonth } = documentMonthLabels();
    const owner = state.userName.trim() || "사용자";
    const excelPreview = overlay.querySelector('[data-setup-preview="excel"]');
    const pptPreview = overlay.querySelector('[data-setup-preview="ppt"]');
    if (excelPreview) excelPreview.textContent = `별첨양식_통합 지출결의서_${excelMonth}월_${owner}`;
    if (pptPreview) pptPreview.textContent = `별첨양식_통합 지출결의서_증빙영수증_${pptMonth}월_${owner}`;
  }

  function refreshBudgetFigures() {
    const monthly = monthlyActivityBudget();
    const countLabel = overlay.querySelector("[data-setup-team-count]");
    const monthlyLabel = overlay.querySelector("[data-setup-monthly-budget]");
    const quarterlyLabel = overlay.querySelector("[data-setup-quarterly-budget]");
    if (countLabel) countLabel.textContent = String(state.teamMemberCount);
    if (monthlyLabel) monthlyLabel.textContent = formatWon(monthly);
    if (quarterlyLabel) quarterlyLabel.textContent = `분기 최대 ${formatWon(monthly * 3)}원`;
  }

  function refreshStorageReady() {
    const badge = overlay.querySelector("[data-setup-storage-ready]");
    if (badge) badge.hidden = !state.storagePath.trim();
  }

  overlay.addEventListener("click", async (event) => {
    const roleCard = event.target.closest("[data-setup-role]");
    if (roleCard) {
      state.userRole = roleCard.dataset.setupRole;
      render();
      return;
    }
    const genderCard = event.target.closest("[data-setup-gender]");
    if (genderCard) {
      state.gender = genderCard.dataset.setupGender;
      render();
      return;
    }
    const counterButton = event.target.closest("[data-setup-count]");
    if (counterButton) {
      state.teamMemberCount = Math.min(30, Math.max(1, state.teamMemberCount + Number(counterButton.dataset.setupCount)));
      refreshBudgetFigures();
      return;
    }
    const actionButton = event.target.closest("[data-setup-action]");
    if (!actionButton) {
      return;
    }
    const action = actionButton.dataset.setupAction;
    if (action === "close") close();
    else if (action === "prev") goPrev();
    else if (action === "next") goNext();
    else if (action === "complete") complete();
    else if (action === "browse-storage" && typeof selectDirectory === "function") {
      actionButton.disabled = true;
      try {
        const selected = await selectDirectory(state.storagePath);
        if (selected) {
          state.storagePath = selected;
          const input = overlay.querySelector('[data-setup-field="storagePath"]');
          if (input) input.value = selected;
          refreshStorageReady();
        }
      } finally {
        actionButton.disabled = false;
      }
    }
  });

  overlay.addEventListener("input", (event) => {
    const field = event.target.closest("[data-setup-field]");
    if (!field) {
      return;
    }
    state[field.dataset.setupField] = field.value;
    if (field.dataset.setupField === "userName") {
      refreshFileNamePreviews();
    }
    if (field.dataset.setupField === "storagePath") {
      refreshStorageReady();
    }
  });

  return { open, close };
}
