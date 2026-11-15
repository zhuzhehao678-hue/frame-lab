// Particles, decals, tracers, brass, light flashes.
import * as THREE from 'three';

const PVERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iColor; attribute vec3 iParams; // size, rot, stretch
varying vec2 vUv; varying vec4 vColor;
void main(){
  vUv = uv;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iParams.x;
  vec2 q = position.xy;
  if(iParams.z > 0.0){
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = vv.xy; float l = length(d);
    vec2 dir = l > 1e-5 ? d / l : vec2(0.0, 1.0);
    vec2 side = vec2(-dir.y, dir.x);
    float len = size + l * iParams.z;
    mv.xy += dir * q.y * len + side * q.x * size;
  } else {
    float c = cos(iParams.y), s = sin(iParams.y);
    mv.xy += mat2(c, s, -s, c) * q * size;
  }
  gl_Position = projectionMatrix * mv;
}`;

const PFRAG_ADD = /* glsl */`
varying vec2 vUv; varying vec4 vColor;
void main(){
  vec2 c = vUv - 0.5; float r = length(c) * 2.0;
  float a = exp(-r*r*4.0) ;
  gl_FragColor = vec4(vColor.rgb, a * vColor.a);
}`;

const PFRAG_SMOKE = /* glsl */`
uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
void main(){
  vec4 t = texture2D(map, vUv);
  float a = t.a * vColor.a;
  if(a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

class ParticleSystem {
  constructor(scene, cap, material) {
    this.cap = cap;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iColor', this.aCol); g.setAttribute('iParams', this.aPar);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = true;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.p = [];
  }
  emit(o) {
    if (this.p.length >= this.cap) this.p.shift();
    this.p.push({
      pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new THREE.Vector3(),
      life: 0, max: o.life ?? 1, s0: o.size ?? 0.1, s1: o.size1 ?? o.size ?? 0.1,
      col: o.color ? o.color.clone() : new THREE.Color(1, 1, 1), a0: o.alpha ?? 1, a1: o.alpha1 ?? 0,
      drag: o.drag ?? 0, grav: o.gravity ?? 0, rot: o.rot ?? Math.random() * 6.28, rv: o.rotVel ?? 0,
      stretch: o.stretch ?? 0, bounce: o.bounce ?? false, fadeIn: o.fadeIn ?? 0,
      col1: o.color1 ? o.color1.clone() : null,
    });
  }
  update(dt, floorFn) {
    const ps = this.p;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const q = ps[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      q.vel.y -= q.grav * dt;
      q.vel.multiplyScalar(Math.exp(-q.drag * dt));
      q.pos.addScaledVector(q.vel, dt);
      if (q.bounce && q.pos.y < 0.01) { q.pos.y = 0.01; q.vel.y *= -0.35; q.vel.x *= 0.6; q.vel.z *= 0.6; }
      q.rot += q.rv * dt;
      ps[w++] = q;
    }
    ps.length = w;
    for (let i = 0; i < w; i++) {
      const q = ps[i];
      const t = q.life / q.max;
      this.aPos.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      this.aVel.setXYZ(i, q.vel.x, q.vel.y, q.vel.z);
      let a = THREE.MathUtils.lerp(q.a0, q.a1, t);
      if (q.fadeIn > 0) a *= Math.min(1, q.life / q.fadeIn);
      let r = q.col.r, g = q.col.g, b = q.col.b;
      if (q.col1) { r += (q.col1.r - r) * t; g += (q.col1.g - g) * t; b += (q.col1.b - b) * t; }
      this.aCol.setXYZW(i, r, g, b, a);
      this.aPar.setXYZ(i, THREE.MathUtils.lerp(q.s0, q.s1, t), q.rot, q.stretch);
    }
    this.mesh.geometry.instanceCount = w;
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = this.aPar.needsUpdate = true;
  }
}

// Billowing fireballs: each billboard evaluates animated fbm noise, erodes
// its silhouette with age and maps a temperature ramp (white -> orange ->
// red -> soot). Premultiplied alpha lets one particle both glow and occlude.
class FireSystem {
  constructor(scene, cap) {
    this.cap = cap;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage); // size, age, seed, heat
    g.setAttribute('iPos', this.aPos); g.setAttribute('iPar', this.aPar); g.instanceCount = 0;
    this.uniforms = { uSoot: { value: new THREE.Color(0.08, 0.075, 0.07) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iPar; varying vec2 vUv; varying vec4 vPar;
        void main(){ vUv = uv; vPar = iPar; vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iPar.z * 6.28), s = sin(iPar.z * 6.28);
          mv.xy += mat2(c, s, -s, c) * position.xy * iPar.x; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSoot; varying vec2 vUv; varying vec4 vPar;
        float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
        float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p *= 2.1; a *= 0.5; } return s; }
        void main(){
          float age = vPar.y, seed = vPar.z, heat = vPar.w;
          vec2 c = vUv - 0.5; float r = length(c) * 2.0;
          float t = age * 2.2 + seed * 10.0;
          float nn = fbm(vec3(c * 3.2, t) + seed * 7.0);
          // billowing silhouette that erodes with age
          float shape = smoothstep(0.0, 0.35, (1.0 - r) * (0.75 + nn * 0.9) - age * 0.55);
          if (shape < 0.01) discard;
          float temp = clamp((1.0 - age * 1.25) * heat * (0.55 + nn * 0.8) * (1.15 - r * 0.6), 0.0, 1.0);
          vec3 fire = mix(vec3(0.9, 0.12, 0.02), vec3(4.0, 1.6, 0.35), smoothstep(0.25, 0.65, temp));
          fire = mix(fire, vec3(12.0, 9.0, 5.5), smoothstep(0.72, 1.0, temp));
          float glow = smoothstep(0.12, 0.45, temp);
          vec3 col = mix(uSoot * (0.6 + nn * 0.5), fire, glow);
          float a = shape * mix(0.85, 1.0, glow) * (1.0 - smoothstep(0.7, 1.0, age));
          // premultiplied: glowing parts add light, sooty parts occlude
          gl_FragColor = vec4(col * a, a * mix(1.0, 0.35, glow));
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.userData.noAO = true; this.mesh.renderOrder = 11;
    scene.add(this.mesh);
    this.p = [];
  }
  emit(pos, vel, size, life, heat = 1) {
    if (this.p.length >= this.cap) this.p.shift();
    this.p.push({ pos: pos.clone(), vel: vel.clone(), size, life: 0, max: life, seed: Math.random(), heat });
  }
  update(dt) {
    let w = 0;
    for (const q of this.p) {
      q.life += dt; if (q.life >= q.max) continue;
      q.vel.multiplyScalar(Math.exp(-3.2 * dt)); q.vel.y += 1.6 * dt;
      q.pos.addScaledVector(q.vel, dt);
      this.p[w++] = q;
    }
    this.p.length = w;
    for (let i = 0; i < w; i++) {
      const q = this.p[i]; const a = q.life / q.max;
      this.aPos.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      this.aPar.setXYZW(i, q.size * (0.55 + Math.sqrt(a) * 0.9), a, q.seed, q.heat);
    }
    this.mesh.geometry.instanceCount = w;
    this.aPos.needsUpdate = this.aPar.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, lib, camera) {
    this.scene = scene; this.camera = camera; this.M = lib.M;
    this.add = new ParticleSystem(scene, 1500, new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG_ADD, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.smoke = new ParticleSystem(scene, 700, new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG_SMOKE, transparent: true, depthWrite: false,
      uniforms: { map: { value: lib.tex.smoke.map } },
    }));
    this.smoke.mesh.renderOrder = 9;
    this.fire = new FireSystem(scene, 160);
    // ground shockwave rings
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = smoothstep(0.75, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r)) * uA; gl_FragColor = vec4(vec3(1.6, 1.1, 0.7) * a, a); }',
    });
    this.rings = [];
    this.ambient = new THREE.Color(0.55, 0.45, 0.38); // smoke lighting tint

    // decals (instanced)
    this.decalCap = 160;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.M.decalHole, this.decalCap);
    this.decals.count = 0; this.decals.userData.noAO = true; this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.decalIdx = 0;
    scene.add(this.decals);

    // pooled point lights — count never changes so shaders never recompile
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 12, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0, peak: 0 });
    }
    this.lightIdx = 0;

    // tracers
    this.tracers = [];
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracerGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true).rotateX(Math.PI / 2);

    // brass casings
    this.brassGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 10);
    this.brassMat = new THREE.MeshStandardMaterial({ color: 0xc8963c, metalness: 1, roughness: 0.28 });
    this.brass = [];

    // debris chunks
    this.debris = [];
  }

  flash(pos, color, peak, dur, dist = 12) {
    const L = this.lights[this.lightIdx++ % this.lights.length];
    L.light.position.copy(pos); L.light.color.copy(color); L.light.distance = dist;
    L.t = 0; L.dur = dur; L.peak = peak; L.light.intensity = peak;
  }

  decal(point, normal, size = 0.09) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const s = size * (0.8 + Math.random() * 0.5);
    m.compose(point.clone().addScaledVector(normal, 0.003), q, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(this.decalIdx % this.decalCap, m);
    this.decalIdx++;
    this.decals.count = Math.min(this.decalIdx, this.decalCap);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  impact(point, normal, surf) {
    const n = normal;
    const rnd = (s) => new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    if (surf === 'metal') {
      for (let i = 0; i < 14; i++) {
        const v = n.clone().multiplyScalar(2 + Math.random() * 5).add(rnd(6));
        this.add.emit({ pos: point, vel: v, life: 0.25 + Math.random() * 0.35, size: 0.012, size1: 0.006, color: new THREE.Color(8, 4.5, 1.6), alpha: 1, alpha1: 0, gravity: 9.8, drag: 1.5, stretch: 0.035, bounce: true });
      }
      this.add.emit({ pos: point.clone().addScaledVector(n, 0.02), life: 0.06, size: 0.18, size1: 0.1, color: new THREE.Color(6, 4, 2), alpha: 1 });
      this.flash(point.clone().addScaledVector(n, 0.2), new THREE.Color(1, 0.7, 0.4), 6, 0.06, 4);
      this.puff(point, n, new THREE.Color(0.35, 0.33, 0.31), 2, 0.12, 0.5);
    } else if (surf === 'wood') {
      for (let i = 0; i < 10; i++) {
        const v = n.clone().multiplyScalar(1.5 + Math.random() * 3).add(rnd(3));
        this.smoke.emit({ pos: point, vel: v, life: 0.7 + Math.random() * 0.5, size: 0.025, size1: 0.02, color: new THREE.Color(0.32, 0.22, 0.13), alpha: 1, alpha1: 0.9, gravity: 9.8, drag: 1, rotVel: (Math.random() - 0.5) * 20, bounce: true });
      }
      this.puff(point, n, new THREE.Color(0.5, 0.42, 0.32), 4, 0.15, 0.8);
    } else {
      for (let i = 0; i < 12; i++) {
        const v = n.clone().multiplyScalar(1.5 + Math.random() * 4).add(rnd(3.5));
        this.smoke.emit({ pos: point, vel: v, life: 0.6 + Math.random() * 0.5, size: 0.02 + Math.random() * 0.02, color: new THREE.Color(0.30, 0.29, 0.27), alpha: 1, alpha1: 1, gravity: 9.8, drag: 0.8, rotVel: (Math.random() - 0.5) * 15, bounce: true });
      }
      for (let i = 0; i < 3; i++) this.add.emit({ pos: point, vel: n.clone().multiplyScalar(3).add(rnd(5)), life: 0.15, size: 0.008, color: new THREE.Color(5, 3, 1.2), gravity: 9.8, stretch: 0.03 });
      this.puff(point, n, new THREE.Color(0.62, 0.58, 0.52), 6, 0.2, 1.4);
    }
    this.decal(point, n, surf === 'metal' ? 0.06 : 0.1);
  }

  puff(point, n, color, count, size, life) {
    const c = color.clone().multiply(this.ambient).multiplyScalar(1.6);
    for (let i = 0; i < count; i++) {
      const v = n.clone().multiplyScalar(0.4 + Math.random() * 1.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6));
      this.smoke.emit({ pos: point.clone().addScaledVector(n, 0.05), vel: v, life: life * (0.7 + Math.random() * 0.6), size: size * 0.6, size1: size * 3.2, color: c, alpha: 0.55, alpha1: 0, drag: 2.2, gravity: -0.15, rotVel: (Math.random() - 0.5) * 1.5 });
    }
  }

  muzzleSmoke(pos, dir) {
    const c = new THREE.Color(0.7, 0.66, 0.6).multiply(this.ambient).multiplyScalar(1.5);
    for (let i = 0; i < 2; i++) this.smoke.emit({ pos, vel: dir.clone().multiplyScalar(0.8 + Math.random()).add(new THREE.Vector3(0, 0.3, 0)), life: 0.9, size: 0.04, size1: 0.35, color: c, alpha: 0.16, alpha1: 0, drag: 2.5, gravity: -0.4, rotVel: (Math.random() - 0.5) * 2 });
  }

  tracer(from, to) {
    const len = from.distanceTo(to);
    if (len < 2) return;
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    m.userData.noAO = true;
    m.renderOrder = 11;
    this.scene.add(m);
    const dir = to.clone().sub(from).normalize();
    this.tracers.push({ mesh: m, from: from.clone(), dir, len, t: 0, speed: 380 });
  }

  ejectBrass(pos, vel, quat) {
    const m = new THREE.Mesh(this.brassGeo, this.brassMat);
    m.position.copy(pos); m.quaternion.copy(quat);
    m.castShadow = false;
    m.userData.noAO = true;
    this.scene.add(m);
    this.brass.push({ mesh: m, vel: vel.clone(), spin: new THREE.Vector3(Math.random() * 30, Math.random() * 20, 25), life: 0, bounced: 0 });
    if (this.brass.length > 40) { const b = this.brass.shift(); this.scene.remove(b.mesh); }
  }

  explosion(pos, scale = 1) {
    const rnd = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.flash(pos, new THREE.Color(1, 0.6, 0.3), 120 * scale, 0.5, 22);
    // core flash + billowing fireballs
    this.add.emit({ pos, life: 0.12, size: 2.5 * scale, size1: 4 * scale, color: new THREE.Color(10, 7, 4), alpha: 1, alpha1: 0 });
    const nFire = Math.round(10 + 6 * scale);
    for (let i = 0; i < nFire; i++) {
      const v = rnd().multiplyScalar((2.5 + Math.random() * 5) * scale); v.y = Math.abs(v.y) * 0.8 + 1;
      this.fire.emit(pos.clone().add(rnd().multiplyScalar(0.3 * scale)), v, (1.2 + Math.random() * 1.2) * scale, 0.9 + Math.random() * 0.7, 0.85 + Math.random() * 0.3);
    }
    // shockwave ring hugging the ground
    if (pos.y < 3.5) {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.ringMat.clone());
      ring.position.set(pos.x, 0.05, pos.z); ring.userData.noAO = true; ring.renderOrder = 12;
      this.scene.add(ring); this.rings.push({ mesh: ring, t: 0, s: scale });
    }
    for (let i = 0; i < 40; i++) {
      const v = rnd().multiplyScalar(6 + Math.random() * 12);
      this.add.emit({ pos, vel: v, life: 0.6 + Math.random() * 0.8, size: 0.02, size1: 0.01, color: new THREE.Color(9, 5, 2), alpha: 1, alpha1: 0, gravity: 9.8, drag: 0.6, stretch: 0.03, bounce: true });
    }
    const sc = new THREE.Color(0.16, 0.15, 0.14).multiply(this.ambient).multiplyScalar(2.2);
    for (let i = 0; i < 18; i++) {
      const v = rnd().multiplyScalar(1 + Math.random() * 2.5 * scale).add(new THREE.Vector3(0, 1.2, 0));
      this.smoke.emit({ pos: pos.clone().add(rnd().multiplyScalar(0.3)), vel: v, life: 2.5 + Math.random() * 2, size: 0.6 * scale, size1: 3.2 * scale, color: sc, alpha: 0.7, alpha1: 0, drag: 1.4, gravity: -0.5, rotVel: (Math.random() - 0.5) * 0.8, fadeIn: 0.15 });
    }
  }

  spawnDebris(mesh, pos, vel, smoke = true) {
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.debris.push({ mesh, vel: vel.clone(), spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), life: 0, smoke, rest: false });
  }

  update(dt, level) {
    this.add.update(dt); this.smoke.update(dt); this.fire.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const k = r.t / 0.45;
      if (k >= 1) { this.scene.remove(r.mesh); this.rings.splice(i, 1); continue; }
      const sz = (1 + k * 11) * r.s; r.mesh.scale.set(sz, 1, sz); r.mesh.material.uniforms.uA.value = (1 - k) * 1.2;
    }
    for (const L of this.lights) {
      if (L.light.intensity <= 0) continue;
      L.t += dt;
      const k = Math.max(0, 1 - L.t / L.dur);
      L.light.intensity = L.peak * k * k;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const head = Math.min(tr.t * tr.speed, tr.len);
      const tail = Math.max(0, head - 7);
      if (tail >= tr.len - 0.01) { this.scene.remove(tr.mesh); this.tracers.splice(i, 1); continue; }
      const mid = (head + tail) / 2;
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, mid);
      tr.mesh.lookAt(tr.from.clone().addScaledVector(tr.dir, tr.len + 1));
      tr.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    }
    const ground = (x, z, y) => {
      let g = 0;
      for (const b of level.colliders) {
        if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
        if (b.max.y <= y + 0.05 && b.max.y > g) g = b.max.y;
      }
      return g;
    };
    for (let i = this.brass.length - 1; i >= 0; i--) {
      const b = this.brass[i];
      b.life += dt;
      if (b.life > 6) { this.scene.remove(b.mesh); this.brass.splice(i, 1); continue; }
      if (b.bounced > 3) continue;
      b.vel.y -= 9.8 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt; b.mesh.rotation.z += b.spin.z * dt;
      const g = ground(b.mesh.position.x, b.mesh.position.z, b.mesh.position.y + 0.1);
      if (b.mesh.position.y < g + 0.005) {
        b.mesh.position.y = g + 0.005; b.vel.y = Math.abs(b.vel.y) * 0.35; b.vel.x *= 0.5; b.vel.z *= 0.5; b.spin.multiplyScalar(0.5);
        b.bounced++;
        if (this.onBrass && b.bounced === 1) this.onBrass(b.mesh.position);
        if (b.bounced > 3) { b.mesh.rotation.x = Math.PI / 2; b.mesh.position.y = g + 0.005; }
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      if (d.life > 14) { this.scene.remove(d.mesh); this.debris.splice(i, 1); continue; }
      if (d.smoke && d.life < 4 && Math.random() < dt * 14) {
        const c = new THREE.Color(0.12, 0.11, 0.1).multiply(this.ambient).multiplyScalar(2);
        this.smoke.emit({ pos: d.mesh.position, vel: new THREE.Vector3(0, 0.8, 0), life: 1.6, size: 0.12, size1: 0.8, color: c, alpha: 0.4 * (1 - d.life / 4), alpha1: 0, drag: 1, gravity: -0.6, fadeIn: 0.1 });
        if (d.life < 1.5 && Math.random() < 0.5) this.add.emit({ pos: d.mesh.position, vel: new THREE.Vector3(0, 0.5, 0), life: 0.25, size: 0.12, size1: 0.02, color: new THREE.Color(6, 2.5, 0.6), alpha: 1, alpha1: 0 });
      }
      if (d.rest) continue;
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const g = ground(d.mesh.position.x, d.mesh.position.z, d.mesh.position.y + 0.2);
      if (d.mesh.position.y < g + 0.06) {
        d.mesh.position.y = g + 0.06; d.vel.y = Math.abs(d.vel.y) * 0.3; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.5);
        if (d.vel.lengthSq() < 0.3) d.rest = true;
      }
    }
  }
}
