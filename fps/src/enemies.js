// Sentinel drones: quad-rotor hunter units with plasma emitters.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (d[ax] || 1e-9);
    let t0 = (b.min[ax] - o[ax]) * inv, t1 = (b.max[ax] - o[ax]) * inv;
    if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmax < tmin) return -1;
  }
  return tmin;
}
export function segmentBlocked(level, a, b) {
  const d = b.clone().sub(a); const len = d.length(); d.divideScalar(len);
  for (const bx of level.colliders) { const t = rayBox(a, d, bx, len); if (t >= 0 && t < len - 0.05) return true; }
  return false;
}
export function rayColliders(level, o, d, maxT) {
  let best = maxT;
  for (const bx of level.colliders) { const t = rayBox(o, d, bx, best); if (t >= 0 && t < best) best = t; }
  return best;
}

export class Enemies {
  constructor(scene, lib, effects, level, audio) {
    this.scene = scene; this.lib = lib; this.effects = effects; this.level = level; this.audio = audio;
    this.list = []; this.bolts = []; this.falling = [];
    this.kamiMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: new THREE.Color(1, 0.05, 0.02), emissiveIntensity: 6, roughness: 0.4 });
    const M = lib.M;
    this.hull = M.gunMetal.clone(); this.hull.color = new THREE.Color(3.2, 3.2, 3.3);
    this.accent = M.paintYellow;
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: new THREE.Color(1, 0.06, 0.02), emissiveIntensity: 18, roughness: 0.2 });
    const rotorTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
      gr.addColorStop(0, 'rgba(30,30,30,0.0)'); gr.addColorStop(0.15, 'rgba(30,30,30,0.5)'); gr.addColorStop(0.85, 'rgba(25,25,25,0.35)'); gr.addColorStop(0.95, 'rgba(40,40,40,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    this.rotorMat = new THREE.MeshStandardMaterial({ map: rotorTex, transparent: true, depthWrite: false, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 3, 1.2), fog: false });
    this.boltGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.6, 0.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.boltGeo = new THREE.SphereGeometry(0.05, 10, 8).scale(1, 1, 4.5);
    this.boltGlowGeo = new THREE.SphereGeometry(0.14, 10, 8).scale(1, 1, 3);
  }

  buildDrone(heavy) {
    const g = new THREE.Group();
    const s = heavy ? 2.2 : 1.65;
    const hull = this.hull, acc = this.accent;
    const mk = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    // lathe hull
    const pts = [[0, -0.16], [0.12, -0.15], [0.2, -0.1], [0.25, -0.02], [0.26, 0.03], [0.22, 0.08], [0.14, 0.12], [0.0, 0.13]].map(([x, y]) => new THREE.Vector2(x, y));
    mk(new THREE.LatheGeometry(pts, 40), hull, 0, 0, 0);
    // armoured belly plate & accent band
    mk(new THREE.TorusGeometry(0.255, 0.018, 10, 48).rotateX(Math.PI / 2), acc, 0, 0.02, 0);
    mk(new RoundedBoxGeometry(0.22, 0.05, 0.16, 3, 0.02), hull, 0, 0.14, 0.02);
    // sensor eye (front = -z)
    mk(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 24).rotateX(Math.PI / 2), this.lib.M.darkSteel, 0, -0.02, -0.21);
    const eye = mk(new THREE.SphereGeometry(0.052, 20, 14), this.eyeMat.clone(), 0, -0.02, -0.245);
    mk(new THREE.TorusGeometry(0.06, 0.008, 8, 24), this.lib.M.chrome, 0, -0.02, -0.248);
    // plasma emitter under the nose
    mk(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 16).rotateX(Math.PI / 2), this.lib.M.darkSteel, 0, -0.13, -0.12);
    mk(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16).rotateX(Math.PI / 2), acc, 0, -0.13, -0.22);
    // antennae
    mk(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 6), this.lib.M.darkSteel, 0.08, 0.24, 0.08, 0, 0, -0.2);
    mk(new THREE.SphereGeometry(0.012, 8, 6), this.lib.M.lampRed, 0.102, 0.35, 0.08);
    // arms + motors + rotors
    const rotors = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      mk(new RoundedBoxGeometry(0.42, 0.04, 0.06, 2, 0.015), hull, dx * 0.36, 0.03, dz * 0.36, 0, -a, 0);
      mk(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 20), this.lib.M.darkSteel, dx * 0.56, 0.05, dz * 0.56);
      mk(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 28, 1, true), hull, dx * 0.56, 0.07, dz * 0.56); // duct ring
      mk(new THREE.TorusGeometry(0.11, 0.006, 6, 28).rotateX(Math.PI / 2), acc, dx * 0.56, 0.088, dz * 0.56);
      const r = mk(new THREE.CircleGeometry(0.105, 28).rotateX(-Math.PI / 2), this.rotorMat, dx * 0.56, 0.095, dz * 0.56);
      r.castShadow = false;
      const blade = mk(new THREE.BoxGeometry(0.2, 0.004, 0.018), this.lib.M.darkSteel, dx * 0.56, 0.093, dz * 0.56);
      rotors.push(blade);
      // landing skid
      mk(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), this.lib.M.darkSteel, dx * 0.2, -0.2, dz * 0.2, dz * 0.3, 0, -dx * 0.3);
    }
    g.scale.setScalar(s);
    return { group: g, eye, rotors };
  }

  spawn(pos, kind = 'normal') {
    if (kind === true) kind = 'heavy'; if (!kind) kind = 'normal';
    const heavy = kind === 'heavy', kami = kind === 'kamikaze';
    const m = this.buildDrone(heavy);
    if (kami) {
      m.group.scale.setScalar(1.3);
      m.group.traverse((o) => { if (o.isMesh && o.material === this.accent) o.material = this.kamiMat; });
    }
    m.group.position.copy(pos);
    this.scene.add(m.group);
    const e = {
      ...m, pos: m.group.position, vel: new THREE.Vector3(), heavy,
      kami, kind, beepT: 0, armed: -1,
      hp: heavy ? 260 : (kami ? 45 : 100), maxHp: heavy ? 260 : (kami ? 45 : 100), radius: heavy ? 1.0 : (kami ? 0.62 : 0.76),
      fireCD: 1.5 + Math.random() * 2, charge: 0, burst: 0,
      orbit: Math.random() * Math.PI * 2, orbitDir: Math.random() < 0.5 ? -1 : 1,
      pref: (heavy ? 13 : 10) + Math.random() * 5, alt: 3.2 + Math.random() * 3,
      hitFlash: 0, alive: true, seen: false, lostT: 0, id: Math.random(),
      wob: Math.random() * 10,
    };
    e.hum = this.audio.droneHum(e.group, heavy, kami);
    this.list.push(e);
    // arrival FX
    this.effects.flash(pos, new THREE.Color(1, 0.3, 0.2), 10, 0.4, 8);
    return e;
  }

  // hitscan test against drones; returns {enemy, t, point}
  raycast(o, d, maxT) {
    let best = null;
    for (const e of this.list) {
      if (!e.alive) continue;
      const oc = o.clone().sub(e.pos);
      const b = oc.dot(d); const c = oc.lengthSq() - e.radius * e.radius;
      const h = b * b - c; if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && t < maxT && (!best || t < best.t)) best = { enemy: e, t, point: o.clone().addScaledVector(d, t) };
    }
    return best;
  }

  damage(e, amount, point, dir) {
    if (!e.alive) return false;
    e.hp -= amount; e.hitFlash = 1; e.seen = true;
    e.vel.addScaledVector(dir, e.heavy ? 0.6 : 1.4);
    if (e.hp <= 0) { this.kill(e, dir); return true; }
    return false;
  }

  // area damage from exploding kamikazes (chains into other drones)
  blast(pos, radius, playerMax, droneMax) {
    const pl = this.player;
    if (pl && !pl.dead) {
      const d = pl.camera.position.distanceTo(pos);
      if (d < radius && !segmentBlocked(this.level, pos, pl.camera.position)) {
        const dmg = playerMax * (1 - d / radius);
        pl.damage(dmg, pos, this.t || 0);
        if (this.onPlayerHit) this.onPlayerHit(pos, dmg);
      }
      pl.shake = Math.min(1, pl.shake + Math.max(0, 0.7 * (1 - d / 18)));
    }
    for (const o of this.list.slice()) {
      if (!o.alive) continue;
      const d = o.pos.distanceTo(pos);
      if (d < radius * 1.3 && d > 0.01) this.damage(o, droneMax * (1 - d / (radius * 1.3)), o.pos.clone(), o.pos.clone().sub(pos).normalize());
    }
  }

  kill(e, dir) {
    e.alive = false;
    if (this.onKill) this.onKill(e);
    if (e.kami) { this.explodeNow(e, dir); this.blast(e.pos.clone(), 4.6, 42, 160); return; }
    // lose control: spiral down trailing fire/smoke, explode on impact
    e.fall = { t: 0, spin: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6), dir: dir.clone() };
    e.vel.addScaledVector(dir, 2.5).add(new THREE.Vector3(0, 1.5, 0));
    this.effects.flash(e.pos, new THREE.Color(1, 0.5, 0.2), 25, 0.25, 10);
    for (let i = 0; i < 20; i++) this.effects.add.emit({ pos: e.pos, vel: new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9), life: 0.5, size: 0.015, color: new THREE.Color(9, 5, 2), gravity: 9.8, stretch: 0.03, bounce: true });
    this.audio.boltImpact(e.pos);
    this.falling.push(e);
  }

  updateFalling(dt) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const e = this.falling[i]; const f = e.fall;
      f.t += dt;
      e.vel.y -= 11 * dt;
      e.vel.x *= Math.exp(-0.6 * dt); e.vel.z *= Math.exp(-0.6 * dt);
      e.pos.addScaledVector(e.vel, dt);
      e.group.rotateY(f.spin * dt);
      e.group.rotateZ(f.spin * 0.15 * dt);
      for (const r of e.rotors) r.rotation.y += dt * 30;
      e.eye.material.emissiveIntensity = Math.random() < 0.5 ? 2 : 25;
      // fire + smoke trail
      const c = new THREE.Color(0.22, 0.2, 0.18).multiply(this.effects.ambient).multiplyScalar(2.2);
      for (let k = 0; k < 2; k++) this.effects.smoke.emit({ pos: e.pos.clone().addScaledVector(e.vel, -k * 0.016), vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.7, (Math.random() - 0.5) * 0.4), life: 2.8, size: 0.4, size1: 2.2, color: c, alpha: 0.75, alpha1: 0, drag: 1, gravity: -0.5, fadeIn: 0.04, rotVel: (Math.random() - 0.5) * 2 });
      this.effects.add.emit({ pos: e.pos, vel: e.vel.clone().multiplyScalar(-0.15), life: 0.3, size: 0.8, size1: 0.1, color: new THREE.Color(9, 3.5, 0.9), color1: new THREE.Color(2, 0.4, 0.1), alpha: 1, alpha1: 0 });
      if (Math.random() < 0.4) this.effects.add.emit({ pos: e.pos, vel: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5), life: 0.5, size: 0.015, color: new THREE.Color(9, 5, 2), gravity: 9.8, stretch: 0.04 });
      this.audio.updateHum(e.hum, 14 - f.t * 6);
      let hit = f.t > 3;
      for (const b of this.level.colliders) {
        if (e.pos.x > b.min.x - 0.3 && e.pos.x < b.max.x + 0.3 && e.pos.z > b.min.z - 0.3 && e.pos.z < b.max.z + 0.3 && e.pos.y < b.max.y + 0.3 && e.pos.y > b.min.y - 0.3) { hit = true; break; }
      }
      if (hit) { this.falling.splice(i, 1); this.explodeNow(e, f.dir); }
    }
  }

  explodeNow(e, dir) {
    this.audio.stopHum(e.hum);
    this.audio.explosion(e.pos);
    this.effects.explosion(e.pos.clone(), e.heavy ? 1.4 : 1.0);
    // break apart into debris: re-parent several meshes
    const parts = e.group.children.slice();
    const worldQ = e.group.quaternion.clone();
    for (const p of parts) {
      if (Math.random() < 0.45 || p.material === this.rotorMat) continue;
      const wp = new THREE.Vector3(); p.getWorldPosition(wp);
      const m = p.clone(); m.scale.multiplyScalar(e.group.scale.x); m.quaternion.premultiply(worldQ);
      const v = wp.clone().sub(e.pos).normalize().multiplyScalar(2 + Math.random() * 4).addScaledVector(dir, 2).add(new THREE.Vector3(0, 2.5, 0));
      this.effects.spawnDebris(m, wp, v, Math.random() < 0.4);
    }
    this.scene.remove(e.group);
  }

  fireBolt(e, player) {
    const muzzle = new THREE.Vector3(0, -0.13, -0.26).multiplyScalar(e.group.scale.x).applyQuaternion(e.group.quaternion).add(e.pos);
    const target = player.camera.position.clone().add(new THREE.Vector3(0, -0.25, 0));
    // lead the target a bit, add inaccuracy
    const dist = target.distanceTo(muzzle);
    target.addScaledVector(player.vel, dist / 30 * 0.6);
    const spread = e.heavy ? 0.5 : 0.75;
    target.add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.6, (Math.random() - 0.5) * spread));
    const dir = target.sub(muzzle).normalize();
    const mesh = new THREE.Mesh(this.boltGeo, this.boltMat); mesh.userData.noAO = true;
    const glow = new THREE.Mesh(this.boltGlowGeo, this.boltGlowMat); glow.userData.noAO = true; mesh.add(glow);
    mesh.position.copy(muzzle); mesh.lookAt(muzzle.clone().add(dir));
    this.scene.add(mesh);
    this.bolts.push({ mesh, vel: dir.multiplyScalar(e.heavy ? 24 : 30), life: 0, dmg: e.heavy ? 18 : 11, from: e.pos.clone(), whizzed: false });
    this.effects.flash(muzzle, new THREE.Color(1, 0.15, 0.05), 14, 0.12, 6);
    this.audio.laser(muzzle, e.heavy);
  }

  update(dt, t, player) {
    this.player = player; this.t = t;
    this.updateFalling(dt);
    const target = player.camera.position;
    for (const e of this.list) {
      if (!e.alive) continue;
      e.wob += dt;
      // line of sight
      const los = !segmentBlocked(this.level, e.pos, target);
      if (los) { e.seen = true; e.lostT = 0; } else e.lostT += dt;
      // desired position: orbit around the player at a preferred range
      e.orbit += dt * 0.22 * e.orbitDir * (e.heavy ? 0.6 : 1);
      if (Math.random() < dt * 0.15) e.orbitDir *= -1;
      const desired = new THREE.Vector3(target.x + Math.cos(e.orbit) * e.pref, e.alt + Math.sin(e.wob * 0.7) * 0.6, target.z + Math.sin(e.orbit) * e.pref);
      // if no LOS for a while, swing closer & higher
      if (e.lostT > 2) { desired.lerp(target, 0.35); desired.y = e.alt + 2.5; }
      desired.x = THREE.MathUtils.clamp(desired.x, -16, 15.5);
      desired.z = THREE.MathUtils.clamp(desired.z, -22, 19);
      const distP = target.distanceTo(e.pos);
      if (e.kami) { desired.copy(target); desired.y = distP > 9 ? 3.6 : target.y - 0.25; }
      const acc = desired.sub(e.pos).clampLength(0, 6).multiplyScalar(e.kami ? 3.4 : 1.4);
      // separation
      for (const o of this.list) {
        if (o === e || !o.alive) continue;
        const d = e.pos.clone().sub(o.pos); const l = d.length();
        if (l < 2.5 && l > 0.001) acc.addScaledVector(d, (2.5 - l) * 3 / l);
      }
      // collider avoidance: probe ahead
      const ahead = e.pos.clone().addScaledVector(e.vel, 0.5);
      for (const b of this.level.colliders) {
        const bb = b.clone().expandByScalar(e.radius + 0.4);
        if (bb.containsPoint(ahead)) { acc.y += 14; acc.addScaledVector(e.vel, -1.5); }
        if (b.clone().expandByScalar(e.radius).containsPoint(e.pos)) { e.pos.y = Math.max(e.pos.y, b.max.y + e.radius + 0.1); }
      }
      if (e.pos.y < 1.2) acc.y += (1.2 - e.pos.y) * 20;
      e.vel.addScaledVector(acc, dt);
      e.vel.multiplyScalar(Math.exp(-1.6 * dt));
      e.vel.clampLength(0, e.heavy ? 4.2 : (e.kami ? 10.5 : 6.5));
      e.pos.addScaledVector(e.vel, dt);

      // orientation: face the player, bank with acceleration
      const look = target.clone().sub(e.pos);
      const yaw = Math.atan2(-look.x, -look.z);
      const pitch = Math.atan2(look.y, Math.hypot(look.x, look.z)) * 0.6;
      const localVel = e.vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch - localVel.z * 0.05 + Math.sin(e.wob * 2.1) * 0.03, yaw, -localVel.x * 0.07 + Math.sin(e.wob * 1.7) * 0.04, 'YXZ'));
      e.group.quaternion.slerp(q, 1 - Math.exp(-6 * dt));
      for (const r of e.rotors) r.rotation.y += dt * 90;

      // eye: charge glow & hit flash
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      const chargeGlow = e.charge > 0 ? 1 + e.charge * 3 : 1;
      e.eye.material.emissiveIntensity = 18 * chargeGlow + e.hitFlash * 40;
      e.eye.material.emissive.setRGB(1, 0.06 + e.hitFlash * 0.6, 0.02 + e.hitFlash * 0.5);

      // damaged smoke
      if (e.hp < e.maxHp * 0.45 && Math.random() < dt * 20) {
        const c = new THREE.Color(0.08, 0.075, 0.07).multiply(this.effects.ambient).multiplyScalar(2.5);
        this.effects.smoke.emit({ pos: e.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), vel: new THREE.Vector3(0, 0.6, 0).addScaledVector(e.vel, -0.2), life: 1.4, size: 0.12, size1: 0.7, color: c, alpha: 0.45, alpha1: 0, drag: 0.8, gravity: -0.5, fadeIn: 0.1 });
        if (Math.random() < 0.15) this.effects.add.emit({ pos: e.pos, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), life: 0.4, size: 0.01, color: new THREE.Color(8, 4, 1.5), gravity: 9.8, stretch: 0.04 });
      }

      if (e.kami) {
        // proximity fuse with an accelerating beep
        e.beepT -= dt;
        const iv = THREE.MathUtils.clamp(distP / 14, 0.07, 0.55);
        if (e.beepT <= 0) { e.beepT = iv; this.audio.beep && this.audio.beep(e.pos, 900 + (1 - iv / 0.55) * 900); e.hitFlash = Math.max(e.hitFlash, 0.6); }
        if (e.armed < 0 && distP < 2.3 && !player.dead) e.armed = 0.32;
        if (e.armed >= 0) { e.armed -= dt; if (e.armed <= 0) this.kill(e, new THREE.Vector3(0, 1, 0)); }
        continue;
      }
      // attack logic
      if (player.dead) continue;
      e.fireCD -= dt;
      if (los && e.fireCD <= 0 && e.charge <= 0) { e.charge = 0.0001; this.audio.charge(e.pos); }
      if (e.charge > 0) {
        e.charge += dt / 0.45;
        if (e.charge >= 1) {
          e.charge = 0;
          this.fireBolt(e, player);
          e.burst++;
          const burstN = e.heavy ? 4 : 2;
          if (e.burst < burstN) e.fireCD = e.heavy ? 0.18 : 0.25;
          else { e.burst = 0; e.fireCD = (e.heavy ? 2.4 : 1.8) + Math.random() * 1.8; }
          if (e.burst > 0) e.charge = 0; // next shot of burst skips charge
        }
      }
      if (e.burst > 0 && e.fireCD <= 0 && los) {
        this.fireBolt(e, player);
        e.burst++;
        const burstN = e.heavy ? 4 : 2;
        if (e.burst >= burstN) { e.burst = 0; e.fireCD = (e.heavy ? 2.4 : 1.8) + Math.random() * 1.8; } else e.fireCD = e.heavy ? 0.18 : 0.25;
      }
    }
    this.list = this.list.filter((e) => e.alive);

    // bolts
    const pc = player.camera.position;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life += dt;
      const p0 = b.mesh.position.clone();
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length(); const dir = step.clone().divideScalar(len);
      let dead = b.life > 4;
      // world hit
      const tw = rayColliders(this.level, p0, dir, len);
      // player hit: closest approach to player capsule (approx as segment)
      const feet = player.pos.clone().add(new THREE.Vector3(0, 0.3, 0));
      const head = new THREE.Vector3(player.pos.x, player.pos.y + player.height - 0.15, player.pos.z);
      const closest = closestSegSeg(p0, p0.clone().add(step), feet, head);
      if (!dead && closest.d < 0.42 && closest.t * len <= tw) {
        player.damage(b.dmg, b.from, t);
        if (this.onPlayerHit) this.onPlayerHit(b.from, b.dmg);
        dead = true;
      } else if (!dead && tw < len) {
        const hp = p0.clone().addScaledVector(dir, tw);
        for (let k = 0; k < 10; k++) this.effects.add.emit({ pos: hp, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.35, size: 0.015, color: new THREE.Color(9, 1.6, 0.6), gravity: 9.8, stretch: 0.03, bounce: true });
        this.effects.add.emit({ pos: hp, life: 0.12, size: 0.5, size1: 0.2, color: new THREE.Color(5, 0.8, 0.3), alpha: 1 });
        this.effects.flash(hp, new THREE.Color(1, 0.2, 0.08), 8, 0.15, 5);
        this.audio.boltImpact(hp);
        dead = true;
      }
      // near-miss whizz
      if (!b.whizzed && p0.distanceTo(pc) < 2.5) { b.whizzed = true; this.audio.whizz(p0); }
      if (dead) { this.scene.remove(b.mesh); this.bolts.splice(i, 1); continue; }
      b.mesh.position.add(step);
      if (Math.random() < 0.7) this.effects.add.emit({ pos: p0, life: 0.18, size: 0.06, size1: 0.01, color: new THREE.Color(4, 0.5, 0.2), alpha: 0.8, alpha1: 0 });
    }
  }

  clear() {
    for (const e of this.list.concat(this.falling)) { this.scene.remove(e.group); this.audio.stopHum(e.hum); }
    this.falling = [];
    for (const b of this.bolts) this.scene.remove(b.mesh);
    this.list = []; this.bolts = [];
  }
}

function closestSegSeg(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const c = d1.dot(r), b = d1.dot(d2), denom = a * e - b * b;
  s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
  else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return { d: c1.distanceTo(c2), t: s };
}
