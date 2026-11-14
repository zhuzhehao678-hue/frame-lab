import * as THREE from 'three';
import { TexGen, GLSL } from './texgen.js';

// Builds the full PBR material library. `progress(frac,label)` is awaited
// between textures so the loading bar can repaint.
export async function buildMaterials(renderer, quality, progress) {
  const tg = new TexGen(renderer);
  const S = quality.texSize; // 1024 or 2048
  const half = Math.max(512, S / 2);
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);

  const jobs = [
    ['ground', { glsl: GLSL.ground, size: S * 2 > 2048 ? 2048 : S * 2, normalStrength: 5 }],
    ['brick', { glsl: GLSL.brick, size: S, normalStrength: 6 }],
    ['claddingTeal', { glsl: GLSL.corrugated, size: S, normalStrength: 7, colorA: lin(0.10, 0.22, 0.22) }],
    ['claddingGrey', { glsl: GLSL.corrugated, size: S, normalStrength: 7, colorA: lin(0.32, 0.33, 0.33), seed: 3 }],
    ['containerRed', { glsl: GLSL.container, size: S, normalStrength: 7, colorB: lin(1, 0, 0), colorA: lin(0.36, 0.06, 0.03), seed: 1 }],
    ['containerBlue', { glsl: GLSL.container, size: S, normalStrength: 7, colorB: lin(1, 0, 0), colorA: lin(0.03, 0.10, 0.24), seed: 2 }],
    ['containerGreen', { glsl: GLSL.container, size: S, normalStrength: 7, colorB: lin(1, 0, 0), colorA: lin(0.10, 0.17, 0.10), seed: 5 }],
    ['containerOrange', { glsl: GLSL.container, size: S, normalStrength: 7, colorB: lin(1, 0, 0), colorA: lin(0.62, 0.22, 0.03), seed: 7 }],
    ['concreteWall', { glsl: GLSL.concreteWall, size: S, normalStrength: 4 }],
    ['tread', { glsl: GLSL.treadPlate, size: half, normalStrength: 6 }],
    ['wood', { glsl: GLSL.wood, size: half, normalStrength: 5 }],
    ['paintYellow', { glsl: GLSL.paintedMetal, size: half, normalStrength: 3, colorA: lin(0.75, 0.48, 0.02) }],
    ['paintBlue', { glsl: GLSL.paintedMetal, size: half, normalStrength: 3, colorA: lin(0.04, 0.12, 0.30), seed: 4 }],
    ['paintGrey', { glsl: GLSL.paintedMetal, size: half, normalStrength: 3, colorA: lin(0.20, 0.21, 0.21), seed: 6 }],
    ['paintRed', { glsl: GLSL.paintedMetal, size: half, normalStrength: 3, colorA: lin(0.40, 0.05, 0.03), seed: 8 }],
    ['gunMetal', { glsl: GLSL.gunMetal, size: half, normalStrength: 2, colorA: lin(0.035, 0.036, 0.038), colorB: lin(0.55, 0, 0) }],
    ['gunTan', { glsl: GLSL.gunMetal, size: half, normalStrength: 2, colorA: lin(0.30, 0.24, 0.16), colorB: lin(0.0, 0, 0), seed: 3 }],
    ['fabric', { glsl: GLSL.fabric, size: half, normalStrength: 2 }],
    ['polymer', { glsl: GLSL.polymer, size: half, normalStrength: 3, colorA: lin(0.03, 0.03, 0.032) }],
    ['chainlink', { glsl: GLSL.chainlink, size: half, normalStrength: 3, alpha: true }],
    ['water', { glsl: GLSL.water, size: S, normalStrength: 2, passes: ['normalMap'] }],
    ['lineYellow', { glsl: GLSL.paintLine, size: 512, normalStrength: 1, colorA: lin(0.8, 0.55, 0.02), alpha: true, width: 128, height: 1024 }],
    ['lineWhite', { glsl: GLSL.paintLine, size: 512, normalStrength: 1, colorA: lin(0.8, 0.8, 0.76), alpha: true, width: 128, height: 1024, seed: 2 }],
    ['smoke', { glsl: GLSL.smoke, size: 256, alpha: true, passes: ['map'] }],
    ['bulletHole', { glsl: GLSL.bulletHole, size: 128, alpha: true, normalStrength: 3, passes: ['map', 'normalMap'] }],
  ];

  const tex = {};
  for (let i = 0; i < jobs.length; i++) {
    const [name, def] = jobs[i];
    await progress(i / jobs.length, `合成材质 ${name}`);
    tex[name] = tg.generate(def);
  }
  await progress(1, '编译着色器');

  const pbr = (t, o = {}) => {
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap,
      roughnessMap: t.orm, metalnessMap: t.orm, aoMap: t.orm,
      roughness: 1, metalness: 1, aoMapIntensity: 1, ...o,
    });
    return m;
  };

  const M = {};
  M.ground = pbr(tex.ground, { envMapIntensity: 1.0 });
  // break up tiling: world-space macro variation (dirt, sun-bleaching, tyre-worn lanes)
  M.ground.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGW;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
float gfbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<5;i++){ s += a*gn(p); p *= 2.03; a *= 0.5; } return s; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      float macro = gfbm(vGW.xz * 0.045);
      float macro2 = gfbm(vGW.xz * 0.21 + 17.0);
      diffuseColor.rgb *= mix(0.72, 1.18, macro) * mix(0.9, 1.06, macro2);
      // darker tyre-worn lanes along the forklift route (x ~ 0..4)
      float lane = exp(-pow((vGW.x - 0.6) / 1.6, 2.0)) + exp(-pow((vGW.x - 4.2) / 1.2, 2.0)) * 0.7;
      diffuseColor.rgb *= 1.0 - lane * 0.22 * smoothstep(0.3, 0.7, gn(vGW.xz * vec2(2.0, 0.15)));
      float grime = smoothstep(0.55, 0.8, gfbm(vGW.xz * 0.09 + 3.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.5, 0.44), grime * 0.6);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * mix(0.75, 1.1, macro2), 0.03, 1.0);`);
  };
  M.brick = pbr(tex.brick);
  M.claddingTeal = pbr(tex.claddingTeal);
  M.claddingGrey = pbr(tex.claddingGrey);
  M.containerRed = pbr(tex.containerRed);
  M.containerBlue = pbr(tex.containerBlue);
  M.containerGreen = pbr(tex.containerGreen);
  M.containerOrange = pbr(tex.containerOrange);
  M.concreteWall = pbr(tex.concreteWall);
  M.tread = pbr(tex.tread);
  M.wood = pbr(tex.wood);
  M.paintYellow = pbr(tex.paintYellow);
  M.paintBlue = pbr(tex.paintBlue);
  M.paintGrey = pbr(tex.paintGrey);
  M.paintRed = pbr(tex.paintRed);
  M.gunMetal = pbr(tex.gunMetal);
  M.gunTan = pbr(tex.gunTan);
  M.polymer = pbr(tex.polymer);
  M.fabric = pbr(tex.fabric);
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9, metalness: 0 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.12, metalness: 1 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 1 });
  M.darkSteel = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.45, metalness: 1 });
  M.chainlink = pbr(tex.chainlink, { alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
  M.glassDark = new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 });
  M.windowLit = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.55, 0.24), emissiveIntensity: 1.4, roughness: 0.2 });
  M.lampLens = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1.0, 0.75, 0.45), emissiveIntensity: 40, roughness: 0.3 });
  M.lampRed = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: new THREE.Color(1.0, 0.08, 0.04), emissiveIntensity: 20 });
  M.lineYellow = pbr(tex.lineYellow, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, metalnessMap: null, metalness: 0, aoMap: null });
  M.lineWhite = pbr(tex.lineWhite, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, metalnessMap: null, metalness: 0, aoMap: null });
  M.water = new THREE.MeshPhysicalMaterial({
    color: 0x0b1a1e, roughness: 0.06, metalness: 0.0, normalMap: tex.water.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2, clearcoat: 0.3,
  });
  M.water.normalMap.repeat.set(30, 30);
  M.decalHole = new THREE.MeshStandardMaterial({
    map: tex.bulletHole.map, normalMap: tex.bulletHole.normalMap, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, metalness: 0,
  });
  M.cone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.18, 0.02), roughness: 0.55, metalness: 0, normalMap: tex.polymer.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
  M.reflective = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.25, metalness: 0.6, envMapIntensity: 2 });
  M.cabinWhite = pbr(tex.claddingGrey, { color: new THREE.Color(1.5, 1.5, 1.45) });
  M.lampAmber = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: new THREE.Color(1.0, 0.45, 0.05), emissiveIntensity: 6, roughness: 0.3 });
  M.silhouette = new THREE.MeshStandardMaterial({ color: 0x2a2523, roughness: 0.9, metalness: 0.3 });

  return { M, tex };
}

// Set UVs on a box so that texture tiling matches world size (`scale` metres
// per texture repeat). Keeps texel density constant across the level.
export function boxUV(geo, sx, sy, sz, scale = 2, scaleY = scale) {
  const uv = geo.attributes.uv; const n = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let u = uv.getX(i), v = uv.getY(i);
    if (nx > 0.5) { u *= sz / scale; v *= sy / scaleY; }
    else if (ny > 0.5) { u *= sx / scale; v *= sz / scale; }
    else { u *= sx / scale; v *= sy / scaleY; }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}
