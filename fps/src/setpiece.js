// Scripted moment at the start of wave 3: a heavy cargo drone crossing the
// basin is hit by harbour air defence, spirals down trailing smoke and
// crashes onto the moored feeder's deck, which then burns for the rest of
// the match under a tall smoke column visible from the yard.
import * as THREE from 'three';

export class CrashEvent {
  constructor(scene, enemies, effects, audio) {
    this.scene = scene; this.effects = effects; this.audio = audio;
    const d = enemies.buildDrone(true);
    this.g = d.group; this.rotors = d.rotors;
    this.g.scale.setScalar(5.5);
    // underslung cargo container
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.2), enemies.lib.M.containerOrange);
    box.position.set(0, -0.32, 0); this.g.add(box);
    this.g.visible = false; scene.add(this.g);
    this.state = 'idle'; this.t = 0;
    this.crashAt = new THREE.Vector3(96, 7.2, -40.5);
  }

  start() {
    if (this.state !== 'idle') return;
    this.state = 'fly'; this.t = 0; this.g.visible = true;
    this.g.position.set(40, 52, -280);
    this.audio.heliStart && (this.hum = this.audio.heliStart(this.g));
  }

  update(dt) {
    if (this.state === 'idle') return;
    this.t += dt;
    for (const r of this.rotors) r.rotation.y += dt * 60;
    const fx = this.effects;
    if (this.state === 'fly') {
      // inbound toward the ship; air-defence tracers from the far shore walk onto it
      const from = new THREE.Vector3(40, 52, -280), mid = new THREE.Vector3(80, 42, -130);
      const k = Math.min(this.t / 7, 1);
      this.g.position.lerpVectors(from, mid, k);
      this.g.lookAt(this.g.position.clone().add(mid.clone().sub(from)));
      this.g.rotateY(Math.PI);
      if (this.t > 3.5 && Math.random() < dt * 14) {
        const src = new THREE.Vector3(-60 + Math.random() * 60, 2, -40 - Math.random() * 30);
        const miss = new THREE.Vector3((Math.random() - 0.5) * 18 * (1 - k), (Math.random() - 0.5) * 10 * (1 - k), 0);
        fx.tracer(src, this.g.position.clone().add(miss));
      }
      if (k >= 1) {
        this.state = 'fall'; this.t = 0; this.fallFrom = this.g.position.clone();
        fx.explosion(this.g.position.clone(), 2.2); this.audio.explosion(this.g.position.clone());
        if (this.onHit) this.onHit();
      }
    } else if (this.state === 'fall') {
      // spiral down onto the deck
      const T = 4.2, k = Math.min(this.t / T, 1);
      const p = this.fallFrom.clone().lerp(this.crashAt, k * k);
      p.x += Math.sin(this.t * 3) * 6 * (1 - k); p.z += Math.cos(this.t * 3) * 6 * (1 - k);
      this.g.position.copy(p);
      this.g.rotation.y += dt * 4; this.g.rotation.z = Math.sin(this.t * 2) * 0.5;
      if (Math.random() < dt * 40) fx.smoke.emit({ pos: p.clone(), vel: new THREE.Vector3(0, 1, 0), life: 6, size: 1.2, size1: 6, color: new THREE.Color(0.08, 0.075, 0.07).multiply(fx.ambient).multiplyScalar(2), alpha: 0.7, alpha1: 0, drag: 0.5, gravity: -0.1 });
      if (Math.random() < dt * 30) fx.fire.emit(p.clone(), new THREE.Vector3(0, 2, 0), 1.6, 0.6, 1);
      if (k >= 1) {
        this.state = 'burn'; this.t = 0;
        fx.explosion(this.crashAt.clone(), 3); fx.explosion(this.crashAt.clone().add(new THREE.Vector3(4, 1, 2)), 2);
        this.audio.explosion(this.crashAt.clone());
        if (this.hum) { this.audio.heliStop(this.hum); this.hum = null; }
        this.g.rotation.set(0.3, 1.2, 0.5); this.g.position.copy(this.crashAt).add(new THREE.Vector3(0, -0.6, 0));
        if (this.onCrash) this.onCrash();
      }
    } else if (this.state === 'burn') {
      // wreck burns: flames on deck and a tall leaning smoke column
      const base = this.crashAt;
      if (Math.random() < dt * 22) fx.fire.emit(base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0.3, (Math.random() - 0.5) * 4)), new THREE.Vector3(0, 2.5, 0), 1.4 + Math.random() * 1.2, 0.9 + Math.random() * 0.6, 0.9);
      if (Math.random() < dt * 7) fx.smoke.emit({ pos: base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3)), vel: new THREE.Vector3(-0.9, 4.2, 0.4), life: 24, size: 4, size1: 30, color: new THREE.Color(0.05, 0.045, 0.04), alpha: 0.9, alpha1: 0, drag: 0.04, gravity: -0.04, rotVel: (Math.random() - 0.5) * 0.3, fadeIn: 0.1 });
    }
    if (this.hum && this.audio.heliUpdate) this.audio.heliUpdate(this.hum, this.g);
  }

  reset() {
    this.state = 'idle'; this.g.visible = false;
    if (this.hum) { this.audio.heliStop(this.hum); this.hum = null; }
  }
}
