// Frag grenades: thrown with G, bounce off the level's boxes with restitution
// and friction, explode after a fuse with distance-falloff damage.
import * as THREE from 'three';
import { segmentBlocked } from './enemies.js';

const R = 0.045;

export class Grenades {
  constructor(scene, lib, effects, level, audio) {
    this.scene = scene; this.effects = effects; this.level = level; this.audio = audio;
    this.count = 3; this.max = 4; this.cool = 0;
    this.list = [];
    const body = lib.M.gunMetal.clone(); body.color = new THREE.Color(1.6, 2.0, 1.1);
    const pts = [[0, -0.04], [0.02, -0.038], [0.033, -0.025], [0.037, 0], [0.034, 0.022], [0.024, 0.035], [0.014, 0.04], [0.014, 0.05], [0, 0.05]].map(([x, y]) => new THREE.Vector2(x, y));
    this.proto = new THREE.Group();
    const b = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), body); this.proto.add(b);
    const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.006), lib.M.steel); spoon.position.set(0.03, 0.02, 0); spoon.rotation.z = -0.25; this.proto.add(spoon);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0022, 6, 16), lib.M.steel); ring.position.set(-0.012, 0.055, 0); this.proto.add(ring);
    this.proto.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // launch state shared by the preview and the real throw
  launch(camera, playerVel) {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const pos = camera.position.clone().addScaledVector(fwd, 0.35).addScaledVector(right, -0.12).add(new THREE.Vector3(0, -0.08, 0));
    const vel = fwd.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.2, 0)).add(playerVel.clone().multiplyScalar(0.8));
    return { pos, vel };
  }

  // dotted arc to the first impact + a ring where it lands
  showPreview(camera, playerVel) {
    if (!this.dots) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.7), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), mat, 40);
      this.dots.frustumCulled = false; this.dots.userData.noAO = true; this.dots.renderOrder = 13; this.scene.add(this.dots);
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 40).rotateX(-Math.PI / 2), mat.clone()); this.ring.userData.noAO = true; this.scene.add(this.ring);
    }
    const { pos, vel } = this.launch(camera, playerVel);
    const p = pos.clone(), v = vel.clone(), m = new THREE.Matrix4();
    let n = 0, hit = null; const h = 1 / 60;
    for (let i = 0; i < 160 && !hit; i++) {
      v.y -= 9.8 * h; p.addScaledVector(v, h);
      for (const b of this.level.colliders) if (b.containsPoint(p)) { hit = p.clone(); break; }
      if (i >= 9 && i % 4 === 0 && n < 40) { m.makeTranslation(p.x, p.y, p.z); this.dots.setMatrixAt(n++, m); } // skip the first ~2 m (would fill the screen)
    }
    this.dots.count = n; this.dots.instanceMatrix.needsUpdate = true; this.dots.visible = true;
    this.ring.visible = !!hit;
    if (hit) this.ring.position.set(hit.x, hit.y + 0.03, hit.z);
  }
  hidePreview() { if (this.dots) { this.dots.visible = false; this.ring.visible = false; } }

  canThrow(weapon) { return this.count > 0 && this.cool <= 0 && !weapon.reloading; }

  throw(camera, playerVel) {
    this.count--; this.cool = 1.0;
    this.hidePreview();
    const { pos, vel } = this.launch(camera, playerVel);
    const mesh = this.proto.clone();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.list.push({ mesh, vel, spin: new THREE.Vector3(Math.random() * 14 - 7, Math.random() * 10, 12), fuse: 2.4, bounces: 0 });
    this.audio.grenadeThrow && this.audio.grenadeThrow();
  }

  update(dt, ctx) {
    this.cool -= dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      const steps = 4, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vel.y -= 9.8 * h;
        g.mesh.position.addScaledVector(g.vel, h);
        const p = g.mesh.position;
        for (const b of this.level.colliders) {
          const c = new THREE.Vector3(THREE.MathUtils.clamp(p.x, b.min.x, b.max.x), THREE.MathUtils.clamp(p.y, b.min.y, b.max.y), THREE.MathUtils.clamp(p.z, b.min.z, b.max.z));
          const d = p.clone().sub(c); let l = d.length();
          if (l >= R) continue;
          let n;
          if (l > 1e-6) n = d.divideScalar(l);
          else { n = new THREE.Vector3(0, 1, 0); l = 0; } // centre inside: pop up
          p.addScaledVector(n, R - l);
          const vn = g.vel.dot(n);
          if (vn < 0) {
            g.vel.addScaledVector(n, -1.38 * vn);              // restitution 0.38
            const vt = g.vel.clone().addScaledVector(n, -g.vel.dot(n));
            g.vel.addScaledVector(vt, -0.35);                 // friction
            g.spin.multiplyScalar(0.6);
            if (-vn > 1.4) { g.bounces++; this.audio.grenadeBounce && this.audio.grenadeBounce(p, Math.min(-vn / 8, 1)); }
          }
        }
      }
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt; g.mesh.rotation.z += g.spin.z * dt;
      if (g.fuse <= 0) { this.explode(g.mesh.position.clone(), ctx); this.scene.remove(g.mesh); this.list.splice(i, 1); }
    }
  }

  explode(pos, { enemies, player, t, onPlayerHit, boss, hazards, walkers }) {
    if (walkers) walkers.splash(pos, 7, 230);
    if (hazards) hazards.splash(pos, 6);
    if (this.props) this.props.splash(pos, 7, 40);
    if (boss) boss.splash(pos, 7.5, 210);
    this.effects.explosion(pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 1.25);
    this.audio.explosion(pos);
    if (pos.y < 0.3) this.effects.decal(new THREE.Vector3(pos.x, 0.002, pos.z), new THREE.Vector3(0, 1, 0), 1.6);
    // debris/dirt kick-up
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 7, (Math.random() - 0.5) * 8);
      this.effects.smoke.emit({ pos, vel: v, life: 1 + Math.random(), size: 0.03 + Math.random() * 0.04, color: new THREE.Color(0.12, 0.11, 0.1), alpha: 1, alpha1: 1, gravity: 9.8, drag: 0.4, rotVel: 10, bounce: true });
    }
    for (const e of enemies.list.slice()) {
      const d = e.pos.distanceTo(pos);
      if (d > 7.5) continue;
      let dmg = 210 * Math.pow(1 - d / 7.5, 1.3);
      if (segmentBlocked(this.level, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), e.pos)) dmg *= 0.35;
      const dir = e.pos.clone().sub(pos).normalize();
      e.vel.addScaledVector(dir, 6 * (1 - d / 7.5));
      enemies.damage(e, dmg, e.pos.clone(), dir);
    }
    const pc = player.camera.position;
    const dp = pc.distanceTo(pos);
    if (dp < 5.5 && !segmentBlocked(this.level, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), pc)) {
      const dmg = 75 * Math.pow(1 - dp / 5.5, 1.2);
      player.damage(dmg, pos, t);
      onPlayerHit && onPlayerHit(pos, dmg);
    }
    player.shake = Math.min(1, player.shake + Math.max(0, 0.9 * (1 - dp / 22)));
  }

  clear() { for (const g of this.list) this.scene.remove(g.mesh); this.list = []; this.count = 3; }
}
