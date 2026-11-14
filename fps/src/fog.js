// Physically-inspired height fog with sun in-scattering, injected into every
// built-in three.js material via ShaderChunk overrides. Uses scene.fog (any
// THREE.Fog instance) only as the on/off switch; parameters live in FOG.
import * as THREE from 'three';

// three clones material uniforms on compile; these subclasses return
// themselves from clone() so all materials share one live set of values.
class SharedColor extends THREE.Color { clone() { return this; } }
class SharedVec3 extends THREE.Vector3 { clone() { return this; } }
class SharedVec4 extends THREE.Vector4 { clone() { return this; } }

export const FOG = {
  uFogColor: { value: new SharedColor(0.24, 0.20, 0.19) },
  uFogSunColor: { value: new SharedColor(0.75, 0.42, 0.2) },
  uFogSunDir: { value: new SharedVec3(0, 0.1, -1).normalize() },
  // x density, y height falloff, z base height, w time
  uFogParams: { value: new SharedVec4(0.0035, 0.12, 0.0, 0.0) },
};

export function installFog() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  {
    vec4 fogWp = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      fogWp = batchingMatrix * fogWp;
    #endif
    #ifdef USE_INSTANCING
      fogWp = instanceMatrix * fogWp;
    #endif
    vFogWorldPos = (modelMatrix * fogWp).xyz;
  }
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorldPos;
  uniform vec3 uFogColor;
  uniform vec3 uFogSunColor;
  uniform vec3 uFogSunDir;
  uniform vec4 uFogParams;

  // analytic integral of exponential height fog along the view ray
  vec4 heightFog(vec3 camPos, vec3 wp){
    vec3 rd = wp - camPos;
    float dist = length(rd);
    rd /= max(dist, 1e-4);
    float a = uFogParams.x * exp(-uFogParams.y * (camPos.y - uFogParams.z));
    float b = uFogParams.y;
    float k = b * rd.y;
    float integ = abs(k) > 1e-4 ? (1.0 - exp(-k * dist)) / k : dist;
    float fogAmt = 1.0 - exp(-a * integ);
    float sunAmt = max(dot(rd, uFogSunDir), 0.0);
    float mie = pow(sunAmt, 12.0) * 0.55 + pow(sunAmt, 3.0) * 0.3;
    vec3 col = uFogColor + uFogSunColor * mie;
    return vec4(col, clamp(fogAmt, 0.0, 1.0));
  }
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  {
    vec4 hf = heightFog(cameraPosition, vFogWorldPos);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hf.rgb, hf.a);
  }
#endif
`;

  // Uniforms must exist on every material that uses fog: patch UniformsLib.fog
  Object.assign(THREE.UniformsLib.fog, FOG);
  for (const key of Object.keys(THREE.ShaderLib)) {
    const sh = THREE.ShaderLib[key];
    if (sh.uniforms && sh.uniforms.fogColor) Object.assign(sh.uniforms, FOG);
  }
}

