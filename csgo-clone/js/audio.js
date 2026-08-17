// Tiny synthesized SFX via WebAudio so the game has feedback without asset files.
let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function tone(freq, dur, type = 'square', gainVal = 0.15, delay = 0) {
  try {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
    gain.gain.setValueAtTime(gainVal, ac.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(ac.currentTime + delay);
    osc.stop(ac.currentTime + delay + dur);
  } catch (e) { /* audio unavailable, ignore */ }
}

function noiseBurst(dur, gainVal = 0.2) {
  try {
    const ac = getCtx();
    const bufferSize = ac.sampleRate * dur;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(gainVal, ac.currentTime);
    src.connect(gain).connect(ac.destination);
    src.start();
  } catch (e) { /* ignore */ }
}

export const SFX = {
  shot(weaponId) {
    if (weaponId === 'knife') { tone(180, 0.05, 'triangle', 0.1); return; }
    noiseBurst(0.06, 0.18);
    tone(weaponId === 'rifle' ? 140 : 220, 0.07, 'sawtooth', 0.12);
  },
  hitFlesh() { tone(500, 0.08, 'sine', 0.1); },
  reload() { tone(300, 0.08, 'square', 0.06); tone(240, 0.08, 'square', 0.06, 0.12); },
  plantTick() { tone(880, 0.05, 'sine', 0.05); },
  defuseTick() { tone(660, 0.05, 'sine', 0.05); },
  beep() { tone(1000, 0.09, 'sine', 0.1); },
  explode() { noiseBurst(0.6, 0.35); tone(80, 0.6, 'sawtooth', 0.25); },
  roundWin() { tone(660, 0.15, 'sine', 0.15); tone(880, 0.2, 'sine', 0.15, 0.15); },
  roundLose() { tone(300, 0.25, 'sawtooth', 0.12); tone(180, 0.3, 'sawtooth', 0.12, 0.2); },
};
