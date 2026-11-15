import * as THREE from 'three';
import { TexGen, GLSL } from './texgen.js';
import { REFL } from './reflect.js';

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
    sh.uniforms.uReflTex = REFL.tex; sh.uniforms.uReflMat = REFL.mat; sh.uniforms.uReflOn = REFL.on; sh.uniforms.uWet = REFL.wet; sh.uniforms.uRain = REFL.rain; sh.uniforms.uRainTime = REFL.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #if defined( RE_IndirectSpecular )
      if (uReflOn > 0.5) {
        // planar reflection replaces the env-map specular on smooth wet areas
        vec4 rp = uReflMat * vec4(vGW, 1.0);
        vec2 ruv = rp.xy / rp.w + (normal.xy - geometryNormal.xy) * 0.06;
        float wetM = smoothstep(0.42, 0.08, roughnessFactor);
        float rough = clamp(roughnessFactor * 10.0, 0.0, 4.0);
        vec3 rc = texture2D(uReflTex, ruv).rgb * 0.5;
        rc += texture2D(uReflTex, ruv + vec2(0.0, 0.004) * rough).rgb * 0.25;
        rc += texture2D(uReflTex, ruv - vec2(0.0, 0.004) * rough).rgb * 0.25;
        radiance = mix(radiance, rc, wetM);
      }
      #endif`).replace('#include <common>', `#include <common>
uniform sampler2D uReflTex; uniform mat4 uReflMat; uniform float uReflOn; uniform float uWet; uniform float uRain; uniform float uRainTime;
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
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uRain > 0.0) {
        // raindrop ripples on standing water
        vec2 rp = vGW.xz * 2.2; vec2 cell = floor(rp); vec2 fr = fract(rp);
        vec2 grad = vec2(0.0);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = cell + vec2(float(i), float(j));
          float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
          float tt = fract(uRainTime * 1.1 + h);
          vec2 d = fr - (vec2(float(i), float(j)) + vec2(fract(h * 7.13), fract(h * 13.71)));
          float r = length(d), front = tt * 0.7;
          float wave = sin((r - front) * 45.0) * (1.0 - tt) * smoothstep(front + 0.06, front, r) * smoothstep(front - 0.18, front, r);
          grad += d / max(r, 1e-3) * wave;
        }
        float wetM = smoothstep(0.32, 0.08, roughnessFactor);
        normal = normalize(normal + (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz * 0.35 * wetM * uRain);
      }`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * mix(0.75, 1.1, macro2), 0.03, 1.0);
      // drier ground for brighter times of day: only the deepest puddles stay glossy
      roughnessFactor = mix(max(roughnessFactor, mix(0.8, 0.05, smoothstep(0.08, 0.04, roughnessFactor))), roughnessFactor, uWet);`);
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
    normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 1.2, clearcoat: 0.3,
  });
  M.water.normalMap.repeat.set(30, 30);
  // harbour water: two crossing swell layers instead of one tiled normal map,
  // view-dependent sun glitter and churned foam where the swell hits the quay
  M.water.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        float wT = uFogParams.w;
        vec2 wUv = vFogWorldPos.xz;
        vec3 mapN = texture2D( normalMap, wUv * 0.11 + vec2(wT * 0.012, wT * 0.019) ).xyz * 2.0 - 1.0;
        vec3 mapN2 = texture2D( normalMap, wUv * vec2(0.043, 0.051) + vec2(-wT * 0.007, wT * 0.009) ).xyz * 2.0 - 1.0;
        vec3 mapN3 = texture2D( normalMap, wUv * 0.37 + vec2(wT * 0.031, -wT * 0.024) ).xyz * 2.0 - 1.0;
        float wDist = length(vFogWorldPos - cameraPosition);
        float detail = 1.0 - smoothstep(20.0, 160.0, wDist);
        mapN = normalize(vec3(mapN.xy * 0.6 + mapN2.xy * 1.1 + mapN3.xy * 0.45 * detail, 1.0));`)
      .replace('#include <opaque_fragment>', `
        {
          // sun glitter: very sharp specular lobe on a perturbed normal, broken up by sparkle noise
          #if NUM_DIR_LIGHTS > 0
            vec3 wV = normalize(vFogWorldPos - cameraPosition);
            vec3 wNw = normalize(vec3(-(mapN.x) * 1.3, 1.0, -(mapN.y) * 1.3));
            vec3 wR = reflect(wV, wNw);
            float gl = pow(max(dot(wR, uFogSunDir), 0.0), 700.0);
            float sp = cloudH(floor(vFogWorldPos.xz * 3.0) + floor(uFogParams.w * 6.0));
            outgoingLight += directionalLights[0].color * gl * step(0.72, sp) * 1.4 * cloudShadow(vFogWorldPos);
          #endif
          // foam lapping against the quay face and fenders
          float qd = vFogWorldPos.z + 27.8;                 // 0 at the quay wall, negative over the water
          float n = cloudN(vFogWorldPos.xz * vec2(1.6, 2.2) + vec2(uFogParams.w * 0.25, uFogParams.w * 0.4));
          n = n * 0.65 + cloudN(vFogWorldPos.xz * 4.7 - uFogParams.w * 0.3) * 0.35;
          float surge = 0.5 + 0.5 * sin(uFogParams.w * 0.9 + vFogWorldPos.x * 0.35);
          float band = exp(qd * (2.6 - surge * 1.2));
          float foam = smoothstep(0.45, 0.75, n + band * 0.55) * band;
          vec3 wSun = vec3(0.0);
          #if NUM_DIR_LIGHTS > 0
            wSun = directionalLights[0].color * max(uFogSunDir.y, 0.05) * cloudShadow(vFogWorldPos);
          #endif
          vec3 foamCol = wSun * 0.32 + uFogColor * 0.7;
          // light scattered back out of the murky water column
          outgoingLight += wSun * vec3(0.006, 0.016, 0.015) * (0.8 + 0.4 * mapN.x);
          outgoingLight = mix(outgoingLight, foamCol, clamp(foam, 0.0, 0.85));
          // turbid green-brown near the quay, darker teal in open water
          outgoingLight *= mix(vec3(1.0), vec3(0.85, 1.05, 0.95), exp(qd * 0.4));
        }
        #include <opaque_fragment>`);
  };
  M.water.customProgramCacheKey = () => 'harbourWater';
  M.decalHole = new THREE.MeshStandardMaterial({
    map: tex.bulletHole.map, normalMap: tex.bulletHole.normalMap, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, metalness: 0,
  });
  M.cone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.18, 0.02), roughness: 0.55, metalness: 0, normalMap: tex.polymer.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
  M.reflective = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.25, metalness: 0.6, envMapIntensity: 2 });
  M.cabinWhite = pbr(tex.claddingGrey, { color: new THREE.Color(1.5, 1.5, 1.45) });
  M.lampAmber = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: new THREE.Color(1.0, 0.45, 0.05), emissiveIntensity: 6, roughness: 0.3 });
  M.sandbag = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.36, 0.31, 0.2), roughness: 0.95, normalMap: tex.fabric.normalMap, normalScale: new THREE.Vector2(1.2, 1.2) });
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
