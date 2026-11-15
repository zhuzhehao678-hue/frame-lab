// Rain: GPU-animated streaks wrapped around the camera (no per-frame CPU
// work), ground splashes, lightning with delayed thunder and a rain bed.
import * as THREE from 'three';

const N = 9000;
const BOX = new THREE.Vector3(36, 16, 36);

export class Rain {
  constructor(scene, camera, effects, audio) {
    this.camera = camera; this.effects = effects; this.audio = audio;
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    const off = new Float32Array(N * 3), rnd = new Float32Array(N);
    for (let i = 0; i < N; i++) { off[i * 3] = Math.random() * BOX.x; off[i * 3 + 1] = Math.random() * BOX.y; off[i * 3 + 2] = Math.random() * BOX.z; rnd[i] = Math.random(); }
    g.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('iRnd', new THREE.InstancedBufferAttribute(rnd, 1));
    g.instanceCount = N;
    this.uniforms = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: BOX }, uWind: { value: new THREE.Vector2(1.2, 0.5) }, uColor: { value: new THREE.Color(0.75, 0.8, 0.88) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 iOff; attribute float iRnd;
        uniform vec3 uCam; uniform float uTime; uniform vec3 uBox; uniform vec2 uWind;
        varying float vA; varying vec2 vUv;
        void main(){
          float speed = 11.0 + iRnd * 4.0;
          vec3 vel = vec3(uWind.x, -speed, uWind.y);
          vec3 p = iOff + vel * uTime;
          // wrap into a box centred on the camera
          p.xz = mod(p.xz - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCam.xz;
          p.y = mod(p.y, uBox.y) - 0.4;
          vec3 dir = normalize(vel);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, toCam));
          float len = 0.45 + iRnd * 0.35;
          vec3 wp = p + side * (position.x * 0.022) + dir * (position.y * len);
          vA = smoothstep(0.0, 4.0, distance(p, cameraPosition)) * (1.0 - smoothstep(12.0, 18.0, distance(p, cameraPosition)));
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA; varying vec2 vUv;
        void main(){
          float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          gl_FragColor = vec4(uColor, a * vA * 0.55);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.userData.noAO = true; this.mesh.renderOrder = 12;
    scene.add(this.mesh);
    this.splashT = 0; this.boltT = 8 + Math.random() * 10; this.flash = 0;
    this.thunderQueue = [];
  }

  startAudio() {
    const A = this.audio; if (!A.ctx || this.bed) return;
    const ctx = A.ctx;
    const n = ctx.createBufferSource(); n.buffer = A.noiseBuf; n.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.value = 0.14;
    n.connect(hp).connect(lp).connect(g).connect(A.master); n.start();
    const n2 = ctx.createBufferSource(); n2.buffer = A.noiseBuf; n2.loop = true; n2.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 500;
    const g2 = ctx.createGain(); g2.gain.value = 0.08;
    n2.connect(bp).connect(g2).connect(A.master); n2.start();
    this.bed = [n, n2];
  }

  thunder(delay, power) {
    const A = this.audio; if (!A.enabled) return;
    const t = A.ctx.currentTime + delay;
    const d = A.out(null, { verb: 1.4, gain: 1.2 * power });
    A.noise(d, t, 3.5, { type: 'lowpass', f: 600, f1: 60, q: 0.4, gain: 1.0, attack: 0.08, curve: 3 });
    A.noise(d, t + 0.1, 2.0, { type: 'lowpass', f: 200, f1: 40, gain: 0.8, attack: 0.2, curve: 2 });
    A.tone(d, t, 2.5, { f: 45, f1: 30, gain: 0.6, attack: 0.15, curve: 2 });
  }

  update(dt, t, player) {
    this.uniforms.uCam.value.copy(this.camera.position);
    this.uniforms.uTime.value = t;
    // ground splashes around the player
    this.splashT += dt * 70;
    while (this.splashT > 1) {
      this.splashT -= 1;
      const a = Math.random() * Math.PI * 2, r = 1 + Math.sqrt(Math.random()) * 9;
      const p = new THREE.Vector3(this.camera.position.x + Math.cos(a) * r, 0.02, this.camera.position.z + Math.sin(a) * r);
      this.effects.smoke.emit({ pos: p, vel: new THREE.Vector3(0, 0.6, 0), life: 0.22, size: 0.03, size1: 0.12, color: new THREE.Color(0.5, 0.52, 0.55), alpha: 0.45, alpha1: 0, gravity: 3 });
    }
    // lightning
    this.boltT -= dt;
    if (this.boltT <= 0) {
      this.boltT = 12 + Math.random() * 18;
      this.flash = 1; this.flashSeq = [0.0, 0.09, 0.2];
      const dist = 0.6 + Math.random() * 2.5;
      this.thunder(dist, 1.3 - dist * 0.25);
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const flicker = this.flash > 0 ? (Math.sin(t * 60) > -0.2 ? 1 : 0.3) : 0;
    return this.flash * flicker;
  }
}
