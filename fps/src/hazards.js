// Explosive fuel drums. A hit punctures the drum: it vents burning fuel for a
// couple of seconds and then detonates (immediately if hit hard / chained).
// Blasts damage drones, the boss, the player and set off neighbouring drums.
import * as THREE from 'three';

const SPOTS = [[5.2, -2.2], [-4.6, -5.4], [10.4, -12.4], [-10.5, 11.4], [1.5, -14.6], [13.6, 11.2]];
const HP = 30;

function labelTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  for (let k = 0; k < 2; k++) {
    const x0 = k * 256;
    g.fillStyle = '#e8c21c'; g.beginPath(); g.moveTo(x0 + 60, 14); g.lineTo(x0 + 106, 64); g.lineTo(x0 + 60, 114); g.lineTo(x0 + 14, 64); g.closePath(); g.fill();
    g.fillStyle = '#c0281a'; g.beginPath(); g.moveTo(x0 + 60, 36); g.quadraticCurveTo(x0 + 82, 62, x0 + 60, 92); g.quadraticCurveTo(x0 + 38, 62, x0 + 60, 36); g.fill();
    g.fillStyle = '#f2efe6'; g.font = '900 34px "Arial Black",Arial,"PingFang SC","Microsoft YaHei",sans-serif'; g.textBaseline = 'middle';
    g.fillText('易燃', x0 + 118, 46); g.font = 'bold 22px Arial,sans-serif'; g.fillText('FLAMMABLE', x0 + 118, 84);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Hazards {
  constructor(scene, lib, level, effects, audio) {
    this.scene = scene; this.level = level; this.effects = effects; this.audio = audio;
    const M = lib.M;
    const r = 0.29, h = 0.88;
    const pts = [new THREE.Vector2(0, 0.005), new THREE.Vector2(r - 0.01, 0), new THREE.Vector2(r, 0.02)];
    for (const hy of [0.29, 0.59]) pts.push(new THREE.Vector2(r, hy - 0.025), new THREE.Vector2(r + 0.012, hy), new THREE.Vector2(r, hy + 0.025));
    pts.push(new THREE.Vector2(r, h - 0.02), new THREE.Vector2(r - 0.01, h), new THREE.Vector2(r - 0.02, h - 0.012), new THREE.Vector2(0, h - 0.012));
    const geo = new THREE.LatheGeometry(pts, 32);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.8, uv.getY(i) * 0.9);
    const bandMat = new THREE.MeshStandardMaterial({ map: labelTex(), transparent: true, alphaTest: 0.3, roughness: 0.5 });
    const band = new THREE.CylinderGeometry(r + 0.004, r + 0.004, 0.2, 32, 1, true);
    this.list = SPOTS.map(([x, z], i) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = i * 1.7;
      const body = new THREE.Mesh(geo, M.paintRed); body.castShadow = body.receiveShadow = true; g.add(body);
      const lab = new THREE.Mesh(band, bandMat); lab.position.y = 0.44; g.add(lab);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), M.darkSteel); cap.position.set(0.15, h - 0.005, 0); g.add(cap);
      scene.add(g);
      const box = new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, h, z + r));
      level.colliders.push(box);
      const drum = { g, body, box, hp: HP, burning: 0, fuse: -1, alive: true, pos: new THREE.Vector3(x, 0.45, z) };
      body.userData.surf = 'metal'; body.userData.drum = drum;
      level.rayMeshes.push(body);
      return drum;
    });
    this.pending = [];
  }

  damage(drum, amount, point) {
    if (!drum.alive) return;
    drum.hp -= amount;
    if (drum.hp <= 0) { drum.fuse = 0.05; return; }
    if (drum.fuse < 0) { drum.fuse = 2.4; drum.leak = point ? point.clone() : drum.pos.clone(); this.audio.charge && this.audio.charge(drum.pos); }
  }

  splash(pos, radius) {
    for (const d of this.list) if (d.alive) { const dd = d.pos.distanceTo(pos); if (dd < radius) this.damage(d, 100 * (1 - dd / radius) + 20, d.pos); }
  }

  update(dt, ctx) {
    for (const d of this.list) {
      if (!d.alive || d.fuse < 0) continue;
      d.fuse -= dt;
      // burning fuel jet from the puncture
      const p = d.leak || d.pos;
      if (Math.random() < dt * 60) this.effects.add.emit({ pos: p, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.6 + Math.random(), (Math.random() - 0.5) * 0.6), life: 0.35, size: 0.18, size1: 0.45, color: new THREE.Color(8, 3.2, 0.8), color1: new THREE.Color(2, 0.4, 0.1), alpha: 0.9, alpha1: 0 });
      if (Math.random() < dt * 12) {
        const c = new THREE.Color(0.1, 0.09, 0.08).multiply(this.effects.ambient).multiplyScalar(2.4);
        this.effects.smoke.emit({ pos: p.clone().add(new THREE.Vector3(0, 0.4, 0)), vel: new THREE.Vector3(0, 1.2, 0), life: 2.2, size: 0.25, size1: 1.4, color: c, alpha: 0.5, alpha1: 0, drag: 0.6, gravity: -0.4, fadeIn: 0.05 });
      }
      const L = this.effects.lights[1]; L.light.position.copy(p).add(new THREE.Vector3(0, 0.5, 0)); L.light.color.setRGB(1, 0.5, 0.2); L.light.distance = 6; L.peak = 8 + Math.random() * 4; L.t = 0; L.dur = 0.1; L.light.intensity = L.peak;
      if (d.fuse <= 0) this.explode(d, ctx);
    }
  }

  explode(d, { enemies, boss, player, t, onPlayerHit }) {
    d.alive = false;
    this.scene.remove(d.g);
    const i = this.level.colliders.indexOf(d.box); if (i >= 0) this.level.colliders.splice(i, 1);
    const j = this.level.rayMeshes.indexOf(d.body); if (j >= 0) this.level.rayMeshes.splice(j, 1);
    const pos = d.pos.clone().add(new THREE.Vector3(0, 0.3, 0));
    this.effects.explosion(pos, 1.6);
    this.audio.explosion(pos);
    this.effects.decal(new THREE.Vector3(pos.x, 0.003, pos.z), new THREE.Vector3(0, 1, 0), 2.2);
    // lid flies off
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 24), d.body.material);
    this.effects.spawnDebris(lid, pos.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3((Math.random() - 0.5) * 3, 9, (Math.random() - 0.5) * 3), true);
    const R = 6.5;
    for (const e of enemies.list.slice()) { const dd = e.pos.distanceTo(pos); if (dd < R) enemies.damage(e, 220 * (1 - dd / R), e.pos.clone(), e.pos.clone().sub(pos).normalize()); }
    if (boss) boss.splash(pos, R + 1, 200);
    const dp = player.camera.position.distanceTo(pos);
    if (dp < 5.5) { const dmg = 80 * (1 - dp / 5.5); player.damage(dmg, pos, t); onPlayerHit && onPlayerHit(pos, dmg); }
    player.shake = Math.min(1, player.shake + Math.max(0, 0.9 * (1 - dp / 20)));
    // chain reaction
    for (const o of this.list) if (o.alive && o.pos.distanceTo(pos) < 3.5) { o.fuse = Math.min(o.fuse < 0 ? 9 : o.fuse, 0.18 + Math.random() * 0.15); o.leak = o.pos.clone(); }
    if (this.onExplode) this.onExplode(pos);
  }

  reset() {
    for (const d of this.list) {
      if (!d.alive) { this.scene.add(d.g); this.level.colliders.push(d.box); this.level.rayMeshes.push(d.body); }
      d.alive = true; d.hp = HP; d.fuse = -1; d.leak = null;
    }
  }
}
