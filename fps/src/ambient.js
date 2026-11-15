// Background life: a flock of gulls, a working ship-to-shore crane and a tug
// crossing the basin. Cheap (instancing / a handful of meshes) but it stops
// the world from feeling frozen.
import * as THREE from 'three';

export class Ambient {
  constructor(scene, lib) {
    this.scene = scene;
    this.buildGulls();
    this.buildCrane(lib.M);
    this.buildTug(lib.M);
    this.buildFlags(lib.M);
  }

  buildGulls() {
    const N = 16;
    this.N = N;
    const body = new THREE.SphereGeometry(0.11, 10, 6).scale(1, 0.8, 3.0);
    // wing: tapered quad, hinge at the body (x=0)
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.14, 0.62, 0.02, 0.02, 0, 0, 0.16, 0.62, 0.02, 0.02, 0.62, 0.02, 0.1, 0, 0, 0.16], 3));
    wing.computeVertexNormals();
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.8, side: THREE.DoubleSide });
    const grey = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.8, side: THREE.DoubleSide, emissive: new THREE.Color(0.08, 0.08, 0.085) });
    this.gBody = new THREE.InstancedMesh(body, white, N);
    this.gWingL = new THREE.InstancedMesh(wing, grey, N);
    this.gWingR = new THREE.InstancedMesh(wing, grey, N);
    for (const m of [this.gBody, this.gWingL, this.gWingR]) { m.frustumCulled = false; m.userData.noAO = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); }
    this.gulls = [];
    for (let i = 0; i < N; i++) {
      this.gulls.push({
        cx: -10 + Math.random() * 30, cz: -40 - Math.random() * 30, r: 14 + Math.random() * 22,
        a: Math.random() * 6.28, speed: (0.12 + Math.random() * 0.1) * (Math.random() < 0.5 ? 1 : -1),
        h: 12 + Math.random() * 14, phase: Math.random() * 10, flapT: Math.random() * 5,
        fear: 0, off: new THREE.Vector3(), fv: new THREE.Vector3(),
      });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
  }

  buildCrane(M) {
    // dynamic trolley + spreader + box on the crane at x = -20, z = -195
    const g = new THREE.Group();
    g.position.set(-20, 0, -195);
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 7), M.silhouette); trolley.position.y = 39; g.add(trolley);
    this.cables = [];
    for (const [x, z] of [[-1, -2], [1, -2], [-1, 2], [1, 2]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 4), M.darkSteel); c.position.set(x, 0, z); g.add(c); this.cables.push(c);
    }
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.59, 12.2), M.containerOrange); g.add(box);
    this.crane = { g, trolley, box, t: 0 };
    this.scene.add(g);
  }

  // flags: cloth waves via a vertex shader, pinned along the hoist edge (x = 0)
  buildFlags(M) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d');
    g.fillStyle = '#b52a22'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#f2efe6'; g.fillRect(0, 62, 256, 36);
    g.fillStyle = '#1d3d66'; g.fillRect(0, 0, 92, 160);
    g.fillStyle = '#f2efe6'; g.font = '900 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('9', 46, 82);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.flagTime = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.flagTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          float fx = uv.x, ph = uTime * 6.0 - position.x * 3.2 + position.y * 0.9;
          float amp = fx * 0.22;
          vec3 objectNormal = normalize(vec3(-amp * 3.2 * cos(ph) * 0.6, 0.0, 1.0));`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          transformed.z += sin(ph) * amp + sin(ph * 2.3 + 1.0) * amp * 0.25;
          transformed.y -= fx * fx * 0.12;`);
    };
    mat.customProgramCacheKey = () => 'flag';
    const flag = (x, y, z, ry, w, h, pole) => {
      if (pole > 0) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, pole, 10), M.paintGrey); p.position.set(x, y + pole / 2, z); p.castShadow = true; this.scene.add(p);
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.steel); k.position.set(x, y + pole + 0.05, z); this.scene.add(k);
      }
      const geo = new THREE.PlaneGeometry(w, h, 24, 10).translate(w / 2, 0, 0);
      const m = new THREE.Mesh(geo, mat); m.position.set(x + 0.06 * Math.cos(ry), y + pole - h / 2 - 0.15, z); m.rotation.y = ry; m.userData.noAO = true;
      this.scene.add(m);
    };
    flag(13.6, 0, -25.4, Math.PI * 0.9, 1.9, 1.2, 8);
    flag(-17.2, 0, -25.4, Math.PI * 0.9, 1.9, 1.2, 8);
    flag(43.4, 6.6, -40.7, Math.PI, 1.5, 0.95, 4.5);       // ship's stern staff
  }

  buildTug(M) {
    const g = new THREE.Group();
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-4, -1.5); hullShape.lineTo(3, -1.5); hullShape.quadraticCurveTo(5, 0, 3, 1.5); hullShape.lineTo(-4, 1.5); hullShape.closePath();
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 2.2, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.8, 0), M.paintRed);
    g.add(hull);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.4), M.cabinWhite || M.paintGrey); cab.position.set(-0.5, 2.5, 0); g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.6, 2.45), M.glassDark); win.position.set(-0.5, 3.1, 0); g.add(win);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.6, 12), M.paintGrey); stack.position.set(-2.2, 3.5, 0); g.add(stack);
    // wake: additive foam strip trailing the boat
    const wakeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 0.88), transparent: true, opacity: 0.35, depthWrite: false });
    const wake = new THREE.Mesh(new THREE.PlaneGeometry(40, 5).rotateX(-Math.PI / 2).translate(-22, 0, 0), wakeMat);
    wake.position.y = -0.95; g.add(wake);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.userData.noAO = true; } });
    g.position.set(-260, -2.0, -95);
    this.tug = { g, x: -260 };
    this.scene.add(g);
    this.smokeT = 0;
  }

  // gunfire / blasts: gulls within range scatter up and away, then drift back
  scare(pos, strength = 1) {
    let n = 0;
    for (const b of this.gulls) {
      const p = new THREE.Vector3(b.cx + Math.cos(b.a) * b.r, b.h, b.cz + Math.sin(b.a) * b.r).add(b.off);
      const d = p.distanceTo(pos); if (d > 90 * strength) continue;
      const k = (1 - d / (90 * strength)) * 0.6 + 0.4;
      if (b.fear < 0.3) n++;
      b.fear = Math.min(1, b.fear + k);
      const away = p.clone().sub(pos).setY(0).normalize().multiplyScalar(9 + Math.random() * 6);
      b.fv.copy(away).add(new THREE.Vector3((Math.random() - 0.5) * 4, 5 + Math.random() * 4, (Math.random() - 0.5) * 4));
    }
    return n;
  }

  update(dt, t, effects) {
    if (this.flagTime) this.flagTime.value = t;
    // gulls: circling glide, occasional flapping bursts
    const m = this._m, q = this._q, e = this._e;
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.N; i++) {
      const b = this.gulls[i];
      b.a += b.speed * dt;
      b.flapT -= dt;
      if (b.flapT < -1.6) b.flapT = 2 + Math.random() * 5;
      // fear: fly off along fv (decaying), then the offset relaxes back home
      if (b.fear > 0) {
        b.fear = Math.max(0, b.fear - dt * 0.07);
        b.off.addScaledVector(b.fv, dt * Math.min(1, b.fear * 2));
        b.fv.multiplyScalar(1 - dt * 0.15);
      }
      if (b.fear < 0.5) b.off.multiplyScalar(1 - dt * 0.12 * (1 - b.fear * 2));
      const panicked = b.fear > 0.45;
      const flapping = b.flapT < 0 || panicked;
      const flap = flapping ? Math.sin(t * (panicked ? 19 : 14) + b.phase) * 0.75 : 0.12 + Math.sin(t * 1.3 + b.phase) * 0.05;
      const p = new THREE.Vector3(b.cx + Math.cos(b.a) * b.r, b.h + Math.sin(t * 0.4 + b.phase) * 1.5, b.cz + Math.sin(b.a) * b.r).add(b.off);
      let heading = Math.atan2(-Math.sin(b.a) * Math.sign(b.speed), Math.cos(b.a) * Math.sign(b.speed));
      let bank = -0.35 * Math.sign(b.speed);
      if (panicked && b.fv.lengthSq() > 1) { heading = Math.atan2(-b.fv.x, -b.fv.z); bank = Math.sin(t * 3 + b.phase) * 0.3; }
      e.set(0, heading, bank, 'YXZ'); q.setFromEuler(e);
      m.compose(p, q, s); this.gBody.setMatrixAt(i, m);
      const ql = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), flap));
      m.compose(p, ql, s); this.gWingR.setMatrixAt(i, m);
      const qr = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI - flap));
      m.compose(p, qr, new THREE.Vector3(1, -1, 1)); this.gWingL.setMatrixAt(i, m);
    }
    this.gBody.instanceMatrix.needsUpdate = this.gWingL.instanceMatrix.needsUpdate = this.gWingR.instanceMatrix.needsUpdate = true;

    // crane cycle (~70 s): trolley runs out over the ship, lowers, lifts, returns
    const c = this.crane; c.t = (c.t + dt) % 70;
    const u = c.t / 70;
    const outK = THREE.MathUtils.smoothstep(u, 0.0, 0.25) - THREE.MathUtils.smoothstep(u, 0.6, 0.85);
    const z = THREE.MathUtils.lerp(-5, -75, outK);
    const drop = Math.sin(Math.min(1, Math.max(0, (u - 0.28) / 0.3)) * Math.PI);
    const boxY = 30 - drop * 14;
    const carrying = u < 0.43 || u > 0.85;
    c.trolley.position.z = z;
    c.box.visible = carrying;
    c.box.position.set(0, boxY, z);
    for (const cb of this.cables) {
      const top = 37.5, bot = boxY + 1.4;
      cb.scale.y = top - bot; cb.position.y = (top + bot) / 2; cb.position.z = z + (cb.position.z > z ? 0 : 0);
      cb.position.z = z + (this.cables.indexOf(cb) < 2 ? -2 : 2);
    }

    // tug crossing the basin, loops every ~3 minutes
    this.tug.x += dt * 3.2;
    if (this.tug.x > 260) this.tug.x = -260;
    this.tug.g.position.x = this.tug.x;
    this.tug.g.position.y = -2.0 + Math.sin(t * 0.9) * 0.08;
    this.tug.g.rotation.z = Math.sin(t * 0.7) * 0.02;
    this.smokeT -= dt;
    if (effects && this.smokeT <= 0) {
      this.smokeT = 0.25;
      const p = new THREE.Vector3(this.tug.x - 2.2, 2.4, -95);
      effects.smoke.emit({ pos: p, vel: new THREE.Vector3(-0.5, 1.2, 0), life: 6, size: 0.8, size1: 5, color: new THREE.Color(0.25, 0.24, 0.23), alpha: 0.35, alpha1: 0, drag: 0.3, gravity: -0.1, fadeIn: 0.5 });
    }
  }
}
