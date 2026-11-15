// Planar reflection for the wet ground (y = 0). A mirrored camera renders the
// scene into a half-res HDR target; the ground shader swaps its environment
// specular for this texture where the surface is smooth (puddles / wet film),
// so containers, drones and the sunset actually show up in the water.
import * as THREE from 'three';

export const REFL = {
  tex: { value: null },
  mat: { value: new THREE.Matrix4() },
  on: { value: 0 },
  wet: { value: 1 },
  rain: { value: 0 },
  time: { value: 0 },
};

export class PlanarReflection {
  constructor(renderer, scale = 0.5) {
    this.renderer = renderer;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    this.cam = new THREE.PerspectiveCamera();
    this.hidden = [];
    REFL.tex.value = this.rt.texture;
    REFL.on.value = 1;
  }

  setSize(w, h) { this.rt.setSize(Math.max(16, Math.floor(w * this.scale)), Math.max(16, Math.floor(h * this.scale))); }

  render(scene, camera) {
    const r = this.renderer, rc = this.cam;
    const normal = new THREE.Vector3(0, 1, 0);
    const planePos = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.01) return;
    const view = planePos.clone().sub(camPos).reflect(normal).negate().add(planePos);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = planePos.clone().sub(look).reflect(normal).negate().add(planePos);
    rc.position.copy(view);
    rc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    rc.lookAt(target);
    rc.far = camera.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);

    const tm = REFL.mat.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);

    // oblique near plane = water surface, so nothing below ground leaks in
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePos).applyMatrix4(rc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = rc.projectionMatrix.elements;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();

    const vis = this.hidden.map((o) => o.visible);
    this.hidden.forEach((o) => { o.visible = false; });
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    REFL.on.value = 0;
    r.setRenderTarget(this.rt);
    r.state.buffers.depth.setMask(true);
    r.clear();
    r.render(scene, rc);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = prevShadow;
    REFL.on.value = 1;
    this.hidden.forEach((o, i) => { o.visible = vis[i]; });
  }
}
