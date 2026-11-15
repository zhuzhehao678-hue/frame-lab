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
    // barrel steel that glows as it heats up (emissive driven by setHeat)
    this.mat.hot = viewmodelMaterial(M.darkSteel); this.mat.hot.emissive = new THREE.Color(0, 0, 0);
    for (const m of Object.values(this.mat)) { m.envMapIntensity = m.envMapIntensity ?? 1; }

    this.root = new THREE.Group();     // follows camera
    this.pivot = new THREE.Group();    // animation offsets
    this.gun = new THREE.Group();
    this.root.add(this.pivot); this.pivot.add(this.gun);
    camera.add(this.root);

    this.buildGun();
    this.buildHands();
    this.buildFlash();

    this.mergeStatic();
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
    this.meleeT = 9;
    this.inspectT = 9;
    this.events = {}; // callbacks: reloadStage
    this.hipPos = new THREE.Vector3(0.135, -0.175, -0.36);
    this.hipRot = new THREE.Euler(0.035, 0.05, -0.06);
    this.adsPos = new THREE.Vector3(0, -this.sightY, -0.165);
    // per-weapon tuning (overridden by subclasses)
    this.kind = 'rifle'; this.label = 'MK-18 CQBR · 5.56'; this.auto = true;
    this.damage = [26, 32]; this.recoilMul = 1; this.reloadTimes = [2.25, 2.75]; this.equipSpeed = 1.6;
    this.climb = 1; this.baseSpread = 0.022;
    if (this.optics) this.setOptic('reddot');
  }

  // collapse the gun's static parts (direct children of this.gun) into one
  // mesh per material: ~100 draw calls -> ~10 per weapon
  mergeStatic() {
    const groups = new Map();
    for (const c of this.gun.children.slice()) {
      if (!c.isMesh || c === this.reticle || c === this.scopeLens || !c.geometry.attributes.normal) continue;
      c.updateMatrix();
      const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(c.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) continue;
      if (!groups.has(c.material)) groups.set(c.material, []);
      groups.get(c.material).push(g);
      this.gun.remove(c);
    }
    for (const [mat, list] of groups) {
      const merged = new THREE.Mesh(mergeGeometries(list, false), mat);
      this.gun.add(merged);
    }
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
    A(new THREE.CylinderGeometry(0.0088, 0.0088, 0.13, 20).rotateX(Math.PI / 2), this.mat.hot, 0, 0.031, -0.525);
    const brake = A(new THREE.CylinderGeometry(0.0128, 0.0128, 0.062, 24).rotateX(Math.PI / 2), this.mat.hot, 0, 0.031, -0.615);
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
    // optic riser mount (shared by all optics)
    this.sightY = 0.1055;
    A(RB(0.027, 0.02, 0.045, 0.003), metal, 0, 0.0755, -0.01);
    A(RB(0.032, 0.008, 0.016, 0.002), metal, 0.004, 0.073, -0.01); // QD lever
    // optic 1: tube red-dot
    const nOptic0 = this.gun.children.length;
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
    // gather the red dot parts into a swappable group
    this.optics = {};
    const grab = (n0) => { const g = new THREE.Group(); for (const c of this.gun.children.slice(n0)) { this.gun.remove(c); g.add(c); } this.gun.add(g); return g; };
    this.optics.reddot = { group: grab(nOptic0), reticle: this.reticle, sightY: 0.1055, zoom: 0.72, sens: 1, label: '红点' };
    this.buildHolo(); this.buildPrism();
    // suppressor (muzzle attachment), slid over the brake
    {
      const n0 = this.gun.children.length;
      const A2 = (g, m, x, y, z) => this.add(g, m, x, y, z);
      A2(uvScale(new THREE.CylinderGeometry(0.019, 0.019, 0.17, 28).rotateX(Math.PI / 2), 2), metal, 0, 0.031, -0.69);
      A2(new THREE.CylinderGeometry(0.0195, 0.0195, 0.02, 28).rotateX(Math.PI / 2), dark, 0, 0.031, -0.612);
      A2(new THREE.CylinderGeometry(0.0195, 0.0195, 0.012, 28).rotateX(Math.PI / 2), dark, 0, 0.031, -0.77);
      A2(new THREE.CircleGeometry(0.019, 28).rotateY(Math.PI), dark, 0, 0.031, -0.776);
      this.suppressor = new THREE.Group(); for (const c of this.gun.children.slice(n0)) { this.gun.remove(c); this.suppressor.add(c); } this.gun.add(this.suppressor);
      this.suppressor.visible = false;
    }

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

  // Articulated glove. Canonical frame: palm centre at origin, palm faces -x,
  // fingers point -z, finger stack along y (index at +y). curls = per-finger
  // total bend (radians); thumb = [yaw, bend].
  makeHand(curls, thumb, { spread = 0.0, indexStraight = false } = {}) {
    const { glove, knuckle } = this.mat;
    const H = new THREE.Group();
    const seg = (r, l) => new THREE.CapsuleGeometry(r, l, 5, 10).rotateX(Math.PI / 2).translate(0, 0, -l / 2 - r * 0.4);
    // palm: slightly tapered block + thenar pad
    const palm = new THREE.Mesh(uvScale(RB(0.028, 0.082, 0.09, 0.012), 3), glove); H.add(palm);
    const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10).scale(0.8, 1.0, 1.5), glove); thenar.position.set(-0.008, -0.03, 0.012); H.add(thenar);
    // back-of-hand armour + knuckle ridge
    const plate = new THREE.Mesh(uvScale(RB(0.008, 0.07, 0.05, 0.004), 3), knuckle); plate.position.set(0.016, 0.0, -0.012); H.add(plate);
    const ridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.06, 4, 8), knuckle); ridge.position.set(0.013, 0, -0.044); H.add(ridge);
    // cuff strap
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.03, 18).rotateX(Math.PI / 2).scale(0.75, 1.15, 1), knuckle); cuff.position.set(0.002, -0.004, 0.058); H.add(cuff);
    const lens = [[0.042, 0.027, 0.021], [0.046, 0.03, 0.022], [0.043, 0.028, 0.021], [0.034, 0.022, 0.018]];
    const radii = [0.0092, 0.0095, 0.009, 0.0082];
    [0.03, 0.0105, -0.009, -0.028].forEach((y, i) => {
      let parent = new THREE.Group(); parent.position.set(0.002, y, -0.044); parent.rotation.x = (i - 1.5) * spread; H.add(parent);
      const curl = (i === 0 && indexStraight) ? 0.25 : curls[i];
      for (let k = 0; k < 3; k++) {
        const j = new THREE.Group();
        j.rotation.y = curl * [0.42, 0.33, 0.25][k]; // positive yaw swings -z toward -x: bend toward the palm
        parent.add(j);
        const r = radii[i] * (1 - k * 0.08);
        const m = new THREE.Mesh(seg(r, lens[i][k]), glove); j.add(m);
        const next = new THREE.Group(); next.position.z = -lens[i][k] - r * 0.5; j.add(next);
        parent = next;
      }
    });
    // thumb: rooted at the heel of the palm, opposes the fingers
    let tp = new THREE.Group(); tp.position.set(-0.014, -0.03, 0.01); tp.rotation.set(0.5, thumb[0], -0.6); H.add(tp);
    for (let k = 0; k < 2; k++) {
      const j = new THREE.Group(); j.rotation.y = thumb[1] * 0.5; tp.add(j);
      j.add(new THREE.Mesh(seg(0.0105 - k * 0.001, k ? 0.026 : 0.032), glove));
      const next = new THREE.Group(); next.position.z = -(k ? 0.026 : 0.032) - 0.005; j.add(next); tp = next;
    }
    H.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
    return H;
  }

  // optic 2: holographic sight — open window, 65 MOA ring + centre dot
  buildHolo() {
    const { metal, dark, glass, rubber } = this.mat;
    const n0 = this.gun.children.length;
    const A = (g, m, x, y, z, rx, ry, rz) => this.add(g, m, x, y, z, rx, ry, rz);
    const Y = 0.104;
    A(RB(0.034, 0.012, 0.085, 0.003), metal, 0, 0.0905, -0.012);              // base
    A(RB(0.034, 0.012, 0.03, 0.004), dark, 0, 0.0905, 0.042);                 // battery / buttons
    A(RB(0.004, 0.034, 0.07, 0.0015), metal, 0.0175, Y + 0.004, -0.02);        // side walls
    A(RB(0.004, 0.034, 0.07, 0.0015), metal, -0.0175, Y + 0.004, -0.02);
    A(RB(0.039, 0.004, 0.072, 0.0015), metal, 0, Y + 0.022, -0.02);            // hood
    A(RB(0.008, 0.006, 0.01, 0.001), rubber, 0.012, 0.099, 0.05);              // buttons
    A(RB(0.008, 0.006, 0.01, 0.001), rubber, -0.004, 0.099, 0.05);
    A(new THREE.PlaneGeometry(0.031, 0.024), glass, 0, Y + 0.006, -0.05);       // windows
    A(new THREE.PlaneGeometry(0.031, 0.024), glass, 0, Y + 0.006, 0.008);
    const tex = canvasTex(128, (g, s) => {
      g.strokeStyle = 'rgba(255,60,40,1)'; g.lineWidth = s * 0.03; g.shadowColor = 'rgba(255,0,0,1)'; g.shadowBlur = s * 0.03;
      g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,220,210,1)'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.035, 0, Math.PI * 2); g.fill();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4); g.lineTo(s / 2 + Math.cos(a) * s * 0.46, s / 2 + Math.sin(a) * s * 0.46); g.stroke(); }
    });
    const m = viewmodelMaterial(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3.5, 1, 0.9), fog: false }));
    const ret = A(new THREE.PlaneGeometry(0.016, 0.016), m, 0, Y + 0.006, -0.048); ret.renderOrder = 20;
    const g = new THREE.Group(); for (const c of this.gun.children.slice(n0)) { this.gun.remove(c); g.add(c); } this.gun.add(g);
    this.optics.holo = { group: g, reticle: ret, sightY: Y + 0.006, zoom: 0.72, sens: 1, label: '全息' };
  }

  // optic 3: compact 2x prism — magnifies by narrowing the main view;
  // the housing and eyepiece frame the image like a real low-power optic
  buildPrism() {
    const { metal, dark, glass, rubber } = this.mat;
    const n0 = this.gun.children.length;
    const A = (g, m, x, y, z, rx, ry, rz) => this.add(g, m, x, y, z, rx, ry, rz);
    const Y = 0.1075;
    // prism housing: hollow along the sight line so the eye sees through it
    A(RB(0.031, 0.008, 0.075, 0.003), metal, 0, Y - 0.0185, -0.01);
    A(RB(0.031, 0.005, 0.075, 0.002), metal, 0, Y + 0.0175, -0.01);
    A(RB(0.004, 0.032, 0.075, 0.0015), metal, 0.0165, Y, -0.01);
    A(RB(0.004, 0.032, 0.075, 0.0015), metal, -0.0165, Y, -0.01);
    A(new THREE.CylinderGeometry(0.019, 0.017, 0.035, 32, 1, true).rotateX(Math.PI / 2), metal, 0, Y, -0.064); // objective bell
    A(new THREE.CylinderGeometry(0.017, 0.016, 0.03, 32, 1, true).rotateX(Math.PI / 2), dark, 0, Y, 0.042);     // eyepiece
    A(new THREE.CylinderGeometry(0.0175, 0.0175, 0.008, 32, 1, true).rotateX(Math.PI / 2), rubber, 0, Y, 0.059);
    A(new THREE.RingGeometry(0.0155, 0.019, 32), metal, 0, Y, -0.0815, 0, Math.PI);
    A(new THREE.RingGeometry(0.0145, 0.0176, 32), rubber, 0, Y, 0.063);
    A(RB(0.014, 0.012, 0.016, 0.003), metal, 0, Y + 0.022, -0.01);                // elevation turret
    A(RB(0.012, 0.014, 0.016, 0.003), metal, 0.019, Y - 0.004, -0.01);           // windage turret
    A(new THREE.CylinderGeometry(0.0035, 0.0035, 0.03, 10).rotateX(Math.PI / 2), dark, 0, Y + 0.022, -0.045); // fibre-optic tube
    A(new THREE.CircleGeometry(0.0158, 32), glass, 0, Y, -0.08, 0, Math.PI);
    A(new THREE.CircleGeometry(0.0145, 32), glass, 0, Y, 0.056);
    const tex = canvasTex(128, (g, s) => {
      g.strokeStyle = 'rgba(255,70,30,1)'; g.fillStyle = 'rgba(255,70,30,1)'; g.lineWidth = s * 0.028; g.shadowColor = 'rgba(255,0,0,1)'; g.shadowBlur = s * 0.02;
      g.beginPath(); g.moveTo(s * 0.4, s * 0.58); g.lineTo(s * 0.5, s * 0.5); g.lineTo(s * 0.6, s * 0.58); g.stroke();   // chevron
      g.fillRect(s * 0.493, s * 0.5, s * 0.014, s * 0.28);                                                        // post
      for (let i = 1; i <= 3; i++) g.fillRect(s * (0.5 - 0.05 / i), s * (0.6 + i * 0.06), s * 0.1 / i, s * 0.01); // drop marks
    });
    const m = viewmodelMaterial(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3, 1, 0.8), fog: false }));
    const ret = A(new THREE.PlaneGeometry(0.02, 0.02), m, 0, Y, -0.075); ret.renderOrder = 20;
    const g = new THREE.Group(); for (const c of this.gun.children.slice(n0)) { this.gun.remove(c); g.add(c); } this.gun.add(g);
    this.optics.x2 = { group: g, reticle: ret, sightY: Y, zoom: 0.5, sens: 0.6, label: '2 倍镜' };
  }

  // heat: shots fired recently. Steel starts to glow dull red ~12, orange by ~28
  setHeat(heat) {
    const k = THREE.MathUtils.clamp((heat - 12) / 16, 0, 1);
    this.mat.hot.emissive.setRGB(1, 0.18 + 0.32 * k, 0.03 + 0.1 * k * k);
    this.mat.hot.emissiveIntensity = k * k * 2.2;
  }

  // receiver / furniture finish; the tan texture carries the cerakote grain
  setFinish(name, lib) {
    const { metal, tan, poly } = this.mat;
    if (!this._fin) this._fin = { mMap: metal.map, mCol: metal.color.clone(), pCol: poly.color.clone(), tCol: tan.color.clone() };
    const f = this._fin, T = lib.M.gunTan.map;
    const tint = { fde: [1.0, 1.0, 1.0], olive: [0.62, 0.7, 0.45], grey: [0.62, 0.64, 0.68] }[name];
    if (!tint) { metal.map = f.mMap; metal.color.copy(f.mCol); poly.color.copy(f.pCol); tan.color.copy(f.tCol); }
    else {
      metal.map = T; metal.color.setRGB(...tint);
      tan.color.setRGB(...tint);
      poly.color.setRGB(...tint.map((v) => v * 0.55));
    }
    metal.needsUpdate = true;
  }

  setMuzzle(suppressed) {
    if (!this.suppressor) return;
    this.suppressed = !!suppressed; this.suppressor.visible = this.suppressed;
    this.muzzle.position.z = this.suppressed ? -0.78 : -0.655;
    this.baseDamage = this.baseDamage || this.damage.slice();
    this.damage = this.baseDamage.map((d) => Math.round(d * (this.suppressed ? 0.9 : 1)));
    this.recoilMul = this.suppressed ? 0.85 : 1;
    this.flash.scale.setScalar(this.suppressed ? 0.35 : 1);
  }

  setOptic(name) {
    if (!this.optics || !this.optics[name]) return;
    for (const [k, o] of Object.entries(this.optics)) { o.group.visible = k === name; o.reticle.visible = false; }
    const o = this.optics[name];
    this.optic = name; this.reticle = o.reticle; this.sightY = o.sightY; this.adsZoom = o.zoom; this.opticSens = o.sens;
    this.adsPos.y = -o.sightY;
  }

  buildHands() {
    const { glove, sleeve, knuckle } = this.mat;
    if (this.useNewHands !== false) {
      // ---- right hand wraps the pistol grip (grip axis tilted by 0.33 rad)
      const R = new THREE.Group(); R.position.set(0, -0.07, 0.048); R.rotation.set(0.33, 0, 0); this.gun.add(R);
      const rh = this.makeHand([1.0, 3.1, 3.2, 3.1], [-0.2, 0.9], { indexStraight: true });
      // palm on the right flank of the grip, fingers forward then around the front strap
      rh.position.set(0.03, 0.006, 0.012); rh.rotation.set(Math.PI / 2, 0, 0); R.add(rh);
      rh.rotation.set(-Math.PI / 2 + 0.0, 0, 0);
      rh.rotation.order = 'YXZ';
      rh.rotation.set(0, 0, 0);
      // orient: fingers (-z) should run along -z of the gun at grip height, wrapping toward -x
      rh.position.set(0.028, 0.0, 0.006);
      this.arm(R, new THREE.Vector3(0.03, -0.045, 0.05), new THREE.Vector3(0.55, -0.35, 1.0), 0.32, 0.034, 0.045);
      this.rightHand = rh;
      // ---- left hand cradles the handguard from below, fingers up the right side, thumb over the top
      const L = new THREE.Group(); L.position.set(0, 0.01, -0.33); this.gun.add(L);
      this.leftHand = L; this.leftHome = L.position.clone();
      const lh = this.makeHand([2.3, 2.4, 2.4, 2.2], [0.4, 0.6], { spread: 0.04 });
      // palm faces up (+y), fingers point +x then curl up around the guard
      lh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
      lh.position.set(-0.012, -0.03, 0.0);
      L.add(lh);
      this.arm(L, new THREE.Vector3(-0.042, -0.04, 0.045), new THREE.Vector3(-0.5, -0.55, 1.0), 0.4, 0.033, 0.046);
      return;
    }
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

  canFire() { return this.meleeT > 0.5 && this.throwT > 0.6 && !this.reloading && this.ammo > 0 && this.cool <= 0 && this.sprint < 0.35 && this.equipT >= 1; }

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
    const s = 0.8 + Math.random() * 0.5; this.flash.scale.setScalar(s * (this.ads > 0.5 ? 0.4 : 1) * (this.suppressed ? 0.3 : 1));
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
    // slide / vault: gun tucked low and canted
    const vk = player.vault ? Math.sin(Math.min(1, player.vault.t) * Math.PI) : 0;
    pos.y -= (this.slideK || 0) * 0.03 + vk * 0.12; rot.z += (this.slideK || 0) * 0.25 + vk * 0.4; rot.x -= vk * 0.3;
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

    // inspect: roll the weapon over to show its left flank, then the top
    this.inspectT += dt;
    if (this.inspectT < 2.6 && !this.reloading && this.ads < 0.1) {
      const u = this.inspectT / 2.6;
      const k = THREE.MathUtils.smoothstep(u, 0, 0.18) * (1 - THREE.MathUtils.smoothstep(u, 0.82, 1));
      const sweep = THREE.MathUtils.smoothstep(u, 0.25, 0.7);
      pos.x += -0.07 * k; pos.y += 0.05 * k; pos.z += 0.06 * k;
      rot.y += (0.9 - sweep * 0.25) * k; rot.z += (0.5 + sweep * 0.5) * k; rot.x += (0.15 + sweep * 0.25) * k;
    }
    // melee: wind up, drive the stock/frame forward, recover
    this.meleeT += dt;
    if (this.meleeT < 0.55) {
      const m = this.meleeT;
      const wind = THREE.MathUtils.smoothstep(m, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(m, 0.12, 0.2));
      const hit = THREE.MathUtils.smoothstep(m, 0.12, 0.2) * (1 - THREE.MathUtils.smoothstep(m, 0.28, 0.55));
      pos.x += wind * 0.05 - hit * 0.07; pos.y += wind * 0.02 - hit * 0.01; pos.z += wind * 0.06 - hit * 0.16;
      rot.y += wind * 0.35 - hit * 0.6; rot.z += -wind * 0.3 + hit * 0.5; rot.x += hit * 0.15;
    }
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
    this.slideK = THREE.MathUtils.damp(this.slideK || 0, player.slideT > 0 ? 1 : 0, 10, dt);
    this.camera.fov = THREE.MathUtils.lerp(baseFov, baseFov * (this.adsZoom || 0.72), this.ads) + this.sprint * 4 + this.slideK * 7;
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

// ---------------------------------------------------------------------------
// Designated marksman rifle with a real magnified optic: a second camera
// renders the world at 4x into a texture shown only inside the scope lens
// (picture-in-picture), so the view around the scope is not magnified.
export class DMR extends Weapon {
  constructor(camera, lib, effects) {
    super(camera, lib, effects);
    this.kind = 'dmr'; this.label = 'SR-25 DMR · 7.62 · 4x'; this.auto = false;
    this.magSize = 20; this.ammo = 20; this.reserve = 80;
    this.rate = 0.2; this.damage = [64, 72]; this.recoilMul = 1.7; this.climb = 2.4;
    this.reloadTimes = [2.4, 2.9]; this.equipSpeed = 1.4; this.baseSpread = 0.03;
    this.hipPos = new THREE.Vector3(0.135, -0.18, -0.37);
    this.hipRot = new THREE.Euler(0.035, 0.05, -0.06);
    this.adsPos = new THREE.Vector3(0, -this.sightY, -0.235); // eyepiece ~10 cm in front of the eye
    this.zoom = 4;
  }

  buildGun() {
    const { metal, tan, poly, rubber, steel, dark } = this.mat;
    const A = (g, m, x, y, z, rx, ry, rz, p) => this.add(g, m, x, y, z, rx, ry, rz, p);
    A(uvScale(RB(0.032, 0.045, 0.21, 0.005), 1.5), tan, 0, 0.036, -0.02);
    A(uvScale(RB(0.03, 0.038, 0.17, 0.006), 1.5), tan, 0, -0.002, 0.0);
    A(uvScale(RB(0.032, 0.05, 0.08, 0.006), 1.5), tan, 0, -0.03, -0.062);
    A(RB(0.003, 0.018, 0.06, 0.001), dark, 0.0162, 0.037, -0.006);
    A(RB(0.052, 0.008, 0.02, 0.003), metal, 0, 0.058, 0.08);
    A(RB(0.010, 0.005, 0.064, 0.002), metal, 0, -0.036, 0.006);
    A(RB(0.005, 0.022, 0.006, 0.002), steel, 0, -0.026, 0.008, -0.3);
    A(uvScale(RB(0.028, 0.105, 0.042, 0.009), 2), poly, 0, -0.07, 0.048, 0.33);
    // precision stock with adjustable cheek riser
    A(new THREE.CylinderGeometry(0.016, 0.016, 0.21, 24).rotateX(Math.PI / 2), metal, 0, 0.03, 0.18);
    A(uvScale(RB(0.044, 0.08, 0.2, 0.012), 2), poly, 0, 0.018, 0.255);
    A(uvScale(RB(0.03, 0.03, 0.14, 0.01), 2), poly, 0, 0.068, 0.25);
    A(RB(0.046, 0.13, 0.024, 0.008), rubber, 0, -0.002, 0.36);
    // long free-float handguard and heavy barrel with suppressor
    A(uvScale(RB(0.046, 0.05, 0.42, 0.01), 3), tan, 0, 0.032, -0.33);
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) A(RB(0.003, 0.012, 0.034, 0.0014), dark, s * 0.0222, 0.028, -0.17 - i * 0.05);
    A(new THREE.CylinderGeometry(0.0105, 0.0105, 0.16, 20).rotateX(Math.PI / 2), this.mat.hot, 0, 0.033, -0.62);
    A(uvScale(new THREE.CylinderGeometry(0.019, 0.019, 0.17, 28).rotateX(Math.PI / 2), 2), metal, 0, 0.033, -0.78);
    A(new THREE.CircleGeometry(0.019, 28), dark, 0, 0.033, -0.866, 0, Math.PI);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.033, -0.87); this.gun.add(this.muzzle);
    this.ejectPort = new THREE.Object3D(); this.ejectPort.position.set(0.02, 0.037, -0.006); this.gun.add(this.ejectPort);
    // top rail
    {
      const parts = [];
      const base = RB(0.022, 0.007, 0.6, 0.0015).toNonIndexed(); base.translate(0, 0.062, -0.2); parts.push(base);
      for (let i = 0; i < 38; i++) { const t = new THREE.BoxGeometry(0.0235, 0.0045, 0.0062).toNonIndexed(); t.translate(0, 0.067, 0.09 - i * 0.0158); parts.push(t); }
      for (const p of parts) for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k);
      A(mergeGeometries(parts), metal, 0, 0, 0);
    }
    // scope: rings, tube, objective bell, eyepiece, turrets
    this.sightY = 0.112;
    const Y = this.sightY;
    for (const z of [-0.06, 0.04]) { A(RB(0.03, 0.03, 0.02, 0.004), metal, 0, 0.083, z); A(new THREE.TorusGeometry(0.0195, 0.004, 8, 24), metal, 0, Y, z); }
    A(uvScale(new THREE.CylinderGeometry(0.0155, 0.0155, 0.16, 28, 1, true).rotateX(Math.PI / 2), 2), metal, 0, Y, -0.01);
    A(new THREE.CylinderGeometry(0.0255, 0.0155, 0.05, 28, 1, true).rotateX(Math.PI / 2), metal, 0, Y, -0.115);
    A(new THREE.CylinderGeometry(0.0255, 0.0255, 0.05, 28, 1, true).rotateX(Math.PI / 2), metal, 0, Y, -0.165);
    A(new THREE.RingGeometry(0.021, 0.0258, 28), metal, 0, Y, -0.19, 0, Math.PI);
    A(new THREE.CylinderGeometry(0.0195, 0.0155, 0.04, 28, 1, true).rotateX(-Math.PI / 2), metal, 0, Y, 0.09);
    A(new THREE.CylinderGeometry(0.0205, 0.0205, 0.03, 28, 1, true).rotateX(Math.PI / 2), rubber, 0, Y, 0.124);
    A(new THREE.CylinderGeometry(0.01, 0.01, 0.018, 20), metal, 0, Y + 0.022, -0.01);
    A(new THREE.CylinderGeometry(0.01, 0.01, 0.018, 20).rotateZ(Math.PI / 2), metal, 0.022, Y, -0.01);
    // objective glass (reflective, outward-facing)
    A(new THREE.CircleGeometry(0.021, 28), this.mat.glass, 0, Y, -0.189, 0, Math.PI);
    // eyepiece lens shows the PIP render
    this.scopeRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
    this.scopeMat = viewmodelMaterial(new THREE.ShaderMaterial({
      uniforms: { tScope: { value: this.scopeRT.texture }, uAlign: { value: 0 } },
      vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv = uv;\n#include <begin_vertex>\n#include <project_vertex>\n}',
      fragmentShader: `uniform sampler2D tScope; uniform float uAlign; varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5; float r = length(c) * 2.0;
          vec3 col = vec3(0.0);
          col.r = texture2D(tScope, 0.5 + c * 0.985).r; col.g = texture2D(tScope, vUv).g; col.b = texture2D(tScope, 0.5 + c * 1.015).b;
          // reticle: thick outer posts, fine centre cross, stadia dots, lit centre dot
          float fine = step(abs(c.x), 0.0016) * step(abs(c.y), 0.2) + step(abs(c.y), 0.0016) * step(abs(c.x), 0.2);
          float thick = step(abs(c.x), 0.006) * step(0.2, abs(c.y)) + step(abs(c.y), 0.006) * step(0.2, abs(c.x));
          float dots = 0.0; for (int i = 1; i <= 4; i++) { float o = float(i) * 0.045; dots += step(length(vec2(c.x, abs(c.y) - o)), 0.004) + step(length(vec2(abs(c.x) - o, c.y)), 0.004); }
          col *= 1.0 - clamp(fine + thick + dots, 0.0, 1.0) * 0.95;
          col += vec3(3.0, 0.15, 0.05) * smoothstep(0.005, 0.0015, length(c));
          // eye-box: dark edge ring, closes in when not aligned
          float edge = 1.0 - smoothstep(0.86 - (1.0 - uAlign) * 0.6, 0.98, r);
          col *= edge * uAlign;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    // material clone() deep-copies texture uniforms: re-bind the live render target
    this.scopeMat.uniforms.tScope.value = this.scopeRT.texture;
    this.scopeLens = A(new THREE.CircleGeometry(0.0175, 40), this.scopeMat, 0, Y, 0.1395);
    this.reticle = new THREE.Object3D();
    this.scopeCam = new THREE.PerspectiveCamera(15, 1, 0.1, 4500);
    // 20-round straight magazine
    this.mag = new THREE.Group(); this.mag.position.set(0, -0.055, -0.064); this.gun.add(this.mag);
    this.magHome = this.mag.position.clone();
    this.add(uvScale(RB(0.026, 0.13, 0.078, 0.004), 2), poly, 0, -0.06, -0.006, -0.08, 0, 0, this.mag);
    this.add(RB(0.03, 0.012, 0.084, 0.004), poly, 0, -0.13, -0.012, -0.08, 0, 0, this.mag);
  }

  // render the magnified view (called by the game before the main render)
  renderScope(renderer, scene, hide) {
    if (!this.root.visible || this.ads < 0.15) return;
    const cam = this.camera, sc = this.scopeCam;
    cam.updateMatrixWorld();
    sc.position.setFromMatrixPosition(cam.matrixWorld);
    sc.quaternion.setFromRotationMatrix(cam.matrixWorld);
    sc.fov = (this.baseFov || 74) / this.zoom; sc.aspect = 1; sc.updateProjectionMatrix();
    sc.updateMatrixWorld();
    const vis = hide.map((o) => o.visible); hide.forEach((o) => { o.visible = false; });
    const prev = renderer.getRenderTarget(); const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.scopeRT); renderer.clear(); renderer.render(scene, sc);
    renderer.setRenderTarget(prev); renderer.shadowMap.autoUpdate = prevShadow;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    this.scopeMat.uniforms.uAlign.value = THREE.MathUtils.smoothstep(this.ads, 0.55, 0.95);
  }

  update(dt, t, player, input, mouse) {
    super.update(dt, t, player, input, mouse);
    // the main view zooms only slightly; the magnification lives inside the scope
    const baseFov = this.baseFov || 74;
    this.camera.fov = THREE.MathUtils.lerp(baseFov, baseFov * 0.85, this.ads) + this.sprint * 4 + (this.slideK || 0) * 7;
    this.camera.updateProjectionMatrix();
    if (this.ads < 0.15) this.scopeMat.uniforms.uAlign.value = 0;
  }
}

// Pump-action 12 gauge: 8 pellets per shell, a real pump stroke between
// shots (left hand rides the forend) and shell-by-shell loading that the
// trigger interrupts.
export class Shotgun extends Weapon {
  constructor(camera, lib, effects) {
    super(camera, lib, effects);
    this.kind = 'shotgun'; this.label = 'M590 · 12ga · 霰弹'; this.auto = false;
    this.magSize = 6; this.ammo = 6; this.reserve = 30;
    this.rate = 0.82; this.damage = [15, 19]; this.pellets = 8; this.recoilMul = 2.0; this.climb = 3.2;
    this.reloadTimes = [0.5, 0.5]; this.equipSpeed = 1.6; this.baseSpread = 0.055;
    this.hipPos = new THREE.Vector3(0.13, -0.16, -0.36);
    this.hipRot = new THREE.Euler(0.04, 0.05, -0.06);
    this.adsPos = new THREE.Vector3(0, -this.sightY - 0.008, -0.4);
    this.adsZoom = 0.86;
    this.pumpT = 9; this.ejectPending = false;
    // the forend sits ~2.6 cm lower than the rifle's handguard the hand rig was posed for
    this.leftHome.y -= 0.04; this.leftHand.position.copy(this.leftHome);
    // a shell held in the loading hand
    this.handShell = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.07, 12).rotateZ(Math.PI / 2), viewmodelMaterial(lib.M.paintRed));
    this.handShell.position.set(0.0, 0.02, 0.0); this.handShell.visible = false; this.leftHand.add(this.handShell);
  }

  // damage falls off past ~8 m
  falloff(t) { return THREE.MathUtils.clamp(1 - (t - 8) / 22, 0.2, 1); }

  buildGun() {
    const { metal, poly, steel, dark, rubber } = this.mat;
    const A = (g, m, x, y, z, rx, ry, rz, p) => this.add(g, m, x, y, z, rx, ry, rz, p);
    this.sightY = 0.057;
    A(uvScale(RB(0.034, 0.052, 0.2, 0.006), 1.5), metal, 0, 0.02, -0.02);           // receiver
    A(RB(0.003, 0.02, 0.05, 0.001), dark, 0.0172, 0.03, -0.02);                      // ejection port
    A(RB(0.004, 0.012, 0.03, 0.002), steel, -0.018, 0.012, -0.0);                    // action release
    A(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 20).rotateX(Math.PI / 2), this.mat.hot, 0, 0.039, -0.37); // barrel
    A(RB(0.008, 0.004, 0.48, 0.0012), dark, 0, 0.052, -0.37);                        // vent rib
    for (let i = 0; i < 12; i++) A(RB(0.008, 0.003, 0.004, 0.0008), dark, 0, 0.0545, -0.15 - i * 0.04);
    A(new THREE.SphereGeometry(0.003, 10, 8), steel, 0, this.sightY, -0.6);         // front bead
    A(RB(0.012, 0.006, 0.008, 0.001), dark, 0, 0.051, -0.02);                        // rear notch
    A(new THREE.CylinderGeometry(0.0115, 0.0115, 0.42, 18).rotateX(Math.PI / 2), metal, 0, 0.009, -0.33); // magazine tube
    A(new THREE.CylinderGeometry(0.013, 0.013, 0.025, 18).rotateX(Math.PI / 2), dark, 0, 0.009, -0.553);
    A(RB(0.02, 0.012, 0.02, 0.003), dark, 0, 0.025, -0.555);                        // barrel clamp
    // grip, trigger guard, stock
    A(RB(0.010, 0.005, 0.064, 0.002), metal, 0, -0.036, 0.006);
    A(RB(0.005, 0.022, 0.006, 0.002), steel, 0, -0.026, 0.008, -0.3);
    A(uvScale(RB(0.028, 0.105, 0.042, 0.009), 2), poly, 0, -0.07, 0.048, 0.33);
    A(uvScale(RB(0.04, 0.06, 0.25, 0.012), 2), poly, 0, 0.0, 0.2, -0.06);
    A(RB(0.044, 0.12, 0.024, 0.008), rubber, 0, -0.02, 0.33, -0.06);
    // pump forend (animated)
    this.pump = new THREE.Group(); this.pump.position.set(0, 0.008, -0.33); this.gun.add(this.pump);
    this.pumpHome = this.pump.position.clone();
    this.add(uvScale(RB(0.042, 0.042, 0.17, 0.012), 2), poly, 0, -0.002, 0, 0, 0, 0, this.pump);
    for (let i = 0; i < 7; i++) this.add(RB(0.044, 0.044, 0.006, 0.006), dark, 0, -0.002, -0.06 + i * 0.02, 0, 0, 0, this.pump);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.039, -0.625); this.gun.add(this.muzzle);
    this.ejectPort = new THREE.Object3D(); this.ejectPort.position.set(0.02, 0.03, -0.02); this.gun.add(this.ejectPort);
    this.mag = new THREE.Group(); this.gun.add(this.mag); this.magHome = this.mag.position.clone();
    this.reticle = new THREE.Object3D();
  }

  // pull the trigger mid-reload to stop loading and fire
  canFire() {
    if (this.reloading && this.ammo > 0 && this.pumpT > 0.6) { this.reloading = false; this.handShell.visible = false; }
    return super.canFire() && this.pumpT > 0.6;
  }

  startReload() {
    if (this.reloading || this.ammo >= this.magSize || this.reserve <= 0) return false;
    this.reloading = true; this.reloadT = 0; this.shellT = 0; this.reloadEmpty = this.ammo === 0;
    return true;
  }

  fire() { const p = super.fire(); this.pumpT = 0; this.ejectPending = true; this.spreadBloom = 0.3; return p; }

  // the hull is ejected by the pump stroke, not the shot
  ejectBrass() { }

  update(dt, t, player, input, mouse) {
    // shell-by-shell loading, handled here instead of the magazine swap
    const loading = this.reloading;
    let stillLoading = loading, tilt = 0, hand = 0;
    if (loading) {
      this.reloadT += dt; this.shellT += dt;
      tilt = THREE.MathUtils.smoothstep(this.reloadT, 0, 0.25);
      const u = this.shellT / 0.5;
      hand = Math.sin(Math.min(u, 1) * Math.PI);
      this.handShell.visible = u < 0.75;
      if (u >= 1) {
        this.shellT = 0;
        if (this.reserve > 0 && this.ammo < this.magSize) { this.ammo++; this.reserve--; this.emit('magin'); this.kickV += 0.2; }
        if (this.ammo >= this.magSize || this.reserve <= 0) {
          stillLoading = false; this.handShell.visible = false;
          if (this.reloadEmpty) { this.pumpT = 0; this.ejectPending = false; }
        }
      }
    }
    this.reloading = false;            // keep the base class's magazine animation out of it
    super.update(dt, t, player, input, mouse);
    this.reloading = stillLoading;
    // pump stroke: back at 0.12-0.32 s, forward by 0.55 s; the left hand rides it
    this.pumpT += dt;
    const p = this.pumpT;
    let back = 0;
    if (p > 0.12 && p < 0.55) back = p < 0.32 ? THREE.MathUtils.smoothstep(p, 0.12, 0.32) : 1 - THREE.MathUtils.smoothstep(p, 0.34, 0.55);
    if (p > 0.2 && this.ejectPending) { this.ejectPending = false; Weapon.prototype.ejectBrass.call(this); this.emit('bolt'); }
    this.pump.position.z = this.pumpHome.z + back * 0.075;
    if (this.reloading) {
      // rolled over, left hand fetches a shell and thumbs it into the loading port
      this.pivot.rotation.z += 0.5 * tilt; this.pivot.position.y -= 0.02 * tilt;
      this.leftHand.position.set(-0.01 - hand * 0.04, -0.03 - hand * 0.08, 0.0 - (1 - hand) * 0.05);
      this.leftHand.rotation.set(hand * 0.5, 0, -0.9 * tilt);
    } else {
      this.leftHand.position.copy(this.leftHome); this.leftHand.position.z += back * 0.075;
      this.leftHand.rotation.set(0, 0, 0);
    }
  }
}
