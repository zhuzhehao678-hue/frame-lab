// Extraction helicopter: flies in from the sea after the last wave, flares,
// and hovers over the yard with rotor wash kicking up dust.
import * as THREE from 'three';

export class Heli {
  constructor(scene, lib, effects, audio) {
    this.scene = scene; this.effects = effects; this.audio = audio;
    const M = lib.M;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, 3.2, 8, 20).rotateX(Math.PI / 2), M.paintGrey);
    body.scale.set(1, 0.95, 1); g.add(body);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 3.6), M.darkSteel); belly.position.set(0, -0.9, 0.2); g.add(belly);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.08, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), M.glassDark);
    glass.scale.set(0.95, 0.85, 1.1); glass.position.set(0, 0.15, -2.15); g.add(glass);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 6.5, 12).rotateX(Math.PI / 2), M.paintGrey); boom.position.set(0, 0.35, 5.0); g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 1.1), M.paintGrey); fin.position.set(0, 1.1, 8.0); fin.rotation.x = -0.3; g.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), M.paintGrey); stab.position.set(0, 0.45, 7.4); g.add(stab);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.7, 10), M.darkSteel); mast.position.set(0, 1.45, -0.2); g.add(mast);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 2.4), M.paintGrey); engine.position.set(0, 1.0, 0.6); g.add(engine);
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 8).rotateX(Math.PI / 2), M.darkSteel); skid.position.set(sx * 1.05, -1.65, 0.1); g.add(skid);
      for (const z of [-0.9, 1.1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), M.darkSteel); st.position.set(sx * 0.95, -1.3, z); st.rotation.z = sx * 0.25; g.add(st); }
    }
    // rotors: blurred disc + two blades
    this.rotor = new THREE.Group(); this.rotor.position.set(0, 1.85, -0.2); g.add(this.rotor);
    const discMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.6, 40).rotateX(-Math.PI / 2), discMat); disc.userData.noAO = true; g.add(disc); disc.position.copy(this.rotor.position);
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(11, 0.05, 0.32), M.darkSteel); b.rotation.y = i * Math.PI / 2; this.rotor.add(b); }
    this.tail = new THREE.Group(); this.tail.position.set(0.18, 1.2, 8.1); g.add(this.tail);
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.6, 0.14), M.darkSteel); b.rotation.x = i * Math.PI / 2; this.tail.add(b); }
    // nav lights and searchlight cone
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), M.lampRed); red.position.set(-1.1, -0.2, -0.8); g.add(red);
    this.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 8, 8) })); this.strobe.position.set(0, 1.25, 8.6); g.add(this.strobe);
    const coneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85), transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(3.2, 18, 24, 1, true).translate(0, -9, 0), coneMat); this.beam.position.set(0, -1.1, -2.4); this.beam.rotation.x = 0.35; this.beam.userData.noAO = true; g.add(this.beam);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== discMat && o.material !== coneMat; } });
    g.visible = false;
    scene.add(g);
    this.g = g; this.t = -1;
  }

  // night/rain: searchlight visible
  arrive(night) {
    this.t = 0; this.g.visible = true; this.beam.visible = !!night;
    this.from = new THREE.Vector3(-30, 38, -230); this.to = new THREE.Vector3(1, 13, -4);
    this.g.position.copy(this.from);
    if (this.audio.heliStart) this.hum = this.audio.heliStart(this.g);
  }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const T = 13, k = Math.min(this.t / T, 1);
    const e = 1 - Math.pow(1 - k, 2.4);                    // decelerate on approach
    const p = this.from.clone().lerp(this.to, e);
    p.y += Math.sin(this.t * 1.1) * 0.25 * k;                // hover bob
    const vel = p.clone().sub(this.g.position).divideScalar(Math.max(dt, 1e-3));
    this.g.position.copy(p);
    const dir = this.to.clone().sub(this.from).setY(0).normalize();
    const yaw = Math.atan2(-dir.x, -dir.z);
    const speed = vel.length();
    // nose down while fast, flare nose-up while braking, slow yaw while hovering
    const pitch = THREE.MathUtils.clamp(-speed * 0.012, -0.28, 0) + (k > 0.7 && k < 1 ? 0.12 * Math.sin((k - 0.7) / 0.3 * Math.PI) : 0);
    this.g.rotation.set(pitch, yaw + (k >= 1 ? Math.sin(this.t * 0.3) * 0.15 : 0), Math.sin(this.t * 0.7) * 0.03, 'YXZ');
    this.rotor.rotation.y += dt * 42; this.tail.rotation.x += dt * 70;
    this.strobe.visible = (this.t % 1.2) < 0.08;
    // rotor wash: dust ring under the aircraft once it is low
    const h = this.g.position.y;
    if (h < 22 && Math.random() < dt * 30 * (1 - h / 22)) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
      const gp = new THREE.Vector3(this.g.position.x + Math.cos(a) * r, 0.1, this.g.position.z + Math.sin(a) * r);
      this.effects.smoke.emit({ pos: gp, vel: new THREE.Vector3(Math.cos(a), 0.25, Math.sin(a)).multiplyScalar(4 + Math.random() * 3), life: 1.6, size: 0.4, size1: 2.6, color: new THREE.Color(0.42, 0.38, 0.33).multiply(this.effects.ambient).multiplyScalar(1.6), alpha: 0.4, alpha1: 0, drag: 1.2, gravity: -0.1, rotVel: (Math.random() - 0.5) * 1.5 });
    }
    if (this.hum && this.audio.heliUpdate) this.audio.heliUpdate(this.hum, this.g);
  }

  reset() { this.t = -1; this.g.visible = false; if (this.hum && this.audio.heliStop) this.audio.heliStop(this.hum); this.hum = null; }
}
