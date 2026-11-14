// GPU procedural PBR texture generator.
// Every material is a GLSL function evaluated on a fullscreen quad. Three passes
// are rendered per material (albedo / tangent-space normal / packed ORM), read
// back into DataTextures with mipmaps + anisotropy. All noise is periodic so
// every texture tiles seamlessly.
import * as THREE from 'three';

const COMMON = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uPass;
uniform vec2 uTexel;
uniform float uNormalStrength;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uSeed;

#define PI 3.14159265359

vec2 wrapc(vec2 c, vec2 per){ return mod(c, per); }

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * 0.0213);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * 0.031);
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// periodic value noise
float vnoise(vec2 p, vec2 per){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = hash12(wrapc(i, per));
  float b = hash12(wrapc(i+vec2(1,0), per));
  float c = hash12(wrapc(i+vec2(0,1), per));
  float d = hash12(wrapc(i+vec2(1,1), per));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
// periodic gradient noise  [-1,1]
float gnoise(vec2 p, vec2 per){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 ga = hash22(wrapc(i, per))*2.0-1.0;
  vec2 gb = hash22(wrapc(i+vec2(1,0), per))*2.0-1.0;
  vec2 gc = hash22(wrapc(i+vec2(0,1), per))*2.0-1.0;
  vec2 gd = hash22(wrapc(i+vec2(1,1), per))*2.0-1.0;
  float a = dot(ga, f); float b = dot(gb, f-vec2(1,0));
  float c = dot(gc, f-vec2(0,1)); float d = dot(gd, f-vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 1.414;
}
float fbm(vec2 uv, vec2 freq, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 f = freq;
  for(int i=0;i<10;i++){
    if(i>=oct) break;
    s += a * (gnoise(uv*f, f)*0.5+0.5);
    n += a; a *= 0.5; f *= 2.0;
  }
  return s/n;
}
float ridged(vec2 uv, vec2 freq, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 f = freq;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    s += a * (1.0 - abs(gnoise(uv*f, f)));
    n += a; a *= 0.5; f *= 2.0;
  }
  return s/n;
}
// periodic voronoi: x = F1, y = F2, z = cell hash
vec3 voronoi(vec2 uv, vec2 freq){
  vec2 p = uv*freq;
  vec2 i = floor(p); vec2 f = fract(p);
  float F1 = 8.0, F2 = 8.0; float id = 0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(x,y);
    vec2 c = wrapc(i+g, freq);
    vec2 o = hash22(c);
    vec2 r = g + o - f;
    float d = dot(r,r);
    if(d<F1){ F2=F1; F1=d; id = hash12(c+7.7);} else if(d<F2){ F2=d; }
  }
  return vec3(sqrt(F1), sqrt(F2), id);
}
float sat(float x){ return clamp(x,0.0,1.0); }
float lin2srgb(float c){ return c <= 0.0031308 ? 12.92*c : 1.055*pow(c, 1.0/2.4) - 0.055; }
vec3 lin2srgb(vec3 c){ return vec3(lin2srgb(c.r), lin2srgb(c.g), lin2srgb(c.b)); }
vec3 srgb2lin(vec3 c){ return pow(c, vec3(2.2)); }
`;

const MAIN = /* glsl */`
void main(){
  vec3 albedo; float h, rough, metal, ao;
  if(uPass == 0){
    material(vUv, albedo, h, rough, metal, ao);
    #ifdef ALPHA_AO
    gl_FragColor = vec4(lin2srgb(clamp(albedo,0.0,1.0)), clamp(ao,0.0,1.0));
    #else
    gl_FragColor = vec4(lin2srgb(clamp(albedo,0.0,1.0)), 1.0);
    #endif
  } else if(uPass == 1){
    vec3 a2; float r2, m2, o2, hx0, hx1, hy0, hy1;
    material(fract(vUv - vec2(uTexel.x,0.0)), a2, hx0, r2, m2, o2);
    material(fract(vUv + vec2(uTexel.x,0.0)), a2, hx1, r2, m2, o2);
    material(fract(vUv - vec2(0.0,uTexel.y)), a2, hy0, r2, m2, o2);
    material(fract(vUv + vec2(0.0,uTexel.y)), a2, hy1, r2, m2, o2);
    vec3 n = normalize(vec3((hx0-hx1)*uNormalStrength, (hy0-hy1)*uNormalStrength, 1.0));
    gl_FragColor = vec4(n*0.5+0.5, 1.0);
  } else if(uPass == 2){
    material(vUv, albedo, h, rough, metal, ao);
    gl_FragColor = vec4(clamp(ao,0.0,1.0), clamp(rough,0.02,1.0), clamp(metal,0.0,1.0), 1.0);
  } else {
    material(vUv, albedo, h, rough, metal, ao);
    gl_FragColor = vec4(h, h, h, 1.0);
  }
}
`;

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class TexGen {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  // def: { glsl, size, normalStrength, colorA, colorB, seed, alpha }
  generate(def) {
    const size = def.size || 1024;
    const w = def.width || size, h = def.height || size;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: (def.alpha ? '#define ALPHA_AO\n' : '') + COMMON + def.glsl + MAIN,
      uniforms: {
        uPass: { value: 0 },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
        uNormalStrength: { value: def.normalStrength ?? 4.0 },
        uColorA: { value: new THREE.Color(def.colorA ?? 0xffffff) }, // linear
        uColorB: { value: new THREE.Color(def.colorB ?? 0x000000) },
        uSeed: { value: def.seed ?? 0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad.material = mat;

    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, type: THREE.UnsignedByteType });
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    const out = {};
    const passes = def.passes || ['map', 'normalMap', 'orm'];
    for (const name of passes) {
      const passId = { map: 0, normalMap: 1, orm: 2, height: 3 }[name];
      mat.uniforms.uPass.value = passId;
      r.setRenderTarget(rt);
      r.render(this.scene, this.cam);
      const buf = new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      const tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = this.maxAniso;
      tex.colorSpace = name === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      out[name] = tex;
    }
    r.setRenderTarget(prevRT);
    r.toneMapping = prevTone;
    rt.dispose();
    mat.dispose();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Material library (GLSL). Each defines:
// void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao)
// ---------------------------------------------------------------------------
export const GLSL = {};

// Wet poured-concrete yard: 2x2 slabs per tile, saw-cut joints, cracks,
// aggregate, oil stains, tyre grime and standing water.
GLSL.ground = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  // slabs (2x2 per texture)
  vec2 s = uv*2.0; vec2 sf = fract(s); vec2 sid = floor(s);
  float jd = min(min(sf.x,1.0-sf.x), min(sf.y,1.0-sf.y));
  float joint = 1.0 - smoothstep(0.0025, 0.006, jd);
  float slabTone = hash12(sid+3.1);

  float n1 = fbm(uv, vec2(6.0), 7);
  float n2 = fbm(uv+0.37, vec2(24.0), 5);
  float fine = gnoise(uv*512.0, vec2(512.0))*0.5+0.5;
  float grit = hash12(floor(uv*1024.0));
  // aggregate pebbles
  vec3 vo = voronoi(uv, vec2(180.0));
  float pebble = smoothstep(0.32, 0.12, vo.x) * step(0.55, vo.z);

  // cracks: voronoi edges perturbed by noise, masked
  vec2 wuv = uv + (vec2(fbm(uv, vec2(8.0),4), fbm(uv+5.2, vec2(8.0),4))-0.5)*0.06;
  vec3 cv = voronoi(wuv, vec2(5.0));
  float crackMask = smoothstep(0.55, 0.75, fbm(uv+1.7, vec2(3.0), 3));
  float crack = (1.0 - smoothstep(0.0, 0.012, cv.y - cv.x)) * crackMask;

  // puddles: low-frequency field, biased into joints / low spots
  float pf = fbm(uv+9.1, vec2(3.0), 6);
  float puddle = smoothstep(0.565, 0.59, pf + joint*0.03);
  float wetEdge = smoothstep(0.47, 0.585, pf);

  // oil / grime stains
  float oil = smoothstep(0.62, 0.78, fbm(uv+3.3, vec2(4.0), 5)) * 0.9;
  float grime = fbm(uv+7.0, vec2(2.0), 4);

  vec3 base = mix(vec3(0.36,0.35,0.33), vec3(0.50,0.49,0.46), n1);
  base *= mix(0.86, 1.08, slabTone);
  base *= mix(0.82, 1.0, n2);
  base = mix(base, base*vec3(0.72,0.70,0.66), smoothstep(0.4,0.8,grime)*0.6);
  base += (grit-0.5)*0.05;
  base = mix(base, base*1.18, pebble*0.5);
  base = mix(base, base*0.28, oil);
  base = mix(base, vec3(0.06), joint*0.85);
  base = mix(base, vec3(0.05), crack);

  // darken when wet
  float wet = max(wetEdge*0.65, puddle);
  albedo = base * mix(1.0, 0.52, wet);
  albedo = mix(albedo, albedo*vec3(0.85,0.9,1.0), puddle);

  h = n1*0.35 + n2*0.25 + fine*0.08 + pebble*0.05 - joint*0.6 - crack*0.5;
  h = mix(h, 0.30, puddle); // water surface is flat

  rough = mix(0.82, 0.95, fine) - n2*0.1;
  rough = mix(rough, 0.32, wetEdge*0.8);
  rough = mix(rough, 0.06, puddle);
  rough = mix(rough, 0.25, oil*0.6);
  metal = 0.0;
  ao = 1.0 - joint*0.7 - crack*0.6 - (1.0-n2)*0.15;
}
`;

