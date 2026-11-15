// Field supplies: ammo cans and med kits at fixed spots, auto-collected by
// walking over them, respawning after a delay. Each carries a soft ground
// halo so it reads at a glance without HUD clutter.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const SPOTS = [
  [-11.5, 9.5, 'med'], [12.8, -3.6, 'ammo'], [-3.8, -20.5, 'ammo'], [8.6, 15.2, 'med'], [-15.6, -9.0, 'ammo'], [4.4, -9.0, 'med'], [-27.5, 0.6, 'ammo'],
];

export class Pickups {
  constructor(scene, lib, audio) {
    this.scene = scene; this.audio = audio;
    const M = lib.M;
    const olive = M.gunMetal.clone(); olive.color = new THREE.Color(2.2, 2.6, 1.4);
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.45, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc81e14, roughness: 0.5, emissive: new THREE.Color(0.4, 0.02, 0.01) });
    const halo = (col) => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, `rgba(${col},0.55)`); gr.addColorStop(0.85, `rgba(${col},0.9)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2, 2, 2), fog: false });
    };
    this.haloMat = { ammo: halo('255,190,80'), med: halo('120,255,160') };
    const build = (kind) => {
      const g = new THREE.Group();
      if (kind === 'ammo') {
        g.add(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.19, 0.15, 2, 0.015), olive));
        const lid = new THREE.Mesh(new RoundedBoxGeometry(0.31, 0.03, 0.16, 2, 0.01), olive); lid.position.y = 0.105; g.add(lid);
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16, Math.PI), M.darkSteel); handle.position.y = 0.12; g.add(handle);
        const can2 = g.children[0].clone(); can2.position.set(0, 0, 0.17); g.add(can2);
      } else {
        g.add(new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.22, 0.12, 2, 0.03), white));
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.125), red); c1.position.y = 0.0; g.add(c1);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.125), red); g.add(c2);
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16, Math.PI), M.darkSteel); h.position.y = 0.11; g.add(h);
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return g;
    };
    this.items = SPOTS.map(([x, z, kind]) => {
      const root = new THREE.Group(); root.position.set(x, 0, z);
      const model = build(kind); model.position.y = 0.12; root.add(model);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2), this.haloMat[kind]);
      ring.position.y = 0.02; ring.userData.noAO = true; root.add(ring);
      scene.add(root);
      return { root, model, ring, kind, alive: true, respawn: 0 };
    });
  }

  update(dt, t, player, give) {
    for (const it of this.items) {
      if (!it.alive) {
        it.respawn -= dt;
        if (it.respawn <= 0) { it.alive = true; it.root.visible = true; }
        continue;
      }
      it.model.rotation.y += dt * 0.8;
      it.model.position.y = 0.14 + Math.sin(t * 2 + it.root.position.x) * 0.03;
      it.ring.material.opacity = 0.6 + Math.sin(t * 3) * 0.25;
      const dx = player.pos.x - it.root.position.x, dz = player.pos.z - it.root.position.z;
      if (dx * dx + dz * dz < 1.1 * 1.1 && Math.abs(player.pos.y - it.root.position.y) < 1 && !player.dead) {
        if (give(it.kind)) {
          it.alive = false; it.root.visible = false; it.respawn = 35;
          this.audio.pickup && this.audio.pickup(it.kind);
        }
      }
    }
  }

  reset() { for (const it of this.items) { it.alive = true; it.root.visible = true; } }
}
