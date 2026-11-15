// Adaptive score, synthesised live. A lookahead scheduler plays a D-minor
// progression; layers fade in with intensity:
//   0 calm  : pad only
//   1 combat: + bass pulse, kick/snare/hats
//   2 boss  : + arpeggio, busier drums
export class Music {
  constructor(audio) {
    this.audio = audio;
    this.started = false;
    this.intensity = 0; this.target = 0;
    this.volume = 0.5;
  }

  start() {
    const A = this.audio; if (!A.ctx || this.started) return;
    const ctx = this.ctx = A.ctx;
    this.started = true;
    this.out = ctx.createGain(); this.out.gain.value = this.volume * 0.5;
    this.out.connect(A.master);
    const verb = ctx.createGain(); verb.gain.value = 0.35; this.out.connect(verb); verb.connect(A.verb);
    this.bus = {};
    for (const k of ['pad', 'bass', 'drums', 'arp']) { const g = ctx.createGain(); g.gain.value = k === 'pad' ? 1 : 0; g.connect(this.out); this.bus[k] = g; }
    this.bpm = 96; this.step = 0; this.next = ctx.currentTime + 0.1;
    // Dm  Bb  F  C  (root midi, chord)
    this.prog = [[50, [62, 65, 69]], [46, [58, 62, 65]], [53, [60, 65, 69]], [48, [60, 64, 67]]];
    this.timer = setInterval(() => this.schedule(), 40);
  }

  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.1); }

  setIntensity(i) {
    if (!this.started || i === this.target) return;
    this.target = i;
    const t = this.ctx.currentTime;
    this.bus.bass.gain.setTargetAtTime(i >= 1 ? 0.9 : 0, t, 1.2);
    this.bus.drums.gain.setTargetAtTime(i >= 1 ? 0.8 : 0, t, i >= 1 ? 0.6 : 2.0);
    this.bus.arp.gain.setTargetAtTime(i >= 2 ? 0.45 : 0, t, 1.0);
    this.bus.pad.gain.setTargetAtTime(i >= 2 ? 0.75 : 1, t, 1.5);
  }

  f(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  schedule() {
    const ctx = this.ctx; const spb = 60 / this.bpm / 4; // 16th notes
    while (this.next < ctx.currentTime + 0.18) {
      this.playStep(this.step, this.next, spb);
      this.next += spb; this.step = (this.step + 1) % 256;
    }
  }

  playStep(s, t, spb) {
    const bar = Math.floor(s / 16) % 4, pos = s % 16;
    const [root, chord] = this.prog[bar];
    const boss = this.target >= 2;
    if (pos === 0) chord.forEach((m, i) => this.pad(this.f(m - 12 + (i === 2 ? 12 : 0)), t, spb * 16));
    if (pos % 2 === 0) this.bass(this.f(root - 12 + (pos === 6 || pos === 14 ? 12 : 0)), t, spb * 1.6);
    if (pos === 0 || pos === 8 || (boss && (pos === 6 || pos === 10))) this.kick(t);
    if (pos === 4 || pos === 12) this.snare(t);
    if (pos % 2 === 1 || boss) this.hat(t, pos % 4 === 2 ? 0.5 : 0.25);
    if (pos % 2 === 0) { const notes = [...chord, chord[0] + 12]; this.arp(this.f(notes[(pos / 2 + bar) % 4] + 12), t, spb * 1.5); }
  }

  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0.0001, t + a, d); }

  pad(f, t, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.35); g.gain.setTargetAtTime(0.0001, t + dur * 0.8, dur * 0.2);
    for (const d of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur * 1.3); }
    lp.connect(g).connect(this.bus.pad);
  }
  bass(f, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(160, t + dur); lp.Q.value = 6;
    const g = ctx.createGain(); this.env(g, t, 0.005, 0.22, dur * 0.4);
    o.connect(lp).connect(g).connect(this.bus.bass); o.start(t); o.stop(t + dur + 0.3);
  }
  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); this.env(g, t, 0.002, 0.7, 0.09);
    o.connect(g).connect(this.bus.drums); o.start(t); o.stop(t + 0.4);
  }
  noiseHit(t, type, f, peak, decay) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.audio.noiseBuf;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f;
    const g = ctx.createGain(); this.env(g, t, 0.001, peak, decay);
    src.connect(flt).connect(g).connect(this.bus.drums); src.start(t, Math.random()); src.stop(t + decay * 6);
  }
  snare(t) { this.noiseHit(t, 'bandpass', 1800, 0.35, 0.06); const o = this.ctx.createOscillator(); o.frequency.value = 190; const g = this.ctx.createGain(); this.env(g, t, 0.002, 0.2, 0.05); o.connect(g).connect(this.bus.drums); o.start(t); o.stop(t + 0.3); }
  hat(t, v) { this.noiseHit(t, 'highpass', 7500, 0.09 * v * 2, 0.025); }
  arp(f, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ctx.createGain(); this.env(g, t, 0.004, 0.05, dur * 0.35);
    o.connect(lp).connect(g).connect(this.bus.arp); o.start(t); o.stop(t + dur + 0.3);
  }
}