// Running-bond brick with recessed mortar, per-brick tone, chips and soot.
GLSL.brick = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 bc = vec2(4.0, 12.0); // bricks per tile
  vec2 p = uv*bc;
  float row = floor(p.y);
  p.x += mod(row,2.0)*0.5;
  vec2 id = floor(p); vec2 f = fract(p);
  id.x = mod(id.x, bc.x);
  float mx = 0.035, my = 0.10;
  vec2 e = vec2(min(f.x,1.0-f.x)/mx, min(f.y,1.0-f.y)/my);
  float edge = min(e.x, e.y);
  float chip = fbm(uv+hash12(id)*3.0, vec2(48.0), 4);
  float brickMask = smoothstep(0.9, 1.5 + chip*1.4, edge);

  float tone = hash12(id);
  float tone2 = hash12(id+1.3);
  vec3 bcol = mix(vec3(0.42,0.16,0.10), vec3(0.62,0.28,0.17), tone);
  bcol = mix(bcol, vec3(0.30,0.20,0.17), step(0.86, tone2)); // dark clinker
  bcol = mix(bcol, vec3(0.66,0.42,0.30), step(0.93, tone2)*0.7);
  float n = fbm(uv, vec2(32.0), 6);
  float spec = hash12(floor(uv*1024.0));
  bcol *= mix(0.78, 1.12, n);
  bcol *= 0.94 + spec*0.12;

  vec3 mortar = vec3(0.50,0.48,0.44) * mix(0.75,1.05, fbm(uv+4.0, vec2(64.0),4));
  albedo = mix(mortar, bcol, brickMask);
  // soot / grime: vertical streaks from the top
  float streak = fbm(vec2(uv.x, uv.y*0.15), vec2(24.0, 1.0), 5);
  float grime = smoothstep(0.35, 0.9, streak) * 0.55;
  albedo *= 1.0 - grime*0.6;
  // efflorescence (white salt) patches
  float eff = smoothstep(0.66, 0.85, fbm(uv+2.0, vec2(4.0), 5));
  albedo = mix(albedo, vec3(0.70,0.68,0.64), eff*0.35*(1.0-brickMask*0.4));

  h = brickMask*0.7 + n*0.2 + spec*0.04 - (1.0-brickMask)*0.1*fbm(uv, vec2(128.0),3);
  rough = mix(0.95, 0.80, brickMask) - n*0.08;
  metal = 0.0;
  ao = mix(0.55, 1.0, smoothstep(0.0, 1.0, edge*0.6));
}
`;

// Painted corrugated sheet cladding with peeling paint, rust streaks.
GLSL.corrugated = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  float wave = sin(uv.x*PI*2.0*8.0);
  float prof = wave*0.5+0.5;
  float n = fbm(uv, vec2(8.0), 6);
  float peel = smoothstep(0.62, 0.66, fbm(uv+1.0, vec2(10.0,6.0), 6));
  float rustStreak = smoothstep(0.45, 0.95, fbm(vec2(uv.x, uv.y*0.12), vec2(32.0,1.0), 5));
  float rustTop = smoothstep(0.75, 1.0, uv.y) * 0.8;
  float rust = sat(max(rustStreak*0.7, rustTop) * fbm(uv+3.0, vec2(16.0),4)*1.6);
  vec3 paint = uColorA * mix(0.75, 1.05, n);
  paint *= 0.92 + hash12(floor(uv*1024.0))*0.08;
  // sun-bleached on ridges
  paint = mix(paint, paint*1.2+0.04, prof*0.25);
  vec3 rustC = mix(vec3(0.24,0.09,0.03), vec3(0.45,0.20,0.07), fbm(uv+2.0, vec2(64.0),4));
  vec3 bare = vec3(0.55,0.55,0.53);
  albedo = mix(paint, rustC, rust);
  albedo = mix(albedo, mix(bare, rustC, 0.5), peel);
  // grime in valleys
  albedo *= mix(0.7, 1.0, prof);
  h = prof*0.9 + n*0.05 - peel*0.04 + rust*0.03*fbm(uv, vec2(128.0),3);
  rough = mix(0.55, 0.78, n) ; rough = mix(rough, 0.9, rust); rough = mix(rough, 0.45, peel);
  metal = mix(0.0, 0.85, peel*(1.0-rust));
  ao = mix(0.7, 1.0, prof);
}
`;

