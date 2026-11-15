// First-person viewmodel: a fully modelled carbine with optic, light, gloved
// hands, procedural animation (sway, bob, recoil springs, ADS, sprint, reload).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Squash viewmodel depth into the nearest 6% of the depth range so it never
// clips into world geometry, while still sorting correctly against itself.
// It also uses its own fixed, narrower projection (like AAA viewmodel FOV)
// so the gun doesn't distort at wide FOVs or zoom with ADS.
export const VM = { proj: { value: new THREE.Matrix4() }, fov: 54 };
function viewmodelMaterial(src) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.vmProj = VM.proj;
    sh.vertexShader = 'uniform mat4 vmProj;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n gl_Position = vmProj * mvPosition;\n gl_Position.z = -gl_Position.w + (gl_Position.z + gl_Position.w) * 0.06;');
  };
  m.customProgramCacheKey = () => 'viewmodel';
  return m;
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const RB = (w, h, d, r = 0.004, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.01, h / 2.01, d / 2.01));

function uvScale(geo, s) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  return geo;
}

export class Weapon {
  constructor(camera, lib, effects) {
    this.camera = camera; this.effects = effects;
    const M = lib.M;
    this.mat = {
      metal: viewmodelMaterial(M.gunMetal), tan: viewmodelMaterial(M.gunTan), poly: viewmodelMaterial(M.polymer),
      rubber: viewmodelMaterial(M.rubber), steel: viewmodelMaterial(M.steel), dark: viewmodelMaterial(M.darkSteel),
      glove: viewmodelMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.20, 0.155, 0.10), roughness: 0.82, metalness: 0, normalMap: M.polymer.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) })), sleeve: viewmodelMaterial(M.fabric || M.polymer), knuckle: viewmodelMaterial(M.rubber),
      glass: viewmodelMaterial(new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 2.5 })),
    };
    this.mat.sleeve.color = new THREE.Color(1, 1, 1);
    for (const m of Object.values(this.mat)) { m.envMapIntensity = m.envMapIntensity ?? 1; }

    this.root = new THREE.Group();     // follows camera
    this.pivot = new THREE.Group();    // animation offsets
    this.gun = new THREE.Group();
    this.root.add(this.pivot); this.pivot.add(this.gun);
    camera.add(this.root);

    this.buildGun();
    this.buildHands();
    this.buildFlash();

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });

    // state
    this.magSize = 30; this.ammo = 30; this.reserve = 180;
    this.rate = 60 / 760; this.cool = 0;
    this.reloading = false; this.reloadT = 0; this.reloadDur = 2.3; this.reloadEmpty = false;
    this.ads = 0; this.sprint = 0;
    this.kick = 0; this.kickV = 0; this.kickRot = 0; this.kickRotV = 0; this.kickSide = 0;
    this.swayX = 0; this.swayY = 0; this.swayVX = 0; this.swayVY = 0;
    this.flashT = 1;
    this.shotsFired = 0; this.spreadBloom = 0;
    this.equipT = 0;
    this.throwT = 9;
    this.events = {}; // callbacks: reloadStage
    this.hipPos = new THREE.Vector3(0.135, -0.175, -0.36);
    this.hipRot = new THREE.Euler(0.035, 0.05, -0.06);
    this.adsPos = new THREE.Vector3(0, -this.sightY, -0.165);
    // per-weapon tuning (overridden by subclasses)
    this.kind = 'rifle'; this.label = 'MK-18 CQBR · 5.56'; this.auto = true;
    this.damage = [26, 32]; this.recoilMul = 1; this.reloadTimes = [2.25, 2.75]; this.equipSpeed = 1.6;
    this.climb = 1; this.baseSpread = 0.022;
  }

  add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.gun) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m); return m;
  }

  buildGun() {
    const { metal, tan, poly, rubber, steel, dark, glass } = this.mat;
    const A = (g, m, x, y, z, rx, ry, rz) => this.add(g, m, x, y, z, rx, ry, rz);
    // receivers
    A(uvScale(RB(0.030, 0.042, 0.19, 0.005), 1.5), metal, 0, 0.035, -0.02);
    A(uvScale(RB(0.029, 0.036, 0.165, 0.006), 1.5), metal, 0, -0.002, 0.0);
    A(uvScale(RB(0.031, 0.05, 0.078, 0.006), 1.5), metal, 0, -0.03, -0.062);
    // ejection port + dust cover, forward assist, brass deflector
    A(RB(0.003, 0.017, 0.052, 0.001), dark, 0.0152, 0.036, -0.006);
    A(new THREE.CylinderGeometry(0.0075, 0.0075, 0.03, 16).rotateX(Math.PI / 2), metal, 0.016, 0.044, 0.04);
    A(RB(0.01, 0.022, 0.016, 0.003), metal, 0.017, 0.044, 0.02);
    // selector & bolt catch (left side)
    A(RB(0.004, 0.008, 0.02, 0.0015), steel, -0.016, 0.005, 0.045);
    A(RB(0.004, 0.016, 0.01, 0.0015), steel, -0.016, -0.008, -0.03);
    // magazine release button (right)
    A(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 12).rotateZ(Math.PI / 2), steel, 0.016, -0.01, -0.03);
    // charging handle
    A(RB(0.052, 0.008, 0.02, 0.003), metal, 0, 0.055, 0.074);
    A(RB(0.018, 0.006, 0.05, 0.002), metal, 0, 0.055, 0.05);
    // trigger guard + trigger
    A(RB(0.010, 0.005, 0.064, 0.002), metal, 0, -0.036, 0.006);
    A(RB(0.005, 0.022, 0.006, 0.002), steel, 0, -0.026, 0.008, -0.3);
    // pistol grip
    const grip = A(uvScale(RB(0.028, 0.105, 0.042, 0.009), 2), tan, 0, -0.07, 0.048, 0.33);
    A(RB(0.03, 0.012, 0.046, 0.004), tan, 0, -0.119, 0.064, 0.33);
    // buffer tube + stock
    A(new THREE.CylinderGeometry(0.0155, 0.0155, 0.21, 24).rotateX(Math.PI / 2), metal, 0, 0.03, 0.18);
    A(RB(0.035, 0.012, 0.03, 0.003), metal, 0, 0.012, 0.098); // castle nut / end plate
    A(uvScale(RB(0.042, 0.07, 0.18, 0.012), 2), tan, 0, 0.02, 0.245);
    A(uvScale(RB(0.036, 0.035, 0.13, 0.01), 2), tan, 0, 0.055, 0.25); // cheek riser
    A(RB(0.044, 0.125, 0.024, 0.008), rubber, 0, 0.0, 0.34);
    // handguard (free-float, long)
    const hg = A(uvScale(RB(0.043, 0.047, 0.35, 0.009), 3), metal, 0, 0.031, -0.29);
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
      A(RB(0.003, 0.011, 0.032, 0.0014), dark, s * 0.0207, 0.026, -0.17 - i * 0.048);
    }
    for (let i = 0; i < 6; i++) A(RB(0.012, 0.003, 0.03, 0.0014), dark, 0, 0.0063, -0.17 - i * 0.048);
    // continuous top rail with teeth
    {
      const parts = [];
      const base = RB(0.022, 0.007, 0.53, 0.0015).toNonIndexed(); base.translate(0, 0.0595, -0.185); parts.push(base);
      for (let i = 0; i < 34; i++) {
        const t = new THREE.BoxGeometry(0.0235, 0.0045, 0.0062).toNonIndexed();
        t.translate(0, 0.0645, 0.07 - i * 0.0158); parts.push(t);
      }
      // keep only position/normal/uv
      for (const p of parts) for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k);
      A(mergeGeometries(parts), metal, 0, 0, 0);
    }
    // barrel, gas block area, muzzle brake
    A(new THREE.CylinderGeometry(0.0088, 0.0088, 0.13, 20).rotateX(Math.PI / 2), dark, 0, 0.031, -0.525);
    const brake = A(new THREE.CylinderGeometry(0.0128, 0.0128, 0.062, 24).rotateX(Math.PI / 2), metal, 0, 0.031, -0.615);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) A(RB(0.004, 0.012, 0.008, 0.0015), dark, s * 0.0115, 0.031, -0.597 - i * 0.015);
    A(new THREE.CylinderGeometry(0.009, 0.0128, 0.006, 20).rotateX(Math.PI / 2), dark, 0, 0.031, -0.648);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.031, -0.655); this.gun.add(this.muzzle);
    this.ejectPort = new THREE.Object3D(); this.ejectPort.position.set(0.02, 0.036, -0.006); this.gun.add(this.ejectPort);
    // angled foregrip
    A(uvScale(RB(0.03, 0.03, 0.07, 0.008), 2), poly, 0, 0.003, -0.34, -0.35);
    // weapon light on right rail
    A(RB(0.012, 0.02, 0.03, 0.003), metal, 0.024, 0.04, -0.41);
    A(new THREE.CylinderGeometry(0.0115, 0.0115, 0.085, 20).rotateX(Math.PI / 2), metal, 0.034, 0.04, -0.42);
    A(new THREE.CylinderGeometry(0.014, 0.0115, 0.02, 20).rotateX(Math.PI / 2), metal, 0.034, 0.04, -0.47);
    A(new THREE.CircleGeometry(0.012, 20), glass, 0.034, 0.04, -0.4805);
    // optic (tube red-dot) on riser mount
    this.sightY = 0.1055;
    A(RB(0.027, 0.02, 0.045, 0.003), metal, 0, 0.0755, -0.01);
    A(RB(0.032, 0.008, 0.016, 0.002), metal, 0.004, 0.073, -0.01); // QD lever
    const tube = new THREE.CylinderGeometry(0.0185, 0.0185, 0.1, 32, 1, true).rotateX(Math.PI / 2);
    A(uvScale(tube, 2), metal, 0, this.sightY, -0.01);
    A(new THREE.CylinderGeometry(0.021, 0.021, 0.022, 32, 1, true).rotateX(Math.PI / 2), metal, 0, this.sightY, -0.065);
    A(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 32, 1, true).rotateX(Math.PI / 2), rubber, 0, this.sightY, 0.044);
    // ring faces
    A(new THREE.RingGeometry(0.0165, 0.021, 32), metal, 0, this.sightY, -0.0761, 0, Math.PI);
    A(new THREE.RingGeometry(0.0165, 0.02, 32), rubber, 0, this.sightY, 0.050);
    // turrets
    A(new THREE.CylinderGeometry(0.0085, 0.0085, 0.012, 20), metal, 0, this.sightY + 0.022, -0.012);
    A(new THREE.CylinderGeometry(0.0085, 0.0085, 0.012, 20).rotateZ(Math.PI / 2), metal, 0.022, this.sightY, -0.012);
    // lenses (tinted, reflective)
    A(new THREE.CircleGeometry(0.0168, 32), glass, 0, this.sightY, -0.074, 0, Math.PI);
    A(new THREE.CircleGeometry(0.0168, 32), glass, 0, this.sightY, 0.04);
    // reticle: red dot at the objective, additive
    const dotTex = canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,230,220,1)'); gr.addColorStop(0.18, 'rgba(255,40,20,1)'); gr.addColorStop(0.45, 'rgba(255,0,0,0.25)'); gr.addColorStop(1, 'rgba(255,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    const dotMat = viewmodelMaterial(new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(4, 1, 1), fog: false }));
    this.reticle = A(new THREE.PlaneGeometry(0.0042, 0.0042), dotMat, 0, this.sightY, -0.07);
    this.reticle.renderOrder = 20;

    // magazine (group so it can be animated)
    this.mag = new THREE.Group(); this.mag.position.set(0, -0.055, -0.064); this.gun.add(this.mag);
    this.magHome = this.mag.position.clone();
    for (let i = 0; i < 4; i++) {
      const seg = this.add(uvScale(RB(0.024, 0.055, 0.07, 0.004), 2), tan, 0, -0.026 - i * 0.042, -0.004 - i * i * 0.0055, -0.08 * i, 0, 0, this.mag);
      for (const s of [-1, 1]) this.add(RB(0.002, 0.03, 0.05, 0.001), tan, s * 0.0125, -0.026 - i * 0.042, -0.004 - i * i * 0.0055, -0.08 * i, 0, 0, this.mag);
      seg.userData.magseg = true;
    }
    this.add(RB(0.03, 0.014, 0.08, 0.005), tan, 0, -0.192, -0.055, -0.3, 0, 0, this.mag);
    // top round visible in feed lips (brass)
  }

  // forearm: sleeve cylinder + cuff from `start` heading along `dir` (group space)
  arm(parent, start, dir, len, r0, r1) {
    const { sleeve, knuckle } = this.mat;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    const geo = new THREE.CylinderGeometry(r1, r0, len, 28, 24).translate(0, -len / 2 - 0.02, 0);
    // fabric folds: bunched wrinkles near the cuff, gentle sag along the arm
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x); const t = -y / len;
      const w = 1 + 0.07 * Math.sin(y * 90 + Math.sin(a * 3) * 2) * Math.exp(-t * 3) + 0.03 * Math.sin(a * 5 + y * 30) + 0.02 * Math.sin(a * 9 - y * 55);
      p.setXYZ(i, x * w, y, z * w);
    }
    geo.computeVertexNormals();
    const sl = new THREE.Mesh(geo, sleeve);
    sl.position.copy(start); sl.quaternion.copy(q); parent.add(sl);
    const cf = new THREE.Mesh(new THREE.CylinderGeometry(r1 * 0.88, r1 * 0.95, 0.05, 20).translate(0, -0.01, 0), knuckle);
    cf.position.copy(start); cf.quaternion.copy(q); parent.add(cf);
  }

  buildHands() {
    const { glove, sleeve, knuckle } = this.mat;
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
    // ---- right hand on the pistol grip
    const R = new THREE.Group(); R.position.set(0.0, -0.07, 0.05); R.rotation.set(0.33, 0, 0); this.gun.add(R);
    this.add(uvScale(RB(0.034, 0.075, 0.05, 0.014), 3), glove, 0.022, 0.005, 0.012, 0, 0.05, -0.05, R); // palm/back of hand
    this.add(uvScale(RB(0.012, 0.02, 0.034, 0.005), 3), knuckle, 0.04, 0.012, 0.0, 0, 0.1, 0, R);
    for (let i = 0; i < 4; i++) {
      // fingers wrap around the front strap of the grip
      const y = 0.022 - i * 0.019;
      if (i === 0) {
        // index finger extended along receiver (trigger discipline) -> on trigger
        this.add(cap(0.0082, 0.04), glove, 0.017, 0.058, -0.028, Math.PI / 2 - 0.2, 0, 0.1, R);
        continue;
      }
      this.add(cap(0.0085, 0.024), glove, 0.017, y, -0.028, Math.PI / 2 - 0.1, 0, 0.35, R);
      this.add(cap(0.0082, 0.018), glove, -0.006, y, -0.036, 0, 0, Math.PI / 2, R);
      this.add(cap(0.008, 0.012), glove, -0.019, y, -0.022, Math.PI / 2 + 0.3, 0, 0, R);
    }
    // thumb over left side
    this.add(cap(0.0095, 0.03), glove, -0.02, 0.05, 0.0, 0.4, 0, 0.3, R);
    // wrist and forearm (goes back and down out of frame)
    this.add(cap(0.022, 0.03), glove, 0.026, -0.035, 0.035, -1.0, 0, -0.3, R);
    this.arm(R, new THREE.Vector3(0.03, -0.045, 0.05), new THREE.Vector3(0.55, -0.35, 1.0), 0.32, 0.034, 0.045);

    // ---- left hand on the handguard / foregrip
    const L = new THREE.Group(); L.position.set(0, 0.01, -0.33); this.gun.add(L);
    this.leftHand = L; this.leftHome = L.position.clone();
    this.add(uvScale(RB(0.06, 0.03, 0.075, 0.013), 3), glove, -0.012, -0.012, 0.0, 0, 0, 0.5, L); // palm under/left of guard
    this.add(uvScale(RB(0.014, 0.022, 0.05, 0.006), 3), knuckle, -0.036, 0.0, 0.0, 0, 0, 0.6, L);
    for (let i = 0; i < 4; i++) {
      const z = -0.026 + i * 0.019;
      this.add(cap(0.0088, 0.032), glove, 0.018, 0.0, z, 0, 0, -0.35, L);
      this.add(cap(0.0082, 0.018), glove, 0.029, 0.022, z, 0, 0, 0.25, L);
    }
    this.add(cap(0.0098, 0.036), glove, -0.028, 0.035, -0.015, -0.8, 0, -0.35, L); // thumb over the top
    this.add(cap(0.023, 0.03), glove, -0.035, -0.032, 0.03, -1.0, 0, 0.6, L);
    this.arm(L, new THREE.Vector3(-0.042, -0.04, 0.045), new THREE.Vector3(-0.5, -0.55, 1.0), 0.4, 0.033, 0.046);
  }

  buildFlash() {
    const star = canvasTex(256, (g, s) => {
      g.translate(s / 2, s / 2);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.12, 'rgba(255,210,120,0.95)'); gr.addColorStop(0.4, 'rgba(255,120,30,0.35)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
      g.fillStyle = gr; g.beginPath();
      const N = 7;
      for (let i = 0; i < N * 2; i++) {
        const a = i / (N * 2) * Math.PI * 2; const r = (i % 2 ? 0.16 : 0.5) * s * (0.7 + Math.random() * 0.3);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath(); g.fill();
    });
    const side = canvasTex(256, (g, s) => {
      const gr = g.createLinearGradient(0, s / 2, s, s / 2);
      gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.3, 'rgba(255,190,90,0.8)'); gr.addColorStop(1, 'rgba(255,90,10,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, s * 0.42); g.quadraticCurveTo(s * 0.5, s * 0.15, s, s * 0.5); g.quadraticCurveTo(s * 0.5, s * 0.85, 0, s * 0.58); g.fill();
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(s * 0.1, s * 0.5); g.lineTo(s * (0.5 + Math.random() * 0.4), s * (0.3 + i * 0.2)); g.lineTo(s * 0.15, s * 0.52); g.fill(); }
    });
    const fm = (t) => viewmodelMaterial(new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3.2, 2.6, 2.0), side: THREE.DoubleSide, fog: false }));
    this.flash = new THREE.Group(); this.muzzle.add(this.flash);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), fm(star)); this.flash.add(front);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.08).translate(-0.1, 0, 0), fm(side)); s1.rotation.set(0, Math.PI / 2, 0); this.flash.add(s1);
    const s2 = s1.clone(); s2.rotation.set(Math.PI / 2, Math.PI / 2, 0, 'YXZ'); this.flash.add(s2);
    this.flash.children.forEach((c) => { c.renderOrder = 21; c.userData.noAO = true; });
    this.flash.visible = false;
  }

  canFire() { return this.throwT > 0.6 && !this.reloading && this.ammo > 0 && this.cool <= 0 && this.sprint < 0.35 && this.equipT >= 1; }

  startReload() {
    if (this.reloading || this.ammo >= this.magSize || this.reserve <= 0) return false;
    this.reloading = true; this.reloadT = 0;
    this.reloadEmpty = this.ammo === 0;
    this.reloadDur = this.reloadEmpty ? this.reloadTimes[1] : this.reloadTimes[0];
    this.stage = 0;
    return true;
  }

  // called when the trigger is pulled and canFire(); returns muzzle world pos
  fire() {
    this.ammo--; this.cool = this.rate; this.shotsFired++;
    const adsK = 1 - this.ads * 0.55;
    this.kickV += 0.9 * adsK * this.recoilMul; this.kickRotV += 7.5 * adsK * this.recoilMul; this.kickSide = (Math.random() - 0.5) * 0.6;
    this.flashT = 0;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    const s = 0.8 + Math.random() * 0.5; this.flash.scale.setScalar(s * (this.ads > 0.5 ? 0.4 : 1));
    this.spreadBloom = Math.min(this.spreadBloom + 0.35, 1.6);
    const mp = new THREE.Vector3(); this.muzzle.getWorldPosition(mp);
    return mp;
  }

  ejectBrass() {
    const p = new THREE.Vector3(); this.ejectPort.getWorldPosition(p);
    const q = new THREE.Quaternion(); this.ejectPort.getWorldQuaternion(q);
    const right = new THREE.Vector3(1, 0.6, 0.25).applyQuaternion(q).normalize();
    const v = right.multiplyScalar(2.6 + Math.random() * 1.2);
    this.effects.ejectBrass(p, v, q);
  }

  // spread in radians given player movement
  spread(player) {
    const move = Math.min(player.speed / 4.4, 1.5);
    const base = THREE.MathUtils.lerp(this.baseSpread, 0.0015, this.ads);
    return base + move * THREE.MathUtils.lerp(0.02, 0.004, this.ads) + (player.onGround ? 0 : 0.05) + this.spreadBloom * THREE.MathUtils.lerp(0.012, 0.004, this.ads) - player.crouch * 0.004;
  }

  update(dt, t, player, input, mouse) {
    this.cool -= dt;
    this.equipT = Math.min(1, this.equipT + dt * this.equipSpeed);
    this.spreadBloom = THREE.MathUtils.damp(this.spreadBloom, 0, input.firing ? 2 : 6, dt);
    const wantAds = input.ads && !this.reloading && !player.sprinting;
    this.ads = THREE.MathUtils.damp(this.ads, wantAds ? 1 : 0, 13, dt);
    player.ads = this.ads;
    this.sprint = THREE.MathUtils.damp(this.sprint, player.sprinting ? 1 : 0, 8, dt);

    // recoil springs (critically-damped-ish)
    const k = 260, c = 22;
    this.kickV += (-k * this.kick - c * this.kickV) * dt; this.kick += this.kickV * dt;
    this.kickRotV += (-k * this.kickRot - c * this.kickRotV) * dt; this.kickRot += this.kickRotV * dt;

    // sway from mouse (lags behind look)
    const sk = 120, sc = 14;
    const tx = THREE.MathUtils.clamp(-mouse.x * 0.00055, -0.06, 0.06) * (1 - this.ads * 0.75);
    const ty = THREE.MathUtils.clamp(mouse.y * 0.00055, -0.06, 0.06) * (1 - this.ads * 0.75);
    this.swayVX += (sk * (tx - this.swayX) - sc * this.swayVX) * dt; this.swayX += this.swayVX * dt;
    this.swayVY += (sk * (ty - this.swayY) - sc * this.swayVY) * dt; this.swayY += this.swayVY * dt;

    // base pose
    const pos = this.hipPos.clone().lerp(this.adsPos, this.ads);
    const hr = 1 - this.ads;
    const rot = new THREE.Euler(this.hipRot.x * hr, this.hipRot.y * hr, this.hipRot.z * hr);
    // idle breathing
    const breathe = (1 - this.ads * 0.85);
    pos.y += Math.sin(t * 1.6) * 0.0018 * breathe;
    pos.x += Math.sin(t * 0.8) * 0.0012 * breathe;
    rot.z += Math.sin(t * 1.1) * 0.004 * breathe;
    // movement bob (figure-8)
    const ph = player.bobPhase, amp = player.bobAmp * (1 - this.ads * 0.85);
    pos.x += Math.cos(ph) * 0.009 * amp;
    pos.y += -Math.abs(Math.sin(ph)) * 0.011 * amp;
    rot.z += Math.cos(ph) * 0.012 * amp;
    rot.x += Math.abs(Math.sin(ph)) * 0.01 * amp;
    // landing & vertical velocity
    pos.y -= player.landKick * 0.35;
    pos.y += THREE.MathUtils.clamp(-player.vel.y * 0.002, -0.02, 0.02);
    // crouch tilt
    rot.z += player.crouch * 0.05 * (1 - this.ads);
    // sprint pose (tactical lower)
    const sp = this.sprint;
    pos.add(new THREE.Vector3(-0.03, -0.045, 0.03).multiplyScalar(sp));
    rot.x += -0.28 * sp; rot.y += 0.55 * sp; rot.z += 0.3 * sp;
    pos.x += Math.cos(ph) * 0.02 * sp; pos.y += Math.sin(ph * 2) * 0.008 * sp;
    // sway
    rot.y += this.swayX; rot.x += this.swayY; rot.z += this.swayX * 0.8;
    pos.x += this.swayX * 0.04; pos.y += this.swayY * 0.03;
    // recoil
    pos.z += this.kick * 0.03; pos.y += this.kick * 0.004 * (1 - this.ads * 0.6);
    rot.x += this.kickRot * 0.006; rot.z += this.kickSide * this.kickRot * 0.004;
    // equip raise
    const e = 1 - this.equipT; pos.y -= e * e * 0.25; rot.x -= e * e * 0.8;

    // grenade throw: gun dips down-left while the off hand throws
    this.throwT += dt;
    if (this.throwT < 0.75) {
      const k = Math.sin(Math.min(this.throwT / 0.75, 1) * Math.PI);
      pos.y -= 0.16 * k; pos.x -= 0.03 * k; rot.x -= 0.5 * k; rot.z += 0.35 * k;
    }
    // reload animation
    this.mag.visible = true;
    if (this.reloading) {
      this.reloadT += dt;
      const u = this.reloadT / this.reloadDur;
      const tilt = THREE.MathUtils.smoothstep(u, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(u, 0.82, 1.0));
      rot.z += 0.55 * tilt; rot.x += 0.18 * tilt; pos.y -= 0.025 * tilt; pos.x -= 0.02 * tilt;
      const magPos = this.magHome.clone();
      const L = this.leftHome.clone();
      if (u < 0.14) { /* gripping */ }
      else if (u < 0.30) { const a = (u - 0.14) / 0.16; magPos.y -= a * a * 0.4; magPos.z += a * 0.04; if (this.stage === 0) { this.stage = 1; this.emit('magout'); } }
      else if (u < 0.52) { const a = (u - 0.30) / 0.22; magPos.y -= THREE.MathUtils.lerp(0.35, 0.05, THREE.MathUtils.smoothstep(a, 0, 1)); magPos.x += (1 - a) * -0.05; if (this.stage === 1) { this.stage = 2; } }
      else if (u < 0.62) { const a = (u - 0.52) / 0.10; magPos.y -= 0.05 * (1 - a); if (a > 0.8 && this.stage === 2) { this.stage = 3; this.emit('magin'); this.kickV += 0.6; } }
      else if (this.reloadEmpty && u < 0.8) { if (u > 0.7 && this.stage === 3) { this.stage = 4; this.emit('bolt'); this.kickV += 0.8; this.kickRotV -= 4; } }
      // left hand follows the magazine during the swap
      const handK = THREE.MathUtils.smoothstep(u, 0.1, 0.18) * (1 - THREE.MathUtils.smoothstep(u, 0.62, 0.74));
      L.lerp(magPos.clone().add(new THREE.Vector3(-0.01, -0.09, 0.0)), handK);
      this.leftHand.position.copy(L);
      this.leftHand.rotation.set(handK * 0.6, 0, handK * -0.9);
      this.mag.position.copy(magPos);
      if (u >= 1) {
        this.reloading = false;
        const need = this.magSize - this.ammo + (this.reloadEmpty ? 0 : 1); // +1 in the chamber
        const take = Math.min(need, this.reserve);
        this.ammo += take; this.reserve -= take;
        this.mag.position.copy(this.magHome);
        this.leftHand.position.copy(this.leftHome); this.leftHand.rotation.set(0, 0, 0);
      }
    }

    this.pivot.position.copy(pos);
    this.pivot.rotation.copy(rot);

    // muzzle flash timing
    this.flashT += dt;
    this.flash.visible = this.flashT < 0.035;

    // FOV
    const baseFov = this.baseFov || 74;
    this.camera.fov = THREE.MathUtils.lerp(baseFov, baseFov * 0.72, this.ads) + this.sprint * 4;
    this.camera.updateProjectionMatrix();
    const vfov = THREE.MathUtils.lerp(VM.fov, VM.fov * 0.86, this.ads);
    const top = 0.01 * Math.tan(THREE.MathUtils.degToRad(vfov / 2)), h = 2 * top, w = h * this.camera.aspect;
    VM.proj.value.makePerspective(-w / 2, w / 2, top, -top, 0.01, 50);
    this.reticle.visible = this.ads > 0.6;
  }

  emit(name) { const f = this.events[name]; if (f) f(); }
}

