const fileInput = document.getElementById("file-input");
const dropZone  = document.getElementById("drop-zone");
const fileInfo  = document.getElementById("file-info");
const uploadBtn = document.getElementById("upload-btn");
const statusArea = document.getElementById("status");

let selectedFile = null;

// === 파일 선택 (클릭 방식) ===
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

// === 드래그 앤 드롭 ===
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragging");
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

// === 파일 검증 + 미리보기 ===
function handleFile(file) {
  if (!/\.(pdf|png|jpg|jpeg)$/i.test(file.name)) {
    showStatus("error", "PDF나 이미지(PNG/JPG)만 지원해요.");
    return;
  }
  selectedFile = file;
  fileInfo.innerHTML = `<strong>선택됨:</strong> ${file.name} <span class="size">${(file.size/1024).toFixed(1)} KB</span>`;
  uploadBtn.disabled = false;
  showStatus("info", "업로드 준비 완료");
}

// === 업로드 → 폴링 → play.html 이동 ===
uploadBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  uploadBtn.disabled = true;

  try {
    showStatus("loading", "업로드 중...");
    const { scoreId } = await api.upload(selectedFile);

    showStatus("loading", "악보 분석 중... (수십 초 걸릴 수 있어요)");
    await waitUntilDone(scoreId);

    showStatus("success", "✅ 분석 완료! 연주 화면으로 이동합니다.");
    setTimeout(() => {
      window.location.href = `play.html?scoreId=${scoreId}`;
    }, 800);
  } catch (err) {
    showStatus("error", "❌ " + err.message);
    uploadBtn.disabled = false;
  }
});

// 폴링: 1.5초 간격으로 status 확인, "done"이 될 때까지 대기
async function waitUntilDone(scoreId) {
  while (true) {
    await new Promise(r => setTimeout(r, 1500));
    const { status } = await api.getStatus(scoreId);
    if (status === "done") return;
    if (status === "failed") throw new Error("악보 분석 실패");
    // "processing"이면 계속 루프
  }
}

function showStatus(type, message) {
  statusArea.className = `status status-${type}`;
  statusArea.textContent = message;
}