// Shipping container side: trapezoidal corrugation, u repeats, v spans height.
GLSL.container = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  // trapezoid profile, 4 per tile in u
  float x = fract(uv.x*4.0);
  // uColorB.x = 1 -> geometry already has the corrugation, keep texture flat
  float prof = mix(smoothstep(0.08, 0.20, x) * (1.0 - smoothstep(0.58, 0.70, x)), 0.6, uColorB.x);
  float n = fbm(uv, vec2(6.0, 4.0), 6);
  float scratches = 0.0;
  {
    vec2 q = vec2(uv.x*40.0 + uv.y*6.0, uv.y*3.0);
    float l = abs(fract(q.x + gnoise(uv*vec2(8.0,4.0), vec2(8.0,4.0))*0.6) - 0.5);
    scratches = (1.0-smoothstep(0.0, 0.015, l)) * step(0.82, vnoise(uv*vec2(16.0,12.0), vec2(16.0,12.0)));
  }
  // dents
  float dent = fbm(uv+8.0, vec2(3.0,2.0), 3);
  // rust: patches + streaks from top rail + bottom
  float rp = smoothstep(0.66, 0.75, fbm(uv+4.4, vec2(6.0,4.0), 6));
  float streak = smoothstep(0.55, 0.95, fbm(vec2(uv.x, uv.y*0.2), vec2(48.0,1.0), 5)) * smoothstep(0.3, 1.0, uv.y);
  float bottom = smoothstep(0.18, 0.0, uv.y) * fbm(uv+1.0, vec2(24.0,4.0), 4)*1.5;
  float rust = sat(rp + streak*0.6 + bottom);
  vec3 paint = uColorA * mix(0.78, 1.06, n);
  paint = mix(paint, paint*1.15 + 0.03, (1.0-prof)*0.15 + smoothstep(0.5,1.0,uv.y)*0.12); // fading
  vec3 rustC = mix(vec3(0.20,0.075,0.03), vec3(0.42,0.18,0.07), fbm(uv+2.0, vec2(48.0,32.0),4));
  albedo = mix(paint, rustC, rust*0.9);
  albedo = mix(albedo, vec3(0.42,0.42,0.40), scratches*0.7);
  // dirt at bottom
  float dirt = smoothstep(0.35, 0.0, uv.y) * 0.5 * fbm(uv+6.0, vec2(16.0,4.0),4);
  albedo = mix(albedo, vec3(0.16,0.13,0.10), dirt);
  albedo *= mix(0.78, 1.0, prof);
  h = prof*0.8 + (dent-0.5)*0.25 + rust*0.03*vnoise(uv*vec2(256.0,128.0), vec2(256.0,128.0)) - scratches*0.02;
  rough = mix(0.5, 0.7, n); rough = mix(rough, 0.92, rust); rough = mix(rough, 0.35, scratches);
  metal = scratches*0.9;
  ao = mix(0.75, 1.0, prof) * (1.0 - smoothstep(0.06, 0.0, uv.y)*0.4);
}
`;

// Cast-in-place concrete wall: formwork panel seams, tie holes, water stains.
GLSL.concreteWall = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 pc = vec2(2.0, 2.0);
  vec2 p = uv*pc; vec2 f = fract(p); vec2 id = floor(p);
  float seam = 1.0 - smoothstep(0.0, 0.004, min(min(f.x,1.0-f.x), min(f.y,1.0-f.y)));
  // tie holes at 1/6, 1/2, 5/6 grid
  vec2 tp = fract(p*vec2(2.0,3.0)) - 0.5;
  float hole = 1.0 - smoothstep(0.018, 0.026, length(tp*vec2(1.0, 1.5)));
  float holeRim = smoothstep(0.02, 0.03, length(tp*vec2(1.0,1.5))) * (1.0 - smoothstep(0.03, 0.06, length(tp*vec2(1.0,1.5))));
  float panelTone = hash12(id+2.0);
  float n = fbm(uv, vec2(8.0), 7);
  float wood = gnoise(vec2(uv.x*6.0, uv.y*160.0) + fbm(uv, vec2(4.0), 3)*3.0, vec2(6.0, 160.0))*0.5+0.5;
  float pores = step(0.985, hash12(floor(uv*900.0))) * step(0.4, vnoise(uv*60.0, vec2(60.0)));
  float streak = smoothstep(0.4, 0.95, fbm(vec2(uv.x, uv.y*0.1), vec2(40.0, 1.0), 6));
  float bottomDamp = smoothstep(0.35, 0.0, uv.y) * fbm(uv+3.0, vec2(12.0,4.0), 5);
  vec3 c = mix(vec3(0.36,0.35,0.33), vec3(0.50,0.49,0.46), n);
  c *= mix(0.9, 1.07, panelTone);
  c *= 0.96 + wood*0.06;
  c = mix(c, c*vec3(0.55,0.55,0.52), streak*0.55);
  c = mix(c, vec3(0.20,0.22,0.17), bottomDamp*0.7); // moss/damp
  c = mix(c, vec3(0.08), hole);
  c = mix(c, c*0.75, seam);
  c *= 1.0 - pores*0.6;
  albedo = c;
  h = n*0.4 + wood*0.04 - seam*0.25 - hole*0.8 + holeRim*0.08 - pores*0.3;
  rough = mix(0.86, 0.96, n); rough = mix(rough, 0.7, streak*0.4);
  metal = 0.0;
  ao = 1.0 - hole*0.8 - seam*0.3;
}
`;

