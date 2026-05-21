// OSMD가 CDN으로 로드되면 전역에 opensheetmusicdisplay 객체가 생김
const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,    // 창 크기 바뀌면 자동 리사이즈
  drawTitle: true,     // 곡 제목 표시
});

async function renderScore() {
  try {
    // assets 폴더의 샘플 파일을 fetch해서 OSMD에 던져줌
    await osmd.load("assets/sample.musicxml");
    osmd.render();
    console.log("✅ 악보 렌더링 성공");
  } catch (err) {
    console.error("❌ 악보 로딩 실패:", err);
  }
}

renderScore();