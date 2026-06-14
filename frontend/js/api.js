// ============================================================
// 백엔드 통신 모음
// 
// USE_MOCK이 true면: 백엔드 없이 가짜 응답으로 동작 (개발/테스트용)
// USE_MOCK이 false면: 실제 백엔드(API_BASE)에 fetch
// ============================================================

var USE_MOCK = false;
var API_BASE = "http://localhost:8001";

var api = {
  // === 악보 업로드 ===
  // 파일 보내고 scoreId 받아옴
  async upload(file) {
    if (USE_MOCK) return mockUpload(file);

    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("업로드 실패");
    return await res.json();                  // { scoreId }
  },

  // === 처리 상태 폴링 ===
  // "processing" / "done" / "failed"
  async getStatus(scoreId) {
    if (USE_MOCK) return mockStatus(scoreId);

    const res = await fetch(`${API_BASE}/api/score/${scoreId}/status`);
    if (!res.ok) throw new Error("상태 확인 실패");
    return await res.json();                  // { status }
  },

  // === 파싱된 악보 JSON ===
  // D 담당자가 사용할 데이터
  async getScore(scoreId) {
    if (USE_MOCK) return mockScore(scoreId);

    const res = await fetch(`${API_BASE}/api/score/${scoreId}`);
    if (!res.ok) throw new Error("악보 데이터 가져오기 실패");
    return await res.json();                  // { metadata, measures, ... }
  },

  // === MusicXML URL ===
  // OSMD가 fetch해서 렌더링할 URL을 반환 (요청은 OSMD가 알아서 함)
  getMusicXmlUrl(scoreId) {
    return `${API_BASE}/api/score/${scoreId}/musicxml`;
  },

  // === 악보 제목 수정 ===
  async renameScore(scoreId, newTitle) {
    const res = await fetch(`${API_BASE}/api/score/${scoreId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (!res.ok) throw new Error('제목 수정 실패');
    return await res.json();
  },
};


// ============================================================
// 백엔드 없을 때 가짜 응답 (USE_MOCK = true일 때만 호출됨)
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function mockUpload(file) {
  console.log("[mock] 업로드 받음:", file.name);
  await sleep(800);
  return { scoreId: "mock-" + Date.now() };
}

let mockStatusCount = 0;
async function mockStatus(scoreId) {
  await sleep(400);
  mockStatusCount++;
  return { status: mockStatusCount >= 3 ? "done" : "processing" };
}

async function mockScore(scoreId) {
  await sleep(300);
  return { metadata: { title: "Mock Score" }, measures: [] };
}