// Diamond tread plate steel, galvanised and worn.
GLSL.treadPlate = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 p = uv*16.0;
  vec2 c = floor(p); vec2 f = fract(p)-0.5;
  float flip = mod(c.x+c.y, 2.0);
  vec2 q = flip > 0.5 ? vec2(f.x+f.y, f.x-f.y) : vec2(f.x-f.y, f.x+f.y);
  float lug = 1.0 - smoothstep(0.08, 0.12, length(q*vec2(0.28, 1.0)));
  float n = fbm(uv, vec2(8.0), 6);
  float wear = smoothstep(0.4, 0.8, fbm(uv+2.0, vec2(4.0), 5));
  float rust = smoothstep(0.66, 0.8, fbm(uv+5.0, vec2(6.0), 6));
  vec3 steel = mix(vec3(0.42,0.43,0.44), vec3(0.62,0.62,0.62), n);
  steel = mix(steel, vec3(0.75), lug*wear*0.6);
  vec3 rustC = vec3(0.35,0.16,0.06);
  albedo = mix(steel, rustC, rust);
  albedo *= 1.0 - smoothstep(0.7,1.0, fbm(uv+9.0, vec2(3.0),4))*0.4;
  h = lug*0.8 + n*0.1;
  rough = mix(0.55, 0.32, lug*wear); rough = mix(rough, 0.9, rust);
  metal = mix(1.0, 0.0, rust);
  ao = mix(0.75, 1.0, lug);
}
`;

// Weathered wood planks (pallets, crates).
GLSL.wood = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  float planks = 6.0;
  float py = uv.y*planks; float pid = floor(py); float pf = fract(py);
  float seam = 1.0 - smoothstep(0.0, 0.025, min(pf, 1.0-pf));
  float off = hash12(vec2(pid, 1.0));
  vec2 g = vec2(uv.x + off, uv.y);
  float warp = fbm(g, vec2(2.0, 12.0), 4);
  float grain = sin((g.y*planks*14.0 + warp*12.0 + gnoise(g*vec2(4.0,96.0), vec2(4.0,96.0))*1.5)*PI)*0.5+0.5;
  float fine = gnoise(g*vec2(8.0, 512.0), vec2(8.0,512.0))*0.5+0.5;
  // knots
  vec3 kv = voronoi(g, vec2(3.0, 18.0));
  float knot = (1.0 - smoothstep(0.05, 0.15, kv.x)) * step(0.75, kv.z);
  float tone = hash12(vec2(pid, 7.0));
  vec3 c = mix(vec3(0.42,0.30,0.18), vec3(0.62,0.48,0.32), tone);
  c = mix(c*0.75, c, grain);
  c *= 0.9 + fine*0.15;
  c = mix(c, vec3(0.22,0.14,0.08), knot);
  // greying weathering
  float weather = fbm(uv+1.0, vec2(4.0), 5);
  c = mix(c, vec3(0.42,0.40,0.37)*(0.8+grain*0.3), smoothstep(0.35, 0.8, weather)*0.7);
  c = mix(c, vec3(0.05), seam);
  albedo = c;
  h = grain*0.25 + fine*0.15 - seam*0.9 - knot*0.15;
  rough = mix(0.78, 0.95, fine);
  metal = 0.0;
  ao = 1.0 - seam*0.7;
}
`;

