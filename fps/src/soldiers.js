// Hostile infantry: procedural humanoids that move between cover positions on
// the nav grid, aim (with a visible wind-up), fire short bursts, reload in a
// crouch and react to hits. Head shots x2.5. They are the main threat; the
// drones support them.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { segmentBlocked } from './enemies.js';
import { NavGrid } from './walker.js';

const HP = 100;
const MAX_SHOOTERS = 3;
const cap = (r, l, y) => new THREE.CapsuleGeometry(r, l, 4, 10).translate(0, y, 0);

// merge the direct mesh children of a group per material (fewer draw calls)
function mergeGroup(g) {
  const byMat = new Map();
  for (const c of g.children.slice()) {
    if (!c.isMesh || c.userData.keep) continue;
    c.updateMatrix();
    const geo = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(c.matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) continue;
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(geo); g.remove(c);
  }
  for (const [m, list] of byMat) { const mesh = new THREE.Mesh(mergeGeometries(list, false), m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); }
}

export class Soldiers {
  constructor(scene, lib, effects, level, audio, enemies) {
    this.scene = scene; this.lib = lib; this.effects = effects; this.level = level; this.audio = audio; this.enemies = enemies;
    this.list = []; this.nades = []; this.grenadeCD = 8; this.allowNades = true;
    const M = lib.M;
    const tint = (src, c, extra = {}) => { const m = src.clone(); m.color = new THREE.Color(...c); Object.assign(m, extra); return m; };
    this.mat = {
      camo: tint(M.fabric, [0.55, 0.56, 0.42]),
      vest: tint(M.polymer, [0.42, 0.4, 0.3]),
      helmet: tint(M.polymer, [0.5, 0.5, 0.38], { roughness: 0.75 }),
      mask: new THREE.MeshStandardMaterial({ color: 0x1b1b1a, roughness: 0.95 }),
      glove: tint(M.rubber, [0.5, 0.45, 0.38]),
      boot: new THREE.MeshStandardMaterial({ color: 0x1f1a15, roughness: 0.8 }),
      gun: M.darkSteel, goggle: new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.15, metalness: 0.6 }),
    };
    this.spawnPts = [[-15.2, -21.2], [14.6, -21.5], [14.6, 18.6], [-15.2, 18.6], [0.5, -21.6], [-9.5, -21], [8, 18.8], [14.8, 3.5], [-15.5, 2.5]];
  }

  get alive() { let n = 0; for (const s of this.list) if (s.alive) n++; return n; }

  build() {
    const m = this.mat;
    const root = new THREE.Group();
    const pelvis = new THREE.Group(); pelvis.position.y = 0.95; root.add(pelvis);
    const torso = new THREE.Group(); pelvis.add(torso);
    const add = (g, geo, mat, x = 0, y = 0, z = 0) => { const k = new THREE.Mesh(geo, mat); k.position.set(x, y, z); g.add(k); return k; };
    add(torso, new RoundedBoxGeometry(0.38, 0.5, 0.23, 2, 0.06), m.camo, 0, 0.29, 0);
    add(torso, new RoundedBoxGeometry(0.43, 0.34, 0.29, 2, 0.04), m.vest, 0, 0.33, 0);
    for (const x of [-0.12, 0, 0.12]) add(torso, new RoundedBoxGeometry(0.1, 0.12, 0.06, 1, 0.015), m.vest, x, 0.2, -0.17);
    add(torso, new RoundedBoxGeometry(0.3, 0.36, 0.15, 2, 0.04), m.vest, 0, 0.34, 0.2);
    add(torso, new RoundedBoxGeometry(0.36, 0.12, 0.25, 1, 0.03), m.camo, 0, 0.02, 0);
    // head
    const head = new THREE.Group(); head.position.y = 0.6; torso.add(head);
    add(head, new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), m.mask, 0, -0.04, 0);
    add(head, new THREE.SphereGeometry(0.11, 14, 10).scale(0.95, 1.1, 1), m.mask, 0, 0.07, 0);
    add(head, new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), m.helmet, 0, 0.1, 0.01);
    add(head, new RoundedBoxGeometry(0.19, 0.05, 0.05, 1, 0.015), m.goggle, 0, 0.09, -0.09);
    // arms (shoulder pivots), posed to hold the rifle
    const arm = (side) => {
      const sh = new THREE.Group(); sh.position.set(0.22 * side, 0.5, 0); torso.add(sh);
      add(sh, cap(0.055, 0.2, -0.15), m.camo);
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      add(el, cap(0.05, 0.18, -0.13), m.camo);
      add(el, new THREE.SphereGeometry(0.05, 8, 6), m.glove, 0, -0.29, 0);
      return { sh, el };
    };
    const armR = arm(1), armL = arm(-1);
    // rifle
    const rifle = new THREE.Group(); rifle.position.set(0.06, 0.33, -0.3); torso.add(rifle);
    add(rifle, new THREE.BoxGeometry(0.055, 0.09, 0.46), m.gun, 0, 0, 0);
    add(rifle, new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8).rotateX(Math.PI / 2), m.gun, 0, 0.015, -0.37);
    add(rifle, new THREE.BoxGeometry(0.04, 0.15, 0.07).rotateX(0.25), m.gun, 0, -0.1, -0.06);
    add(rifle, new THREE.BoxGeometry(0.05, 0.09, 0.22), m.vest, 0, -0.02, 0.32);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.015, -0.54); rifle.add(muzzle);
    // legs
    const leg = (side) => {
      const hip = new THREE.Group(); hip.position.set(0.11 * side, 0.95, 0); root.add(hip);
      add(hip, cap(0.075, 0.28, -0.22), m.camo);
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      add(knee, cap(0.062, 0.3, -0.22), m.camo);
      add(knee, new RoundedBoxGeometry(0.11, 0.09, 0.25, 1, 0.025), m.boot, 0, -0.44, -0.04);
      return { hip, knee };
    };
    const legR = leg(1), legL = leg(-1);
    for (const g of [torso, head, armR.sh, armR.el, armL.sh, armL.el, rifle, legR.hip, legR.knee, legL.hip, legL.knee]) mergeGroup(g);
    // hit-test anchors
    const anchor = (g, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); g.add(o); return o; };
    const A = { head: anchor(head, 0, 0.07, 0), chest: anchor(torso, 0, 0.32, 0), hips: anchor(torso, 0, 0.0, 0),
      thighR: anchor(legR.hip, 0, -0.24, 0), thighL: anchor(legL.hip, 0, -0.24, 0), shinR: anchor(legR.knee, 0, -0.22, 0), shinL: anchor(legL.knee, 0, -0.22, 0) };
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { root, pelvis, torso, head, armR, armL, rifle, muzzle, legR, legL, A };
  }

  spawn(pos) {
    if (!this.nav) this.nav = new NavGrid(this.level.colliders, 0.35, 0.45);
    const b = this.build();
    b.root.position.set(pos.x, 0, pos.z);
    this.scene.add(b.root);
    const s = Object.assign(b, {
      pos: b.root.position, kind: 'soldier', heavy: false, kami: false, alive: true, hp: HP * (this.enemies.hpMult || 1), maxHp: HP,
      yaw: 0, phase: Math.random() * 6, speed: 0, crouch: 0, aimPitch: 0, hitK: 0, state: 'move', goal: null, path: null, planT: 0,
      aimT: 0, burst: 0, burstT: 0, bursts: 0, fireCD: 1 + Math.random(), losT: 0, noLos: 0, reloadT: 0, shooting: false, spotted: false, dead: 0, flushT: 0, burstLimit: 2 + Math.floor(Math.random() * 2),
    });
    this.list.push(s);
    return s;
  }

  // nearest hit on a soldier's body spheres
  raycast(o, d, maxT) {
    let best = null; const c = new THREE.Vector3();
    for (const s of this.list) {
      if (!s.alive) continue;
      if (s.pos.distanceToSquared(o) > (maxT + 3) * (maxT + 3)) continue;
      const test = (a, r, part) => {
        a.getWorldPosition(c);
        const oc = o.clone().sub(c); const b = oc.dot(d); const h = b * b - (oc.lengthSq() - r * r);
        if (h < 0) return; const t = -b - Math.sqrt(h);
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { soldier: s, part, t, point: o.clone().addScaledVector(d, t) };
      };
      test(s.A.head, 0.135, 'head'); test(s.A.chest, 0.26, 'body'); test(s.A.hips, 0.22, 'body');
      test(s.A.thighR, 0.12, 'leg'); test(s.A.thighL, 0.12, 'leg'); test(s.A.shinR, 0.1, 'leg'); test(s.A.shinL, 0.1, 'leg');
    }
    return best;
  }

  damage(s, amount, part, dir) {
    if (!s.alive) return false;
    const k = part === 'head' ? 2.5 : (part === 'leg' ? 0.7 : 1);
    s.hp -= amount * k; s.lastDmg = amount * k; s.hitK = 1; s.spotted = true;
    s.aimT = Math.min(s.aimT, 0.2);                       // getting hit spoils the aim
    if (dir) s.hitDir = dir.clone();
    if (s.hp <= 0) { this.kill(s, dir); return true; }
    return false;
  }

  splash(pos, radius, dmg) {
    for (const s of this.list) if (s.alive) { const d = s.pos.distanceTo(pos); if (d < radius) this.damage(s, dmg * (1 - d / radius), 'body', s.pos.clone().sub(pos).setY(0.3).normalize()); }
  }

  kill(s, dir) {
    s.alive = false; s.dead = 0; s.shooting = false;
    s.fallDir = dir ? Math.atan2(dir.x, dir.z) : s.yaw;
    // the rifle drops away
    const wp = s.rifle.getWorldPosition(new THREE.Vector3());
    const r = s.rifle.clone(); r.quaternion.copy(s.rifle.getWorldQuaternion(new THREE.Quaternion()));
    s.rifle.visible = false;
    this.effects.spawnDebris(r, wp, new THREE.Vector3((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2), false);
    if (this.onKill) this.onKill(s);
  }

  // a firing position: sees the player, ideally hugs cover, not crowded
  pickGoal(s, target) {
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 14;
      const c = new THREE.Vector3(THREE.MathUtils.clamp(target.x + Math.cos(a) * r, -16, 15.3), 0, THREE.MathUtils.clamp(target.z + Math.sin(a) * r, -22.3, 19.3));
      const [i, j] = this.nav.cell(c); if (!this.nav.free(i, j)) continue;
      if (segmentBlocked(this.level, new THREE.Vector3(c.x, 1.55, c.z), target, true)) continue;
      let cover = 0;
      for (const b of this.level.colliders) { if (b.max.y < 0.8 || b.max.y > 3.2) continue; const dx = Math.max(b.min.x - c.x, 0, c.x - b.max.x), dz = Math.max(b.min.z - c.z, 0, c.z - b.max.z); if (dx * dx + dz * dz < 2.2) { cover = 1; break; } }
      let crowd = 0; for (const o of this.list) if (o !== s && o.alive && o.goal && o.goal.distanceTo(c) < 3.5) crowd += 1;
      const score = c.distanceTo(s.pos) * 0.5 - cover * 6 + Math.abs(r - 14) * 0.4 + crowd * 25;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  update(dt, t, player, onPlayerHit) {
    const target = player.camera.position;
    let shooters = 0; for (const s of this.list) if (s.alive && s.shooting) shooters++;
    for (const s of this.list) {
      if (!s.alive) { this.updateDeath(s, dt); continue; }
      s.hitK = Math.max(0, s.hitK - dt * 4);
      const eye = s.A.head.getWorldPosition(new THREE.Vector3());
      const los = !player.dead && !segmentBlocked(this.level, eye, target, true);
      if (los) { s.losT += dt; s.noLos = 0; s.spotted = true; } else { s.losT = 0; s.noLos += dt; }
      const distP = Math.hypot(target.x - s.pos.x, target.z - s.pos.z);

      // ---- decide where to be
      s.planT -= dt;
      if (s.state === 'move' && (!s.goal || s.planT <= 0)) {
        s.goal = this.pickGoal(s, target) || new THREE.Vector3(target.x, 0, target.z);
        s.path = this.nav.path(s.pos, s.goal); s.planT = 6;
      }
      if (s.state === 'engage' && (s.noLos > 2.5 || s.bursts >= s.burstLimit || distP < 4)) {
        s.state = 'move'; s.goal = null; s.bursts = 0; s.burstLimit = 2 + Math.floor(Math.random() * 2); if (s.shooting) { s.shooting = false; shooters--; }
      }

      // ---- locomotion along the path
      let want = 0; const mv = new THREE.Vector3();
      if (s.state === 'move' && s.path && s.path.length) {
        const nxt = s.path[0];
        mv.set(nxt.x - s.pos.x, 0, nxt.z - s.pos.z);
        if (mv.length() < 0.35) s.path.shift();
        if (s.path.length) { mv.normalize(); want = (s.spotted && los && distP < 22) ? 2.2 : 3.3; }
      } else if (s.state === 'move') { s.state = 'engage'; s.aimT = 0; }
      if (s.state === 'move' && s.goal && (!s.path || !s.path.length) && s.pos.distanceTo(s.goal) < 1.2) { s.state = 'engage'; s.aimT = 0; }
      // keep apart from squad mates
      for (const o of this.list) { if (o === s || !o.alive) continue; const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z, d2 = dx * dx + dz * dz; if (d2 < 0.8 && d2 > 1e-4) { s.pos.x += dx / Math.sqrt(d2) * dt * 1.5; s.pos.z += dz / Math.sqrt(d2) * dt * 1.5; } }
      if (s.reloadT > 0) want = 0;
      s.speed += (want - s.speed) * Math.min(1, dt * 6);
      s.pos.x += mv.x * s.speed * dt; s.pos.z += mv.z * s.speed * dt;
      for (const b of this.level.colliders) {
        if (b.max.y < 0.4 || b.min.y > 1.6) continue;
        const cx = THREE.MathUtils.clamp(s.pos.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(s.pos.z, b.min.z, b.max.z);
        const ex = s.pos.x - cx, ez = s.pos.z - cz, d2 = ex * ex + ez * ez;
        if (d2 < 0.09 && d2 > 1e-8) { const d = Math.sqrt(d2); s.pos.x += ex / d * (0.3 - d); s.pos.z += ez / d * (0.3 - d); }
      }

      // ---- facing: the player when visible, otherwise where we're going
      let wantYaw = s.yaw;
      if (los || (s.state === 'engage' && s.spotted)) wantYaw = Math.atan2(-(target.x - s.pos.x), -(target.z - s.pos.z));
      else if (s.speed > 0.3) wantYaw = Math.atan2(-mv.x, -mv.z);
      s.yaw += Math.atan2(Math.sin(wantYaw - s.yaw), Math.cos(wantYaw - s.yaw)) * Math.min(1, dt * 7);
      s.root.rotation.y = s.yaw;

      // ---- combat: wind-up, bursts, reload in a crouch
      s.fireCD -= dt; if (s.reloadT > 0) s.reloadT -= dt;
      const canShoot = los && s.state === 'engage' && distP < 38 && s.reloadT <= 0 && s.hitK < 0.5;
      if (canShoot && (s.shooting || shooters < MAX_SHOOTERS)) {
        if (!s.shooting) { s.shooting = true; shooters++; }
        s.aimT += dt;
        if (s.aimT > 0.8 * (this.enemies.fireMult || 1) && s.fireCD <= 0) {
          this.fire(s, target, player, distP, onPlayerHit, t);
          s.burst++;
          if (s.burst >= 3 + (s.bursts % 2)) { s.burst = 0; s.bursts++; s.fireCD = (1.6 + Math.random() * 1.4) * (this.enemies.fireMult || 1); s.aimT = 0.4; if (s.bursts % 3 === 0) s.reloadT = 2.2; }
          else s.fireCD = 0.11;
        }
      } else if (s.shooting && (!los || s.state !== 'engage' || s.reloadT > 0)) { s.shooting = false; shooters--; s.aimT = 0; }

      // flush a camper: engaged but blind for a while -> lob a grenade at the last seen spot
      if (los) s.lastSeen = new THREE.Vector3(target.x, 0, target.z);
      s.flushT = (s.state === 'engage' && !los && s.lastSeen) ? s.flushT + dt : 0;
      if (s.flushT > 3.5 && this.grenadeCD <= 0 && !this.nades.length && this.allowNades && s.lastSeen.distanceTo(s.pos) > 6 && s.lastSeen.distanceTo(s.pos) < 24) {
        this.throwNade(s, s.lastSeen); s.flushT = -6; this.grenadeCD = 14;
      }

      this.animate(s, dt, target);
    }
    this.grenadeCD -= dt;
    this.updateNades(dt, player, onPlayerHit, t);
  }

  throwNade(s, at) {
    const from = s.A.chest.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0));
    const tgt = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
    const T = 1.1, v = tgt.clone().sub(from).divideScalar(T); v.y = (tgt.y - from.y) / T + 0.5 * 9.8 * T;
    const mesh = (this.nadeProto ? this.nadeProto.clone() : new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), this.lib.M.darkSteel));
    mesh.position.copy(from); this.scene.add(mesh);
    this.nades.push({ mesh, vel: v, fuse: 2.6, warned: false });
    s.recoil = 1;
  }

  updateNades(dt, player, onPlayerHit, t) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i], p = n.mesh.position;
      n.fuse -= dt; n.vel.y -= 9.8 * dt; p.addScaledVector(n.vel, dt);
      n.mesh.rotation.x += dt * 9; n.mesh.rotation.z += dt * 5;
      if (p.y < 0.05) { p.y = 0.05; n.vel.y *= -0.3; n.vel.x *= 0.5; n.vel.z *= 0.5; }
      for (const b of this.level.colliders) { if (b.containsPoint(p)) { p.addScaledVector(n.vel, -dt * 1.5); n.vel.x *= -0.35; n.vel.z *= -0.35; break; } }
      const d = player.pos.distanceTo(p);
      if (!n.warned && d < 7) { n.warned = true; if (this.onNadeWarn) this.onNadeWarn(p); }
      if (n.warned && Math.random() < dt * 8 && this.audio.beep) this.audio.beep(p, 1500);
      if (n.fuse <= 0) {
        this.scene.remove(n.mesh); this.nades.splice(i, 1);
        const at = p.clone().add(new THREE.Vector3(0, 0.3, 0));
        this.effects.explosion(at, 1); this.audio.explosion(at);
        if (this.enemies.props) this.enemies.props.splash(at, 6, 30);
        this.splash(at, 4.5, 140);
        const eye = player.camera.position;
        const dd = eye.distanceTo(at);
        if (!player.dead && dd < 5.5 && !segmentBlocked(this.level, at, eye)) {
          const dmg = 70 * (1 - dd / 5.5); player.damage(dmg, at, t); if (onPlayerHit) onPlayerHit(at, dmg);
        }
        player.shake = Math.min(1, (player.shake || 0) + Math.max(0, 0.8 * (1 - dd / 16)));
      }
    }
  }

  fire(s, target, player, dist, onPlayerHit, t) {
    const mz = s.muzzle.getWorldPosition(new THREE.Vector3());
    // hit chance: distance, player movement, crouch, first burst is wild, difficulty
    const pv = Math.hypot(player.vel.x, player.vel.z);
    let p = 0.62 - dist * 0.013 - pv * 0.045 - (player.crouch || 0) * 0.12;
    if (s.bursts === 0) p *= 0.55;
    p = THREE.MathUtils.clamp(p / (this.enemies.fireMult || 1), 0.05, 0.7);
    const hit = Math.random() < p;
    let end;
    if (hit) {
      end = target.clone().add(new THREE.Vector3(0, -0.25, 0));
      player.damage(8, s.pos.clone(), t);
      if (onPlayerHit) onPlayerHit(s.pos.clone(), 8);
    } else {
      const dir = target.clone().sub(mz).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 2.2).add(new THREE.Vector3(0, (Math.random() - 0.3) * 1.2, 0));
      end = target.clone().add(side).addScaledVector(dir, 25);
      if (this.audio.whizz && dist > 4) this.audio.whizz(target.clone().add(side.multiplyScalar(0.3)));
    }
    this.effects.tracer(mz, end);
    this.effects.flash(mz, new THREE.Color(1, 0.7, 0.35), 5, 0.05, 6);
    this.effects.add.emit({ pos: mz, life: 0.05, size: 0.12, size1: 0.2, color: new THREE.Color(8, 5, 2.5), alpha: 1, alpha1: 0 });
    if (this.audio.enemyShot) this.audio.enemyShot(mz);
    s.recoil = 1;
  }

  animate(s, dt, target) {
    // gait
    const k = Math.min(1, s.speed / 3.3);
    s.phase += dt * (2.2 + s.speed * 2.3);
    const crouchWant = s.reloadT > 0 ? 1 : (s.state === 'engage' && !s.shooting ? 0.6 : 0);
    s.crouch += (crouchWant - s.crouch) * Math.min(1, dt * 5);
    const c = s.crouch * (1 - k);
    const sw = Math.sin(s.phase);
    // a footfall each half stride, audible within ~28 m
    if (k > 0.2 && Math.sign(sw) !== (s.lastSw || 0)) {
      s.lastSw = Math.sign(sw);
      if (this.audio.npcStep && target.distanceToSquared(s.pos) < 784) this.audio.npcStep(s.pos, s.speed > 2.5);
    }
    for (const [L, sgn] of [[s.legR, 1], [s.legL, -1]]) {
      const ph = sw * sgn;
      L.hip.rotation.x = ph * 0.6 * k + c * 1.25;
      L.knee.rotation.x = -(Math.max(0, -Math.sin(s.phase * sgn + 0.9)) * 1.1 * k) - c * 2.1;
    }
    const bob = Math.abs(Math.cos(s.phase)) * 0.05 * k;
    s.pelvis.position.y = 0.95 - c * 0.36 + bob;
    for (const L of [s.legR, s.legL]) L.hip.position.y = s.pelvis.position.y;
    // aim pitch at the player's head; flinch back when hit; recoil kick
    const eye = s.A.chest.getWorldPosition(new THREE.Vector3());
    const want = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
    s.aimPitch += (THREE.MathUtils.clamp(want, -0.6, 0.6) - s.aimPitch) * Math.min(1, dt * 6);
    s.recoil = Math.max(0, (s.recoil || 0) - dt * 10);
    const raised = s.shooting || s.state === 'engage' ? 1 : 0.35;
    s.torso.rotation.x = s.aimPitch * raised + s.hitK * 0.35 + s.recoil * 0.05 - k * 0.12 + c * 0.15;
    s.torso.rotation.y = s.hitK * 0.2 * Math.sin(s.phase * 3);
    // arms hold the rifle: raised to the shoulder when engaging, low ready when running
    const up = raised;
    s.armR.sh.rotation.set(0.35 + up * 0.5, 0, -0.32); s.armR.el.rotation.x = 0.75 - up * 0.2;
    s.armL.sh.rotation.set(0.75 + up * 0.45, 0, 0.5); s.armL.el.rotation.x = 0.35;
    s.rifle.position.set(0.06, 0.25 + up * 0.08, -0.26 - up * 0.04);
    s.rifle.rotation.x = (1 - up) * -0.5 - s.recoil * 0.08;
  }

  updateDeath(s, dt) {
    s.dead += dt;
    const k = Math.min(1, s.dead / 0.7);
    const e = k * k;
    // knees give, then the body topples away from the shot
    s.root.rotation.set(0, s.fallDir, 0, 'YXZ');
    s.root.rotateX(e * Math.PI * 0.47);
    s.pelvis.position.y = 0.95 - e * 0.25;
    for (const L of [s.legR, s.legL]) { L.hip.position.y = s.pelvis.position.y; L.knee.rotation.x = -e * 0.6; }
    s.torso.rotation.x = -e * 0.2;
    s.armR.sh.rotation.x = s.armL.sh.rotation.x = 0.3 + e * 1.8;
    if (s.dead > 14) s.pos.y -= dt * 0.3;
    if (s.dead > 17) { this.scene.remove(s.root); s.removed = true; }
  }

  clear() { for (const s of this.list) this.scene.remove(s.root); this.list = []; for (const n of this.nades) this.scene.remove(n.mesh); this.nades = []; this.grenadeCD = 8; }
  prune() { this.list = this.list.filter((s) => !s.removed); }
}
