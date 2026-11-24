/** Лёгкие синтезированные звуки (WebAudio) — без внешних файлов */
let ctx: AudioContext | null = null;
let enabled = true;

export const setSoundEnabled = (v: boolean) => { enabled = v; };

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.08) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  check() { if (enabled) { tone(660, 0, 0.12, 'triangle'); tone(990, 0.07, 0.18, 'triangle'); } },
  undo() { if (enabled) { tone(440, 0, 0.1, 'sine', 0.06); tone(330, 0.07, 0.14, 'sine', 0.06); } },
  victory() {
    if (!enabled) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.35, 'triangle', 0.09));
    tone(1568, 0.6, 0.7, 'sine', 0.07);
  },
  levelUp() { if (enabled) [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.25, 'square', 0.04)); },
  notify() { if (enabled) { tone(880, 0, 0.14, 'sine', 0.07); tone(1175, 0.16, 0.2, 'sine', 0.07); } },
  error() { if (enabled) tone(180, 0, 0.22, 'sawtooth', 0.05); },
};