// Generic painted steel with chips, scratches and rust (drums, poles, rails).
GLSL.paintedMetal = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  float n = fbm(uv, vec2(4.0), 6);
  float chips = smoothstep(0.66, 0.69, fbm(uv+2.2, vec2(12.0), 6));
  float rust = smoothstep(0.62, 0.80, fbm(uv+5.5, vec2(5.0), 6));
  float drip = smoothstep(0.5, 0.95, fbm(vec2(uv.x, uv.y*0.15), vec2(32.0,1.0),4))*0.5;
  vec3 paint = uColorA * mix(0.8, 1.06, n);
  vec3 rustC = mix(vec3(0.22,0.08,0.03), vec3(0.46,0.21,0.08), fbm(uv+1.0, vec2(32.0),4));
  albedo = mix(paint, rustC, sat(rust + drip));
  albedo = mix(albedo, vec3(0.5,0.5,0.5), chips*(1.0-rust));
  h = n*0.1 - chips*0.2 + rust*0.1*vnoise(uv*200.0, vec2(200.0));
  rough = mix(0.45, 0.65, n); rough = mix(rough, 0.92, rust); rough = mix(rough, 0.4, chips);
  metal = chips*(1.0-rust);
  ao = 1.0;
}
`;

// Weapon finish: matte cerakote with micro texture and slight wear.
GLSL.gunMetal = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  float n = fbm(uv, vec2(8.0), 6);
  float micro = hash12(floor(uv*1024.0));
  float wear = smoothstep(0.62, 0.78, fbm(uv+3.0, vec2(6.0), 6));
  float scratch = 0.0;
  for(int i=0;i<3;i++){
    float a = float(i)*1.7+0.4;
    vec2 d = vec2(cos(a), sin(a));
    float l = abs(fract(dot(uv, d)*30.0 + gnoise(uv*6.0, vec2(6.0))*0.3)-0.5);
    scratch += (1.0-smoothstep(0.0, 0.01, l)) * step(0.85, vnoise(uv*vec2(10.0), vec2(10.0)));
  }
  vec3 c = uColorA * mix(0.85, 1.1, n) * (0.95 + micro*0.1);
  c = mix(c, vec3(0.5,0.5,0.52), sat(wear*0.6 + scratch*0.5));
  albedo = c;
  h = micro*0.15 + n*0.1 - scratch*0.1;
  rough = mix(0.5, 0.66, micro); rough = mix(rough, 0.3, sat(wear+scratch));
  metal = mix(uColorB.x, 1.0, sat(wear+scratch));
  ao = 1.0;
}
`;

