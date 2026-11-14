// "Pier 9" — a small dockside container yard at golden hour.
// Static geometry is merged per material for draw-call efficiency; colliders
// are axis-aligned boxes used by the player, enemies and projectiles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxUV } from './materials.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const SURF = {
  ground: 'concrete', concreteWall: 'concrete', brick: 'concrete',
  wood: 'wood',
};
const surfOf = (name) => SURF[name] || 'metal';
SURF.rubber = 'wood'; SURF.cone = 'wood';

// Trapezoidal corrugated sheet in the XY plane facing +Z (x across ridges).
// Real geometry so low sun rakes across the ridges and casts micro-shadows.
function corrugatedPanel(len, h, pitch = 0.25, depth = 0.036) {
  const n = Math.max(1, Math.round(len / pitch));
  const p = len / n;
  const prof = [[0, 0], [0.12, 0], [0.24, -depth], [0.62, -depth], [0.74, 0], [1, 0]];
  const pos = [], uv = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < prof.length - 1; k++) {
      const x0 = -len / 2 + (i + prof[k][0]) * p, x1 = -len / 2 + (i + prof[k + 1][0]) * p;
      const z0 = prof[k][1], z1 = prof[k + 1][1];
      const u0 = (x0 + len / 2), u1 = (x1 + len / 2);
      pos.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, 0, z0, x1, h, z1, x0, h, z0);
      uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export class Level {
  constructor(scene, lib) {
    this.scene = scene;
    this.M = lib.M;
    this.colliders = [];          // THREE.Box3[]
    this.batches = new Map();     // matName -> geometry[]
    this.dynamicMeshes = [];      // meshes that are not merged
    this.rayMeshes = [];          // meshes bullets can hit
    this.lights = [];
    this.spawnPoints = [];
    this.lamps = [];              // flicker targets
    this.playerStart = new THREE.Vector3(0, 0, 15);
    this.playerYaw = 0;
    this.build();
    this.flush();
  }

  // ---------------------------------------------------------------- helpers
  put(geo, matName, x = 0, y = 0, z = 0, ry = 0, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx || 0, ry, opts.rz || 0));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    if (opts.parent) m.premultiply(opts.parent);
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const key = matName + (opts.noShadow ? ':ns' : '');
    if (!this.batches.has(key)) this.batches.set(key, []);
    this.batches.get(key).push(g);
    if (opts.collide) {
      g.computeBoundingBox();
      const b = g.boundingBox.clone();
      if (opts.pad) b.expandByScalar(opts.pad);
      this.colliders.push(b);
    }
    return g;
  }

  box(sx, sy, sz, matName, x, y, z, ry = 0, opts = {}) {
    const geo = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, opts.uvScale ?? 2, opts.uvScaleY ?? opts.uvScale ?? 2);
    return this.put(geo, matName, x, y + sy / 2, z, ry, { collide: opts.collide ?? true, ...opts });
  }

  collider(minx, miny, minz, maxx, maxy, maxz) {
    this.colliders.push(new THREE.Box3(new THREE.Vector3(minx, miny, minz), new THREE.Vector3(maxx, maxy, maxz)));
  }

  flush() {
    for (const [key, list] of this.batches) {
      const [matName, flag] = key.split(':');
      const geo = mergeGeometries(list, false);
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, this.M[matName]);
      mesh.castShadow = flag !== 'ns' && !['water', 'lineYellow', 'lineWhite', 'windowLit', 'lampLens', 'reflective'].includes(matName);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.surf = surfOf(matName);
      mesh.name = 'static_' + matName;
      this.scene.add(mesh);
      if (!['water', 'lineYellow', 'lineWhite', 'silhouette', 'lampLens'].includes(matName)) this.rayMeshes.push(mesh);
    }
    this.batches.clear();
  }

  // ---------------------------------------------------------------- build
  build() {
    const M = this.M;
    // Ground slab: 8 m per texture repeat (4 m slabs)
    {
      const W = 64, D = 64;
      const g = new THREE.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 8, uv.getY(i) * D / 8);
      this.put(g, 'ground', 0, 0, -4 + 0);
      this.collider(-40, -2, -27, 40, 0, 30);
    }
    this.buildWarehouse();
    this.buildSouthWall();
    this.buildContainerWall();
    this.buildFenceAndQuay();
    this.buildYardProps();
    this.buildMarkings();
    this.buildDistant();
    this.buildLights();

    // drone spawn points high above the stacks / beyond fence
    this.spawnPoints.push(
      new THREE.Vector3(14, 9, -18), new THREE.Vector3(-12, 12, -20), new THREE.Vector3(0, 10, -30),
      new THREE.Vector3(16, 8, 8), new THREE.Vector3(-14, 13, 10), new THREE.Vector3(10, 11, -4),
    );
  }

  buildWarehouse() {
    const x0 = -18; // facade plane
    // massing (back volume, no texture detail needed)
    this.box(14, 10.2, 46, 'claddingGrey', x0 - 7.15, 0, -2, 0, { uvScale: 2 });
    // brick plinth with slight relief
    const brickH = 3.2;
    // door opening at z = -2 .. 3 (5m wide), so build brick in two pieces
    this.box(0.4, brickH, 21, 'brick', x0 + 0.05, 0, -13.5 + 0, 0, { uvScale: 2.4 });
    this.box(0.4, brickH, 15.5, 'brick', x0 + 0.05, 0, 10.75, 0, { uvScale: 2.4 });
    // cladding: corrugations vertical -> u along facade
    {
      const h = 6.6, len = 46;
      const g = new THREE.PlaneGeometry(len, h).rotateY(Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2, uv.getY(i) * h / 6.6);
      this.put(g, 'claddingTeal', x0 + 0.02, brickH + h / 2, -2);
      // above-door cladding fill
    }
    // concrete sill band between brick and cladding
    this.box(0.55, 0.25, 46, 'concreteWall', x0 + 0.1, brickH, -2, 0, { uvScale: 2, collide: false });
    // parapet flashing
    this.box(0.5, 0.35, 46.2, 'paintGrey', x0 + 0.05, 9.8, -2, 0, { collide: false });
    // roll-up door recess
    const dz = 0.5, dw = 5.2, dh = 4.6;
    this.box(0.3, dh, dw, 'claddingGrey', x0 - 0.35, 0, dz, 0, { uvScale: 1.3, rx: 0 });
    // door corrugation horizontal: rotate the uv by building a plane
    {
      const g = new THREE.PlaneGeometry(dw, dh).rotateY(Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v * dh / 0.8, u); }
      this.put(g, 'claddingGrey', x0 - 0.18, dh / 2, dz);
    }
    // door frame (yellow steel jambs) + header
    this.box(0.35, dh + 0.3, 0.3, 'paintYellow', x0 + 0.05, 0, dz - dw / 2 - 0.15);
    this.box(0.35, dh + 0.3, 0.3, 'paintYellow', x0 + 0.05, 0, dz + dw / 2 + 0.15);
    this.box(0.5, 0.6, dw + 1.0, 'paintGrey', x0 + 0.05, dh, dz, 0, { collide: false });
    this.box(0.45, brickH - dh + 0.0 > 0 ? 0.01 : 0.01, 0.01, 'paintGrey', x0, 0, dz, 0, { collide: false });
    // bollards in front of door
    for (const bz of [dz - dw / 2 - 0.6, dz + dw / 2 + 0.6]) {
      this.put(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 20), 'paintYellow', x0 + 0.7, 0.55, bz, 0, { collide: true });
      this.put(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'paintYellow', x0 + 0.7, 1.1, bz);
    }
    // windows: row of clerestory windows (some lit) with frames
    for (let i = 0; i < 9; i++) {
      const wz = -20 + i * 4.6 + 1.6;
      if (Math.abs(wz - dz) < 3.2) continue;
      const lit = [1, 2, 4, 6, 7].includes(i);
      this.box(0.12, 1.5, 2.6, 'darkSteel', x0 + 0.06, 6.0, wz, 0, { collide: false });
      // pane grid
      for (let gy = 0; gy < 2; gy++) for (let gz = 0; gz < 3; gz++) {
        const g = new THREE.PlaneGeometry(0.78, 0.66).rotateY(Math.PI / 2);
        this.put(g, lit && !(gy === 1 && gz === (i % 3)) ? 'windowLit' : 'glassDark', x0 + 0.13, 6.0 + 0.37 + gy * 0.72, wz - 0.84 + gz * 0.84);
      }
    }
    // downpipes
    for (const pz of [-19.5, -8, 9.5, 18.6]) {
      this.put(new THREE.CylinderGeometry(0.075, 0.075, 9.6, 14), 'paintGrey', x0 + 0.3, 4.8, pz, 0, { noShadow: false });
      this.put(new THREE.CylinderGeometry(0.11, 0.11, 0.35, 14), 'paintGrey', x0 + 0.3, 9.55, pz);
      for (let k = 0; k < 4; k++) this.box(0.25, 0.05, 0.05, 'darkSteel', x0 + 0.17, 1.5 + k * 2.4, pz, 0, { collide: false });
      // elbow at bottom
      this.put(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 14), 'paintGrey', x0 + 0.42, 0.12, pz, 0, { rz: Math.PI / 2 });
    }
    // electrical box + conduit
    this.box(0.25, 0.9, 0.7, 'paintGrey', x0 + 0.32, 1.3, -5.5, 0, { collide: false });
    this.box(0.04, 2.0, 0.04, 'darkSteel', x0 + 0.24, 2.2, -5.4, 0, { collide: false });
    // facade collider
    this.collider(x0 - 20, 0, -26, x0 + 0.25, 12, 22);
  }

  buildSouthWall() {
    const z0 = 20.5;
    this.box(36.5, 4.4, 0.5, 'concreteWall', -0.25, 0, z0, 0, { uvScale: 4.4 });
    this.box(36.8, 0.18, 0.7, 'concreteWall', -0.25, 4.4, z0, 0, { uvScale: 2 });
    // pilasters
    for (let x = -16; x <= 16; x += 8) this.box(0.6, 4.6, 0.4, 'concreteWall', x, 0, z0 - 0.42, 0, { uvScale: 2 });
    // wall-mounted cable tray
    this.box(30, 0.08, 0.35, 'steel', 0, 3.3, z0 - 0.45, 0, { collide: false });
    for (let x = -14; x <= 14; x += 3.5) this.box(0.04, 0.25, 0.4, 'darkSteel', x, 3.12, z0 - 0.45, 0, { collide: false });
  }

  container(x, y, z, ry, mat, opts = {}) {
    const L = 6.06, H = 2.59, W = 2.44;
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    // body: real corrugated walls (u = metres along, v = full height)
    const ph = H - 0.2;
    const side = corrugatedPanel(L - 0.2, ph);
    const endP = corrugatedPanel(W - 0.2, ph, 0.3);
    for (const sz of [-1, 1]) {
      const pm = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.1, sz * (W / 2 - 0.02)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sz > 0 ? 0 : Math.PI, 0)), new THREE.Vector3(1, 1, 1)));
      this.put(side, mat, 0, 0, 0, 0, { parent: pm });
    }
    for (const sx of [-1, 1]) {
      if (opts.open && sx > 0) continue;
      const pm = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(sx * (L / 2 - 0.02), 0.1, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sx * Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)));
      this.put(endP, mat, 0, 0, 0, 0, { parent: pm });
    }
    // roof & floor plates
    this.put(boxUV(new THREE.BoxGeometry(L - 0.1, 0.04, W - 0.1), L, 0.04, W, 1.5), mat, 0, H - 0.04, 0, 0, { parent });
    this.put(boxUV(new THREE.BoxGeometry(L - 0.1, 0.06, W - 0.1), L, 0.06, W, 1.5), 'darkSteel', 0, 0.1, 0, 0, { parent });
    if (opts.open) {
      // dim interior lining so the open end reads as a deep box
      const lin = (sx, sy, sz, px, py, pz) => this.put(boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, 1.5), 'darkSteel', px, py, pz, 0, { parent });
      lin(L - 0.2, ph, 0.02, 0, H / 2, W / 2 - 0.07); lin(L - 0.2, ph, 0.02, 0, H / 2, -W / 2 + 0.07);
      lin(0.02, ph, W - 0.2, -L / 2 + 0.07, H / 2, 0); lin(L - 0.2, 0.02, W - 0.2, 0, H - 0.08, 0);
    }
    // frame rails & corner posts (painted, darker by reuse)
    const rail = (sx, sy, sz, px, py, pz) => {
      const g = boxUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, 1.5);
      this.put(g, mat, px, py, pz, 0, { parent });
    };
    rail(L, 0.16, 0.16, 0, H - 0.08, W / 2 - 0.08); rail(L, 0.16, 0.16, 0, H - 0.08, -W / 2 + 0.08);
    rail(L, 0.2, 0.18, 0, 0.1, W / 2 - 0.09); rail(L, 0.2, 0.18, 0, 0.1, -W / 2 + 0.09);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      rail(0.16, H, 0.16, sx * (L / 2 - 0.08), H / 2, sz * (W / 2 - 0.08));
      // corner castings
      for (const cy of [0.08, H - 0.08]) {
        const g = new THREE.BoxGeometry(0.18, 0.12, 0.18);
        this.put(g, 'darkSteel', sx * (L / 2 - 0.08), cy, sz * (W / 2 - 0.08), 0, { parent });
      }
    }
    // door end at +x: lock bars + handles + hinge blocks
    if (!opts.open) {
      for (const bz of [-0.85, -0.45, 0.45, 0.85]) {
        this.put(new THREE.CylinderGeometry(0.022, 0.022, H - 0.35, 10), 'steel', L / 2 + 0.02, H / 2, bz, 0, { parent });
        for (const by of [0.3, H - 0.3]) this.put(new THREE.BoxGeometry(0.05, 0.08, 0.1), 'darkSteel', L / 2 + 0.03, by, bz, 0, { parent });
        this.put(new THREE.BoxGeometry(0.04, 0.32, 0.05), 'darkSteel', L / 2 + 0.07, 1.25, bz + 0.07, 0, { parent });
      }
      this.put(new THREE.BoxGeometry(0.02, H - 0.3, 0.01), 'darkSteel', L / 2 + 0.005, H / 2, 0, 0, { parent });
    } else {
      // swung-open doors
      for (const s of [-1, 1]) {
        const dg = boxUV(new THREE.BoxGeometry(0.05, H - 0.25, W / 2 - 0.05), 0.05, H - 0.25, W / 2, 1);
        const pm = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(L / 2, 0, s * (W / 2)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * 1.9, 0)), new THREE.Vector3(1, 1, 1)));
        this.put(dg, mat, 0, H / 2, -s * (W / 4), 0, { parent: pm });
      }
      // interior: darker floor planks
      this.put(boxUV(new THREE.BoxGeometry(L - 0.3, 0.04, W - 0.25), L, 0.04, W, 1.5), 'wood', 0, 0.2, 0, 0, { parent });
    }
    // collider: AABB of rotated box
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, H / 2, 0), new THREE.Vector3(L, H, W)).applyMatrix4(parent);
    if (opts.open) {
      // hollow: three walls + roof
      const walls = [
        [0, H / 2, W / 2 - 0.05, L, H, 0.1], [0, H / 2, -W / 2 + 0.05, L, H, 0.1], [-L / 2 + 0.05, H / 2, 0, 0.1, H, W], [0, H - 0.05, 0, L, 0.1, W], [0, 0.1, 0, L, 0.2, W],
      ];
      for (const w of walls) this.colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(w[0], w[1], w[2]), new THREE.Vector3(w[3], w[4], w[5])).applyMatrix4(parent));
    } else this.colliders.push(b);
  }

  buildContainerWall() {
    const mats = ['containerRed', 'containerBlue', 'containerGreen', 'containerOrange'];
    let k = 0;
    for (let i = 0; i < 7; i++) {
      const z = -20 + i * 6.15;
      const levels = i === 2 ? 3 : (i === 5 ? 1 : 2);
      for (let l = 0; l < levels; l++) {
        const jitter = (Math.sin(i * 12.9 + l * 4.1) * 0.05);
        this.container(17.6 + jitter * 2, l * 2.59, z, Math.PI / 2 + jitter, mats[(k++ * 3 + l) % 4]);
      }
    }
    this.collider(16.2, 0, -24, 30, 12, 22);
  }

  buildFenceAndQuay() {
    const zf = -23.5;
    // chain-link fence panels between posts
    for (let x = -17.5; x < 16; x += 3) {
      const g = new THREE.PlaneGeometry(3, 2.6);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3 / 1, uv.getY(i) * 2.6 / 1);
      this.put(g, 'chainlink', x + 1.5, 1.4, zf, 0, { noShadow: false });
      this.put(new THREE.CylinderGeometry(0.04, 0.045, 2.9, 12), 'steel', x, 1.45, zf);
    }
    this.put(new THREE.CylinderGeometry(0.025, 0.025, 33.5, 10), 'steel', -0.75, 2.75, zf, 0, { rz: Math.PI / 2 });
    this.put(new THREE.CylinderGeometry(0.02, 0.02, 33.5, 10), 'steel', -0.75, 0.12, zf, 0, { rz: Math.PI / 2 });
    // barbed wire strands
    for (let s = 0; s < 3; s++) this.put(new THREE.CylinderGeometry(0.006, 0.006, 33.5, 4), 'darkSteel', -0.75, 2.86 + s * 0.12, zf + 0.12 + s * 0.08, 0, { rz: Math.PI / 2 });
    for (let x = -17.5; x < 16; x += 3) this.box(0.03, 0.42, 0.03, 'darkSteel', x, 2.85, zf + 0.12, 0, { rx: -0.6, collide: false });
    this.collider(-18, 0, zf - 0.15, 16.5, 3.2, zf + 0.15);

    // quay edge: concrete coping, then drop to the water
    this.box(80, 0.4, 2.4, 'concreteWall', 0, -0.35, -26.2, 0, { uvScale: 2, collide: false });
    this.box(80, 3.2, 1.2, 'concreteWall', 0, -3.6, -27.2, 0, { uvScale: 3.2, collide: false });
    // rubber fenders on quay face
    for (let x = -36; x <= 36; x += 6) this.box(0.6, 1.6, 0.35, 'rubber', x, -2.0, -27.9, 0, { collide: false });
    // mooring bollards beyond the fence
    for (const x of [-12, 0, 12]) {
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.26, 0), new THREE.Vector2(0.2, 0.08), new THREE.Vector2(0.17, 0.45), new THREE.Vector2(0.3, 0.55), new THREE.Vector2(0.3, 0.62), new THREE.Vector2(0, 0.64)];
      this.put(new THREE.LatheGeometry(pts, 24), 'paintGrey', x, 0, -25.6);
    }
    // water
    const wg = new THREE.PlaneGeometry(3000, 1500).rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, this.M.water);
    water.position.set(0, -2.1, -778);
    water.receiveShadow = false;
    this.scene.add(water);
    this.water = water;
  }

  barrier(x, z, ry) {
    const s = new THREE.Shape();
    s.moveTo(-0.30, 0); s.lineTo(0.30, 0); s.lineTo(0.30, 0.08); s.lineTo(0.12, 0.28); s.lineTo(0.08, 0.81); s.lineTo(-0.08, 0.81); s.lineTo(-0.12, 0.28); s.lineTo(-0.30, 0.08); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 3.0, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
    g.translate(0, 0, -1.5);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
    this.put(g, 'concreteWall', x, 0, z, ry);
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0.6, 0.81, 3.0));
    b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)));
    this.colliders.push(b);
  }

  pallet(x, y, z, ry, collide = true) {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    for (let i = 0; i < 7; i++) this.put(boxUV(new THREE.BoxGeometry(1.2, 0.022, 0.1), 1.2, 0.02, 0.1, 1.2), 'wood', 0, 0.133, -0.45 + i * 0.15, 0, { parent });
    for (const bx of [-0.55, 0, 0.55]) this.put(boxUV(new THREE.BoxGeometry(0.1, 0.08, 1.0), 0.1, 0.08, 1.0, 1.2), 'wood', bx, 0.08, 0, 0, { parent });
    for (const bz of [-0.45, 0, 0.45]) this.put(boxUV(new THREE.BoxGeometry(1.2, 0.04, 0.1), 1.2, 0.04, 0.1, 1.2), 'wood', 0, 0.02, bz, 0, { parent });
    if (collide) {
      const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0.07, 0), new THREE.Vector3(1.2, 0.145, 1.0)).applyMatrix4(parent);
      this.colliders.push(b);
    }
  }

  crate(x, y, z, ry, s = 1.0) {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    this.put(boxUV(new THREE.BoxGeometry(s, s, s), s, s, s, 1.0), 'wood', 0, s / 2, 0, 0, { parent });
    // edge battens
    const t = 0.06, o = s / 2 + 0.005;
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      this.put(boxUV(new THREE.BoxGeometry(t, s + 0.01, t), t, s, t, 1), 'wood', a * (o - t / 2 + 0.01), s / 2, b * (o - t / 2 + 0.01), 0, { parent });
      this.put(boxUV(new THREE.BoxGeometry(s + 0.01, t, t), s, t, t, 1), 'wood', 0, b > 0 ? s - t / 2 : t / 2, a * (o - t / 2 + 0.01), 0, { parent });
    }
    // diagonal brace on two faces
    const d = Math.SQRT2 * s * 0.92;
    this.put(boxUV(new THREE.BoxGeometry(d, 0.08, 0.02), d, 0.08, 0.02, 1), 'wood', 0, s / 2, o, 0, { parent, rz: Math.PI / 4 });
    this.put(boxUV(new THREE.BoxGeometry(d, 0.08, 0.02), d, 0.08, 0.02, 1), 'wood', 0, s / 2, -o, 0, { parent, rz: -Math.PI / 4 });
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, s / 2, 0), new THREE.Vector3(s, s, s)).applyMatrix4(parent);
    this.colliders.push(b);
  }

  drum(x, z, mat, tipped = false) {
    // 55-gal drum with rolling hoops
    const pts = [];
    const r = 0.29, h = 0.88;
    pts.push(new THREE.Vector2(0, 0.005), new THREE.Vector2(r - 0.01, 0.0), new THREE.Vector2(r, 0.02));
    for (const hy of [0.29, 0.59]) { pts.push(new THREE.Vector2(r, hy - 0.025), new THREE.Vector2(r + 0.012, hy), new THREE.Vector2(r, hy + 0.025)); }
    pts.push(new THREE.Vector2(r, h - 0.02), new THREE.Vector2(r - 0.01, h), new THREE.Vector2(r - 0.02, h - 0.012), new THREE.Vector2(0, h - 0.012));
    const g = new THREE.LatheGeometry(pts, 32);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.8, uv.getY(i) * 0.9);
    if (tipped) {
      this.put(g, mat, x, r, z, 0.6, { rz: Math.PI / 2 });
      this.colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.5, 0, z - 0.5), new THREE.Vector3(x + 0.5, 0.58, z + 0.5)));
    } else {
      this.put(g, mat, x, 0, z, Math.random() * 6);
      this.put(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), 'darkSteel', x + 0.15, h - 0.005, z);
      this.colliders.push(new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, h, z + r)));
    }
  }

  stairs(x0, z, toX, height, width = 1.1) {
    // steel stair stringers + tread-plate steps climbing toward -x
    const steps = Math.ceil(height / 0.2);
    const rise = height / steps;
    const run = Math.abs(toX - x0) / steps;
    const dir = Math.sign(toX - x0);
    for (let i = 0; i < steps; i++) {
      const sx = x0 + dir * (i + 0.5) * run;
      const top = (i + 1) * rise;
      this.box(run + 0.02, 0.05, width, 'tread', sx, top - 0.05, z, 0, { collide: false, uvScale: 1 });
      this.collider(sx - run / 2, 0, z - width / 2, sx + run / 2, top, z + width / 2);
    }
    const len = Math.hypot(Math.abs(toX - x0), height);
    const ang = Math.atan2(height, Math.abs(toX - x0));
    for (const s of [-1, 1]) {
      const g = boxUV(new THREE.BoxGeometry(len, 0.22, 0.05), len, 0.22, 0.05, 1);
      this.put(g, 'paintYellow', (x0 + toX) / 2, height / 2 - 0.05, z + s * (width / 2 + 0.03), 0, { rz: dir * ang });
      // handrail + posts
      this.put(new THREE.CylinderGeometry(0.022, 0.022, len, 10), 'paintYellow', (x0 + toX) / 2, height / 2 + 0.95, z + s * (width / 2 + 0.05), 0, { rz: Math.PI / 2 + dir * ang });
      for (let k = 0; k <= 3; k++) {
        const t = k / 3; const px = x0 + (toX - x0) * t; const py = height * t;
        this.put(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 8), 'paintYellow', px, py + 0.5, z + s * (width / 2 + 0.05));
      }
    }
  }

  buildYardProps() {
    // Centre stack: red container with a blue one stacked & slewed on top
    this.container(-6.5, 0, -8, 0.0, 'containerRed');
    this.container(-6.9, 2.59, -8.15, 0.06, 'containerBlue');
    this.stairs(-0.2, -8.2 + 1.8, -3.45, 2.59);
    // landing rail on top of red container (along stair edge)
    // Open container near the fence
    this.container(7, 0, -16, Math.PI / 2 + 0.03, 'containerGreen', { open: false });
    this.container(-2.5, 0, -17.5, 0.2, 'containerOrange', { open: true });
    // Lone container angled across mid-yard (cover)
    this.container(5.5, 0, 4.5, -0.42, 'containerBlue');

    // Jersey barriers
    this.barrier(-1.2, 8.5, Math.PI / 2 + 0.08);
    this.barrier(2.0, 8.8, Math.PI / 2 - 0.1);
    this.barrier(-12, -1, 0.05);
    this.barrier(11.8, -7.5, 0.25);
    this.barrier(12.5, 13.5, Math.PI / 2 + 0.3);

    // crates & pallets
    this.pallet(-13.5, 0, 6, 0.1); this.crate(-13.5, 0.145, 6, 0.15, 1.1); this.crate(-13.3, 1.245, 6.1, 0.4, 0.9);
    this.pallet(-12.0, 0, 7.4, -0.3); this.crate(-12, 0.145, 7.4, -0.2, 1.0);
    this.pallet(-14.2, 0, 14.5, 0.0); this.pallet(-14.2, 0.145, 14.5, 0.05, false); this.pallet(-14.2, 0.29, 14.5, -0.04, false);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-14.8, 0, 14), new THREE.Vector3(-13.6, 0.44, 15)));
    this.crate(9.8, 0, -3.5, 0.3, 1.2); this.crate(10.6, 0, -2.3, -0.1, 0.9);
    this.pallet(1.5, 0, -12.2, 0.7);
    this.pallet(13.5, 0, 2.5, 1.3); this.pallet(13.6, 0.145, 2.5, 1.25, false);

    // drums cluster
    this.drum(-15.5, -12, 'paintBlue'); this.drum(-15.0, -12.6, 'paintBlue'); this.drum(-15.7, -12.7, 'paintRed');
    this.drum(-14.6, -11.6, 'paintYellow', true);
    this.drum(3.2, -1.2, 'paintRed'); this.drum(3.7, -0.7, 'paintGrey');
    this.drum(12.8, 9.8, 'paintBlue');

    // light poles (geometry, lights added in buildLights)
    for (const [px, pz] of [[-9, 4], [10, -11]]) {
      this.put(new THREE.CylinderGeometry(0.08, 0.13, 9, 16), 'paintGrey', px, 4.5, pz, 0, { collide: false });
      this.put(new THREE.CylinderGeometry(0.28, 0.32, 0.25, 16), 'concreteWall', px, 0.12, pz);
      this.colliders.push(new THREE.Box3(new THREE.Vector3(px - 0.3, 0, pz - 0.3), new THREE.Vector3(px + 0.3, 9, pz + 0.3)));
      this.put(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 10), 'paintGrey', px + 0.75, 8.9, pz, 0, { rz: Math.PI / 2 - 0.15 });
      this.box(0.7, 0.14, 0.35, 'darkSteel', px + 1.45, 8.95, pz, 0, { collide: false });
      this.put(new THREE.PlaneGeometry(0.6, 0.28).rotateX(Math.PI / 2), 'lampLens', px + 1.45, 8.945, pz);
      this.lamps.push(new THREE.Vector3(px + 1.45, 8.85, pz));
    }

    // forklift-ish: stack of tyres
    for (let i = 0; i < 4; i++) {
      this.put(new THREE.TorusGeometry(0.32, 0.13, 14, 28).rotateX(Math.PI / 2), 'rubber', 14.2, 0.13 + i * 0.25, -21.0 + (i % 2) * 0.05);
    }
    this.colliders.push(new THREE.Box3(new THREE.Vector3(14.2 - 0.45, 0, -21.45), new THREE.Vector3(14.2 + 0.45, 1.0, -20.55)));

    // forklift parked by the warehouse door, cones, cable reels, site office
    this.forklift(-13.2, -6.2, 0.6);
    this.portacabin(-12.6, 17.2, 0);
    this.cone(-15.2, 3.6); this.cone(-15.6, -2.9); this.cone(1.0, 8.0, 0, true); this.cone(-1.3, -12.0); this.cone(8.6, 9.4);
    this.reel(9.2, 13.2, 0.4); this.reel(10.6, 14.6, 1.2, 0.45, 0.45);
    this.reel(-4.5, 6.5, -0.3, 0.5, 0.5);

    // pipe stack on cribbing
    for (let i = 0; i < 3; i++) {
      this.put(new THREE.CylinderGeometry(0.22, 0.22, 6, 24, 1, true), 'paintGrey', -8.5, 0.37 + 0, 13 + i * 0.46, Math.PI / 2, { rz: Math.PI / 2, noShadow: false });
    }
    this.put(new THREE.CylinderGeometry(0.22, 0.22, 6, 24, 1, true), 'paintGrey', -8.5, 0.37 + 0.4, 13.23, Math.PI / 2, { rz: Math.PI / 2 });
    for (const bx of [-10.8, -6.2]) this.box(0.2, 0.15, 1.6, 'wood', bx, 0, 13.45, 0, { uvScale: 1, collide: false });
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-11.5, 0, 12.7), new THREE.Vector3(-5.5, 1.0, 14.1)));
  }

  cone(x, z, ry = 0, tipped = false) {
    const pts = [[0, 0.03], [0.17, 0.03], [0.17, 0.0], [0.19, 0.0], [0.19, 0.035], [0.12, 0.05], [0.035, 0.7], [0.0, 0.71]].map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(pts, 24);
    const opts = tipped ? { rz: Math.PI / 2 - 0.2 } : {};
    this.put(g, 'cone', x, tipped ? 0.17 : 0, z, ry, opts);
    // reflective bands
    for (const [y, h] of [[0.42, 0.1], [0.25, 0.07]]) {
      const r0 = 0.12 - (y / 0.7) * 0.085, r1 = 0.12 - ((y + h) / 0.7) * 0.085;
      const b = new THREE.CylinderGeometry(r1 + 0.004, r0 + 0.004, h, 24, 1, true).translate(0, y + h / 2, 0);
      this.put(b, 'reflective', x, tipped ? 0.17 : 0, z, ry, opts);
    }
    if (!tipped) this.colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.19, 0, z - 0.19), new THREE.Vector3(x + 0.19, 0.7, z + 0.19)));
  }

  reel(x, z, ry, r = 0.6, w = 0.6) {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, r, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    for (const s of [-1, 1]) this.put(new THREE.CylinderGeometry(r, r, 0.05, 32).rotateZ(Math.PI / 2), 'wood', s * w / 2, 0, 0, 0, { parent });
    this.put(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w, 24).rotateZ(Math.PI / 2), 'rubber', 0, 0, 0, 0, { parent });
    this.put(new THREE.CylinderGeometry(0.06, 0.06, w + 0.1, 12).rotateZ(Math.PI / 2), 'darkSteel', 0, 0, 0, 0, { parent });
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(w + 0.05, r * 2, r * 2)).applyMatrix4(parent);
    this.colliders.push(b);
  }

  forklift(x, z, ry) {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    const P = (geo, mat, px, py, pz, o = {}) => this.put(geo, mat, px, py, pz, o.ry || 0, { parent, ...o });
    const RB = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);
    // chassis + counterweight (forks face -z)
    P(boxUV(RB(1.15, 0.55, 2.0, 0.08), 1.15, 0.55, 2, 1), 'paintYellow', 0, 0.55, 0.15);
    P(boxUV(RB(1.18, 0.7, 0.55, 0.15), 1.18, 0.7, 0.55, 1), 'paintGrey', 0, 0.75, 1.0);
    P(boxUV(RB(1.0, 0.12, 1.1, 0.04), 1, 0.12, 1.1, 1), 'tread', 0, 0.86, 0.15);
    // seat, steering column, wheel
    P(boxUV(RB(0.45, 0.12, 0.42, 0.05), 0.45, 0.12, 0.42, 1), 'rubber', 0, 1.05, 0.45);
    P(boxUV(RB(0.45, 0.5, 0.1, 0.05), 0.45, 0.5, 0.1, 1), 'rubber', 0, 1.3, 0.68);
    P(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 10), 'darkSteel', 0, 1.15, -0.25, { rx: -0.5 });
    P(new THREE.TorusGeometry(0.15, 0.018, 8, 24), 'rubber', 0, 1.42, -0.38, { rx: -1.1 });
    // overhead guard (cage)
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.45, 0.75]) P(boxUV(new THREE.BoxGeometry(0.06, 1.45, 0.06), 0.06, 1.45, 0.06, 1), 'paintGrey', sx, 1.55, sz, { rx: sz < 0 ? 0.12 : 0 });
    P(boxUV(new THREE.BoxGeometry(1.1, 0.06, 1.35), 1.1, 0.06, 1.35, 1), 'paintGrey', 0, 2.27, 0.17);
    for (let i = 0; i < 5; i++) P(new THREE.BoxGeometry(0.03, 0.04, 1.3), 'darkSteel', -0.4 + i * 0.2, 2.31, 0.17);
    // mast + carriage + forks
    for (const sx of [-0.35, 0.35]) P(boxUV(new THREE.BoxGeometry(0.1, 2.4, 0.12), 0.1, 2.4, 0.12, 1), 'darkSteel', sx, 1.25, -0.95);
    P(new THREE.BoxGeometry(0.8, 0.1, 0.12), 'darkSteel', 0, 2.4, -0.95);
    P(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 14), 'chrome', 0, 1.0, -0.88);
    P(boxUV(new THREE.BoxGeometry(0.95, 0.45, 0.06), 0.95, 0.45, 0.06, 1), 'darkSteel', 0, 0.42, -1.05);
    for (const sx of [-0.3, 0.3]) P(boxUV(new THREE.BoxGeometry(0.12, 0.05, 1.1), 0.12, 0.05, 1.1, 1), 'darkSteel', sx, 0.07, -1.6);
    // wheels
    for (const [wx, wz, wr] of [[-0.55, -0.55, 0.32], [0.55, -0.55, 0.32], [-0.52, 0.85, 0.26], [0.52, 0.85, 0.26]]) {
      P(new THREE.CylinderGeometry(wr, wr, 0.24, 24).rotateZ(Math.PI / 2), 'rubber', wx, wr, wz);
      P(new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, 0.25, 16).rotateZ(Math.PI / 2), 'paintRed', wx, wr, wz);
    }
    // beacon
    P(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 12), 'lampAmber', 0.4, 2.38, 0.6);
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 1.2, 0.0), new THREE.Vector3(1.25, 2.4, 2.4)).applyMatrix4(parent);
    this.colliders.push(b);
    const f = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0.1, -1.6), new THREE.Vector3(0.8, 0.2, 1.1)).applyMatrix4(parent);
    this.colliders.push(f);
  }

  portacabin(x, z, ry) {
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    const L = 6, W = 2.6, H = 2.6;
    const side = corrugatedPanel(L, H - 0.3, 0.2, 0.02);
    for (const sz of [-1, 1]) {
      const pm = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.25, sz * W / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sz > 0 ? 0 : Math.PI, 0)), new THREE.Vector3(1, 1, 1)));
      this.put(side, 'cabinWhite', 0, 0, 0, 0, { parent: pm });
    }
    const endP = corrugatedPanel(W, H - 0.3, 0.2, 0.02);
    for (const sx of [-1, 1]) {
      const pm = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(sx * L / 2, 0.25, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sx * Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)));
      this.put(endP, 'cabinWhite', 0, 0, 0, 0, { parent: pm });
    }
    const P = (geo, mat, px, py, pz, o = {}) => this.put(geo, mat, px, py, pz, o.ry || 0, { parent, ...o });
    P(boxUV(new THREE.BoxGeometry(L + 0.12, 0.16, W + 0.12), L, 0.16, W, 2), 'paintGrey', 0, H - 0.05 + 0.03, 0);
    P(boxUV(new THREE.BoxGeometry(L + 0.06, 0.2, W + 0.06), L, 0.2, W, 2), 'paintGrey', 0, 0.25, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(new THREE.BoxGeometry(0.2, 0.25, 0.2), 'concreteWall', sx * (L / 2 - 0.3), 0.12, sz * (W / 2 - 0.3));
    // windows on +z side: one lit, blinds
    for (const wx of [-1.6, 1.4]) {
      P(new THREE.BoxGeometry(1.2, 0.9, 0.06), 'darkSteel', wx, 1.6, W / 2 + 0.01);
      P(new THREE.PlaneGeometry(1.08, 0.78), wx < 0 ? 'windowLit' : 'glassDark', wx, 1.6, W / 2 + 0.045);
      for (let i = 0; i < 6; i++) P(new THREE.BoxGeometry(1.06, 0.018, 0.01), 'cabinWhite', wx, 1.27 + i * 0.13, W / 2 + 0.05);
    }
    // door + steps + AC unit
    P(boxUV(new THREE.BoxGeometry(0.95, 2.0, 0.06), 0.95, 2, 0.06, 1), 'paintBlue', 0, 1.3, W / 2 + 0.02);
    P(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8).rotateZ(Math.PI / 2), 'chrome', 0.35, 1.25, W / 2 + 0.08);
    P(boxUV(new THREE.BoxGeometry(1.2, 0.17, 0.4), 1.2, 0.17, 0.4, 1), 'tread', 0, 0.085, W / 2 + 0.25);
    P(boxUV(new THREE.BoxGeometry(1.2, 0.17, 0.4), 1.2, 0.17, 0.4, 1), 'tread', 0, 0.255, W / 2 + 0.05);
    P(boxUV(new THREE.BoxGeometry(0.8, 0.55, 0.3), 0.8, 0.55, 0.3, 1), 'cabinWhite', 2.2, 2.0, -W / 2 - 0.16);
    P(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20).rotateX(Math.PI / 2), 'darkSteel', 2.2, 2.0, -W / 2 - 0.32);
    // wall lamp above door
    P(new THREE.BoxGeometry(0.22, 0.12, 0.16), 'darkSteel', 0, 2.42, W / 2 + 0.1);
    P(new THREE.PlaneGeometry(0.18, 0.1).rotateX(Math.PI / 2), 'lampLens', 0, 2.355, W / 2 + 0.12);
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, H / 2, 0), new THREE.Vector3(L + 0.1, H, W + 0.1)).applyMatrix4(parent);
    this.colliders.push(b);
    const st = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0.13, W / 2 + 0.25), new THREE.Vector3(1.2, 0.26, 0.4)).applyMatrix4(parent);
    this.colliders.push(st);
    const wl = new THREE.Vector3(0, 2.3, W / 2 + 0.3).applyMatrix4(parent);
    this.cabinLamp = wl;
  }

  buildMarkings() {
    const line = (mat, x, z, len, w, ry) => {
      const g = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * len / 6);
      this.put(g, mat, x, 0.004, z, ry);
    };
    // lane lines
    line('lineYellow', 1.8, -2, 40, 0.15, 0);
    line('lineYellow', 2.2, -2, 40, 0.15, 0);
    line('lineWhite', -15, -2, 40, 0.12, 0);
    // hatched no-park zone in front of the roll-up door
    for (let i = 0; i < 7; i++) line('lineYellow', -15.8 + 0.0, -1.3 + i * 0.75, 2.8, 0.18, Math.PI / 4);
    line('lineYellow', -15.6, 0.5, 5.6, 0.15, 0); line('lineYellow', -16.9, 0.5, 5.6, 0.15, 0);
    // container bay markings
    for (let z = -20; z < 18; z += 6.15) line('lineWhite', 15.5, z - 3.07, 2.0, 0.12, Math.PI / 2);
  }

  buildDistant() {
    // Ship-to-shore gantry cranes on the far side of the basin
    const crane = (x, z, ry) => {
      const parent = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
      const legH = 46, span = 26, depth = 18;
      for (const a of [-1, 1]) for (const b of [-1, 1]) this.put(new THREE.BoxGeometry(1.6, legH, 1.6), 'silhouette', a * span / 2, legH / 2 - 4, b * depth / 2, 0, { parent, noShadow: true });
      this.put(new THREE.BoxGeometry(span + 2, 2.4, 2.4), 'silhouette', 0, 20, depth / 2, 0, { parent, noShadow: true });
      this.put(new THREE.BoxGeometry(span + 2, 2.4, 2.4), 'silhouette', 0, 20, -depth / 2, 0, { parent, noShadow: true });
      // boom over water
      this.put(new THREE.BoxGeometry(2.2, 2.6, 110), 'silhouette', 0, legH - 6, -30, 0, { parent, noShadow: true });
      this.put(new THREE.BoxGeometry(span, 3, 3), 'silhouette', 0, legH - 6, 0, 0, { parent, noShadow: true });
      // A-frame
      this.put(new THREE.BoxGeometry(1.2, 22, 1.2), 'silhouette', 0, legH + 4, 4, 0, { parent, rx: -0.35, noShadow: true });
      this.put(new THREE.BoxGeometry(1.2, 22, 1.2), 'silhouette', 0, legH + 4, -4, 0, { parent, rx: 0.35, noShadow: true });
      // stays
      this.put(new THREE.BoxGeometry(0.4, 0.4, 62), 'silhouette', 0, legH + 2, -40, 0, { parent, rx: -0.29, noShadow: true });
      this.put(new THREE.BoxGeometry(4, 4, 8), 'silhouette', 0, legH - 8, -60, 0, { parent, noShadow: true }); // trolley
      // aviation light
      this.put(new THREE.SphereGeometry(0.6, 8, 6), 'lampRed', 0, legH + 15, 0, 0, { parent, noShadow: true });
    };
    crane(-70, -190, 0.02); crane(-20, -195, 0.0); crane(35, -188, -0.03); crane(110, -200, 0.04);

    // container ship hull + deck stacks
    {
      const parent = new THREE.Matrix4().compose(new THREE.Vector3(30, -2.1, -300), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.04, 0)), new THREE.Vector3(1, 1, 1));
      this.put(new THREE.BoxGeometry(240, 14, 34), 'silhouette', 0, 4, 0, 0, { parent, noShadow: true });
      const cols = ['containerRed', 'containerBlue', 'containerGreen', 'containerOrange', 'paintGrey'];
      for (let i = 0; i < 26; i++) {
        const h = 5 + Math.floor(Math.abs(Math.sin(i * 7.3)) * 4) * 2.6;
        this.put(new THREE.BoxGeometry(7.5, h, 30), cols[i % 5], -100 + i * 7.8, 11 + h / 2, 0, 0, { parent, noShadow: true });
      }
      this.put(new THREE.BoxGeometry(14, 26, 30), 'paintGrey', 96, 24, 0, 0, { parent, noShadow: true });
    }
    // far shore skyline
    for (let i = 0; i < 40; i++) {
      const h = 8 + Math.abs(Math.sin(i * 3.7)) * 40 + (i % 7 === 0 ? 45 : 0);
      const w = 14 + Math.abs(Math.sin(i * 1.3)) * 26;
      this.put(new THREE.BoxGeometry(w, h, 20), 'silhouette', -500 + i * 26, h / 2 - 2, -620 - Math.abs(Math.sin(i * 2.1)) * 60, 0, { noShadow: true });
    }
  }

  buildLights() {
    for (const p of this.lamps) {
      const s = new THREE.SpotLight(new THREE.Color(1.0, 0.68, 0.38), 220, 26, 0.95, 0.6, 1.8);
      s.position.copy(p);
      s.target.position.set(p.x - 0.5, 0, p.z);
      this.scene.add(s, s.target);
      this.lights.push(s);
    }
    if (this.cabinLamp) {
      const cl = new THREE.PointLight(new THREE.Color(1.0, 0.8, 0.55), 6, 7, 2);
      cl.position.copy(this.cabinLamp); this.scene.add(cl); this.lights.push(cl);
    }
    // warm spill from roll-up door gap & wall pack light
    const wp = new THREE.SpotLight(new THREE.Color(1.0, 0.85, 0.65), 90, 16, 0.9, 0.7, 1.8);
    wp.position.set(-17.4, 5.4, 0.5); wp.target.position.set(-12, 0, 0.5);
    this.scene.add(wp, wp.target); this.lights.push(wp);
    this.box(0.3, 0.3, 0.45, 'darkSteel', -17.85, 5.3, 0.5, 0, { collide: false });
    this.put(new THREE.PlaneGeometry(0.35, 0.22).rotateX(Math.PI / 2), 'lampLens', -17.72, 5.295, 0.5);
  }
}
