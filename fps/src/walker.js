// STRIDER — quadruped ground walker. Procedural gait: each foot stays planted
// until the body has moved far enough, then steps along an arc to a predicted
// rest spot; diagonal pairs alternate. Knees are solved with 2-bone IK.
// Armoured front, glowing rear power cell takes triple damage.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { segmentBlocked } from './enemies.js';

const L1 = 1.2, L2 = 1.5, BODY_Y = 1.6, HP = 480;
const Y = new THREE.Vector3(0, 1, 0);

function seg(mesh, a, b) {
  const d = b.clone().sub(a); const l = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(Y, d.divideScalar(l || 1));
  mesh.scale.set(1, l, 1);
}

function ik(hip, foot, pole) {
  const d = foot.clone().sub(hip);
  const dist = THREE.MathUtils.clamp(d.length(), 0.05, L1 + L2 - 0.002);
  const dir = d.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return hip.clone().addScaledVector(dir, a).addScaledVector(p, h);
}

export class Walkers {
  constructor(scene, lib, effects, level, audio, enemies) {
    this.scene = scene; this.lib = lib; this.effects = effects; this.level = level; this.audio = audio; this.enemies = enemies;
    this.list = [];
    const M = lib.M;
    this.mat = {
      hull: enemies.hull, acc: enemies.accent, dark: M.darkSteel, joint: M.steel,
      eye: new THREE.MeshStandardMaterial({ color: 0x110000, emissive: new THREE.Color(1, 0.1, 0.02), emissiveIntensity: 16 }),
      cell: new THREE.MeshStandardMaterial({ color: 0x221000, emissive: new THREE.Color(1, 0.55, 0.1), emissiveIntensity: 9 }),
    };
    this.upperGeo = new RoundedBoxGeometry(0.24, 1, 0.3, 2, 0.06);
    this.lowerGeo = new THREE.CylinderGeometry(0.075, 0.12, 1, 12);
    this.jointGeo = new THREE.SphereGeometry(0.17, 16, 12);
    this.footGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.08, 14);
  }

  get alive() { return this.list.filter((w) => w.alive).length; }

  build() {
    const m = this.mat;
    const body = new THREE.Group();
    const inner = new THREE.Group(); inner.scale.setScalar(1.3);
    body.add(inner);
    const mk = (geo, mat, x, y, z, parent = inner, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
    mk(new RoundedBoxGeometry(1.25, 0.5, 1.7, 3, 0.12), m.hull, 0, 0, 0);
    mk(new RoundedBoxGeometry(1.35, 0.12, 1.2, 2, 0.05), m.dark, 0, -0.3, 0);
    mk(new RoundedBoxGeometry(1.1, 0.22, 0.25, 2, 0.06), m.acc, 0, 0.12, -0.86);   // front armour lip
    for (const sx of [-1, 1]) mk(new RoundedBoxGeometry(0.1, 0.36, 1.3, 2, 0.04), m.dark, sx * 0.66, -0.02, 0);
    const cell = mk(new RoundedBoxGeometry(0.5, 0.28, 0.2, 2, 0.05), m.cell, 0, 0.05, 0.9); // weak point (rear)
    // turret
    const turret = new THREE.Group(); turret.position.set(0, 0.38, -0.1); inner.add(turret);
    mk(new THREE.CylinderGeometry(0.42, 0.48, 0.26, 24), m.hull, 0, 0, 0, turret);
    mk(new RoundedBoxGeometry(0.5, 0.28, 0.55, 2, 0.08), m.hull, 0, 0.2, -0.05, turret);
    const eye = mk(new THREE.SphereGeometry(0.08, 14, 10), m.eye.clone(), 0, 0.24, -0.33, turret);
    const muzzles = [];
    for (const sx of [-0.14, 0.14]) {
      mk(new THREE.CylinderGeometry(0.04, 0.045, 0.7, 12), m.dark, sx, 0.16, -0.6, turret, Math.PI / 2);
      const mz = new THREE.Object3D(); mz.position.set(sx, 0.16, -0.96); turret.add(mz); muzzles.push(mz);
    }
    // legs
    const legs = [];
    const hips = [[-0.58, -0.7], [0.58, -0.7], [-0.58, 0.7], [0.58, 0.7]];
    hips.forEach(([hx, hz], i) => {
      mk(this.jointGeo, m.joint, hx, -0.05, hz);
      const upper = new THREE.Mesh(this.upperGeo, m.dark); const lower = new THREE.Mesh(this.lowerGeo, m.hull);
      const knee = new THREE.Mesh(this.jointGeo, m.joint); const foot = new THREE.Mesh(this.footGeo, m.dark);
      for (const o of [upper, lower, knee, foot]) { o.castShadow = o.receiveShadow = true; this.scene.add(o); }
      legs.push({ hipLocal: new THREE.Vector3(hx * 1.3, -0.065, hz * 1.3), restLocal: new THREE.Vector3(Math.sign(hx) * 1.65, 0, Math.sign(hz) * 1.5), upper, lower, knee, foot, planted: null, step: null, group: (i === 0 || i === 3) ? 0 : 1 });
    });
    return { body, turret, eye, muzzles, legs, cell };
  }

  spawn(pos) {
    const w = this.build();
    w.body.position.set(pos.x, BODY_Y, pos.z);
    this.scene.add(w.body);
    Object.assign(w, {
      pos: w.body.position, vel: new THREE.Vector3(), yaw: 0, hp: HP * (this.enemies.hpMult || 1), maxHp: HP, alive: true,
      fireCD: 2.5, burst: 0, burstT: 0, strafe: Math.random() < 0.5 ? -1 : 1, hitFlash: 0, kind: 'walker', heavy: false, kami: false, t: Math.random() * 10,
    });
    w.body.updateMatrixWorld();
    for (const L of w.legs) { L.planted = L.restLocal.clone().applyMatrix4(w.body.matrixWorld); L.planted.y = 0; }
    this.list.push(w);
    this.effects.puff(new THREE.Vector3(pos.x, 0.1, pos.z), new THREE.Vector3(0, 1, 0), new THREE.Color(0.5, 0.47, 0.42), 8, 0.6, 1.5);
    return w;
  }

  raycast(o, d, maxT) {
    let best = null;
    for (const w of this.list) {
      if (!w.alive) continue;
      const test = (c, r, part) => {
        const oc = o.clone().sub(c); const b = oc.dot(d); const h = b * b - (oc.lengthSq() - r * r);
        if (h < 0) return; const t = -b - Math.sqrt(h);
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { walker: w, part, t, point: o.clone().addScaledVector(d, t) };
      };
      test(w.cell.getWorldPosition(new THREE.Vector3()), 0.38, 'cell');
      test(w.pos, 1.2, 'body');
      test(w.turret.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0)), 0.45, 'body');
    }
    return best;
  }

  damage(w, amount, part, dir) {
    if (!w.alive) return false;
    let k = part === 'cell' ? 3 : 1;
    if (part !== 'cell' && dir) {
      // frontal hits glance off the armour
      const fwd = new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
      if (fwd.dot(dir) < -0.5) k = 0.5;
    }
    w.hp -= amount * k; w.hitFlash = 1;
    if (w.hp <= 0) { this.kill(w); return true; }
    return false;
  }

  splash(pos, radius, dmg) {
    for (const w of this.list) if (w.alive) { const d = w.pos.distanceTo(pos); if (d < radius) this.damage(w, dmg * (1 - d / radius), 'body'); }
  }

  kill(w) {
    w.alive = false; w.dying = 0;
    if (this.onKill) this.onKill(w);
    this.audio.boltImpact(w.pos);
  }

  update(dt, t, player) {
    const target = player.camera.position;
    for (const w of this.list) {
      w.t += dt;
      if (!w.alive) { this.updateDeath(w, dt); continue; }
      // --- locomotion: hold preferred range, strafe, avoid boxes
      const to = new THREE.Vector3(target.x - w.pos.x, 0, target.z - w.pos.z);
      const dist = to.length(); to.normalize();
      const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(w.strafe);
      // line of sight from the turret; lose it for long and the walker pushes in
      const tw0 = w.turret.getWorldPosition(new THREE.Vector3());
      w.los = !segmentBlocked(this.level, tw0, target);
      w.lostT = w.los ? 0 : (w.lostT || 0) + dt;
      let want = side.clone().multiplyScalar(0.6);
      if (dist > 13 || w.lostT > 1.5) want.add(to.clone().multiplyScalar(w.lostT > 1.5 ? 1.6 : 1)); else if (dist < 8) want.sub(to);
      // stuck detection: wander off at an angle for a bit
      w.stuckT = (w.stuckT || 0) + dt;
      if (w.stuckT > 2.5) { if (w.lastPos && w.lastPos.distanceTo(w.pos) < 0.8) { w.detour = 2.2; w.detourDir = side.clone().multiplyScalar(Math.random() < 0.5 ? 1 : -1).add(to.clone().multiplyScalar(-0.3)).normalize(); } w.lastPos = w.pos.clone(); w.stuckT = 0; }
      if (w.detour > 0) { w.detour -= dt; want = w.detourDir.clone(); }
      if (Math.random() < dt * 0.15) w.strafe *= -1;
      const probe = w.pos.clone().addScaledVector(want.clone().normalize(), 1.8); probe.y = 0.6;
      for (const b of this.level.colliders) {
        if (b.max.y < 0.5) continue;
        const bb = b.clone().expandByScalar(1.0);
        if (bb.containsPoint(probe)) { want.addScaledVector(side, -2); w.strafe *= -1; break; }
      }
      want.y = 0; if (want.lengthSq() > 0) want.normalize();
      w.vel.lerp(want.multiplyScalar(1.9), 1 - Math.exp(-2 * dt));
      const next = w.pos.clone().addScaledVector(w.vel, dt);
      let blocked = false;
      for (const b of this.level.colliders) {
        if (b.max.y < 0.5) continue;
        if (next.x > b.min.x - 0.9 && next.x < b.max.x + 0.9 && next.z > b.min.z - 0.9 && next.z < b.max.z + 0.9 && b.min.y < 2) { blocked = true; break; }
      }
      if (!blocked) { w.pos.x = next.x; w.pos.z = next.z; } else { w.vel.multiplyScalar(-0.3); w.strafe *= -1; }
      w.pos.x = THREE.MathUtils.clamp(w.pos.x, -16.5, 15); w.pos.z = THREE.MathUtils.clamp(w.pos.z, -22, 19);
      // heading follows motion; turret tracks the player
      if (w.vel.lengthSq() > 0.05) w.yaw = THREE.MathUtils.lerp(w.yaw, Math.atan2(-w.vel.x, -w.vel.z) + (w.vel.dot(to) < 0 ? 0 : 0), 1 - Math.exp(-2.5 * dt));
      const stepping = w.legs.some((L) => L.step);
      w.pos.y = BODY_Y + Math.sin(w.t * 7) * 0.03 + (stepping ? 0.04 : 0);
      w.body.rotation.set(-w.vel.dot(new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw))) * 0.03, w.yaw, 0, 'YXZ');
      const tw = new THREE.Vector3(); w.turret.getWorldPosition(tw);
      const aim = target.clone().sub(tw);
      w.turret.rotation.y = THREE.MathUtils.lerp(w.turret.rotation.y, Math.atan2(-aim.x, -aim.z) - w.yaw, 1 - Math.exp(-4 * dt));
      w.body.updateMatrixWorld();
      this.updateLegs(w, dt);

      w.hitFlash = Math.max(0, w.hitFlash - dt * 5);
      w.eye.material.emissiveIntensity = 16 + w.hitFlash * 30 + (w.burst > 0 ? 25 : 0);
      if (w.hp < w.maxHp * 0.4 && Math.random() < dt * 14) {
        const c = new THREE.Color(0.1, 0.09, 0.08).multiply(this.effects.ambient).multiplyScalar(2.4);
        this.effects.smoke.emit({ pos: w.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), vel: new THREE.Vector3(0, 0.8, 0), life: 1.6, size: 0.2, size1: 1, color: c, alpha: 0.5, alpha1: 0, drag: 0.8, gravity: -0.5, fadeIn: 0.05 });
      }
      // --- weapons: telegraphed bursts when it has line of sight
      if (player.dead) continue;
      const los = w.los;
      w.fireCD -= dt;
      if (los && w.fireCD <= 0 && w.burst === 0) { w.burst = 6; w.burstT = 0.5; this.audio.charge(w.pos); }
      if (w.burst > 0) {
        w.burstT -= dt;
        if (w.burstT <= 0) {
          const mz = w.muzzles[w.burst % 2].getWorldPosition(new THREE.Vector3());
          this.enemies.fireBoltFrom(mz, player, { dmg: 6, speed: 34, spread: 0.7, heavy: false, from: w.pos });
          w.burst--; w.burstT = 0.11;
          if (w.burst === 0) w.fireCD = (2.6 + Math.random() * 1.5) * (this.enemies.fireMult || 1);
        }
      }
    }
    this.list = this.list.filter((w) => w.alive || w.dying < 6);
  }

  updateLegs(w, dt) {
    const anyStepping = [false, false];
    for (const L of w.legs) if (L.step) anyStepping[L.group] = true;
    const fwdVel = w.vel.clone().multiplyScalar(0.4);
    for (const L of w.legs) {
      const hip = L.hipLocal.clone().applyMatrix4(w.body.matrixWorld);
      const rest = L.restLocal.clone().applyMatrix4(w.body.matrixWorld).add(fwdVel); rest.y = 0;
      if (!L.step && !anyStepping[1 - L.group] && L.planted.distanceTo(rest) > 0.6) {
        L.step = { from: L.planted.clone(), to: rest, t: 0 }; anyStepping[L.group] = true;
      }
      let foot = L.planted;
      if (L.step) {
        L.step.t += dt / 0.3;
        const s = Math.min(1, L.step.t);
        foot = L.step.from.clone().lerp(L.step.to, s); foot.y = Math.sin(s * Math.PI) * 0.45;
        if (s >= 1) { L.planted = L.step.to; L.step = null; this.audio.walkerStep && this.audio.walkerStep(L.planted); }
      }
      // pole: outward from body and up -> spider knees
      const out = hip.clone().sub(w.pos); out.y = 0; out.normalize();
      const knee = ik(hip, foot.clone().add(new THREE.Vector3(0, 0.1, 0)), out.add(new THREE.Vector3(0, 1.4, 0)));
      seg(L.upper, hip, knee); seg(L.lower, knee, foot.clone().add(new THREE.Vector3(0, 0.08, 0)));
      L.knee.position.copy(knee); L.foot.position.copy(foot).add(new THREE.Vector3(0, 0.04, 0));
    }
  }

  updateDeath(w, dt) {
    w.dying += dt;
    // legs buckle: body sinks, then detonates
    w.pos.y = Math.max(0.45, w.pos.y - dt * 1.6);
    w.body.rotation.z += dt * 0.4; w.body.rotation.x += dt * 0.2;
    w.body.updateMatrixWorld();
    for (const L of w.legs) {
      const hip = L.hipLocal.clone().applyMatrix4(w.body.matrixWorld);
      const out = hip.clone().sub(w.pos); out.y = 0; out.normalize();
      const knee = ik(hip, L.planted, out.add(new THREE.Vector3(0, 1.4, 0)));
      seg(L.upper, hip, knee); seg(L.lower, knee, L.planted);
      L.knee.position.copy(knee);
    }
    if (Math.random() < dt * 20) this.effects.add.emit({ pos: w.pos, vel: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5), life: 0.4, size: 0.015, color: new THREE.Color(8, 4, 1.5), gravity: 9.8, stretch: 0.04 });
    if (w.dying > 1.1 && !w.exploded) {
      w.exploded = true;
      this.effects.explosion(w.pos.clone(), 1.8); this.audio.explosion(w.pos);
      this.effects.decal(new THREE.Vector3(w.pos.x, 0.003, w.pos.z), new THREE.Vector3(0, 1, 0), 2.4);
      for (const c of w.body.children[0].children.slice(0, 8)) {
        const wp = c.getWorldPosition(new THREE.Vector3());
        this.effects.spawnDebris(c.clone(), wp, wp.clone().sub(w.pos).normalize().multiplyScalar(4).add(new THREE.Vector3(0, 5, 0)), Math.random() < 0.5);
      }
      this.scene.remove(w.body);
      for (const L of w.legs) { L.upper.material = this.mat.dark; }
    }
    if (w.dying > 5.8) for (const L of w.legs) for (const o of [L.upper, L.lower, L.knee, L.foot]) this.scene.remove(o);
  }

  clear() {
    for (const w of this.list) { this.scene.remove(w.body); for (const L of w.legs) for (const o of [L.upper, L.lower, L.knee, L.foot]) this.scene.remove(o); }
    this.list = [];
  }
}