// Stippled polymer for grips/furniture.
GLSL.polymer = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec3 v = voronoi(uv, vec2(96.0));
  float bump = smoothstep(0.5, 0.0, v.x);
  float n = fbm(uv, vec2(4.0), 4);
  albedo = uColorA * (0.85 + n*0.2) * (0.92 + bump*0.1);
  h = bump*0.6 + n*0.1;
  rough = mix(0.78, 0.62, bump);
  metal = 0.0; ao = 1.0;
}
`;

// Chain-link fence mask (alpha in albedo pass's "ao"); albedo=galv steel.
GLSL.chainlink = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 p = uv*16.0;
  vec2 q = vec2(p.x+p.y, p.x-p.y);
  vec2 f = abs(fract(q)-0.5);
  float d = min(f.x, f.y);
  float wire = 1.0 - smoothstep(0.035, 0.06, d);
  float n = fbm(uv, vec2(4.0), 4);
  float rust = smoothstep(0.6,0.8, fbm(uv+3.0, vec2(8.0), 5));
  albedo = mix(vec3(0.55,0.56,0.57)*(0.8+n*0.3), vec3(0.35,0.18,0.08), rust);
  h = 1.0 - d*4.0;
  rough = mix(0.4, 0.85, rust);
  metal = mix(1.0, 0.1, rust);
  ao = wire; // used as alpha mask
}
`;

