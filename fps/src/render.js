import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { FOG } from './fog.js';

export const QUALITY = {
  low: { label: '低', pixelRatio: 0.75, texSize: 1024, shadow: 2048, ao: false, godrays: 0, msaa: 0, bloom: true },
  medium: { label: '中', pixelRatio: 1.0, texSize: 1024, shadow: 2048, ao: true, godrays: 32, msaa: 0, bloom: true },
  high: { label: '高', pixelRatio: 1.25, texSize: 1024, shadow: 4096, ao: true, godrays: 56, msaa: 4, bloom: true },
  ultra: { label: '极致', pixelRatio: 2.0, texSize: 2048, shadow: 4096, ao: true, godrays: 80, msaa: 4, bloom: true },
};

// GTAO that skips objects flagged userData.noAO (particles, sky, alpha-tested fence)
class SelectiveGTAOPass extends GTAOPass {
  _overrideVisibility() {
    super._overrideVisibility();
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (o.visible && o.userData.noAO && !cache.includes(o)) { o.visible = false; cache.push(o); }
    });
  }
}

// Screen-space volumetric light scattering (sun shafts), occlusion from depth.
const GodRayShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 1 },
    uDensity: { value: 0.92 }, uDecay: { value: 0.965 }, uWeight: { value: 0.022 }, uExposure: { value: 1.0 },
    uTint: { value: new THREE.Color(1.0, 0.74, 0.46) }, uAspect: { value: 1.0 }, uFrame: { value: 0 },
  },
  defines: { SAMPLES: 48 },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform vec2 uSun; uniform float uSunVis, uDensity, uDecay, uWeight, uExposure, uAspect, uFrame;
    uniform vec3 uTint;
    varying vec2 vUv;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if(uSunVis <= 0.0){ gl_FragColor = base; return; }
      vec2 delta = (vUv - uSun) * uDensity / float(SAMPLES);
      vec2 coord = vUv - delta * ign(gl_FragCoord.xy + uFrame*5.588238);
      float illum = 1.0; vec3 acc = vec3(0.0);
      for(int i=0;i<SAMPLES;i++){
        coord -= delta;
        float d = texture2D(tDepth, coord).r;
        float sky = step(0.99999, d);
        vec3 s = min(texture2D(tDiffuse, coord).rgb, vec3(6.0)) * sky;
        acc += s * illum * uWeight;
        illum *= uDecay;
      }
      vec2 dd = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = exp(-length(dd) * 2.4);
      gl_FragColor = vec4(base.rgb + acc * uTint * uExposure * uSunVis * fall, base.a);
    }`,
};

// Final cinematic composite: CA, vignette, grade, ACES, sRGB, grain, damage FX.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uExposure: { value: 0.56 },
    uRes: { value: new THREE.Vector2(1, 1) }, uDamage: { value: 0 }, uLowHealth: { value: 0 },
    uCA: { value: 0.0018 }, uVignette: { value: 0.32 }, uGrain: { value: 0.045 }, uADS: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uExposure, uDamage, uLowHealth, uCA, uVignette, uGrain, uADS, uFlash;
    uniform vec2 uRes; varying vec2 vUv;

    // ACES fitted (Stephen Hill)
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
    vec3 ACES(vec3 c){
      const mat3 i = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
      const mat3 o = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
      c = i * c; c = RRTAndODTFit(c); c = o * c; return clamp(c, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*0.0) * 43758.5453); }
    float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }

    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c,c);
      // chromatic aberration grows toward the edges
      float ca = uCA * (1.0 + uDamage*4.0) * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - c*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + c*ca).b;
      col *= uExposure;
      col += uFlash * vec3(1.0, 0.85, 0.6) * 0.15;

      // colour grade in linear (pre-tonemap): warm highlights, cool shadows
      float L = luma(col);
      vec3 shadowTint = vec3(0.92, 0.98, 1.08);
      vec3 highTint = vec3(1.06, 1.0, 0.92);
      col *= mix(shadowTint, highTint, smoothstep(0.02, 1.2, L));
      // saturation
      col = mix(vec3(L), col, 1.08 - uLowHealth*0.7);

      col = ACES(col);

      // filmic contrast curve in display space
      col = toSRGB(col);
      col = mix(col, col*col*(3.0-2.0*col), 0.18);

      // vignette
      float vig = smoothstep(0.85, 0.18, length(c*vec2(1.0, 0.9)) * (1.0 + uVignette*0.6 + uADS*0.25));
      col *= mix(1.0 - uVignette, 1.0, vig);
      // damage: red edge pulse
      float edge = smoothstep(0.2, 0.75, length(c));
      col = mix(col, vec3(0.45, 0.02, 0.0), edge * clamp(uDamage*0.85 + uLowHealth*0.35*(0.6+0.4*sin(uTime*5.0)), 0.0, 0.85));

      // film grain (luma weighted, triangular)
      vec2 gp = gl_FragCoord.xy + fract(uTime*7.31)*vec2(213.0, 117.0);
      float g = hash(gp) + hash(gp+0.37) - 1.0;
      col += g * uGrain * (0.6 - 0.4*luma(col));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping; // done in FinalShader
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.qualityName = qualityName;
    this.q = QUALITY[qualityName];
  }

  setup(scene, camera, sunDir) {
    this.scene = scene; this.camera = camera; this.sunDir = sunDir;
    const r = this.renderer;
    const q = this.q;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    r.setPixelRatio(pr);
    r.setSize(window.innerWidth, window.innerHeight, false);
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(scene, camera));

    if (q.ao) {
      this.gtao = new SelectiveGTAOPass(scene, camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 1.0;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    if (q.godrays && this.gtao) {
      const sh = { ...GodRayShader, defines: { SAMPLES: q.godrays } };
      this.god = new ShaderPass(sh);
      this.god.uniforms.tDepth.value = this.gtao.depthTexture;
      this.composer.addPass(this.god);
    }
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.35, 3.0);
      this.composer.addPass(this.bloom);
    }
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.final.uniforms.uRes.value.copy(s);
    if (this.god) this.god.uniforms.uAspect.value = w / h;
  }

  render(dt, t) {
    const f = this.final.uniforms;
    f.uTime.value = t;
    if (this.god) {
      // project sun to screen
      const cam = this.camera;
      const p = cam.position.clone().addScaledVector(this.sunDir, 1000).project(cam);
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      const facing = fwd.dot(this.sunDir);
      this.god.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      this.god.uniforms.uSunVis.value = THREE.MathUtils.smoothstep(facing, 0.0, 0.45);
      this.god.uniforms.uFrame.value = (this.god.uniforms.uFrame.value + 1) % 64;
    }
    this.composer.render(dt);
  }
}

// Procedural sky + matching PMREM environment
export function createSky(renderer, scene, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  sky.userData.noAO = true;
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  u.turbidity.value = 8;
  u.rayleigh.value = 2.0;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.86;
  u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  u.cloudCoverage.value = 0.5;
  u.cloudDensity.value = 0.7;
  u.cloudElevation.value = 0.55;
  u.cloudScale.value = 0.00018;
  scene.add(sky);

  // environment from sky alone (+ a dim ground bounce)
  const envScene = new THREE.Scene();
  const sky2 = new Sky();
  sky2.scale.setScalar(1000);
  sky2.material.uniforms = THREE.UniformsUtils.clone(sky.material.uniforms);
  sky2.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  sky2.material.uniforms.showSunDisc.value = 0;
  envScene.add(sky2);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.06, 0.05, 0.045) }));
  ground.position.y = -1;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02, 0.1, 2000).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.75;
  return sky;
}

export { FOG };
