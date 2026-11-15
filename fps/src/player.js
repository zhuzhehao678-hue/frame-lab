import * as THREE from 'three';
import { rayColliders } from './enemies.js';

const RADIUS = 0.34;
const STAND_H = 1.78, CROUCH_H = 1.15;
const EYE_STAND = 1.64, EYE_CROUCH = 1.02;
const STEP = 0.45;
const GRAVITY = 17;

export class Player {
  constructor(camera, level) {
    this.camera = camera;
    this.level = level;
    this.pos = level.playerStart.clone();
    this.vel = new THREE.Vector3();
    this.yaw = level.playerYaw; this.pitch = 0;
    this.onGround = true;
    this.crouch = 0;           // 0..1 animated
    this.eyeSmooth = 0;        // smoothing for step-ups
    this.health = 100; this.maxHealth = 100;
    this.lastDamage = -10;
    this.dead = false;
    this.bobPhase = 0; this.bobAmp = 0;
    this.landKick = 0; this.landVel = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.shake = 0;
    this.speed = 0;
    this.sprinting = false;
    this.stepDist = 0;
    this.onStep = null; this.onLand = null;
    this.ads = 0;
    this.lean = 0; this.leanOff = 0;
    this.dmgScale = 0.62; // tuned survivability (armour plating)
  }

