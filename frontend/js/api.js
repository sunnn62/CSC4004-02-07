// 백엔드 없을 때 true. 실제 백엔드 연결되면 false로 변경.
const USE_MOCK = true;
const API_BASE = "http://localhost:8000";

const api = {
  // 파일 업로드. 백엔드는 scoreId 반환.
  async upload(file) {
    if (USE_MOCK) return mockUpload(file);

    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("업로드 실패");
    return await res.json();
  },

  // 처리 상태 폴링용
  async getStatus(scoreId) {
    if (USE_MOCK) return mockStatus(scoreId);
    const res = await fetch(`${API_BASE}/api/score/${scoreId}/status`);
    if (!res.ok) throw new Error("상태 확인 실패");
    return await res.json();
  },

  // 파싱된 악보 JSON
  async getScore(scoreId) {
    if (USE_MOCK) return mockScore(scoreId);
    const res = await fetch(`${API_BASE}/api/score/${scoreId}`);
    if (!res.ok) throw new Error("악보 데이터 가져오기 실패");
    return await res.json();
  }
};

// === 백엔드 없을 때 가짜 응답 (실제 시간 흐름 흉내냄) ===
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
  // 3번 폴링 후 done
  return { status: mockStatusCount >= 3 ? "done" : "processing" };
}

async function mockScore(scoreId) {
  await sleep(300);
  return { metadata: { title: "Mock Score" }, measures: [] };
}