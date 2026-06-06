import { MidiComparatorService } from './d/MidiComparatorService.js';
import { Stopwatch } from './stopwatch.js';
import { Metronome } from './metronome.js';

// D 서비스 인스턴스 (bootstrap에서 생성, 모달 핸들러에서 사용)
let service = null;

const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-container", {
  autoResize: true,
  drawTitle: false,
});

// === 내부 상태 ===
let graphicalNotes = [];
let graphicalNotesByMeasure = new Map();
let noteIdMap = new Map();
let noteBeatMap = new Map();      // noteId -> absoluteStartBeat
let noteNextBeatMap = new Map();  // noteId -> 다음 연주 음표의 absoluteStartBeat (없으면 null)
let notePitchMap = new Map();     // noteId -> pitches[] (양손 음표를 개별 색칠하기 위함)
let errorLog = [];

// 통계 + 진행률
let stats = { correct: 0, wrong: 0 };
let timingStats = { total: 0, correct: 0, fast: 0, slow: 0 };   // 박자 판정 집계 (정확/빠름/느림)
let currentNoteIndex = 0;
let lastCursorBeat = null;     // 직전에 커서를 넘긴 음표의 absoluteStartBeat (같은 박자면 커서 고정)
let timerStarted = false;   // 첫 음 입력 전까지 타이머 대기 (팀원 구현)


// 첫 음 입력 시 딱 한 번만 타이머 시작
function startTimerOnce() {
  if (timerStarted) return;
  timerStarted = true;
  stopwatch.start();
}

// 자동 스크롤 상태
let systemMeasureRanges = [];
let currentSystemIndex = 0;

// === 내부 헬퍼 ===
function colorGraphicalNote(gNote, color) {
  const svgEl = gNote.getSVGGElement?.();
  if (!svgEl) return;
  svgEl.querySelectorAll('path').forEach(p => {
    p.setAttribute('fill', color);
    p.setAttribute('stroke', color);
  });
}

function colorCurrentCursorNotes(color) {
  const sourceNotes = osmd.cursor.NotesUnderCursor();
  if (!sourceNotes) return;
  for (const sn of sourceNotes) {
    const g = graphicalNotes.find(gn => gn.sourceNote === sn);
    if (g) colorGraphicalNote(g, color);
  }
}

// 커서 아래 음표 중, 지정한 MIDI pitch에 해당하는 음표만 색칠한다.
// 양손 동시 타건에서 오른손/왼손을 각각 다른 색(맞음/틀림)으로 칠하기 위함.
function colorCursorNotesByPitch(targetPitches, color) {
  const sourceNotes = osmd.cursor.NotesUnderCursor();
  if (!sourceNotes) return false;
  let colored = false;
  for (const sn of sourceNotes) {
    if (sn.isRest && sn.isRest()) continue;
    const midi = sn.Pitch ? sn.Pitch.halfTone + 12 : null;
    if (midi != null && targetPitches.includes(midi)) {
      const g = graphicalNotes.find(gn => gn.sourceNote === sn);
      if (g) { colorGraphicalNote(g, color); colored = true; }
    }
  }
  return colored;
}

function pitchResultToColor(pitchResult) {
  return pitchResult === 'correct' ? '#2D6E4E' : '#D64545';
}

