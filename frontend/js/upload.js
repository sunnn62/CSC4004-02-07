// ============================================================
// 업로드 로직 — upload.html의 method-card 구조에 맞춤
//
// 구조:
//   .method-card[data-method=camera|library|pdf]  ← 클릭하면
//   #file-camera / #file-library / #file-pdf       ← 해당 input 열림
//   파일 선택되면 → 자동으로 업로드 시작 → 폴링 → play.html 이동
// ============================================================

const statusArea = document.getElementById("status");

// method → 파일 input 매핑
const fileInputMap = {
  library:  document.getElementById("file-library"),
  pdf:      document.getElementById("file-pdf"),
  musicxml: document.getElementById("file-musicxml"),
};

// === method-card 클릭 → 해당 파일 input 열기 ===
document.querySelectorAll(".method-card").forEach((card) => {
  card.addEventListener("click", () => {
    const method = card.dataset.method;
    const input = fileInputMap[method];
    if (input) input.click();
  });
});

// === 파일 선택되면 바로 업로드 ===
Object.values(fileInputMap).forEach((input) => {
  if (!input) return;
  input.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
    e.target.value = ""; // 같은 파일 다시 선택 가능하게 초기화
  });
});

// === 파일 검증 + 업로드 → 폴링 → play.html 이동 ===
async function handleFile(file) {
  if (!/\.(pdf|png|jpg|jpeg|musicxml|xml|mxl)$/i.test(file.name)) {
    showStatus("error", "지원 형식: PDF, 이미지(PNG/JPG), MusicXML 만 가능해요.");
    return;
  }

  setCardsDisabled(true);

  try {
    showStatus("loading", `"${file.name}" 업로드 중...`);
    const { scoreId } = await api.upload(file);

    showStatus("loading", "악보 분석 중... (수십 초 걸릴 수 있어요)");
    await waitUntilDone(scoreId);

    showStatus("success", "✅ 분석 완료!");
    setTimeout(() => {
      window.location.href = `detail.html?scoreId=${scoreId}`;
    }, 800);
  } catch (err) {
    showStatus("error", "❌ " + err.message);
    setCardsDisabled(false);
  }
}

// 폴링: 1.5초 간격으로 status 확인, "done"이 될 때까지 대기
async function waitUntilDone(scoreId) {
  while (true) {
    await new Promise((r) => setTimeout(r, 1500));
    const { status } = await api.getStatus(scoreId);
    if (status === "done") return;
    if (status === "failed") throw new Error("악보 분석 실패");
    // "processing"이면 계속 루프
  }
}

function setCardsDisabled(disabled) {
  document.querySelectorAll(".method-card").forEach((c) => {
    c.disabled = disabled;
    c.style.opacity = disabled ? "0.5" : "";
    c.style.pointerEvents = disabled ? "none" : "";
  });
}

function showStatus(type, message) {
  if (!statusArea) return;
  statusArea.className = `status status-${type}`;
  statusArea.textContent = message;
}