// Water ripples normal source (height only matters).
GLSL.water = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  float a = fbm(uv, vec2(4.0), 7);
  float b = ridged(uv+0.3, vec2(8.0, 6.0), 5);
  h = a*0.6 + b*0.4;
  albedo = vec3(0.02,0.04,0.05); rough = 0.05; metal = 0.0; ao = 1.0;
}
`;

// Road-marking paint decal (alpha in ao channel).
GLSL.paintLine = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  float n = fbm(uv, vec2(16.0, 2.0), 6);
  float worn = smoothstep(0.35, 0.55, n + hash12(floor(uv*vec2(512.0,64.0)))*0.15);
  float edge = smoothstep(0.0, 0.04, uv.x) * smoothstep(1.0, 0.96, uv.x);
  albedo = uColorA * (0.85 + n*0.2);
  h = worn*0.3; rough = 0.6; metal = 0.0;
  ao = worn*edge;
}
`;

// Soft smoke puff sprite (albedo=white, ao=alpha).
GLSL.smoke = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 c = uv-0.5;
  float r = length(c)*2.0;
  float n = fbm(uv, vec2(4.0), 6);
  float m = sat(1.0 - r) ;
  m = smoothstep(0.0, 1.0, m) * (0.4 + n*0.9);
  albedo = vec3(1.0); h = 0.0; rough = 1.0; metal = 0.0;
  ao = sat(m*m*1.4);
}
`;

// Bullet hole decal: dark crater, fractured rim, scorch ring.
GLSL.bulletHole = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 c = uv-0.5; float r = length(c)*2.0;
  float ang = atan(c.y, c.x);
  float jag = gnoise(vec2(ang*3.0, 0.0)+3.0, vec2(20.0))*0.08;
  float hole = 1.0 - smoothstep(0.14+jag, 0.2+jag, r);
  float rim = smoothstep(0.12, 0.25, r) * (1.0 - smoothstep(0.25, 0.5 + jag*2.0, r));
  float scorch = (1.0 - smoothstep(0.2, 0.95, r)) * (0.6 + 0.4*fbm(uv, vec2(8.0), 4));
  float cracks = (1.0-smoothstep(0.0, 0.08, abs(sin(ang*7.0 + gnoise(uv*6.0,vec2(6.0))*2.0)))) * (1.0-smoothstep(0.2, 0.7, r)) * step(0.15, r);
  albedo = mix(vec3(0.25,0.23,0.2), vec3(0.02), hole);
  h = 0.5 - hole*0.5 + rim*0.2 - cracks*0.2;
  rough = 0.9; metal = 0.0;
  ao = sat(max(hole, scorch*0.75 + cracks*0.5));
}
`;

