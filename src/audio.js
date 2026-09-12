// Synthesized audio: UI sfx + ambient atmosphere (wind, birds, gentle music).
// No audio files — everything is generated with WebAudio after the first
// user gesture (autoplay policy). Mute gates a master gain node.

import { state } from './state.js';

let ctx = null;
let master = null;
let ambientStarted = false;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = state.muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function applyMute() {
  if (master) master.gain.setTargetAtTime(state.muted ? 0 : 1, ctx.currentTime, 0.08);
}

function tone(freq, dur = 0.12, type = 'sine', gain = 0.08, when = 0, dest = null) {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g).connect(dest || master);
    o.start(c.currentTime + when);
    o.stop(c.currentTime + when + dur + 0.05);
    return o;
  } catch { return null; }
}

export const sfx = {
  click: () => tone(660, 0.06, 'square', 0.025),
  pop: (i = 0) => tone(300 + i * 40, 0.15, 'triangle', 0.07),
  coin: () => { tone(880, 0.09, 'sine', 0.06); tone(1320, 0.12, 'sine', 0.05, 0.08); },
  chime: () => { tone(523, 0.2, 'sine', 0.06); tone(659, 0.2, 'sine', 0.06, 0.12); tone(784, 0.3, 'sine', 0.06, 0.24); },
  error: () => tone(180, 0.2, 'sawtooth', 0.04),
  whoosh: () => { // camera fly / mode switch
    try {
      const c = ac();
      const noise = noiseSource(c, 0.5);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(300, c.currentTime);
      f.frequency.exponentialRampToValueAtTime(1400, c.currentTime + 0.35);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.05, c.currentTime + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
      noise.connect(f).connect(g).connect(master);
      noise.start();
      noise.stop(c.currentTime + 0.55);
    } catch { /* ignore */ }
  },
};

function noiseSource(c, seconds) {
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Start the looping ambience — call once after the first user gesture. */
export function startAmbient() {
  if (ambientStarted) return;
  ambientStarted = true;
  try {
    const c = ac();

    // — Wind: looping filtered noise with a slow swell —
    const wind = noiseSource(c, 3);
    wind.loop = true;
    const windF = c.createBiquadFilter();
    windF.type = 'lowpass';
    windF.frequency.value = 420;
    const windG = c.createGain();
    windG.gain.value = 0.014;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.007;
    lfo.connect(lfoG).connect(windG.gain);
    wind.connect(windF).connect(windG).connect(master);
    wind.start();
    lfo.start();

    // — Birds: random cheerful chirps —
    const chirp = () => {
      const base = 2100 + Math.random() * 900;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const t = i * (0.09 + Math.random() * 0.05);
        const o = tone(base + Math.random() * 300, 0.07, 'sine', 0.016, t);
        if (o) o.frequency.exponentialRampToValueAtTime(base * 0.75, c.currentTime + t + 0.07);
      }
      setTimeout(chirp, 2500 + Math.random() * 6000);
    };
    setTimeout(chirp, 1200);

    // — Music: soft pentatonic plucks over a warm pad —
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3];
    let bar = 0;
    const pluck = () => {
      bar++;
      const note = scale[Math.floor(Math.random() * scale.length)];
      tone(note, 1.4, 'triangle', 0.022);
      if (bar % 2 === 0) tone(note / 2, 2.2, 'sine', 0.016, 0.05);
      if (Math.random() < 0.4) tone(note * 1.5, 1.1, 'sine', 0.012, 0.3);
      setTimeout(pluck, 1900 + Math.random() * 900);
    };
    setTimeout(pluck, 800);
  } catch { /* audio is optional */ }
}
