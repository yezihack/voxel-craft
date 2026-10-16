/* 音效：WebAudio 合成音 —— 迁移自 voxel-craft.html 第 8230-8259 行 */
/* ============================== 音效 ============================== */
/* 纯 WebAudio 合成，不加载任何音频文件 */
export let actx = null;
export function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = false; } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx || null;
}
export function blip(freq, dur, type = 'square', vol = 0.055) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
export function noiseBurst(dur = 0.09, vol = 0.10, lp = 1400) {
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
  const s = a.createBufferSource(); s.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = a.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(a.destination);
  s.start();
}
