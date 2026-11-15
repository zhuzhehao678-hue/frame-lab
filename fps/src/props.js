// Loose props (traffic cones, cardboard boxes) with a small rigid-body
// solver: bullets, blasts and the player's legs knock them about; they
// tumble, bounce off the slab and walls, then settle onto a stable face.
import * as THREE from 'three';

const BOX_SPOTS = [[-12.6, 4.2, 0.3], [-12.9, 4.9, 1.1], [6.2, 6.0, 0.5], [6.7, 6.4, 0.2], [-3.2, -8.2, 0.9], [9.2, -4.2, 0.1], [-8.2, 10.2, 0.6], [-8.6, 10.7, 1.4]];
const G = 9.8;

function cardboardTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#a77c4e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,40,20' : '200,170,120'},${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1); }
  g.fillStyle = 'rgba(205,190,160,0.85)'; g.fillRect(112, 0, 32, 256);                // packing tape
  g.strokeStyle = '#2b2118'; g.lineWidth = 4; g.strokeRect(24, 150, 70, 70);           // print
  g.fillStyle = '#2b2118'; g.font = 'bold 22px Arial'; g.fillText('↑↑', 40, 195); g.font = 'bold 16px Arial'; g.fillText('PIER 9', 160, 60); g.fillText('FRAGILE', 154, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Props {
  constructor(scene, lib, level, audio) {
    this.level = level; this.audio = audio; this.list = [];
    const M = lib.M;
    // cone: centre of mass ~0.22 m above the base
    const pts = [[0, 0.03], [0.17, 0.03], [0.17, 0.0], [0.19, 0.0], [0.19, 0.035], [0.12, 0.05], [0.035, 0.7], [0.0, 0.71]].map(([a, b]) => new THREE.Vector2(a, b - 0.22));
    const coneGeo = new THREE.LatheGeometry(pts, 20);
    const bandGeo = new THREE.CylinderGeometry(0.083, 0.095, 0.1, 20, 1, true).translate(0, 0.47 - 0.22, 0);
    const coneHull = [new THREE.Vector3(0, 0.49, 0)];
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; coneHull.push(new THREE.Vector3(Math.cos(a) * 0.19, -0.22, Math.sin(a) * 0.19)); }
    const boxMat = new THREE.MeshStandardMaterial({ map: cardboardTex(), roughness: 0.92, metalness: 0 });
    for (const [x, z, ry] of level.coneSpots || []) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(coneGeo, M.cone); body.castShadow = body.receiveShadow = true; g.add(body);
      const band = new THREE.Mesh(bandGeo, M.reflective); g.add(band);
      this.add(scene, g, body, x, 0.22, z, ry, { hull: coneHull, r: 0.22, mass: 3, surf: 'wood', kind: 'cone', upright: true });
    }
    for (const [x, z, ry] of BOX_SPOTS) {
      const s = 0.42 + Math.random() * 0.12, h = s * (0.6 + Math.random() * 0.3);
      if (level.colliders.some((b) => x + s > b.min.x && x - s < b.max.x && z + s > b.min.z && z - s < b.max.z && b.max.y > 0.1)) continue;
      const geo = new THREE.BoxGeometry(s, h, s * 0.8);
      const body = new THREE.Mesh(geo, boxMat); body.castShadow = body.receiveShadow = true;
      const g = new THREE.Group(); g.add(body);
      const hull = []; for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) hull.push(new THREE.Vector3(a * s / 2, b * h / 2, c * s * 0.4));
      this.add(scene, g, body, x, h / 2, z, ry, { hull, r: Math.max(s, h) * 0.55, mass: 2, surf: 'wood', kind: 'box' });
    }
  }

  add(scene, g, body, x, y, z, ry, o) {
    g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
    const p = { g, body, pos: g.position, q: g.quaternion, vel: new THREE.Vector3(), w: new THREE.Vector3(), rest: true, home: [x, y, z, ry], ...o };
    body.userData.surf = o.surf; body.userData.prop = p;
    this.level.rayMeshes.push(body);
    this.list.push(p);
  }

  // impulse J (world, N·s) applied at world point
  push(p, J, point) {
    p.vel.addScaledVector(J, 1 / p.mass);
    const rel = point.clone().sub(p.pos);
    p.w.add(rel.cross(J).multiplyScalar(2.5 / (p.mass * p.r * p.r)));
    p.rest = false; p.restT = 0;
  }

  hit(p, point, dir, dmg) { this.push(p, dir.clone().multiplyScalar(dmg * 0.09).add(new THREE.Vector3(0, dmg * 0.03, 0)), point); }

  splash(pos, radius, strength = 30) {
    for (const p of this.list) {
      const d = p.pos.distanceTo(pos); if (d > radius) continue;
      const dir = p.pos.clone().sub(pos).normalize(); dir.y = Math.abs(dir.y) + 0.6; dir.normalize();
      const k = (1 - d / radius) * strength * p.mass * 0.22; // ~9 m/s at point blank for strength 40
      this.push(p, dir.multiplyScalar(k), p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.1, (Math.random() - 0.5) * 0.3)));
    }
  }

  update(dt, player) {
    const pp = player.pos, pv = player.vel;
    for (const p of this.list) {
      // the player's legs shove props aside
      const dx = p.pos.x - pp.x, dz = p.pos.z - pp.z, d2 = dx * dx + dz * dz, rr = p.r + 0.35;
      if (d2 < rr * rr && p.pos.y < pp.y + 0.9) {
        const sp = Math.hypot(pv.x, pv.z);
        if (sp > 0.5) {
          const n = new THREE.Vector3(dx, 0, dz).normalize();
          this.push(p, n.multiplyScalar(sp * p.mass * 0.6).add(new THREE.Vector3(pv.x, 0, pv.z).multiplyScalar(p.mass * 0.25)).add(new THREE.Vector3(0, p.mass * 0.8, 0)), p.pos.clone().add(new THREE.Vector3(0, 0.15, 0)));
          if (sp > 3 && this.audio.impact && (p.kickT || 0) <= 0) { this.audio.impact(p.pos, p.surf); p.kickT = 0.4; }
        }
      }
      if (p.kickT > 0) p.kickT -= dt;
      if (p.rest) continue;
      const steps = 2, h = dt / steps;
      for (let s = 0; s < steps; s++) this.step(p, h);
    }
  }

  step(p, h) {
    p.vel.y -= G * h;
    p.pos.addScaledVector(p.vel, h);
    const wl = p.w.length();
    if (wl > 1e-5) p.q.premultiply(new THREE.Quaternion().setFromAxisAngle(p.w.clone().divideScalar(wl), wl * h)).normalize();
    // ground contact against the hull points
    let minY = Infinity, low = null;
    for (const v of p.hull) { const w = v.clone().applyQuaternion(p.q); if (w.y < minY) { minY = w.y; low = w; } }
    const floor = p.pos.y + minY;
    if (floor < 0) {
      p.pos.y -= floor;
      if (p.vel.y < -1.5 && this.audio.impact && (p.bonkT || 0) <= 0) { this.audio.impact(p.pos, p.surf); p.bonkT = 0.15; }
      // bounce + friction, and the contact point converts slide into spin
      if (p.vel.y < 0) p.vel.y *= -0.25;
      p.vel.x *= 1 - 6 * h; p.vel.z *= 1 - 6 * h;
      // gravity topples it toward the nearest stable pose
      const Y = new THREE.Vector3(0, 1, 0), up = Y.clone().applyQuaternion(p.q);
      let from, ang;
      if (p.kind === 'box') {
        // whichever face normal points most up/down becomes the new up
        let best = up, bd = 0;
        for (const a of [new THREE.Vector3(1, 0, 0), Y, new THREE.Vector3(0, 0, 1)]) { const w = a.clone().applyQuaternion(p.q); if (Math.abs(w.y) > bd) { bd = Math.abs(w.y); best = w.y < 0 ? w.negate() : w; } }
        from = best; ang = best.angleTo(Y);
      } else if (up.y > 0.8) { from = up; ang = up.angleTo(Y); }
      else { from = up; ang = up.angleTo(Y) - (Math.PI / 2 - 0.2); } // lie on its side, base slightly down
      const axis = from.clone().cross(Y);
      if (axis.lengthSq() > 1e-8) p.w.addScaledVector(axis.normalize(), ang * 14 * h);
      p.w.multiplyScalar(1 - 7 * h);
      if (p.vel.lengthSq() < 0.02 && p.w.lengthSq() < 0.02) { p.restT = (p.restT || 0) + h; if (p.restT > 0.4) { p.rest = true; p.vel.set(0, 0, 0); p.w.set(0, 0, 0); } }
    }
    if (p.bonkT > 0) p.bonkT -= h;
    // walls and crates: push out horizontally
    for (const b of this.level.colliders) {
      if (p.pos.y - p.r > b.max.y || p.pos.y + p.r < b.min.y) continue;
      const cx = THREE.MathUtils.clamp(p.pos.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(p.pos.z, b.min.z, b.max.z);
      const ex = p.pos.x - cx, ez = p.pos.z - cz, d2 = ex * ex + ez * ez;
      if (d2 < p.r * p.r && d2 > 1e-8) {
        const d = Math.sqrt(d2), nx = ex / d, nz = ez / d;
        p.pos.x += nx * (p.r - d); p.pos.z += nz * (p.r - d);
        const vn = p.vel.x * nx + p.vel.z * nz;
        if (vn < 0) { p.vel.x -= 1.4 * vn * nx; p.vel.z -= 1.4 * vn * nz; }
      }
    }
    if (p.pos.y < -30) { p.rest = true; p.g.visible = false; } // fell in the harbour
  }

  reset() {
    for (const p of this.list) {
      const [x, y, z, ry] = p.home; p.pos.set(x, y, z); p.q.setFromEuler(new THREE.Euler(0, ry, 0));
      p.vel.set(0, 0, 0); p.w.set(0, 0, 0); p.rest = true; p.g.visible = true;
    }
  }
}