function showJudgmentBanner(pitchResult, timingResult) {
  let text, type;
  if (pitchResult === 'wrong') {
    text = 'Miss'; type = 'wrong';
  } else if (timingResult === '정확') {
    text = 'Perfect'; type = 'accurate';
  } else if (timingResult === '빠름') {
    text = 'Fast'; type = 'fast';
  } else if (timingResult === '느림') {
    text = 'Slow'; type = 'slow';
  } else {
    text = 'Perfect'; type = 'accurate';
  }
  const banner = document.getElementById("judgment-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.className = `judgment-banner ${type}`;
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  clearTimeout(banner._fadeTimer);
  banner._fadeTimer = setTimeout(() => banner.classList.remove('show'), 600);
}

function updateStatsUI() {
  const total = stats.correct + stats.wrong;
  const acc = total === 0 ? 100 : Math.round(stats.correct / total * 100);
  const accEl = document.getElementById('stat-accuracy');
  const wrongEl = document.getElementById('stat-wrong');
  if (accEl) accEl.innerHTML = `${acc}<small>%</small>`;
  if (wrongEl) wrongEl.innerHTML = `${stats.wrong}<small>개</small>`;
}

function updateProgressUI() {
  const fill = document.getElementById("progress-fill");
  if (!fill || graphicalNotes.length === 0) return;
  const pct = Math.min(100, (currentNoteIndex / graphicalNotes.length) * 100);
  fill.style.width = `${pct}%`;
}

function updateSongInfo() {
  const titleEl = document.getElementById("song-title");
  const metaEl = document.getElementById("song-meta");
  if (!titleEl || !metaEl) return;

  let title = "곡 제목 없음";
  let totalMeasures = 0;
  let tempo = "?";

  try {
    title = osmd.Sheet?.TitleString || title;
    totalMeasures = osmd.Sheet?.SourceMeasures?.length || 0;
    tempo = Math.round(osmd.Sheet?.DefaultStartTempoInBpm || 0) || "?";
  } catch (e) { /* OSMD 버전 차이 방어 */ }

  titleEl.textContent = title;
  metaEl.textContent = `${totalMeasures}마디 · 양손 · ♩=${tempo}`;
}

function getCurrentCursorMeasureNumber() {
  try {
    const iter = osmd.cursor.iterator;
    if (!iter) return null;
    const idx = iter.CurrentMeasureIndex ?? iter.currentMeasureIndex;
    if (idx == null || idx < 0) return null;
    const measure = osmd.Sheet?.SourceMeasures?.[idx];
    return measure?.MeasureNumber ?? (idx + 1);
  } catch (e) {
    console.warn('getCurrentCursorMeasureNumber 실패:', e);
    return null;
  }
}

function captureSystemLayout() {
  systemMeasureRanges = [];
  const pages = osmd.GraphicSheet?.MusicPages || [];
  for (const page of pages) {
    for (const system of page.MusicSystems || []) {
      const measures = [];
      for (const staffLine of system.StaffLines || []) {
        for (const measure of staffLine.Measures || []) {
          const num = measure.parentSourceMeasure?.MeasureNumber;
          if (num != null) measures.push(num);
        }
      }
      if (measures.length === 0) continue;
      systemMeasureRanges.push({
        first: Math.min(...measures),
        last: Math.max(...measures),
      });
    }
  }
  console.log(`✅ 줄(system) ${systemMeasureRanges.length}개 감지`);
}

function getSystemIndexForMeasure(measureNumber) {
  if (measureNumber == null) return -1;
  for (let i = 0; i < systemMeasureRanges.length; i++) {
    const r = systemMeasureRanges[i];
    if (measureNumber >= r.first && measureNumber <= r.last) return i;
  }
  return -1;
}

function scrollToSystem(systemIndex) {
  if (systemIndex < 0 || systemIndex >= systemMeasureRanges.length) return;
  const measureRange = systemMeasureRanges[systemIndex];
  const notes = graphicalNotesByMeasure.get(measureRange.first);
  if (!notes || notes.length === 0) {
    console.warn(`! scrollToSystem(${systemIndex}): measure ${measureRange.first}에 노트 없음`);
    return;
  }
  const noteEl = notes[0].getSVGGElement?.();
  if (!noteEl) {
    console.warn(`! scrollToSystem(${systemIndex}): SVG 요소 못 찾음`);
    return;
  }
  const scrollArea = document.querySelector('.score-area');
  if (!scrollArea) return;
  const noteRect = noteEl.getBoundingClientRect();
  const areaRect = scrollArea.getBoundingClientRect();
  const offsetWithinArea = noteRect.top - areaRect.top + scrollArea.scrollTop;
  const targetTop = Math.max(0, offsetWithinArea - 60);
  scrollArea.scrollTo({ top: targetTop, behavior: 'smooth' });
  console.log(`✅ scrollTo top=${targetTop.toFixed(0)} (system ${systemIndex}, measure ${measureRange.first})`);
}

function updateAutoScroll() {
  const measureNum = getCurrentCursorMeasureNumber();
  const newSystem = getSystemIndexForMeasure(measureNum);
  console.log(`커서 → measure ${measureNum} / system ${newSystem} (현재 ${currentSystemIndex})`);
  if (newSystem >= 0 && newSystem !== currentSystemIndex) {
    console.log(`스크롤 발동: system ${currentSystemIndex} → ${newSystem}`);
    currentSystemIndex = newSystem;
    scrollToSystem(currentSystemIndex);
  }
}

// === 로딩 ===
async function loadScore(source) {
  await osmd.load(source);
  osmd.render();
  osmd.cursor.show();

  graphicalNotes = [];
  graphicalNotesByMeasure.clear();

  for (const measureRow of osmd.GraphicSheet.MeasureList) {
    for (const gMeasure of measureRow) {
      if (!gMeasure) continue;
      const measureNumber = gMeasure.parentSourceMeasure?.MeasureNumber ?? null;
      for (const staffEntry of gMeasure.staffEntries) {
        if (!staffEntry) continue;
        for (const gVoiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const gNote of gVoiceEntry.notes) {
            graphicalNotes.push(gNote);
            if (measureNumber !== null) {
              if (!graphicalNotesByMeasure.has(measureNumber)) {
                graphicalNotesByMeasure.set(measureNumber, []);
              }
              graphicalNotesByMeasure.get(measureNumber).push(gNote);
            }
          }
        }
      }
    }
  }

  stats = { correct: 0, wrong: 0 };
  timingStats = { total: 0, correct: 0, fast: 0, slow: 0 };
  errorLog = [];
  currentNoteIndex = 0;
  updateStatsUI();
  updateProgressUI();
  updateSongInfo();

  captureSystemLayout();
  currentSystemIndex = 0;
  const scrollArea = document.querySelector('.score-area');
  if (scrollArea) scrollArea.scrollTop = 0;

  console.log(`✅ 로딩 완료. 음표 ${graphicalNotes.length}개, 마디 ${graphicalNotesByMeasure.size}개`);
}

