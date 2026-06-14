function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class ScoreSimulator {
  constructor() {
    this._audioCtx = null;
    this._source = null;
    this._timers = [];
    this._isPlaying = false;
    this._loading = false;
    this._scoreJson = null;
    this._bufferCache = new Map(); // scoreId_speed → AudioBuffer
  }

  async loadScore() {
    const scoreId = new URLSearchParams(location.search).get('scoreId');
    if (!scoreId) return false;
    try {
      this._scoreJson = await api.getScore(scoreId);
      return true;
    } catch {
      return false;
    }
  }

  async _initAudio() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
  }

  // OfflineAudioContext로 전체 오디오를 미리 렌더링
  async _preRender(events) {
    const lastEvent = events.at(-1);
    if (!lastEvent) return null;
    const totalSec = lastEvent.timeMs / 1000 + 2.0;
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(totalSec * sampleRate), sampleRate);

    for (const ev of events) {
      const when = ev.timeMs / 1000;
      const dur = Math.min(ev.durationSec, 2.0);
      // 화음은 최고음+최저음 (2개로 제한)
      const pitches = ev.pitches.length > 2
        ? [Math.min(...ev.pitches), Math.max(...ev.pitches)]
        : ev.pitches;

      for (const pitch of pitches) {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(midiToFreq(pitch), when);
        gain.gain.setValueAtTime(0.2, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
        osc.start(when);
        osc.stop(when + dur + 0.01);
      }
    }

    return await offlineCtx.startRendering();
  }

  _buildEvents(speedMultiplier) {
    const bpm = (this._scoreJson.metadata.tempo ?? 120) * speedMultiplier;
    const beatToMs = beat => (beat * 60000) / bpm;

    const beatMap = new Map();
    for (const measure of this._scoreJson.measures ?? []) {
      for (const note of measure.notes ?? []) {
        if (!note.shouldPlay || note.isRest || !note.pitches?.length) continue;
        const key = note.absoluteStartBeat;
        if (!beatMap.has(key)) {
          beatMap.set(key, {
            timeMs: beatToMs(key),
            pitches: [...note.pitches],
            durationSec: Math.max(0.15, ((note.duration ?? 1) * 60) / bpm * 0.8),
          });
        } else {
          for (const p of note.pitches) {
            if (!beatMap.get(key).pitches.includes(p)) beatMap.get(key).pitches.push(p);
          }
        }
      }
    }
    return [...beatMap.values()].sort((a, b) => a.timeMs - b.timeMs);
  }

  async start(speedMultiplier = 1.0) {
    if (!this._scoreJson) {
      const ok = await this.loadScore();
      if (!ok) { alert('악보 데이터를 불러올 수 없어요.'); return; }
    }

    this.stop();
    await this._initAudio();

    const btn = document.getElementById('btn-simulate');
    this._loading = true;
    if (btn) btn.textContent = '⏳ 준비 중...';

    const scoreId = new URLSearchParams(location.search).get('scoreId') ?? 'unknown';
    const cacheKey = `${scoreId}_${speedMultiplier}`;
    const events = this._buildEvents(speedMultiplier);

    let buffer = this._bufferCache.get(cacheKey) ?? null;
    if (!buffer) {
      console.log(`[sim] ${events.length}개 음표 사전 렌더링 중...`);
      buffer = await this._preRender(events);
      if (buffer) this._bufferCache.set(cacheKey, buffer);
    } else {
      console.log('[sim] 캐시된 버퍼 사용');
    }
    this._loading = false;

    if (!buffer || !this._audioCtx) {
      // stop()이 호출된 경우 중단
      if (btn) btn.textContent = '▶ 시뮬레이션';
      return;
    }

    window.scoreView?.reset?.();
    this._isPlaying = true;
    if (btn) btn.textContent = '⏹ 정지';

    const STARTUP_MS = 300;
    const audioStartTime = this._audioCtx.currentTime + STARTUP_MS / 1000;

    // AudioBuffer 재생
    this._source = this._audioCtx.createBufferSource();
    this._source.buffer = buffer;
    this._source.connect(this._audioCtx.destination);
    this._source.start(audioStartTime);

    // requestAnimationFrame으로 AudioContext 클럭 기반 커서 동기화
    const outputLatencyMs = ((this._audioCtx.outputLatency ?? 0) + (this._audioCtx.baseLatency ?? 0)) * 1000;
    const CURSOR_DELAY_MS = Math.max(150, outputLatencyMs); // 소리가 들리는 시점에 맞춰 커서 이동
    console.log(`[sim] outputLatency=${outputLatencyMs.toFixed(0)}ms, CURSOR_DELAY=${CURSOR_DELAY_MS.toFixed(0)}ms`);

    let eventIndex = 0;
    const tick = () => {
      if (!this._isPlaying) return;
      const audioPositionMs = (this._audioCtx.currentTime - audioStartTime) * 1000 - CURSOR_DELAY_MS;
      while (eventIndex < events.length && events[eventIndex].timeMs <= audioPositionMs) {
        window.scoreView?.advanceCursor?.(null);
        eventIndex++;
      }
      if (eventIndex < events.length) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._onEnd();
      }
    };
    this._rafId = requestAnimationFrame(tick);
    console.log('[sim] 재생 시작 (AudioContext 클럭 동기화)');
  }

  stop() {
    this._isPlaying = false;
    this._timers.forEach(clearTimeout);
    this._timers = [];
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    try { this._source?.stop(); } catch {}
    this._source = null;
    try { this._audioCtx?.close(); } catch {}
    this._audioCtx = null;
    const btn = document.getElementById('btn-simulate');
    if (btn) btn.textContent = '▶ 시뮬레이션';
  }

  _onEnd() {
    this._isPlaying = false;
    const btn = document.getElementById('btn-simulate');
    if (btn) btn.textContent = '▶ 시뮬레이션';
  }

  get isPlaying() { return this._isPlaying; }
}

window.scoreSimulator = new ScoreSimulator();

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-simulate');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (window.scoreSimulator.isPlaying || window.scoreSimulator._loading) {
      window.scoreSimulator.stop();
    } else {
      const settings = JSON.parse(sessionStorage.getItem('playSettings') || '{}');
      window.scoreSimulator.start(settings.speedMultiplier ?? 1.0);
    }
  });
});