// Ripstop fabric for sleeves.
GLSL.fabric = /* glsl */`
void material(vec2 uv, out vec3 albedo, out float h, out float rough, out float metal, out float ao){
  vec2 p = uv*96.0;
  float wx = sin(p.x*PI)*0.5+0.5, wy = sin(p.y*PI)*0.5+0.5;
  float weave = mod(floor(p.x)+floor(p.y), 2.0) > 0.5 ? wx : wy;
  vec2 g = fract(uv*24.0);
  float rip = (1.0-smoothstep(0.0, 0.03, min(g.x, g.y)));
  float n = fbm(uv, vec2(6.0), 5);
  // multicam-ish blotches
  float b1 = smoothstep(0.5, 0.55, fbm(uv+1.0, vec2(5.0), 5));
  float b2 = smoothstep(0.58, 0.62, fbm(uv+4.0, vec2(7.0), 5));
  float b3 = smoothstep(0.62, 0.66, fbm(uv+8.0, vec2(9.0), 5));
  vec3 c = mix(vec3(0.24,0.22,0.15), vec3(0.13,0.13,0.08), b1);
  c = mix(c, vec3(0.34,0.29,0.20), b2*0.8);
  c = mix(c, vec3(0.07,0.06,0.045), b3*0.8);
  c *= 0.9 + weave*0.12 + n*0.1;
  albedo = c * (1.0 - rip*0.15);
  h = weave*0.5 + rip*0.3;
  rough = 0.92; metal = 0.0; ao = 0.9 + weave*0.1;
}
`;
