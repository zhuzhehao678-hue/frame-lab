// Lighting presets. Everything that defines the mood of a time of day lives
// here: sun, sky scattering, height fog, exposure, artificial lights.
import * as THREE from 'three';

const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const c = (r, g, b) => new THREE.Color(r, g, b);

export const TIMES = {
  // late-morning sun high in the south-east: bright, neutral, no glare
  day: {
    label: '白天',
    sunDir: v(0.5, 1.15, 0.6), sunColor: c(1.0, 0.93, 0.84), sunIntensity: 6.2,
    hemiSky: c(0.55, 0.6, 0.7), hemiGround: c(0.5, 0.44, 0.36), hemiIntensity: 0.1,
    sky: { turbidity: 4.5, rayleigh: 0.9, mie: 0.004, mieG: 0.8, clouds: 0.42, cloudDensity: 0.55 },
    env: 0.11, envGround: c(0.16, 0.14, 0.12), wet: 0.35, grade: c(1.0, 1.0, 0.97),
    fog: { color: c(0.50, 0.53, 0.58), sun: c(0.25, 0.23, 0.18), density: 0.0025, falloff: 0.1 },
    exposure: 0.56, bloom: 0.06, godWeight: 0.0, lamps: 0, windows: 0.25,
    smokeTint: c(0.75, 0.75, 0.78),
  },
  // golden hour: warm sun ~28° up in the east, off to the side of the main sight lines
  golden: {
    label: '黄昏',
    sunDir: v(1.0, 0.55, 0.12), sunColor: c(1.0, 0.66, 0.40), sunIntensity: 6.4,
    hemiSky: c(0.42, 0.44, 0.52), hemiGround: c(0.55, 0.4, 0.27), hemiIntensity: 0.1,
    sky: { turbidity: 9, rayleigh: 1.8, mie: 0.0045, mieG: 0.82, clouds: 0.48, cloudDensity: 0.62 },
    env: 0.12, envGround: c(0.16, 0.11, 0.07), wet: 0.5, grade: c(1.1, 0.98, 0.82),
    fog: { color: c(0.46, 0.38, 0.32), sun: c(0.7, 0.45, 0.24), density: 0.003, falloff: 0.11 },
    exposure: 0.56, bloom: 0.06, godWeight: 0.0, lamps: 0.35, windows: 0.7,
    smokeTint: c(0.7, 0.6, 0.5),
  },
  // overcast storm: soft light, mist, everything wet, lights on
  rain: {
    label: '雨天', rain: true,
    sunDir: v(0.35, 0.9, 0.25), sunColor: c(0.75, 0.8, 0.9), sunIntensity: 0.9,
    hemiSky: c(0.55, 0.6, 0.68), hemiGround: c(0.22, 0.22, 0.22), hemiIntensity: 0.45,
    sky: { turbidity: 14, rayleigh: 0.5, mie: 0.004, mieG: 0.6, clouds: 1.0, cloudDensity: 1.0, noSun: true, overcast: true },
    env: 0.32, envGround: c(0.08, 0.08, 0.085), wet: 1, grade: c(0.94, 0.99, 1.06),
    fog: { color: c(0.30, 0.33, 0.37), sun: c(0.05, 0.05, 0.05), density: 0.011, falloff: 0.05 },
    exposure: 0.64, bloom: 0.2, godWeight: 0.0, lamps: 1, windows: 1,
    smokeTint: c(0.5, 0.52, 0.55),
  },
  // the original low sunset, with the glare reined in
  sunset: {
    label: '日落',
    sunDir: v(-0.30, 0.115, -1), sunColor: c(1.0, 0.62, 0.36), sunIntensity: 3.4,
    hemiSky: c(0.45, 0.52, 0.7), hemiGround: c(0.38, 0.27, 0.2), hemiIntensity: 0.55,
    sky: { turbidity: 8, rayleigh: 2.0, mie: 0.004, mieG: 0.84, clouds: 0.5, cloudDensity: 0.7 },
    env: 0.8, envGround: c(0.06, 0.05, 0.045), wet: 1, grade: c(1, 1, 1),
    fog: { color: c(0.24, 0.20, 0.19), sun: c(0.5, 0.28, 0.13), density: 0.0035, falloff: 0.12 },
    exposure: 0.6, bloom: 0.15, godWeight: 0.011, lamps: 1, windows: 1,
    smokeTint: c(0.55, 0.45, 0.38),
  },
};
