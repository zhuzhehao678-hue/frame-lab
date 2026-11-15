// Fully synthesised sound design (no samples): layered gunshots with an
// outdoor slap-back reverb, mechanical reload foley, HRTF-positioned drones,
// plasma bolts, explosions, footsteps and a harbour ambience bed.
import * as THREE from 'three';

export class Audio {
  constructor(camera) {
    this.camera = camera;
    this.ctx = null;
    this.enabled = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // reverb send
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.6, 2.8);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.55;
    this.verb.connect(this.verbGain).connect(this.master);
    // early slap-back echo off the warehouse
    this.slap = ctx.createDelay(1); this.slap.delayTime.value = 0.085;
    const slapG = ctx.createGain(); slapG.gain.value = 0.25;
    const slapF = ctx.createBiquadFilter(); slapF.type = 'lowpass'; slapF.frequency.value = 2400;
    this.slap.connect(slapF).connect(slapG).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.enabled = true;
    this.ambience();
  }

  makeNoise(sec) {
    const ctx = this.ctx; const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  impulse(sec, decay) {
    const ctx = this.ctx; const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // sparse early reflections + diffuse tail
        const early = (i % 1777 < 3 && t < 0.15) ? 0.6 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early * (Math.random() - 0.5)) * (t < 0.004 ? t / 0.004 : 1);
      }
    }
    return b;
  }

  // positional output node for a world position (or null = head-locked)
  out(pos, { verb = 0.3, gain = 1 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    let node = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.1; p.maxDistance = 200;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); p.connect(this.master);
      if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; p.connect(s); s.connect(this.verb); }
    } else {
      g.connect(this.master);
      if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s); s.connect(this.verb); s.connect(this.slap); }
    }
    return node;
  }

  noise(dest, t0, dur, { type = 'bandpass', f = 1000, q = 1, f1 = null, gain = 1, attack = 0.001, curve = 3, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = rate;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t0); flt.Q.value = q;
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.setTargetAtTime(0.0001, t0 + attack, dur / curve);
    src.connect(flt).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.5);
  }
  tone(dest, t0, dur, { type = 'sine', f = 440, f1 = null, gain = 0.5, attack = 0.002, curve = 4 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.setTargetAtTime(0.0001, t0 + attack, dur / curve);
    o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + 0.3);
  }

  updateListener() {
    if (!this.ctx) return;
    const L = this.ctx.listener; const c = this.camera;
    const p = new THREE.Vector3(); c.getWorldPosition(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.01); L.positionY.setTargetAtTime(p.y, t, 0.01); L.positionZ.setTargetAtTime(p.z, t, 0.01);
      L.forwardX.setTargetAtTime(f.x, t, 0.01); L.forwardY.setTargetAtTime(f.y, t, 0.01); L.forwardZ.setTargetAtTime(f.z, t, 0.01);
      L.upX.setTargetAtTime(u.x, t, 0.01); L.upY.setTargetAtTime(u.y, t, 0.01); L.upZ.setTargetAtTime(u.z, t, 0.01);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // ------------------------------------------------------------------ weapon
  gunshot(ads, kind = 'rifle') {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const d = this.out(null, { verb: 0.9, gain: 0.9 });
    const pistol = kind === 'pistol';
    const p = (0.94 + Math.random() * 0.12) * (pistol ? 1.3 : 1);
    if (pistol) {
      this.noise(d, t, 0.015, { type: 'highpass', f: 3500, gain: 1.1 });
      this.noise(d, t, 0.11, { type: 'lowpass', f: 5200 * p, f1: 700, q: 0.8, gain: 1.2, curve: 5 });
      this.noise(d, t + 0.003, 0.22, { type: 'bandpass', f: 1000 * p, f1: 260, q: 1, gain: 0.55, curve: 4 });
      this.tone(d, t, 0.08, { f: 150 * p, f1: 60, gain: 0.6, curve: 3 });
      this.click(2600, 0.25, 0.04); // slide
      return;
    }
    this.noise(d, t, 0.02, { type: 'highpass', f: 3000, gain: 1.2 });                        // crack
    this.noise(d, t, 0.16, { type: 'lowpass', f: 4200 * p, f1: 500, q: 0.7, gain: 1.4, curve: 5 }); // body
    this.noise(d, t + 0.004, 0.32, { type: 'bandpass', f: 700 * p, f1: 180, q: 0.9, gain: 0.7, curve: 4 }); // blast
    this.tone(d, t, 0.14, { f: 115 * p, f1: 38, gain: 1.0, curve: 3 });                        // thump
    this.tone(d, t, 0.03, { type: 'square', f: 1800, f1: 900, gain: 0.04 });                   // mech
    // distant tail
    const far = this.out(null, { verb: 1.6, gain: 0.0 });
    this.noise(far, t + 0.03, 0.6, { type: 'lowpass', f: 900, f1: 200, gain: 0.3 });
  }
  dryFire() { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.05 }); this.noise(d, t, 0.03, { f: 3500, q: 6, gain: 0.5 }); this.tone(d, t, 0.02, { f: 2600, gain: 0.1 }); }
  click(f = 2500, gain = 0.4, delay = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime + delay; const d = this.out(null, { verb: 0.08 });
    this.noise(d, t, 0.04, { f, q: 5, gain }); this.noise(d, t + 0.012, 0.05, { f: f * 0.6, q: 3, gain: gain * 0.6 });
  }
  magOut() { if (!this.enabled) return; this.click(1800, 0.5); this.click(900, 0.4, 0.05); this.noise(this.out(null, { verb: 0.05 }), this.ctx.currentTime + 0.06, 0.18, { f: 600, q: 1, gain: 0.15 }); }
  magIn() { if (!this.enabled) return; this.click(1400, 0.8); this.click(3200, 0.5, 0.02); this.tone(this.out(null, { verb: 0.1 }), this.ctx.currentTime, 0.06, { f: 220, gain: 0.25 }); }
  bolt() { if (!this.enabled) return; this.click(2200, 0.9); this.click(1200, 0.8, 0.07); this.tone(this.out(null, { verb: 0.15 }), this.ctx.currentTime + 0.07, 0.08, { f: 160, gain: 0.3 }); }
  hitmarker(kill) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.0, gain: 0.5 });
    this.tone(d, t, 0.05, { type: 'triangle', f: kill ? 1300 : 1800, gain: 0.25 });
    if (kill) this.tone(d, t + 0.05, 0.12, { type: 'triangle', f: 900, gain: 0.25 });
  }
  impact(pos, surf) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.25, gain: 0.7 });
    if (surf === 'metal') { this.tone(d, t, 0.25, { type: 'sine', f: 2200 + Math.random() * 1600, gain: 0.25, curve: 6 }); this.noise(d, t, 0.06, { f: 5000, q: 2, gain: 0.6 }); }
    else if (surf === 'wood') { this.noise(d, t, 0.08, { f: 900, q: 2, gain: 0.8 }); this.tone(d, t, 0.06, { f: 260, gain: 0.3 }); }
    else { this.noise(d, t, 0.1, { f: 1500, q: 0.8, gain: 0.7 }); this.noise(d, t + 0.02, 0.25, { type: 'lowpass', f: 3000, gain: 0.15 }); }
  }
  brass(pos) {
    if (!this.enabled || Math.random() < 0.4) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.1, gain: 0.25 });
    const f = 4200 + Math.random() * 2000; this.tone(d, t, 0.12, { f, gain: 0.12, curve: 5 }); this.tone(d, t + 0.07, 0.08, { f: f * 1.1, gain: 0.06, curve: 5 });
  }
  footstep(sprint) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.05, gain: sprint ? 0.45 : 0.3 });
    this.noise(d, t, 0.09, { type: 'bandpass', f: 380 + Math.random() * 200, q: 1.2, gain: 0.8 });
    this.noise(d, t + 0.01, 0.06, { type: 'highpass', f: 3500, gain: 0.25 });
  }
  land(v) { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.1, gain: Math.min(v / 8, 1) }); this.noise(d, t, 0.15, { type: 'lowpass', f: 600, gain: 1 }); this.tone(d, t, 0.1, { f: 70, gain: 0.5 }); }
  hurt() { if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.1, gain: 0.6 }); this.noise(d, t, 0.25, { type: 'lowpass', f: 800, f1: 200, gain: 0.8 }); this.tone(d, t, 0.2, { f: 90, f1: 50, gain: 0.6 }); }

  pickup(kind) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.2, gain: 0.5 });
    const notes = kind === 'med' ? [660, 880, 1320] : [520, 780];
    notes.forEach((f, i) => this.tone(d, t + i * 0.07, 0.18, { type: 'triangle', f, gain: 0.18, curve: 4 }));
    this.click(1400, 0.4);
  }
  walkerStep(pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.3, gain: 0.8 });
    this.tone(d, t, 0.18, { f: 70, f1: 42, gain: 0.5, curve: 3 }); this.noise(d, t, 0.08, { type: 'lowpass', f: 900, gain: 0.5 });
    this.tone(d, t + 0.02, 0.12, { type: 'sawtooth', f: 340, f1: 520, gain: 0.04, attack: 0.03 });
  }
  slide() {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.05, gain: 0.6 });
    this.noise(d, t, 0.7, { type: 'bandpass', f: 900, f1: 300, q: 0.8, gain: 0.5, attack: 0.03, curve: 2 });
    this.noise(d, t, 0.5, { type: 'highpass', f: 3000, gain: 0.12, attack: 0.02, curve: 2 });
  }
  vault() {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0.05, gain: 0.6 });
    this.noise(d, t, 0.12, { type: 'bandpass', f: 500, q: 1, gain: 0.6 }); this.click(900, 0.3, 0.05);
  }
  heartbeat() {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(null, { verb: 0, gain: 0.9 });
    this.tone(d, t, 0.12, { f: 62, f1: 40, gain: 0.7, curve: 3 }); this.tone(d, t + 0.17, 0.12, { f: 55, f1: 38, gain: 0.5, curve: 3 });
  }
  grenadeThrow() {
    if (!this.enabled) return; const t = this.ctx.currentTime;
    this.click(3200, 0.5); this.click(1800, 0.35, 0.12); // pin + spoon
    this.noise(this.out(null, { verb: 0.05, gain: 0.5 }), t + 0.18, 0.25, { type: 'bandpass', f: 600, f1: 1800, q: 1.2, gain: 0.6, attack: 0.08, curve: 2 });
  }
  grenadeBounce(pos, k) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.2, gain: 0.3 + k * 0.5 });
    this.tone(d, t, 0.12, { f: 1900 + Math.random() * 800, gain: 0.2, curve: 5 }); this.noise(d, t, 0.05, { f: 2500, q: 2, gain: 0.5 });
  }

  // ------------------------------------------------------------------ drones
  beep(pos, f) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.1, gain: 0.8 });
    this.tone(d, t, 0.06, { type: 'square', f, gain: 0.12, curve: 3 });
  }
  droneHum(obj, heavy, kami) {
    if (!this.enabled) return null;
    const ctx = this.ctx;
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.3;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(heavy ? 0.22 : 0.16, ctx.currentTime, 0.4);
    const base = heavy ? 82 : (kami ? 190 : 118);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = base;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = base * 2.01;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = heavy ? 260 : 420; bp.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.value = 0.9;
    // rotor chop LFO
    const lfo = ctx.createOscillator(); lfo.frequency.value = heavy ? 18 : 27;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(ng.gain);
    o1.connect(lp); o2.connect(lp); n.connect(bp).connect(ng).connect(lp);
    lp.connect(g).connect(p).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.15; p.connect(s).connect(this.verb);
    o1.start(); o2.start(); n.start(); lfo.start();
    return { p, g, oscs: [o1, o2, n, lfo], obj, base };
  }
  updateHum(h, speed) {
    if (!h) return; const t = this.ctx.currentTime; const pos = h.obj.position;
    h.p.positionX.setTargetAtTime(pos.x, t, 0.02); h.p.positionY.setTargetAtTime(pos.y, t, 0.02); h.p.positionZ.setTargetAtTime(pos.z, t, 0.02);
    h.oscs[0].frequency.setTargetAtTime(h.base * (1 + speed * 0.04), t, 0.1);
    h.oscs[1].frequency.setTargetAtTime(h.base * 2.01 * (1 + speed * 0.04), t, 0.1);
  }
  stopHum(h) {
    if (!h) return; const t = this.ctx.currentTime;
    h.g.gain.setTargetAtTime(0, t, 0.05);
    for (const o of h.oscs) o.stop(t + 0.4);
  }
  charge(pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.2, gain: 0.35 });
    this.tone(d, t, 0.45, { type: 'sawtooth', f: 300, f1: 1600, gain: 0.12, attack: 0.3, curve: 2 });
  }
  laser(pos, heavy) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.6, gain: heavy ? 1.0 : 0.8 });
    this.tone(d, t, 0.25, { type: 'sawtooth', f: heavy ? 900 : 1400, f1: 120, gain: 0.35, curve: 3 });
    this.tone(d, t, 0.18, { type: 'square', f: heavy ? 450 : 700, f1: 90, gain: 0.12 });
    this.noise(d, t, 0.15, { f: 2500, q: 1, gain: 0.5 });
  }
  whizz(pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.1, gain: 0.9 });
    this.noise(d, t, 0.25, { type: 'bandpass', f: 3000, f1: 700, q: 4, gain: 0.8, attack: 0.05, curve: 2 });
    this.tone(d, t, 0.25, { type: 'sine', f: 900, f1: 500, gain: 0.15, attack: 0.04 });
  }
  boltImpact(pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 0.5, gain: 0.8 });
    this.noise(d, t, 0.2, { type: 'lowpass', f: 3000, f1: 300, gain: 0.8 }); this.tone(d, t, 0.15, { f: 300, f1: 80, gain: 0.3 });
  }
  explosion(pos) {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(pos, { verb: 1.2, gain: 1.6 });
    this.noise(d, t, 1.6, { type: 'lowpass', f: 3000, f1: 120, q: 0.5, gain: 1.4, curve: 4 });
    this.noise(d, t, 0.08, { type: 'highpass', f: 2000, gain: 1.0 });
    this.tone(d, t, 0.9, { f: 70, f1: 28, gain: 1.4, curve: 3 });
    // debris tinkles
    for (let i = 0; i < 6; i++) this.tone(d, t + 0.4 + Math.random() * 1.2, 0.1, { f: 2500 + Math.random() * 3000, gain: 0.05, curve: 5 });
  }
  waveHorn() {
    if (!this.enabled) return; const t = this.ctx.currentTime; const d = this.out(new THREE.Vector3(30, 20, -300), { verb: 1.5, gain: 6 });
    for (const f of [73, 110, 146.8]) this.tone(d, t, 3.2, { type: 'sawtooth', f, gain: 0.08, attack: 0.25, curve: 1.5 });
  }

  // ------------------------------------------------------------------ ambience
  ambience() {
    const ctx = this.ctx;
    // wind
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.11;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(lp.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13; const lg2 = ctx.createGain(); lg2.gain.value = 0.05;
    lfo2.connect(lg2).connect(g.gain);
    n.connect(lp).connect(g).connect(this.master);
    n.start(); lfo.start(); lfo2.start();
    // water lapping from the quay (positioned)
    const w = ctx.createBufferSource(); w.buffer = this.noiseBuf; w.loop = true; w.playbackRate.value = 0.7;
    const wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 650; wb.Q.value = 0.8;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.35; const wlg = ctx.createGain(); wlg.gain.value = 0.045; wl.connect(wlg).connect(wg.gain);
    const wp = ctx.createPanner(); wp.panningModel = 'HRTF'; wp.refDistance = 6; wp.positionX.value = 0; wp.positionY.value = -1; wp.positionZ.value = -27;
    w.connect(wb).connect(wg).connect(wp).connect(this.master);
    w.start(); wl.start();
    // occasional distant gulls / metal creaks
    const tick = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      if (Math.random() < 0.5) {
        const d = this.out(new THREE.Vector3((Math.random() - 0.5) * 60, 15, -40 - Math.random() * 30), { verb: 0.8, gain: 0.5 });
        for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this.tone(d, t + k * 0.22, 0.2, { type: 'triangle', f: 1500 + Math.random() * 300, f1: 900, gain: 0.05, attack: 0.03, curve: 2 });
      } else {
        const d = this.out(new THREE.Vector3(18, 5, (Math.random() - 0.5) * 30), { verb: 0.9, gain: 0.4 });
        this.tone(d, t, 1.2, { type: 'sawtooth', f: 60 + Math.random() * 30, f1: 45, gain: 0.04, attack: 0.3, curve: 2 });
      }
      setTimeout(tick, 6000 + Math.random() * 9000);
    };
    setTimeout(tick, 4000);
  }
}