  get height() { return THREE.MathUtils.lerp(STAND_H, CROUCH_H, this.crouch); }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
  }

  groundHeightAt(x, z, feet, r = RADIUS * 0.8) {
    let g = -Infinity;
    for (const b of this.level.colliders) {
      if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) continue;
      if (b.max.y <= feet + STEP + 0.001 && b.max.y > g) g = b.max.y;
    }
    return g;
  }

  collideXZ(feet, head) {
    const p = this.pos;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const b of this.level.colliders) {
        if (b.max.y <= feet + STEP || b.min.y >= head || b.max.y <= 0.05) continue; // never shove sideways out of the ground slab
        const cx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x);
        const cz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z);
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = RADIUS - d;
          p.x += dx / d * push; p.z += dz / d * push;
          const nx = dx / d, nz = dz / d;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
        } else {
          // centre inside box: push out along smallest axis
          const ox = Math.min(p.x - b.min.x, b.max.x - p.x);
          const oz = Math.min(p.z - b.min.z, b.max.z - p.z);
          if (ox < oz) p.x = (p.x - b.min.x < b.max.x - p.x) ? b.min.x - RADIUS : b.max.x + RADIUS;
          else p.z = (p.z - b.min.z < b.max.z - p.z) ? b.min.z - RADIUS : b.max.z + RADIUS;
        }
      }
      if (!hit) break;
    }
  }

  // is the capsule at (x, feet, z) free of colliders?
  freeAt(x, feet, z, height = STAND_H) {
    for (const b of this.level.colliders) {
      if (b.max.y <= feet + 0.02 || b.min.y >= feet + height) continue;
      if (x + RADIUS > b.min.x && x - RADIUS < b.max.x && z + RADIUS > b.min.z && z - RADIUS < b.max.z) return false;
    }
    return true;
  }

  // look for a waist-high obstacle straight ahead that can be vaulted/mantled
  tryVault(fwd) {
    const feet = this.pos.y;
    for (const reach of [0.45, 0.7, 0.95]) {
      const px = this.pos.x + fwd.x * reach, pz = this.pos.z + fwd.z * reach;
      for (const b of this.level.colliders) {
        const top = b.max.y - feet;
        if (top < 0.5 || top > 1.35) continue;
        if (px < b.min.x - 0.05 || px > b.max.x + 0.05 || pz < b.min.z - 0.05 || pz > b.max.z + 0.05) continue;
        // depth of the obstacle along fwd: march until we're past it
        // march forward: find where the ray enters and then leaves the box
        let over = -1, entered = false;
        for (let d = 0; d < 4.5; d += 0.05) {
          const x = this.pos.x + fwd.x * d, z = this.pos.z + fwd.z * d;
          const inside = x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
          if (inside) entered = true; else if (entered) { over = d; break; }
        }
        if (over < 0) continue;
        const land = new THREE.Vector3(this.pos.x + fwd.x * (over + RADIUS + 0.15), feet, this.pos.z + fwd.z * (over + RADIUS + 0.15));
        const g = this.groundHeightAt(land.x, land.z, b.max.y);
        const topPt = new THREE.Vector3(this.pos.x + fwd.x * (reach + 0.2), b.max.y, this.pos.z + fwd.z * (reach + 0.2));
        if (!this.freeAt(topPt.x, b.max.y, topPt.z, CROUCH_H)) continue;
        if (over - reach < 1.6 && g > -1 && Math.abs(g - feet) < 0.6 && this.freeAt(land.x, g, land.z)) { land.y = g; return { from: this.pos.clone(), apex: b.max.y + 0.15, to: land, t: 0, dur: 0.55, kind: 'vault' }; }
        if (this.freeAt(topPt.x, b.max.y, topPt.z)) return { from: this.pos.clone(), apex: b.max.y + 0.1, to: topPt, t: 0, dur: 0.6, kind: 'mantle' };
      }
    }
    return null;
  }

  update(dt, input, time) {
    if (this.dead) { this.updateCamera(dt, time); return; }
    // ----- scripted vault / mantle
    if (this.vault) {
      const v = this.vault; v.t += dt / v.dur;
      const s = Math.min(1, v.t), e = s * s * (3 - 2 * s);
      this.pos.lerpVectors(v.from, v.to, e);
      const rise = v.kind === 'vault' ? Math.sin(s * Math.PI) : Math.min(1, s * 1.6);
      this.pos.y = THREE.MathUtils.lerp(v.from.y, v.to.y, e) + Math.max(0, v.apex - Math.max(v.from.y, v.to.y)) * rise;
      this.vaultRoll = Math.sin(s * Math.PI) * (v.kind === 'vault' ? 0.12 : 0.05);
      if (s >= 1) { this.vault = null; this.vaultRoll = 0; this.onGround = true; this.vel.set(0, 0, 0); if (this.onLand) this.onLand(3); }
      this.speed = 3; this.updateCamera(dt, time); return;
    }
    // ----- intent
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (input.f) wish.add(fwd); if (input.b) wish.sub(fwd);
    if (input.r) wish.add(right); if (input.l) wish.sub(right);
    if (input.moveX || input.moveY) {
      // analog stick
      wish.set(0, 0, 0).addScaledVector(fwd, -input.moveY).addScaledVector(right, input.moveX);
      if (wish.lengthSq() > 1) wish.normalize();
    } else if (wish.lengthSq() > 0) wish.normalize();

    const wantLean = this.sprinting ? 0 : (input.leanR ? 1 : 0) - (input.leanL ? 1 : 0);
    this.lean = THREE.MathUtils.damp(this.lean, wantLean, 11, dt);
    // slide: crouch while sprinting
    if (input.crouch && !this.crouchHeld && this.sprinting && this.onGround && !this.slideT) {
      const hvx = new THREE.Vector3(this.vel.x, 0, this.vel.z);
      const dir = hvx.lengthSq() > 0.1 ? hvx.normalize() : fwd.clone();
      const sp = Math.max(this.speed, 6.5) * 1.35;
      this.vel.x = dir.x * sp; this.vel.z = dir.z * sp;
      this.slideT = 0.85; this.slideDir = dir;
      if (this.onSlide) this.onSlide();
    }
    this.crouchHeld = input.crouch;
    if (this.slideT) {
      this.slideT = Math.max(0, this.slideT - dt);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs < 2.6 || !this.onGround) this.slideT = 0;
    }
    const wantCrouch = input.crouch || this.slideT > 0;
    this.crouch = THREE.MathUtils.damp(this.crouch, wantCrouch ? 1 : 0, 12, dt);
    this.sprinting = input.sprint && (input.f || input.moveY < -0.5) && !input.crouch && !this.slideT && this.ads < 0.3 && !input.firing;
    let maxSpeed = this.sprinting ? 7.0 : 4.4;
    if (this.crouch > 0.5) maxSpeed = 2.3;
    if (this.ads > 0.5) maxSpeed = Math.min(maxSpeed, 3.7);
    if (Math.abs(this.lean) > 0.3) maxSpeed = Math.min(maxSpeed, 2.6);

    // ----- acceleration / friction (ground vs air)
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (this.onGround) {
      const sp = hv.length();
      if (this.slideT > 0) {
        // low friction, slight steering
        if (sp > 0) hv.multiplyScalar(Math.max(sp - sp * 1.6 * dt, 0) / sp);
        hv.addScaledVector(wish, 2.5 * dt);
      } else {
        if (sp > 0) { const drop = sp * 10 * dt; hv.multiplyScalar(Math.max(sp - drop, 0) / sp); }
        const cur = hv.dot(wish);
        const add = maxSpeed - cur;
        if (add > 0) hv.addScaledVector(wish, Math.min(70 * dt * maxSpeed * 0.2, add));
      }
      if (input.jump && (this.crouch < 0.5 || this.slideT > 0)) {
        input.jump = false;
        const v = this.tryVault(fwd);
        if (v) { this.vault = v; this.slideT = 0; if (this.onVault) this.onVault(v.kind); return this.updateCamera(dt, time); }
        this.vel.y = 5.4; this.onGround = false; this.slideT = 0;
      }
    } else {
      const cur = hv.dot(wish);
      const add = maxSpeed * 0.8 - cur;
      if (add > 0) hv.addScaledVector(wish, Math.min(12 * dt, add));
    }
    this.vel.x = hv.x; this.vel.z = hv.z;
    this.speed = hv.length();

    // ----- integrate with substeps
    const steps = 3; const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.vel.y -= GRAVITY * h;
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h;
      this.collideXZ(this.pos.y, this.pos.y + this.height);
      const wasGround = this.onGround;
      const g = this.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
      // step up
      if (g > this.pos.y && g - this.pos.y <= STEP + 0.001 && this.vel.y <= 0.1) {
        this.eyeSmooth -= (g - this.pos.y);
        this.pos.y = g;
      }
      this.pos.y += this.vel.y * h;
      // ceiling
      if (this.vel.y > 0) {
        for (const b of this.level.colliders) {
          if (this.pos.x + RADIUS < b.min.x || this.pos.x - RADIUS > b.max.x || this.pos.z + RADIUS < b.min.z || this.pos.z - RADIUS > b.max.z) continue;
          const head = this.pos.y + this.height;
          const headBefore = head - this.vel.y * h;
          // only something that was above our head before this step is a ceiling
          if (b.min.y < head && b.min.y >= headBefore - 0.02) { this.pos.y = Math.max(b.min.y - this.height, this.pos.y - this.vel.y * h); this.vel.y = 0; }
        }
      }
      const g2 = this.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y <= g2) {
        if (!wasGround && this.vel.y < -3 && this.onLand) this.onLand(-this.vel.y);
        if (!wasGround) this.landVel = Math.min(-this.vel.y, 12);
        this.pos.y = g2; this.vel.y = 0; this.onGround = true;
      } else if (wasGround && this.vel.y <= 0 && this.pos.y - g2 < STEP + 0.05) {
        // snap down stairs
        this.eyeSmooth += (this.pos.y - g2);
        this.pos.y = g2; this.vel.y = 0; this.onGround = true;
      } else {
        this.onGround = false;
      }
    }
    if (this.pos.y < -0.3 && Math.abs(this.pos.x) < 30 && this.pos.z > -26 && this.pos.z < 29) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    if (this.pos.y < -10) { this.pos.copy(this.level.playerStart); this.vel.set(0, 0, 0); }

    // footsteps
    if (this.onGround && this.speed > 0.5) {
      this.stepDist += this.speed * dt;
      const stride = this.sprinting ? 2.1 : (this.crouch > 0.5 ? 1.2 : 1.7);
      if (this.stepDist > stride) { this.stepDist = 0; this.onStep && this.onStep(this.speed, this.sprinting); }
    }

    // regen
    if (time - this.lastDamage > 3.2 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 34 * dt);

    this.updateCamera(dt, time);
  }

  damage(amount, fromPos, time) {
    if (this.dead) return;
    amount *= this.dmgScale;
    this.health -= amount;
    this.lastDamage = time;
    this.shake = Math.min(this.shake + amount * 0.025, 1.0);
    if (this.health <= 0) { this.health = 0; this.dead = true; this.deathTime = time; }
  }

  addRecoil(p, y) { this.recoilPitch += p; this.recoilYaw += y; }

  updateCamera(dt, time) {
    const cam = this.camera;
    // bob
    const moving = this.onGround ? THREE.MathUtils.clamp(this.speed / 4.4, 0, 1.6) : 0;
    this.bobAmp = THREE.MathUtils.damp(this.bobAmp, moving, 8, dt);
    this.bobPhase += dt * (this.sprinting ? 13.5 : 10.0) * Math.min(1, this.speed / 2 + 0.2);
    const adsDamp = 1 - this.ads * 0.8;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmp * adsDamp;
    const bobX = Math.cos(this.bobPhase) * 0.022 * this.bobAmp * adsDamp;

    // landing spring
    this.landKick += this.landVel * 0.012; this.landVel = 0;
    this.landKick = THREE.MathUtils.damp(this.landKick, 0, 9, dt);
    this.eyeSmooth = THREE.MathUtils.damp(this.eyeSmooth, 0, 14, dt);

    // recoil recovery
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 9, dt);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 9, dt);

    this.shake = THREE.MathUtils.damp(this.shake, 0, 4, dt);
    const sh = this.shake * this.shake;
    const n = (k) => Math.sin(time * 37.0 * k + k * 3.1) * Math.sin(time * 23.0 * k);

    let eye = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouch);
    if (this.dead) {
      const t = Math.min((time - this.deathTime) / 1.2, 1);
      eye = THREE.MathUtils.lerp(eye, 0.35, t * t);
    }
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(this.pos.x, this.pos.y + eye - bobY - this.landKick + this.eyeSmooth, this.pos.z).addScaledVector(right, bobX);
    // lean / peek: shift the head sideways (clamped against walls) and roll
    if (Math.abs(this.lean) > 0.001) {
      const side = right.clone().multiplyScalar(Math.sign(this.lean));
      const want = Math.abs(this.lean) * 0.42;
      const free = rayColliders(this.level, cam.position, side, want + 0.2) - 0.2;
      this.leanOff = THREE.MathUtils.damp(this.leanOff, Math.max(0, Math.min(want, free)) * Math.sign(this.lean), 20, dt);
    } else this.leanOff = THREE.MathUtils.damp(this.leanOff, 0, 20, dt);
    cam.position.addScaledVector(right, this.leanOff);
    cam.position.y -= Math.abs(this.leanOff) * 0.12;
    const roll = (this.vaultRoll || 0) + (this.slideT > 0 ? 0.07 : 0) - this.lean * 0.17 - Math.cos(this.bobPhase) * 0.004 * this.bobAmp + n(1.3) * sh * 0.03 + (this.dead ? Math.min((time - this.deathTime), 1) * 0.6 : 0);
    cam.rotation.set(this.pitch + this.recoilPitch + n(1.0) * sh * 0.03, this.yaw + this.recoilYaw + n(0.7) * sh * 0.03, roll, 'YXZ');
  }
}