// === 🔓 외부 API ===
window.scoreView = {
  attachScoreJson(scoreJson) {
    noteIdMap.clear();
    noteBeatMap.clear();
    noteNextBeatMap.clear();
    notePitchMap.clear();
    lastCursorBeat = null;

    // 연주 대상(shouldPlay) 음표를 순서대로 모은다.
    const playSeq = [];
    for (const measure of scoreJson?.measures ?? []) {
      for (const note of measure.notes ?? []) {
        if (note.id != null && note.absoluteStartBeat != null) {
          noteBeatMap.set(note.id, note.absoluteStartBeat);
          notePitchMap.set(note.id, note.pitches ?? []);
          if (note.shouldPlay) playSeq.push(note);
        }
      }
    }
    // 각 음표의 "다음 연주 음표 박자"를 기록 (다음 음이 같은 박자면 양손 동시 타건).
    for (let i = 0; i < playSeq.length; i++) {
      const nextBeat = i + 1 < playSeq.length ? playSeq[i + 1].absoluteStartBeat : null;
      noteNextBeatMap.set(playSeq[i].id, nextBeat);
    }
    console.log(`[scoreView] JSON 받음. noteBeatMap ${noteBeatMap.size}, 연주음표 ${playSeq.length}개.`);
  },

  getCurrentExpected() {
    const notes = osmd.cursor.NotesUnderCursor();
    if (!notes || notes.length === 0) return null;
    return {
      midiNumbers: notes
        .filter(n => !n.isRest() && n.Pitch)
        .map(n => n.Pitch.halfTone + 12)
    };
  },

  highlightNote(noteId, pitchResult, timingResult) {
    startTimerOnce();   // 첫 음 입력 시 타이머 시작 (팀원 구현)

    // 색칠은 '현재 커서 위치'(= 방금 친 음)에 한다. 커서 이동은 advanceCursor가 담당.
    // 양손 동시 타건에서 오른손/왼손을 각각 맞음/틀림 색으로 칠하기 위해,
    // 그 음표의 pitch에 해당하는 음표만 골라 색칠한다.
    const color = pitchResultToColor(pitchResult);
    const targetPitches = notePitchMap.get(noteId);
    if (noteId && noteIdMap.has(noteId)) {
      colorGraphicalNote(noteIdMap.get(noteId), color);
    } else if (targetPitches && targetPitches.length > 0) {
      const ok = colorCursorNotesByPitch(targetPitches, color);
      if (!ok) colorCurrentCursorNotes(color);   // 매칭 실패 시 안전망
    } else {
      colorCurrentCursorNotes(color);
    }

    if (pitchResult === 'correct') {
      stats.correct++;
    } else {
      stats.wrong++;
      const sourceNotes = osmd.cursor.NotesUnderCursor();
      if (sourceNotes && sourceNotes.length > 0) {
        const n = sourceNotes[0];
        const measureNumber = getCurrentCursorMeasureNumber();
        const staffIdx = n.ParentVoiceEntry?.ParentSourceStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
        const hand = staffIdx === 0 ? '오른손' : '왼손';
        const expectedMidi = n.Pitch ? n.Pitch.halfTone + 12 : null;
        errorLog.push({ measureNumber, hand, expectedMidi });
      }
    }
    // 박자 판정 집계 (null은 면제 — 첫 음/꾸밈음/일시정지 재개 직후)
    if (timingResult === '정확')      { timingStats.total++; timingStats.correct++; }
    else if (timingResult === '빠름') { timingStats.total++; timingStats.fast++; }
    else if (timingResult === '느림') { timingStats.total++; timingStats.slow++; }

    updateStatsUI();
    showJudgmentBanner(pitchResult, timingResult);
  },

  advanceCursor(noteId) {
    currentNoteIndex++;   // 음표 단위 진행률은 항상 증가

    // 커서는 색칠(highlightNote) 이후에, '다음 칠 음'으로 이동시킨다.
    //  - 다음 연주 음표가 같은 박자(양손 동시 타건)면 → 커서를 유지 (색칠 위치 보존, 1칸만 이동)
    //  - 다음 음표가 다른 박자거나 마지막이면 → 한 칸 이동
    //  - noteId가 없거나(데모 버튼) 맵에 없으면 → 항상 한 칸 이동
    if (noteId == null || !noteBeatMap.has(noteId)) {
      osmd.cursor.next();
    } else {
      const beat = noteBeatMap.get(noteId);
      const nextBeat = noteNextBeatMap.get(noteId);
      if (nextBeat == null || nextBeat !== beat) {
        osmd.cursor.next();
      }
    }

    updateProgressUI();
    updateAutoScroll();
  },

  showResultScreen() {
    const params = new URLSearchParams(window.location.search);
    const result = {
      scoreId: params.get('scoreId'),
      songTitle: osmd.Sheet?.TitleString || '곡 제목 없음',
      totalNotes: graphicalNotes.length,
      correctNotes: stats.correct,
      wrongNotes: stats.wrong,
      finishedNotes: currentNoteIndex,
      errorLog: errorLog,
      elapsedSec: stopwatch.elapsedSec,
      timingTotal: timingStats.total,
      timingCorrect: timingStats.correct,
      timingFast: timingStats.fast,
      timingSlow: timingStats.slow,
    };
    sessionStorage.setItem('practiceResult', JSON.stringify(result));
    window.location.href = 'result.html';
  },

  reset() {
    graphicalNotes.forEach(g => colorGraphicalNote(g, '#000000'));
    osmd.cursor.reset();
    stats = { correct: 0, wrong: 0 };
    timingStats = { total: 0, correct: 0, fast: 0, slow: 0 };
    currentNoteIndex = 0;
    lastCursorBeat = null;
    errorLog = [];
    timerStarted = false;   // 다음 첫 음에서 타이머 재시작 (팀원 구현)
    updateStatsUI();
    updateProgressUI();
    currentSystemIndex = 0;
    const scrollArea = document.querySelector('.score-area');
    if (scrollArea) scrollArea.scrollTop = 0;
    metronome.reset();      // 메트로놈도 리셋
  }
};

