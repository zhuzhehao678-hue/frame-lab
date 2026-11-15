// WARDEN — the carrier drone boss. Four rotor pods are the weak points; once
// they're gone the shield drops and the core can be destroyed. Attacks: a
// telegraphed sweeping laser (blocked by cover), pod plasma volleys and
// kamikaze launches.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rayColliders } from './enemies.js';

const POD_HP = 320, CORE_HP = 700;

export class Boss {
  constructor(scene, lib, effects, level, audio, enemies) {
    this.scene = scene; this.lib = lib; this.effects = effects; this.level = level; this.audio = audio; this.enemies = enemies;
    this.active = false; this.dead = false;
  }

  build() {
    const M = this.lib.M, en = this.enemies;
    const g = new THREE.Group();
    const mk = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    const hull = en.hull, acc = en.accent, dark = M.darkSteel;
    // core hull
    const pts = [[0, -1.1], [0.7, -1.0], [1.3, -0.6], [1.6, -0.1], [1.65, 0.2], [1.35, 0.55], [0.8, 0.8], [0, 0.85]].map(([x, y]) => new THREE.Vector2(x, y));
    mk(new THREE.LatheGeometry(pts, 48), hull, 0, 0, 0);
    mk(new THREE.TorusGeometry(1.62, 0.07, 10, 64).rotateX(Math.PI / 2), acc, 0, 0.05, 0);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; mk(new RoundedBoxGeometry(0.7, 0.25, 0.5, 2, 0.06), hull, Math.cos(a) * 1.25, 0.65, Math.sin(a) * 1.25, 0, -a, 0); }
    // shielded core eye (underside)
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x150000, emissive: new THREE.Color(1, 0.08, 0.03), emissiveIntensity: 10, roughness: 0.2 });
    this.core = mk(new THREE.SphereGeometry(0.55, 32, 20), this.coreMat, 0, -1.0, 0);
    this.shieldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.2, 2.2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shield = mk(new THREE.SphereGeometry(0.85, 32, 20), this.shieldMat, 0, -1.0, 0);
    this.shield.castShadow = false; this.shield.userData.noAO = true;
    // emitter barrel for the laser
    mk(new THREE.CylinderGeometry(0.16, 0.24, 0.6, 20), dark, 0, -1.45, 0);
    // arms + pods
    this.pods = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a);
      mk(new RoundedBoxGeometry(2.4, 0.3, 0.45, 2, 0.08), hull, dx * 2.4, 0.1, dz * 2.4, 0, -a, 0);
      const pod = new THREE.Group(); pod.position.set(dx * 3.7, 0.15, dz * 3.7); g.add(pod);
      mk(new THREE.CylinderGeometry(0.55, 0.62, 0.7, 28), dark, 0, 0, 0, 0, 0, 0, pod);
      mk(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 36, 1, true), hull, 0, 0.3, 0, 0, 0, 0, pod);
      mk(new THREE.TorusGeometry(1.1, 0.04, 6, 36).rotateX(Math.PI / 2), acc, 0, 0.43, 0, 0, 0, 0, pod);
      const rotor = mk(new THREE.CircleGeometry(1.05, 36).rotateX(-Math.PI / 2), en.rotorMat, 0, 0.36, 0, 0, 0, 0, pod); rotor.castShadow = false;
      const blade = mk(new THREE.BoxGeometry(2.0, 0.03, 0.14), dark, 0, 0.35, 0, 0, 0, 0, pod);
      // glowing vents = weak point
      const ventMat = new THREE.MeshStandardMaterial({ color: 0x221000, emissive: new THREE.Color(1, 0.45, 0.08), emissiveIntensity: 8 });
      for (let k = 0; k < 4; k++) mk(new THREE.BoxGeometry(0.16, 0.36, 0.06), ventMat, Math.cos(k * 1.57) * 0.6, -0.05, Math.sin(k * 1.57) * 0.6, 0, -k * 1.57 + Math.PI / 2, 0, pod);
      this.pods.push({ group: pod, blade, ventMat, hp: POD_HP, alive: true, fireCD: 2 + i * 0.6, smokeT: 0 });
    }
    g.scale.setScalar(1.0);
    return g;
  }

  spawn(pos) {
    this.group = this.build();
    this.group.position.copy(pos);
    this.scene.add(this.group);
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.coreHp = CORE_HP; this.active = true; this.dead = false; this.falling = false;
    this.t = 0; this.orbit = 0; this.state = 'idle'; this.stateT = 3; this.launchT = 9;
    this.hitFlash = 0;
    this.beam = null;
    this.hum = this.audio.droneHum(this.group, true);
    this.audio.waveHorn();
    this.effects.flash(pos, new THREE.Color(1, 0.3, 0.2), 60, 0.8, 30);
  }

  get podsLeft() { return this.pods ? this.pods.filter((p) => p.alive).length : 0; }
  get shielded() { return this.podsLeft > 0; }
  get hpFrac() {
    if (!this.active) return 0;
    const pods = this.pods.reduce((s, p) => s + Math.max(0, p.hp), 0);
    return (pods + Math.max(0, this.coreHp)) / (POD_HP * 4 + CORE_HP);
  }

  podWorld(p) { return p.group.getWorldPosition(new THREE.Vector3()); }
  coreWorld() { return this.core.getWorldPosition(new THREE.Vector3()); }

  // hitscan: returns { part, t, point } or null
  raycast(o, d, maxT) {
    if (!this.active || this.falling) return null;
    let best = null;
    const test = (c, r, part) => {
      const oc = o.clone().sub(c); const b = oc.dot(d); const h = b * b - (oc.lengthSq() - r * r);
      if (h < 0) return; const t = -b - Math.sqrt(h);
      if (t > 0 && t < maxT && (!best || t < best.t)) best = { part, t, point: o.clone().addScaledVector(d, t) };
    };
    for (const p of this.pods) if (p.alive) test(this.podWorld(p), 1.0, p);
    test(this.coreWorld(), this.shielded ? 0.95 : 0.8, 'core');
    // hull: upper body only, so the exposed core underneath stays hittable
    test(new THREE.Vector3(0, 0.3, 0).applyQuaternion(this.group.quaternion).add(this.pos), 1.3, 'hull');
    return best;
  }

  // returns 'kill' | 'hit' | 'armor'
  damage(part, amount, point) {
    if (!this.active || this.falling) return 'armor';
    if (part === 'hull' || (part === 'core' && this.shielded)) {
      // ricochet: sparks, no damage
      for (let i = 0; i < 5; i++) this.effects.add.emit({ pos: point, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.25, size: 0.012, color: new THREE.Color(6, 7, 9), gravity: 9.8, stretch: 0.03 });
      if (part === 'core') { this.shieldMat.opacity = 0.6; }
      return 'armor';
    }
    this.hitFlash = 1;
    if (part === 'core') {
      this.coreHp -= amount;
      if (this.coreHp <= 0) { this.die(); return 'kill'; }
      return 'hit';
    }
    part.hp -= amount;
    if (part.hp <= 0 && part.alive) {
      part.alive = false;
      const wp = this.podWorld(part);
      this.effects.explosion(wp, 1.5); this.audio.explosion(wp);
      part.blade.visible = false; part.ventMat.emissiveIntensity = 0; part.ventMat.color.setRGB(0.02, 0.02, 0.02);
      this.vel.y -= 2;
      if (this.onPodDown) this.onPodDown(this.podsLeft);
      if (!this.shielded) { this.shield.visible = false; this.audio.charge(this.pos); }
      return 'kill';
    }
    return 'hit';
  }

  // splash damage (grenades)
  splash(pos, radius, dmg) {
    if (!this.active || this.falling) return;
    for (const p of this.pods) if (p.alive) { const d = this.podWorld(p).distanceTo(pos); if (d < radius) this.damage(p, dmg * (1 - d / radius), pos); }
    if (!this.shielded) { const d = this.coreWorld().distanceTo(pos); if (d < radius) this.damage('core', dmg * (1 - d / radius), pos); }
  }

  die() {
    this.falling = true; this.fallT = 0;
    this.endBeam();
    if (this.onDeath) this.onDeath();
  }

  endBeam() { if (this.beam) { this.scene.remove(this.beam.mesh); this.beam = null; } }

  startBeam(player) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.6, 0.3), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), mat);
    mesh.userData.noAO = true; mesh.frustumCulled = false;
    this.scene.add(mesh);
    // aim starts offset from the player and sweeps onto them
    const aim = player.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, -1.2, (Math.random() - 0.5) * 10));
    this.beam = { mesh, mat, t: 0, aim, phase: 'lock' };
    this.audio.charge(this.pos);
  }

  update(dt, t, player) {
    if (!this.active) return;
    this.t += dt;
    if (this.falling) { this.updateFall(dt); return; }
    const target = player.camera.position;
    // hover orbit high above the yard, sinking lower as it gets damaged
    this.orbit += dt * 0.12;
    const alt = 11 - (4 - this.podsLeft) * 1.2;
    const desired = new THREE.Vector3(Math.cos(this.orbit) * 9 - 1, alt + Math.sin(this.t * 0.6) * 0.6, Math.sin(this.orbit) * 11 - 3);
    this.vel.addScaledVector(desired.sub(this.pos).clampLength(0, 4), dt * 0.8);
    this.vel.multiplyScalar(Math.exp(-1.2 * dt));
    this.pos.addScaledVector(this.vel, dt);
    const look = target.clone().sub(this.pos);
    const yaw = Math.atan2(-look.x, -look.z);
    const tiltX = -this.vel.z * 0.03 + Math.sin(this.t * 0.8) * 0.03, tiltZ = this.vel.x * 0.03 + (4 - this.podsLeft) * 0.025;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'));
    this.group.quaternion.slerp(q, 1 - Math.exp(-2 * dt));
    for (const p of this.pods) if (p.alive) p.blade.rotation.y += dt * 40;
    this.audio.updateHum(this.hum, this.vel.length());
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.coreMat.emissiveIntensity = (this.shielded ? 10 : 22 + Math.sin(this.t * 12) * 8) + this.hitFlash * 30;
    this.shieldMat.opacity = THREE.MathUtils.damp(this.shieldMat.opacity, 0.22, 4, dt);

    // damaged pods smoke
    for (const p of this.pods) if (!p.alive && Math.random() < dt * 18) {
      const c = new THREE.Color(0.1, 0.09, 0.08).multiply(this.effects.ambient).multiplyScalar(2.5);
      this.effects.smoke.emit({ pos: this.podWorld(p), vel: new THREE.Vector3(0, 1, 0), life: 2.5, size: 0.4, size1: 2.2, color: c, alpha: 0.6, alpha1: 0, drag: 0.8, gravity: -0.4, fadeIn: 0.05 });
      if (Math.random() < 0.3) this.effects.add.emit({ pos: this.podWorld(p), vel: new THREE.Vector3(0, 0.5, 0), life: 0.3, size: 0.5, size1: 0.1, color: new THREE.Color(8, 3, 0.8), alpha: 1, alpha1: 0 });
    }
    if (player.dead) { this.endBeam(); return; }

    // pod volleys
    for (const p of this.pods) {
      if (!p.alive) continue;
      p.fireCD -= dt;
      if (p.fireCD <= 0) {
        p.fireCD = 3.5 + Math.random() * 2.5;
        const m = this.podWorld(p).add(new THREE.Vector3(0, -0.5, 0));
        this.enemies.fireBoltFrom(m, player, { dmg: 11, speed: 22, spread: 1.1, from: this.pos });
      }
    }
    // kamikaze launches
    this.launchT -= dt;
    if (this.launchT <= 0) {
      this.launchT = this.shielded ? 14 : 9;
      for (let k = 0; k < 2; k++) this.enemies.spawn(this.pos.clone().add(new THREE.Vector3((k ? 1 : -1) * 1.5, -1.5, 0)), 'kamikaze');
    }
    // laser cycle
    this.stateT -= dt;
    if (!this.beam && this.stateT <= 0) { this.startBeam(player); }
    if (this.beam) this.updateBeam(dt, player, t);
  }

  updateBeam(dt, player, t) {
    const b = this.beam;
    b.t += dt;
    const origin = this.coreWorld().add(new THREE.Vector3(0, -0.5, 0));
    const tgt = player.camera.position.clone().add(new THREE.Vector3(0, -0.4, 0));
    // track the player with lag (so strafing dodges it)
    b.aim.lerp(tgt, 1 - Math.exp(-(b.phase === 'lock' ? 1.6 : 0.9) * dt));
    const dir = b.aim.clone().sub(origin).normalize();
    const maxL = 80;
    const hitL = rayColliders(this.level, origin, dir, maxL);
    const groundT = dir.y < -1e-3 ? -origin.y / dir.y : maxL;
    const L = Math.min(hitL, groundT, maxL);
    b.mesh.position.copy(origin);
    b.mesh.lookAt(origin.clone().add(dir));
    const firing = b.phase === 'fire';
    const w = firing ? 0.16 + Math.sin(b.t * 60) * 0.02 : 0.015;
    b.mesh.scale.set(w, w, L);
    b.mat.opacity = firing ? 0.9 : 0.35 + 0.3 * Math.sin(b.t * 30);
    b.mat.color.setRGB(firing ? 14 : 6, firing ? 1.2 : 0.4, firing ? 0.6 : 0.2);
    if (b.phase === 'lock' && b.t > 1.6) { b.phase = 'fire'; b.t = 0; this.audio.laser(origin, true); this.effects.flash(origin, new THREE.Color(1, 0.2, 0.1), 40, 0.3, 14); }
    if (firing) {
      const end = origin.clone().addScaledVector(dir, L);
      // scorch & sparks where it lands
      if (Math.random() < dt * 40) this.effects.add.emit({ pos: end, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6), life: 0.4, size: 0.02, color: new THREE.Color(9, 2, 0.6), gravity: 9.8, stretch: 0.03, bounce: true });
      if (Math.random() < dt * 10) this.effects.puff(end, new THREE.Vector3(0, 1, 0), new THREE.Color(0.3, 0.28, 0.26), 1, 0.3, 1.2);
      const L0 = this.effects.lights[0];
      L0.light.position.copy(end).add(new THREE.Vector3(0, 0.4, 0));
      L0.light.color.setRGB(1, 0.15, 0.05); L0.light.distance = 8; L0.peak = 30; L0.t = 0; L0.dur = 0.1; L0.light.intensity = 30;
      // player hit test: distance from player capsule to the beam segment
      const pc = player.camera.position;
      const tt = THREE.MathUtils.clamp(pc.clone().sub(origin).dot(dir), 0, L);
      const closest = origin.clone().addScaledVector(dir, tt);
      const dd = Math.min(closest.distanceTo(pc), closest.distanceTo(player.pos.clone().add(new THREE.Vector3(0, 0.9, 0))));
      if (dd < 0.55) {
        b.dmgAcc = (b.dmgAcc || 0) + dt * 55;
        if (b.dmgAcc > 6) { player.damage(b.dmgAcc, this.pos, t); if (this.enemies.onPlayerHit) this.enemies.onPlayerHit(this.pos, b.dmgAcc); b.dmgAcc = 0; }
      }
      if (b.t > 2.4) { this.endBeam(); this.stateT = this.shielded ? 6 : 4; }
    }
  }

  updateFall(dt) {
    this.fallT += dt;
    this.vel.y -= 7 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.group.rotateY(dt * 1.5); this.group.rotateZ(dt * 0.3);
    if (Math.random() < dt * 30) {
      const p = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
      this.effects.add.emit({ pos: p, vel: new THREE.Vector3(0, 1, 0), life: 0.4, size: 1.2, size1: 0.2, color: new THREE.Color(9, 3.5, 0.9), alpha: 1, alpha1: 0 });
      const c = new THREE.Color(0.1, 0.09, 0.08).multiply(this.effects.ambient).multiplyScalar(2.5);
      this.effects.smoke.emit({ pos: p, vel: new THREE.Vector3(0, 1.5, 0), life: 4, size: 1, size1: 5, color: c, alpha: 0.7, alpha1: 0, drag: 0.6, gravity: -0.4, fadeIn: 0.05 });
    }
    if (Math.random() < dt * 3) { const p = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)); this.effects.explosion(p, 1.0); this.audio.explosion(p); }
    if (this.pos.y < 1.5 || this.fallT > 5) {
      for (let k = 0; k < 4; k++) this.effects.explosion(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0.5, (Math.random() - 0.5) * 5)), 2.4);
      this.audio.explosion(this.pos); this.audio.explosion(this.pos);
      this.audio.stopHum(this.hum);
      // debris
      for (const c of this.group.children.slice(0, 18)) {
        const wp = c.getWorldPosition(new THREE.Vector3());
        const m = c.clone();
        this.effects.spawnDebris(m, wp, wp.clone().sub(this.pos).normalize().multiplyScalar(4 + Math.random() * 6).add(new THREE.Vector3(0, 5, 0)), Math.random() < 0.5);
      }
      this.scene.remove(this.group);
      this.active = false; this.dead = true;
      if (this.onExploded) this.onExploded(this.pos.clone());
    }
  }

  clear() {
    if (this.group) this.scene.remove(this.group);
    this.endBeam();
    if (this.hum) this.audio.stopHum(this.hum);
    this.active = false; this.dead = false; this.falling = false;
  }
}