// ---------------------------------------------------------------------------
// Sidearm: polymer-frame 9 mm with iron sights, two-handed grip, slide that
// cycles on every shot and locks back on empty.
export class Pistol extends Weapon {
  constructor(camera, lib, effects) {
    super(camera, lib, effects);
    this.kind = 'pistol'; this.label = 'P-17 · 9mm'; this.auto = false;
    this.magSize = 15; this.ammo = 15; this.reserve = 60;
    this.rate = 0.11; this.damage = [38, 44]; this.recoilMul = 1.35;
    this.reloadTimes = [1.45, 1.8]; this.equipSpeed = 2.8; this.climb = 1.5; this.baseSpread = 0.016;
    this.hipPos = new THREE.Vector3(0.12, -0.14, -0.4);
    this.hipRot = new THREE.Euler(0.03, 0.08, -0.03);
    this.adsPos = new THREE.Vector3(0, -this.sightY, -0.42);
    this.slideOff = 0;
  }

  buildGun() {
    const { metal, poly, steel, dark } = this.mat;
    const A = (g, m, x, y, z, rx, ry, rz, p) => this.add(g, m, x, y, z, rx, ry, rz, p);
    this.slide = new THREE.Group(); this.gun.add(this.slide);
    const S = this.slide;
    A(uvScale(RB(0.026, 0.028, 0.186, 0.004), 1.5), metal, 0, 0.031, -0.063, 0, 0, 0, S);
    for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) A(RB(0.0015, 0.02, 0.0028, 0.0006), dark, sx * 0.0132, 0.031, 0.022 - i * 0.0065, 0, 0, 0, S);
    A(RB(0.013, 0.0025, 0.032, 0.001), dark, 0.004, 0.0447, -0.03, 0, 0, 0, S); // ejection port
    // sights (white dots)
    const dotM = viewmodelMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5) }));
    A(RB(0.0042, 0.0065, 0.006, 0.001), steel, 0, 0.048, -0.149, 0, 0, 0, S);
    A(new THREE.CircleGeometry(0.0011, 10), dotM, 0, 0.0495, -0.1459, 0, 0, 0, S);
    for (const sx of [-1, 1]) {
      A(RB(0.0055, 0.0065, 0.008, 0.001), steel, sx * 0.0058, 0.048, 0.021, 0, 0, 0, S);
      A(new THREE.CircleGeometry(0.0009, 10), dotM, sx * 0.0058, 0.0495, 0.0251, 0, 0, 0, S);
    }
    A(new THREE.CylinderGeometry(0.0062, 0.0062, 0.012, 16).rotateX(Math.PI / 2), dark, 0, 0.033, -0.152, 0, 0, 0, S); // barrel crown
    // frame, rail, trigger
    A(uvScale(RB(0.024, 0.018, 0.172, 0.004), 2), poly, 0, 0.0095, -0.057);
    A(RB(0.02, 0.008, 0.05, 0.002), poly, 0, -0.002, -0.115);
    A(RB(0.008, 0.004, 0.052, 0.0015), poly, 0, -0.019, -0.03);
    A(RB(0.004, 0.016, 0.005, 0.0015), steel, 0, -0.008, -0.02, -0.25);
    // grip with texture panel + beavertail
    A(uvScale(RB(0.029, 0.108, 0.048, 0.009), 3), poly, 0, -0.048, 0.024, -0.28);
    A(RB(0.026, 0.01, 0.03, 0.004), poly, 0, 0.01, 0.034);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.033, -0.162); this.gun.add(this.muzzle);
    this.ejectPort = new THREE.Object3D(); this.ejectPort.position.set(0.014, 0.044, -0.03); this.gun.add(this.ejectPort);
    this.sightY = 0.0512;
    this.reticle = new THREE.Object3D();
    // magazine slides out of the grip
    this.mag = new THREE.Group(); this.mag.position.set(0, -0.002, 0.012); this.mag.rotation.x = -0.28; this.gun.add(this.mag);
    this.magHome = this.mag.position.clone();
    A(RB(0.021, 0.1, 0.032, 0.003), dark, 0, -0.05, 0.004, 0, 0, 0, this.mag);
    A(RB(0.03, 0.011, 0.05, 0.004), poly, 0, -0.104, 0.006, 0, 0, 0, this.mag);
  }

  buildHands() {
    const { glove, knuckle } = this.mat;
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
    // right hand wraps the grip
    const R = new THREE.Group(); R.position.set(0, -0.05, 0.03); R.rotation.set(-0.28, 0, 0); this.gun.add(R);
    this.add(uvScale(RB(0.03, 0.062, 0.044, 0.012), 3), glove, 0.018, -0.008, 0.014, 0, 0.1, -0.05, R);
    for (let i = 0; i < 3; i++) {
      const y = -0.004 - i * 0.02;
      this.add(cap(0.0085, 0.024), glove, 0.014, y, -0.03, Math.PI / 2 - 0.1, 0, 0.35, R);
      this.add(cap(0.0082, 0.02), glove, -0.008, y, -0.036, 0, 0, Math.PI / 2, R);
    }
    this.add(cap(0.0082, 0.04), glove, 0.016, 0.04, -0.045, Math.PI / 2 - 0.05, 0, 0.1, R); // index along frame
    this.add(cap(0.0095, 0.03), glove, -0.012, 0.03, -0.035, Math.PI / 2 - 0.2, 0.2, 0, R); // thumb forward
    this.arm(R, new THREE.Vector3(0.03, -0.05, 0.04), new THREE.Vector3(0.45, -0.3, 1.0), 0.34, 0.034, 0.045);
    // left hand cups the right (support grip)
    const L = new THREE.Group(); L.position.set(-0.016, -0.05, 0.01); L.rotation.set(-0.28, 0, 0); this.gun.add(L);
    this.leftHand = L; this.leftHome = L.position.clone();
    this.add(uvScale(RB(0.024, 0.064, 0.048, 0.011), 3), glove, -0.012, -0.008, 0.0, 0, -0.2, 0.05, L);
    this.add(uvScale(RB(0.012, 0.03, 0.04, 0.006), 3), knuckle, -0.028, 0.0, 0.0, 0, -0.2, 0, L);
    for (let i = 0; i < 3; i++) this.add(cap(0.0085, 0.022), glove, 0.008, -0.012 - i * 0.02, -0.04, 0, 0, Math.PI / 2, L);
    this.add(cap(0.0095, 0.03), glove, -0.004, 0.028, -0.04, Math.PI / 2 - 0.25, -0.15, 0, L);
    this.arm(L, new THREE.Vector3(-0.03, -0.045, 0.03), new THREE.Vector3(-0.5, -0.35, 1.0), 0.36, 0.033, 0.045);
  }

  fire() { this.slideOff = 1; this.slideHold = 0.035; const p = super.fire(); this.flash.scale.multiplyScalar(0.55); return p; }

  update(dt, t, player, input, mouse) {
    super.update(dt, t, player, input, mouse);
    // slide: snaps back, returns on a fast spring, locks open when empty
    if (this.slideHold > 0) this.slideHold -= dt;
    else if (!(this.ammo === 0 && !this.reloading) || this.reloadT / this.reloadDur > 0.75) this.slideOff = Math.max(0, this.slideOff - dt * 22);
    this.slide.position.z = this.slideOff * 0.034;
  }
}