// === 🛠 데모 버튼 핸들러 (배포 전 제거) ===
document.getElementById("btn-next")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '정확');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-fast")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '빠름');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-slow")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'correct', '느림');
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-wrong")?.addEventListener("click", () => {
  window.scoreView.highlightNote(null, 'wrong', null);
  window.scoreView.advanceCursor(null);
});
document.getElementById("btn-prev")?.addEventListener("click", () => {
  osmd.cursor.previous();
  currentNoteIndex = Math.max(0, currentNoteIndex - 1);
  updateProgressUI();
  updateAutoScroll();
});
document.getElementById("btn-reset")?.addEventListener("click", () => {
  window.scoreView.reset();
});
document.getElementById("btn-next-10")?.addEventListener("click", async () => {
  for (let i = 0; i < 10; i++) {
    window.scoreView.highlightNote(null, 'correct', '정확');
    window.scoreView.advanceCursor(null);
    await new Promise(r => setTimeout(r, 100));
  }
});
document.getElementById("btn-show-result")?.addEventListener("click", () => {
  window.scoreView.showResultScreen();
});

// === 일시정지 모달 ===
function openPauseModal() {
  const total = stats.correct + stats.wrong;
  const acc = total === 0 ? 100 : Math.round(stats.correct / total * 100);
  document.getElementById("modal-accuracy").textContent = `${acc}%`;
  document.getElementById("modal-wrong").textContent = `${stats.wrong}개`;

  const currentMeasure = getCurrentCursorMeasureNumber() || 0;
  const totalMeasures = osmd.Sheet?.SourceMeasures?.length || 0;
  document.getElementById("modal-progress").textContent =
    `${currentMeasure}/${totalMeasures} 마디`;

  document.getElementById("pause-modal").classList.add("show");
  service?.pause();
  stopwatch.pause();
  metronome.pauseForModal();
}

// startTimer=false면 타이머 재개 안 함 (처음부터 후 첫 음 대기 시)
function closePauseModal(startTimer = true) {
  document.getElementById("pause-modal").classList.remove("show");
  service?.resume();
  if (startTimer) stopwatch.start();
  metronome.resumeFromModal();
}

document.getElementById("btn-pause")?.addEventListener("click", openPauseModal);
document.getElementById("btn-resume")?.addEventListener("click", closePauseModal);

document.getElementById("btn-restart")?.addEventListener("click", () => {
  service?.restart();
  window.scoreView.reset();   // timerStarted=false + metronome.reset() 포함
  stopwatch.reset();
  closePauseModal(false);     // 모달 닫기 + resume, 타이머는 첫 음까지 대기
});

document.getElementById("btn-end")?.addEventListener("click", () => {
  service?.stop();
  stopwatch.pause();
  metronome.reset();
  window.scoreView.showResultScreen();
});

const stopwatch = new Stopwatch(document.getElementById('timer'));

// === 메트로놈 ===
const metronome = new Metronome();

metronome.onStateChange = (running) => {
  document.getElementById('btn-metronome')?.classList.toggle('active', running);
};

document.getElementById('btn-metronome')?.addEventListener('click', () => {
  metronome.toggle();
});

function setupMetronome() {
  const settings = JSON.parse(sessionStorage.getItem('playSettings') || '{}');
  const speed = settings.speedMultiplier ?? 1.0;

  let baseTempo = 120;
  let numerator = 4;
  let denominator = 4;

  try {
    baseTempo = osmd.Sheet?.DefaultStartTempoInBpm || 120;
    const ts = osmd.Sheet?.SourceMeasures?.[0]?.ActiveTimeSignature;
    if (ts) {
      numerator = ts.Numerator ?? ts.numerator ?? 4;
      denominator = ts.Denominator ?? ts.denominator ?? 4;
    }
  } catch (e) {
    console.warn('메트로놈 설정 읽기 실패, 기본값 사용:', e);
  }

  metronome.setTempo(baseTempo * speed);
  metronome.setTimeSignature(numerator, denominator);
  console.log(`✅ 메트로놈 설정: ♩=${baseTempo}×${speed}=${(baseTempo*speed).toFixed(1)} BPM, ${numerator}/${denominator}`);
}

// === MIDI 연결 상태 감지 (onstatechange) + 수동 재연결 ===
function setMidiStatusUI(state, text) {
  const el = document.getElementById('midi-status');
  if (!el) return;
  el.dataset.state = state;
  const textEl = el.querySelector('.status-text');
  if (textEl) textEl.textContent = text;
}

function pickConnectedInputName(midiAccess) {
  for (const input of midiAccess.inputs.values()) {
    if (input.state === 'connected') return input.name || '전자 피아노';
  }
  return null;
}

let _midiAccess = null;
let _refreshMidiStatus = () => {};

async function setupMidiStatusWatcher() {
  if (!navigator.requestMIDIAccess) {
    setMidiStatusUI('unsupported', 'WebMIDI 미지원 (Chrome 권장)');
    return;
  }
  try {
    _midiAccess = await navigator.requestMIDIAccess();
    _refreshMidiStatus = () => {
      const name = pickConnectedInputName(_midiAccess);
      if (name) {
        setMidiStatusUI('connected', `${name} 연결됨`);
      } else {
        setMidiStatusUI('disconnected', '연결 끊김 — USB 확인');
      }
    };
    // addEventListener는 D의 MidiInput.onstatechange 할당과 충돌 X
    _midiAccess.addEventListener('statechange', _refreshMidiStatus);
    _refreshMidiStatus();
  } catch (e) {
    console.warn('MIDI 접근 실패:', e);
    setMidiStatusUI('unsupported', 'MIDI 권한 거부됨');
  }
}

async function retryMidiConnection() {
  setMidiStatusUI('connecting', '연결 확인 중…');

  // access가 아직 없으면 (권한 거부/미지원/최초 실패) 처음부터 셋업
  if (!_midiAccess) {
    await setupMidiStatusWatcher();
  } else {
    _refreshMidiStatus();
  }

  // D 서비스도 재연결 시도 (있을 때만, hot-rebind)
  if (service) {
    try { await service.start(); } catch (e) { console.warn('D 재연결 실패:', e); }
  }
}

document.getElementById('btn-midi-refresh')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-midi-refresh');
  if (!btn || btn.classList.contains('spinning')) return;
  btn.classList.add('spinning');
  const startedAt = performance.now();
  await retryMidiConnection();
  // 최소 600ms 회전 유지 (눌렀다는 시각적 피드백)
  const elapsed = performance.now() - startedAt;
  setTimeout(() => btn.classList.remove('spinning'), Math.max(0, 600 - elapsed));
});

// === 시작 ===
async function bootstrap() {
  setupMidiStatusWatcher();   // MIDI 상태 UI 감지 (fire-and-forget, D 무관)

  const params = new URLSearchParams(window.location.search);
  const scoreId = params.get("scoreId");

  const useBackend = scoreId && scoreId.startsWith("mock-") === false && USE_MOCK === false;

  try {
    if (useBackend) {
      const url = api.getMusicXmlUrl(scoreId);
      console.log(`📂 악보 로딩(백엔드) v4: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`musicxml 응답 오류: ${res.status}`);
      const xmlText = await res.text();
      await loadScore(xmlText);
    } else {
      console.log(`📂 악보 로딩(로컬) v4: assets/canon.mxl`);
      await loadScore("assets/canon.mxl");
    }
  } catch (err) {
    console.error("❌ 악보 로딩 실패:", err);
    if (useBackend) {
      console.warn("⤴ 로컬 canon.mxl로 fallback");
      try { await loadScore("assets/canon.mxl"); } catch (e) { console.error(e); }
    }
  }

  setupMetronome();

  let scoreJson = null;
  try {
    if (useBackend) {
      scoreJson = await api.getScore(scoreId);
    }
  } catch (e) {
    console.warn("scoreJson 못 받음:", e);
  }

  if (scoreJson) {
    setupComparator(scoreJson);
  } else {
    console.warn("⚠️ scoreJson 없음 → D 미연동. 데모 버튼으로 시각 테스트만 가능.");
    // 타이머는 첫 highlightNote 시점에 startTimerOnce()가 자동 시작

  }
}

function setupComparator(scoreJson) {
  const settings = JSON.parse(sessionStorage.getItem('playSettings') || '{}');

  const baseDuration = scoreJson?.metadata?.estimatedDurationSec;
  const speed = settings.speedMultiplier ?? 1.0;
  if (baseDuration) {
    stopwatch.setTotal(baseDuration / speed);
  }

  window.scoreView.attachScoreJson(scoreJson);

  service = new MidiComparatorService(scoreJson, {
    chordWindowMs: 50,
    toleranceMs: 200,
    speedMultiplier: settings.speedMultiplier ?? 1.0,
  });

  service.onResult = (noteId, pitchResult, timingResult) => {
    window.scoreView.highlightNote(noteId, pitchResult, timingResult);
    window.scoreView.advanceCursor(noteId);
  };

  service.onFinish = () => {
    stopwatch.pause();
    metronome.reset();
    window.scoreView.showResultScreen();
  };

  service.start()
    .then(() => {
      console.log('✅ MIDI 연결 완료 — 첫 음 입력 시 타이머 시작');
    })
    .catch(e => {
      console.error('❌ MIDI 연결 실패:', e);
    });

  console.log("✅ D 비교 엔진 연동 완료 (배속:", settings.speedMultiplier ?? 1.0, ")");
}

window._debug = {
  get systemMeasureRanges() { return systemMeasureRanges; },
  get currentSystemIndex() { return currentSystemIndex; },
  get currentNoteIndex() { return currentNoteIndex; },
};

window.osmd = osmd;

bootstrap();

