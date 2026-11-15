import * as THREE from 'three';
import { installFog, FOG } from './fog.js';
import { Renderer, QUALITY, createSky } from './render.js';
import { buildMaterials } from './materials.js';
import { Level } from './level.js';
import { Player } from './player.js';
import { Weapon, Pistol, DMR } from './weapon.js';
import { Effects } from './effects.js';
import { Enemies } from './enemies.js';
import { Audio } from './audio.js';
import { Grenades } from './grenades.js';
import { TIMES } from './timeofday.js';
import { REFL } from './reflect.js';
import { Ambient } from './ambient.js';
import { Boss } from './boss.js';
import { Music } from './music.js';
import { Pickups } from './pickups.js';
import { Hazards } from './hazards.js';
import { Props } from './props.js';
import { Rain } from './rain.js';
import { Walkers } from './walker.js';

installFog();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
try { localStorage.getItem('x'); } catch (e) { window.__noLS = true; }
const LS = window.__noLS ? { getItem: () => null, setItem: () => {} } : localStorage;
const saved = JSON.parse(LS.getItem('afterglow') || '{}');
let qualityName = params.get('q') || saved.quality || 'high';
if (!QUALITY[qualityName]) qualityName = 'high';
let todName = params.get('t') || saved.tod || 'golden';
if (!TIMES[todName]) todName = 'golden';
const TOD = TIMES[todName];
const DIFF = { easy: { dmg: 0.42, hp: 0.8, fire: 1.35, score: 0.8 }, normal: { dmg: 0.62, hp: 1, fire: 1, score: 1 }, hard: { dmg: 0.85, hp: 1.25, fire: 0.78, score: 1.35 } };
const settings = { xhStyle: saved.xhStyle || 'both', xhColor: saved.xhColor || '#f0ece4', mblur: saved.mblur ?? true, diff: DIFF[saved.diff] ? saved.diff : 'normal', sens: saved.sens ?? 1, fov: saved.fov ?? 74, adsSens: saved.adsSens ?? 0.9, music: saved.music ?? 0.5, optic: saved.optic || 'reddot' };
$('diff').value = settings.diff; $('xhstyle').value = settings.xhStyle; $('xhcolor').value = settings.xhColor; $('mblur').checked = settings.mblur; $('quality').value = qualityName; $('tod').value = todName; $('sens').value = settings.sens; $('adssens').value = settings.adsSens; $('music').value = settings.music; $('fov').value = settings.fov; $('optic').value = settings.optic;
const persist = () => LS.setItem('afterglow', JSON.stringify({ quality: qualityName, tod: todName, ...settings, best: saved.best || 0, bestWave: saved.bestWave || 0, tutorialDone: !!saved.tutorialDone }));

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function progress(f, label) {
  $('bar').firstElementChild.style.width = (f * 100).toFixed(0) + '%';
  $('loadlabel').textContent = label;
  await frame();
}

// ------------------------------------------------------------------ world
const R = new Renderer($('view'), qualityName);
const renderer = R.renderer;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1, 2); // switch for our height-fog chunk
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.03, 4500);
scene.add(camera);

const sunDir = TOD.sunDir.clone();
REFL.wet.value = TOD.wet;
FOG.uFogSunDir.value.copy(sunDir);
FOG.uFogColor.value.copy(TOD.fog.color);
FOG.uFogSunColor.value.copy(TOD.fog.sun);
FOG.uFogParams.value.x = TOD.fog.density; FOG.uFogParams.value.y = TOD.fog.falloff;
FOG.uCloud.value.x = TOD.clouds || 0;

async function boot() {
  await progress(0.02, '初始化渲染器');
  const lib = await buildMaterials(renderer, R.q, (f, l) => progress(0.05 + f * 0.7, l));
  await progress(0.78, '搭建码头');
  createSky(renderer, scene, sunDir, TOD);

  // sun
  const sun = new THREE.DirectionalLight(TOD.sunColor, TOD.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const S = sun.shadow;
  S.mapSize.set(R.q.shadow, R.q.shadow);
  S.camera.left = -34; S.camera.right = 34; S.camera.top = 30; S.camera.bottom = -30;
  S.camera.near = 20; S.camera.far = 180;
  S.bias = -0.0003; S.normalBias = 0.035; S.radius = 2.5; S.blurSamples = 12;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(TOD.hemiSky, TOD.hemiGround, TOD.hemiIntensity);
  hemi.userData.base = TOD.hemiIntensity;
  scene.add(hemi);

  const level = new Level(scene, lib);
  for (const l of level.lights) { l.intensity *= TOD.lamps; l.visible = TOD.lamps > 0; }
  lib.M.lampLens.emissiveIntensity *= Math.max(TOD.lamps, 0.02);
  lib.M.windowLit.emissiveIntensity *= TOD.windows;
  if (level.coneMat) level.coneMat.uniforms.uStrength.value = TOD.cones || 0;
  if (TOD.rain) {
    // soaked surfaces: darker and glossier
    for (const [k, m] of Object.entries(lib.M)) {
      if (!m.isMeshStandardMaterial || m.transparent || k === 'ground' || k === 'water' || k.startsWith('lamp') || k === 'windowLit') continue;
      m.roughness *= 0.55; if (m.color) m.color.multiplyScalar(0.82);
    }
    REFL.rain.value = 1;
  }
  for (const m of level.rayMeshes) if (m.name === 'static_chainlink') m.userData.noAO = true;
  scene.traverse((o) => { if (o.name === 'static_chainlink') o.userData.noAO = true; });

  await progress(0.86, '装配武器');
  const effects = new Effects(scene, lib, camera);
  effects.ambient.copy(TOD.smokeTint);
  const audio = new Audio(camera);
  audio.level = level;
  const player = new Player(camera, level);
  const weapon = new Weapon(camera, lib, effects);
  const pistol = new Pistol(camera, lib, effects);
  const dmr = new DMR(camera, lib, effects);
  weapon.baseFov = pistol.baseFov = dmr.baseFov = settings.fov;
  weapon.setOptic(settings.optic);
  pistol.root.visible = false; dmr.root.visible = false;
  // tactical flashlight: always present (intensity 0 when off) so toggling never recompiles shaders
  const flashlight = new THREE.SpotLight(new THREE.Color(1.0, 0.96, 0.9), 0, 40, 0.38, 0.55, 1.6);
  flashlight.position.set(0.06, -0.06, -0.85); // ahead of the muzzle so it doesn't bleach the viewmodel
  flashlight.target.position.set(0.05, -0.15, -10);
  camera.add(flashlight, flashlight.target);
  if (R.q.shadow >= 4096) { flashlight.castShadow = true; flashlight.shadow.mapSize.set(1024, 1024); flashlight.shadow.bias = -0.0005; flashlight.shadow.normalBias = 0.03; flashlight.shadow.camera.near = 0.3; }
  const lensGlow = new THREE.Mesh(new THREE.CircleGeometry(0.0125, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  lensGlow.position.set(0.034, 0.04, -0.4815); lensGlow.rotation.y = Math.PI; lensGlow.visible = false; weapon.gun.add(lensGlow);
  const enemies = new Enemies(scene, lib, effects, level, audio);
  const grenades = new Grenades(scene, lib, effects, level, audio);
  const ambient = new Ambient(scene, lib);
  const boss = new Boss(scene, lib, effects, level, audio, enemies);
  const music = new Music(audio);
  const pickups = new Pickups(scene, lib, audio);
  const hazards = new Hazards(scene, lib, level, effects, audio);
  const props = new Props(scene, lib, level, audio);
  const rain = TOD.rain ? new Rain(scene, camera, effects, audio) : null;
  const walkers = new Walkers(scene, lib, effects, level, audio, enemies);
  enemies.walkers = walkers;
  enemies.hazards = hazards;

  R.setup(scene, camera, sunDir);
  R.final.uniforms.uExposure.value = TOD.exposure;
  R.final.uniforms.uGrade.value.copy(TOD.grade);
  if (R.bloom) R.bloom.strength = TOD.bloom;
  if (R.god) { R.god.uniforms.uWeight.value = TOD.godWeight; R.god.enabled = TOD.godWeight > 0; }
  if (R.refl) {
    R.refl.hidden.push(weapon.root, pistol.root, dmr.root);
    scene.traverse((o) => { if (o.name === 'static_ground') R.refl.hidden.push(o); });
  }

  // pre-compile all shaders (incl. drone + explosion materials) to avoid hitches
  await progress(0.92, '预编译着色器');
  const warm = enemies.buildDrone(false).group; warm.position.set(0, -50, 0); scene.add(warm);
  const warmG = grenades.proto.clone(); warmG.position.set(0, -50, 0); warm.add(warmG);
  const warmB = boss.build(); warmB.position.set(0, -10, 0); warm.add(warmB);
  const warmW = walkers.build(); warmW.body.position.set(0, -20, 0); warm.add(warmW.body);
  const warmLegs = warmW.legs.flatMap((L) => [L.upper, L.lower, L.knee, L.foot]); warmLegs.forEach((o) => o.position.set(0, -60, 0));
  effects.flash(new THREE.Vector3(0, -50, 0), new THREE.Color(1, 1, 1), 0.001, 0.01);
  player.updateCamera(0.016, 0);
  await renderer.compileAsync(scene, camera);
  R.render(0.016, 0);
  scene.remove(warm); warmLegs.forEach((o) => scene.remove(o));
  await progress(1, '就绪');

  return { flashlight, lensGlow, lib, level, effects, audio, player, weapon, pistol, dmr, enemies, grenades, ambient, boss, music, pickups, hazards, props, rain, hemi, walkers, sun };
}

const G = await boot();
const { level, effects, audio, player, enemies, grenades, ambient, boss, music, pickups, hazards, walkers, props } = G;
grenades.props = hazards.props = enemies.props = props;
function applyDifficulty() {
  const D = DIFF[settings.diff];
  player.dmgScale = D.dmg; enemies.hpMult = D.hp; enemies.fireMult = D.fire;
}
applyDifficulty();
R.motionBlur = settings.mblur;
// ------------------------------------------------------------------ loadout
const weapons = [G.weapon, G.pistol, G.dmr];
let weaponIdx = 0;
let weapon = weapons[0];
function switchWeapon(i) {
  if (i === weaponIdx || !started || photo || player.dead || weapon.throwT < 0.6) return;
  weapon.reloading = false; weapon.reloadT = 0;
  weapon.mag.position.copy(weapon.magHome); weapon.leftHand.position.copy(weapon.leftHome); weapon.leftHand.rotation.set(0, 0, 0);
  weapon.root.visible = false;
  weaponIdx = i; weapon = weapons[i];
  weapon.root.visible = true; weapon.equipT = 0; weapon.ads = 0;
  audio.click(1500, 0.35); audio.click(900, 0.3, 0.12);
  buildPips();
  $('wname').textContent = weapon.label;
}
addEventListener('wheel', (e) => { if (locked) switchWeapon((weaponIdx + (e.deltaY > 0 ? 1 : -1) + weapons.length) % weapons.length); });

// ------------------------------------------------------------------ input
const input = { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false, firing: false, ads: false };
const mouse = { x: 0, y: 0 };
let locked = false, started = false, photo = false, gameOver = false;

const keymap = { KeyQ: 'leanL', KeyE: 'leanR', KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyC: 'crouch', ControlLeft: 'crouch' };
addEventListener('keydown', (e) => {
  if (keymap[e.code]) input[keymap[e.code]] = true;
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (e.code === 'Digit1' && locked) switchWeapon(0);
  if (e.code === 'Digit2' && locked) switchWeapon(1);
  if (e.code === 'Digit3' && locked) switchWeapon(2);
  if (e.code === 'Digit4' && locked) fireEMP();
  if (e.code === 'KeyR' && locked && !photo) { if (weapon.startReload()) audio.click(1200, 0.3); }
  if (e.code === 'KeyG' && locked && !photo && !player.dead && grenades.canThrow(weapon) && !e.repeat) G.aimingGrenade = true;
  if (e.code === 'KeyT' && locked && !photo) {
    G.flashOn = !G.flashOn;
    G.flashlight.intensity = G.flashOn ? 90 : 0; G.lensGlow.visible = G.flashOn;
    audio.click(G.flashOn ? 2400 : 1700, 0.35);
  }
  if (e.code === 'KeyV' && locked && !photo && !player.dead && weapon.meleeT > 0.6 && weapon.throwT > 0.6) {
    weapon.meleeT = 0; weapon.reloading = false; meleePending = 0.17;
    audio.melee && audio.melee(false);
  }
  if (e.code === 'KeyI' && locked && !photo && !player.dead && weapon.ads < 0.1) { weapon.inspectT = 0; audio.click(1300, 0.25); audio.click(800, 0.2, 0.9); }
  if (e.code === 'KeyF') $('fps').classList.toggle('hidden');
  if (e.code === 'KeyP' && (locked || photo)) { togglePhoto(); if (!photo && !locked) $('view').requestPointerLock(); }
  if (e.code === 'Tab' && photo) { e.preventDefault(); if (locked) document.exitPointerLock(); else $('view').requestPointerLock(); }
  if (e.code === 'KeyH' && photo) $('photo').classList.toggle('hidden');
});
addEventListener('keyup', (e) => {
  if (e.code === 'KeyG' && G.aimingGrenade) { G.aimingGrenade = false; if (locked && !player.dead && grenades.canThrow(weapon)) { grenades.throw(camera, player.vel); weapon.throwT = 0; } else grenades.hidePreview(); } if (keymap[e.code]) input[keymap[e.code]] = false; if (e.code === 'Space') input.jump = false; });
addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) { input.firing = true; input.triggerPulled = true; }
  if (e.button === 2) input.ads = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.firing = false; if (e.button === 2) input.ads = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (!locked) return;
  // ADS: only the user's ADS multiplier applies (no extra FOV slow-down)
  const s = 0.0021 * settings.sens * THREE.MathUtils.lerp(1, settings.adsSens, weapon.ads) * THREE.MathUtils.lerp(1, weapon.kind === 'dmr' ? 0.4 : (weapon.opticSens || 1), weapon.ads); // slower through the 4x optic
  if (photo) { photoCam.yaw -= e.movementX * s; photoCam.pitch = THREE.MathUtils.clamp(photoCam.pitch - e.movementY * s, -1.5, 1.5); return; }
  player.look(e.movementX, e.movementY, s);
  mouse.x += e.movementX; mouse.y += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === $('view');
  if (!locked) {
    for (const k in input) input[k] = false;
    if (photo) { $('photo').classList.remove('hidden'); return; }
    if (!gameOver) showMenu(true);
  }
});

$('sens').oninput = (e) => { settings.sens = +e.target.value; persist(); };
function applyCrosshair() { const c = $('cross'); c.className = settings.xhStyle; c.style.setProperty('--xh', settings.xhColor); }
applyCrosshair();
$('xhstyle').onchange = (e) => { settings.xhStyle = e.target.value; applyCrosshair(); persist(); };
$('xhcolor').onchange = (e) => { settings.xhColor = e.target.value; applyCrosshair(); persist(); };
$('mblur').onchange = (e) => { settings.mblur = e.target.checked; R.motionBlur = settings.mblur; persist(); };
$('diff').onchange = (e) => { settings.diff = e.target.value; applyDifficulty(); persist(); };
$('music').oninput = (e) => { settings.music = +e.target.value; music.setVolume(settings.music); persist(); };
$('adssens').oninput = (e) => { settings.adsSens = +e.target.value; persist(); };
$('optic').onchange = (e) => { settings.optic = e.target.value; G.weapon.setOptic(settings.optic); persist(); };
$('fov').oninput = (e) => { settings.fov = +e.target.value; for (const w of weapons) w.baseFov = settings.fov; persist(); };
$('quality').onchange = (e) => {
  qualityName = e.target.value; persist();
  const u = new URL(location.href); u.searchParams.set('q', qualityName); location.href = u.toString();
};
$('tod').onchange = (e) => {
  todName = e.target.value; persist();
  const u = new URL(location.href); u.searchParams.set('t', todName); u.searchParams.set('q', qualityName); location.href = u.toString();
};
$('play').onclick = () => {
  audio.init();
  music.setVolume(settings.music); music.start();
  if (G.rain) G.rain.startAudio();
  $('view').requestPointerLock();
  if (!started) {
    started = true; waves.start(); weapon.root.visible = true; weapon.equipT = 0;
    if (!saved.tutorialDone) {
      // first run: walk through the essentials during the opening countdown
      const tips = ['WASD 移动 · Shift 冲刺 · 空格 跳跃/翻越', '右键 开镜 · 左键 射击 · R 换弹', '1/2/3 切枪 · G 手雷 · V 近战', 'Q/E 探头 · C 蹲下（冲刺中滑铲）', '顶部罗盘标出敌人方位 · 场上有补给箱'];
      tips.forEach((tx, i) => setTimeout(() => hint(tx, 2.6), 400 + i * 2800));
      saved.tutorialDone = true; persist();
    } else if (TOD.night) setTimeout(() => hint('夜间作战 · 按 T 开启战术手电', 4), 3500);
  }
};
$('again').onclick = () => { restart(); $('end').classList.add('hidden'); $('view').requestPointerLock(); };
$('endless').onclick = () => { $('end').classList.add('hidden'); waves.goEndless(); $('view').requestPointerLock(); };

function showMenu(paused) {
  const o = $('overlay');
  o.classList.remove('hidden', 'loading');
  $('loadwrap').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('paused').classList.toggle('hidden', !paused || !started);
  if (paused && started) {
    const secs = (performance.now() - stats.t0) / 1000;
    $('paused').textContent = `已暂停  ·  ${waves.endless ? '无尽 ' : ''}第 ${waves.index + 1} 波  ·  得分 ${score.total}  ·  ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  }
  $('play').textContent = started ? '继续' : '开始作战';
  $('hud').classList.remove('on');
}
function hideMenu() { $('overlay').classList.add('hidden'); if (!photo) $('hud').classList.add('on'); }
document.addEventListener('pointerlockchange', () => { if (locked && !photo) hideMenu(); });

// ------------------------------------------------------------------ photo mode
const photoCam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
function togglePhoto() {
  photo = !photo;
  weapon.root.visible = !photo;
  $('hud').classList.toggle('on', !photo);
  $('photo').classList.toggle('hidden', !photo);
  if (photo) { photoCam.pos.copy(camera.position); photoCam.yaw = player.yaw; photoCam.pitch = player.pitch; $('ph_fov').value = settings.fov; }
  else {
    // restore the gameplay look
    const f = R.final.uniforms; f.uFilter.value = 0; f.uVignette.value = 0.32; f.uGrain.value = 0.045; f.uExposure.value = TOD.exposure;
    if (R.dof) R.dof.enabled = false;
  }
}
const ph = (id) => +$(id).value;
function applyPhoto() {
  const f = R.final.uniforms;
  f.uExposure.value = TOD.exposure * Math.pow(2, ph('ph_ev'));
  f.uVignette.value = ph('ph_vig'); f.uGrain.value = ph('ph_grain'); f.uFilter.value = ph('ph_filter');
  if (R.dof) { R.dof.enabled = ph('ph_ap') > 0.01; R.dof.uniforms.uFocus.value = ph('ph_focus'); R.dof.uniforms.uAperture.value = ph('ph_ap') * 1.5; R.dof.uniforms.uAspect.value = camera.aspect; }
}
$('photo').addEventListener('click', (e) => e.stopPropagation());
$('view').addEventListener('click', () => { if (photo && !locked) $('view').requestPointerLock(); });

// ------------------------------------------------------------------ HUD
const hud = {
  pips: $('pips'), mag: $('mag'), res: $('res'), hpn: $('hpn'), hpb: $('hpb'), cross: $('cross'), hit: $('hit'),
  gren: $('gren'), score: $('score'), wn: $('wn'), wleft: $('wleft'), feed: $('feed'), dd: $('dmgdirs'),
};
function buildPips() { hud.pips.innerHTML = ''; for (let i = 0; i < weapon.magSize; i++) hud.pips.appendChild(document.createElement('i')); }
buildPips();
// compass strip: ticks every 15°, labels on cardinals/intercardinals, enemy markers
const compass = { el: $('compass'), items: [], enemies: [] };
{
  const names = { 0: '北', 45: '东北', 90: '东', 135: '东南', 180: '南', 225: '西南', 270: '西', 315: '西北' };
  for (let b = 0; b < 360; b += 15) {
    const tk = document.createElement('i'); tk.className = 'tk' + (b % 45 === 0 ? ' big' : ''); compass.el.appendChild(tk); compass.items.push({ el: tk, b });
    if (names[b] !== undefined) { const lb = document.createElement('span'); lb.className = 'lb' + (b % 90 ? ' minor' : ''); lb.textContent = names[b]; compass.el.appendChild(lb); compass.items.push({ el: lb, b }); }
  }
}
function updateCompass() {
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const head = THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z));
  const place = (el, b) => {
    let d = ((b - head) % 360 + 540) % 360 - 180;
    if (Math.abs(d) > 95) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = (260 + d * 2.75) + 'px';
  };
  for (const it of compass.items) place(it.el, it.b);
  const list = enemies.list.concat(walkers.list.filter((w) => w.alive));
  while (compass.enemies.length < list.length) { const e = document.createElement('i'); compass.el.appendChild(e); compass.enemies.push(e); }
  compass.enemies.forEach((el, i) => {
    const e = list[i];
    if (!e) { el.style.display = 'none'; return; }
    el.className = 'en' + (e.heavy ? ' heavy' : '') + (e.kami ? ' kami' : '') + (e.kind === 'walker' ? ' walker' : '') + (e.kind === 'medic' ? ' medic' : '');
    place(el, THREE.MathUtils.radToDeg(Math.atan2(e.pos.x - camera.position.x, -(e.pos.z - camera.position.z))));
  });
}
let hitT = 0, killT = 0;
const dmgIndicators = [];
function hint(text, dur = 2) { const h = $('hint'); h.textContent = text; h.style.opacity = 1; clearTimeout(h._t); h._t = setTimeout(() => (h.style.opacity = 0), dur * 1000); }
function banner(k, t, s, dur = 3) {
  $('bk').textContent = k; $('bt').textContent = t; $('bs').textContent = s;
  const b = $('banner'); b.style.opacity = 1; clearTimeout(b._t); b._t = setTimeout(() => (b.style.opacity = 0), dur * 1000);
}
function feed(text) { const d = document.createElement('div'); d.textContent = text; hud.feed.prepend(d); setTimeout(() => d.remove(), 3300); }
function updateHUD(dt, t) {
  hud.gren.textContent = '◆'.repeat(grenades.count) + '◇'.repeat(Math.max(0, grenades.max - grenades.count));
  hud.mag.textContent = weapon.ammo; hud.res.textContent = weapon.reserve;
  const pips = hud.pips.children;
  for (let i = 0; i < pips.length; i++) pips[i].className = i < weapon.ammo ? '' : 'e';
  $('ammo').classList.toggle('low', weapon.ammo <= Math.ceil(weapon.magSize * 0.27));
  const hp = Math.ceil(player.health);
  hud.hpn.textContent = hp; hud.hpb.style.width = player.health + '%';
  $('health').classList.toggle('low', hp < 35);
  // dynamic crosshair
  const gap = 4 + weapon.spread(player) * 520;
  const c = hud.cross.children;
  c[0].style.top = (-gap - 9) + 'px'; c[1].style.top = gap + 'px'; c[2].style.left = (-gap - 9) + 'px'; c[3].style.left = gap + 'px';
  hud.cross.style.opacity = (1 - weapon.ads * 1.4) * (1 - weapon.sprint) * (weapon.reloading ? 0.4 : 1);
  hitT -= dt; hud.hit.style.opacity = Math.max(0, hitT * 5); hud.hit.classList.toggle('kill', killT > 0); killT -= dt;
  hud.hit.style.transform = `scale(${1 + Math.max(0, hitT) * 2})`;
  // damage direction arcs
  for (let i = dmgIndicators.length - 1; i >= 0; i--) {
    const d = dmgIndicators[i]; d.life -= dt;
    if (d.life <= 0) { d.el.remove(); dmgIndicators.splice(i, 1); continue; }
    const to = d.from.clone().sub(player.pos);
    const ang = Math.atan2(to.x, -to.z) + player.yaw; // screen angle, 0 = ahead
    d.el.style.transform = `rotate(${ang}rad)`;
    d.el.style.opacity = Math.min(1, d.life * 1.5);
  }
  updateCompass();
  $('boss').classList.toggle('on', boss.active && !boss.falling);
  if (boss.active) {
    $('bossfill').style.width = (boss.hpFrac * 100).toFixed(1) + '%';
    $('bossst').textContent = boss.shielded ? `护盾运行中 · 旋翼舱 ${boss.podsLeft} / 4` : '护盾失效 · 攻击核心';
  }
  $('lockwarn').classList.toggle('on', enemies.list.some((e) => e.lasering));
  hud.wn.textContent = waves.endless ? `无尽 ${waves.index + 1}` : waves.index + 1;
  hud.score.textContent = score.total;
  hud.wleft.textContent = waves.active ? `剩余 ${enemies.list.length + walkers.alive + waves.queue.length}` : (waves.index + 1 >= WAVES.length && waves.done ? '已肃清' : '准备');
}

// ------------------------------------------------------------------ gameplay hooks
const freshStats = () => ({ shots: 0, hits: 0, kills: 0, t0: performance.now(), dmgTaken: 0, byKind: {}, bestCombo: 0, boomKills: 0, meleeKills: 0, longKills: 0, waveDmg: 0, flawless: 0, bossKilled: false });
const stats = freshStats();
let killSource = { type: 'gun' };
player.onStep = (sp, sprint, surf) => audio.footstep(sprint, surf, TOD.rain ? 0.8 : (TOD.wet >= 1 ? 0.3 : 0.08));
player.onLand = (v) => audio.land(v);
player.onSlide = () => audio.slide();
player.onVault = () => audio.vault();
effects.onBrass = (p) => audio.brass(p);
for (const w of weapons) {
  w.events.magout = () => audio.magOut();
  w.events.magin = () => audio.magIn();
  w.events.bolt = () => audio.bolt();
}
const NAMES = { normal: '哨兵无人机', heavy: '重型哨兵', kamikaze: '自爆蜂', walker: '四足机甲', sniper: '狙击无人机', medic: '维修无人机' };
const POINTS = { normal: 100, heavy: 250, kamikaze: 150, walker: 450, sniper: 220, medic: 200 };
const score = { total: 0, combo: 0, last: -10, best: +(saved.best || 0) };
// scorestreak: every EMP_KILLS kills charges an EMP that disables machines nearby
const EMP_KILLS = 6, EMP_RADIUS = 32;
const emp = { charge: 0, ready: false, flash: 0 };
function updateEmpHud() {
  const el = $('emp'); if (!el) return;
  el.classList.toggle('ready', emp.ready);
  el.querySelector('i').style.width = `${Math.min(1, emp.charge / EMP_KILLS) * 100}%`;
}
function fireEMP() {
  if (!emp.ready || !started || photo || player.dead) return;
  emp.ready = false; emp.charge = 0; emp.flash = 1; updateEmpHud();
  const c = camera.position;
  effects.empPulse(new THREE.Vector3(c.x, c.y, c.z)); audio.emp(); player.shake = Math.max(player.shake, 0.4);
  if (pad.active) rumble(0.6, 0.9, 400);
  let n = 0;
  killSource = { type: 'emp' };
  for (const e of enemies.list) {
    if (!e.alive || e.pos.distanceTo(c) > EMP_RADIUS) continue;
    n++;
    if (e.kind === 'kamikaze') { enemies.damage(e, 1e4, e.pos, e.pos.clone().sub(c).normalize()); continue; }
    e.stagger = e.heavy ? 3 : 4; e.emp = e.stagger; e.charge = 0; e.burst = 0; e.aimT = 0;
    e.fireCD = Math.max(e.fireCD, e.stagger + 1);
    if (e.beam) e.beam.visible = false;
  }
  for (const w of walkers.list) if (w.alive && w.pos.distanceTo(c) < EMP_RADIUS) { w.empT = 6; n++; }
  killSource = { type: 'gun' };
  feed(n ? `EMP 脉冲 · ${n} 个目标瘫痪` : 'EMP 脉冲 · 范围内无目标');
}
enemies.onKill = (e) => {
  stats.kills++; killT = 0.35; killPulse = 1;
  stats.byKind[e.kind] = (stats.byKind[e.kind] || 0) + 1;
  if (killSource.type === 'boom') stats.boomKills++;
  if (killSource.type === 'melee') stats.meleeKills++;
  if (killSource.type === 'gun' && killSource.w === 'dmr' && killSource.dist > 25) stats.longKills++;
  score.combo = simTime - score.last < 4 ? score.combo + 1 : 1;
  stats.bestCombo = Math.max(stats.bestCombo, score.combo);
  score.last = simTime;
  const pts = Math.round(POINTS[e.kind] * score.combo * DIFF[settings.diff].score);
  score.total += pts;
  feed(`${NAMES[e.kind]} 已摧毁  +${pts}${score.combo > 1 ? `  ×${score.combo} 连杀` : ''}`);
  audio.hitmarker(true);
  if (!emp.ready && killSource.type !== 'emp') {
    emp.charge++;
    if (emp.charge >= EMP_KILLS) { emp.ready = true; audio.empReady(); feed('EMP 脉冲已就绪 · 按 4 释放'); }
  }
  updateEmpHud();
};
boss.onPodDown = (left) => {
  stats.kills++; score.total += 300; feed(`旋翼舱已摧毁  +300  (剩余 ${left})`);
  if (left === 0) { banner('SHIELD DOWN', '护盾失效', '攻击下方核心', 2.5); }
};
boss.onDeath = () => { stats.bossKilled = true; score.total += 3000; feed('母舰 WARDEN 已击落  +3000'); slowmo.t = 2.2; banner('TARGET DOWN', '母舰已击落', '', 3); };
boss.onExploded = () => { player.shake = 1; };
walkers.onKill = (w) => enemies.onKill(w);
enemies.onPlayerHit = (from, dmg) => {
  stats.dmgTaken += dmg; stats.waveDmg += dmg;
  if (pad.active) rumble(0.8, 0.5, 160);
  audio.hurt();
  const el = document.createElement('div'); el.className = 'dd'; hud.dd.appendChild(el);
  dmgIndicators.push({ el, from: from.clone(), life: 1.4 });
};

// each wave: [normal, heavy, kamikaze]
const WAVES = [[3, 0, 0], [3, 1, 1], [3, 1, 2, null, 1, 0, 1], [3, 2, 3, null, 1, 1, 1], [2, 1, 2, 'boss', 1, 1, 0]];
const WALKER_SPAWNS = [[-9, -20], [13, -0.5], [0, 17.5], [6, -20.5], [-8, 1.5]];
const CN = ['一', '二', '三', '四', '五'];
const waves = {
  index: 0, active: false, queue: [], timer: 0, spawnT: 0, done: false,
  start() { this.index = 0; this.endless = false; this.begin(2.5); stats.t0 = performance.now(); },
  // campaign waves, then procedurally escalating endless waves (boss every 5th)
  wave(i) {
    if (i < WAVES.length && !this.endless) return WAVES[i];
    const e = i - WAVES.length + 1;
    return [Math.min(3 + Math.floor(e * 0.6), 7), Math.min(1 + Math.floor(e / 2), 4), Math.min(2 + Math.floor(e / 1.5), 7), e % 5 === 0 ? 'boss' : null, Math.min(1 + Math.floor(e / 3), 3), Math.min(1 + Math.floor(e / 2), 3), Math.min(1 + Math.floor(e / 3), 2)];
  },
  goEndless() {
    this.endless = true; this.done = false; gameOver = false;
    this.index++; this.refill(); this.begin(4);
  },
  refill() {
    G.weapon.reserve = Math.min(G.weapon.reserve + 90, 270);
    G.pistol.reserve = Math.min(G.pistol.reserve + 30, 90);
    G.dmr.reserve = Math.min(G.dmr.reserve + 20, 100);
    grenades.count = Math.min(grenades.max, grenades.count + 2);
    player.health = Math.max(player.health, 70);
  },
  begin(delay) {
    this.active = false; this.timer = delay;
    const [n, h, k, special, wk = 0, sn = 0, md = 0] = this.wave(this.index);
    stats.waveDmg = 0;
    this.bossPending = special === 'boss'; this.bossT = 4;
    const q = [...Array(n).fill('normal'), ...Array(h).fill('heavy'), ...Array(k).fill('kamikaze'), ...Array(wk).fill('walker'), ...Array(sn).fill('sniper'), ...Array(md).fill('medic')];
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    this.queue = q;
    const parts = [`哨兵 ×${n}`]; if (h) parts.push(`重型哨兵 ×${h}`); if (k) parts.push(`自爆蜂 ×${k}`); if (wk) parts.push(`四足机甲 ×${wk}`); if (sn) parts.push(`狙击无人机 ×${sn}`); if (md) parts.push(`维修无人机 ×${md}`);
    if (this.endless) banner(`ENDLESS · ${this.index + 1}`, `无尽 · 第 ${this.index + 1} 波`, (special === 'boss' ? '母舰来袭  ·  ' : '') + parts.join('  ·  '), 3.2);
    else if (special === 'boss') banner('FINAL WAVE', '母舰 · WARDEN', '摧毁四个旋翼舱使护盾失效，然后攻击核心 · 激光可被掩体阻挡', 5);
    else banner(`WAVE ${this.index + 1} / ${WAVES.length}`, `第 ${CN[this.index]} 波`, parts.join('  ·  '), 3.2);
    if (k && this.index === 1) setTimeout(() => hint('自爆蜂会直冲过来引爆 · 在远处击落它', 4), 3500);
  },
  update(dt) {
    if (this.done) return;
    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0) { this.active = true; this.spawnT = 0; audio.waveHorn(); }
      return;
    }
    this.spawnT -= dt;
    if (this.bossPending) { this.bossT -= dt; if (this.bossT <= 0) { this.bossPending = false; boss.spawn(new THREE.Vector3(0, 16, -34)); } }
    if (this.queue.length && this.spawnT <= 0) {
      const kind = this.queue.shift();
      if (kind === 'walker') {
        const sp = WALKER_SPAWNS.slice().sort((a, b) => Math.hypot(b[0] - player.pos.x, b[1] - player.pos.z) - Math.hypot(a[0] - player.pos.x, a[1] - player.pos.z))[Math.floor(Math.random() * 2)];
        walkers.spawn(new THREE.Vector3(sp[0], 0, sp[1]));
        if (!this.walkerHint) { this.walkerHint = true; hint('四足机甲：正面装甲减伤 · 绕到背后打发光的能量核心', 4.5); }
        this.spawnT = 1.1;
      } else {
      // spawn away from the player
      const pts = level.spawnPoints.slice().sort((a, b) => b.distanceTo(player.pos) - a.distanceTo(player.pos));
      const p = pts[Math.floor(Math.random() * 3)].clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      enemies.spawn(p, kind);
      if (kind === 'medic' && !this.medicHint) { this.medicHint = true; setTimeout(() => hint('维修无人机正在修复敌人 · 优先击落（罗盘绿色标记）', 4.5), 1500); }
      this.spawnT = 1.1;
      }
    }
    if (!this.queue.length && enemies.list.length === 0 && enemies.falling.length === 0 && walkers.alive === 0 && !this.bossPending && !boss.active) {
      if (stats.waveDmg < 0.5) { stats.flawless++; feed('毫发无伤 · 本波未受伤  +250'); score.total += 250; }
      if (this.index + 1 >= WAVES.length && !this.endless) { this.done = true; victory(); return; }
      this.index++;
      this.refill();
      hint('弹药已补给 · 步枪 +90 · 手枪 +30 · 射手步枪 +20 · 手雷 +2', 2.5);
      this.begin(6);
    }
  },
};

function saveBest() {
  const nb = score.total > score.best; if (nb) { score.best = score.total; saved.best = score.best; LS.setItem('afterglow', JSON.stringify({ ...JSON.parse(LS.getItem('afterglow') || '{}'), best: score.best })); }
  return nb ? `得分 ${score.total} · 新纪录` : `得分 ${score.total} · 最高 ${score.best}`;
}
const MEDALS = [
  ['毫发无伤', '任意一波未受伤', (s) => s.flawless > 0],
  ['连杀大师', '4 秒连杀达到 5 次', (s) => s.bestCombo >= 5],
  ['神射手', '命中率不低于 55%', (s) => s.shots > 20 && s.hits / s.shots >= 0.55],
  ['爆破专家', '用手雷或油桶炸毁 3 个目标', (s) => s.boomKills >= 3],
  ['机甲猎手', '击毁一台四足机甲', (s) => (s.byKind.walker || 0) > 0],
  ['近身格斗', '用枪托击毁一个目标', (s) => s.meleeKills > 0],
  ['远程狙杀', '用射手步枪在 25 米外击杀', (s) => s.longKills > 0],
  ['屠龙者', '击落母舰 WARDEN', (s) => s.bossKilled],
];
function showEnd(win, bonus = 0) {
  const secs = (performance.now() - stats.t0) / 1000;
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const reached = waves.index + 1;
  let grade = 'C';
  if (win) grade = (acc >= 45 && stats.dmgTaken < 260) ? 'S' : 'A';
  else if (waves.endless) grade = reached >= 15 ? 'S' : reached >= 10 ? 'A' : 'B';
  else if (reached >= 4) grade = 'B';
  const bestLine = saveBest();
  if (waves.endless) { const bw = Math.max(saved.bestWave || 0, reached); saved.bestWave = bw; LS.setItem('afterglow', JSON.stringify({ ...JSON.parse(LS.getItem('afterglow') || '{}'), bestWave: bw })); }
  $('ek').textContent = win ? 'MISSION COMPLETE' : (waves.endless ? `ENDLESS · WAVE ${reached}` : 'MISSION FAILED');
  $('et').textContent = win ? '堆场已肃清' : '阵亡';
  $('eg').textContent = grade;
  $('escore').textContent = bestLine + (bonus ? `（含时间与生命奖励 +${bonus}）` : '') + (waves.endless ? ` · 无尽最高第 ${saved.bestWave} 波` : '');
  const bk = stats.byKind;
  const cell = (k, v) => `<div>${k}<b>${v}</b></div>`;
  $('es').innerHTML = cell('用时', `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`) + cell('命中率', acc + '%') + cell('承受伤害', Math.round(stats.dmgTaken)) + cell('最高连杀', '×' + stats.bestCombo)
    + cell('哨兵', (bk.normal || 0) + (bk.heavy || 0)) + cell('自爆蜂', bk.kamikaze || 0) + cell('四足机甲', bk.walker || 0) + cell('到达波次', reached);
  $('em').innerHTML = MEDALS.map(([n, d, f]) => `<div class="medal ${f(stats) ? 'got' : ''}"><span class="i">${f(stats) ? '★' : '☆'}</span><div class="n">${n}</div><div class="d">${d}</div></div>`).join('');
  $('endless').classList.toggle('hidden', !win);
  $('overlay').classList.add('hidden'); $('hud').classList.remove('on');
  $('end').classList.remove('hidden'); document.exitPointerLock();
}
function victory() {
  gameOver = true;
  const bonus = Math.max(0, Math.round(300 - (performance.now() - stats.t0) / 1000)) * 10 + Math.round(player.health) * 10;
  score.total += bonus;
  setTimeout(() => showEnd(true, bonus), 2500);
}
function defeat() {
  gameOver = true;
  setTimeout(() => showEnd(false), 2200);
}
function restart() {
  enemies.clear(); grenades.clear(); boss.clear(); pickups.reset(); hazards.reset(); walkers.clear(); props.reset();
  player.pos.copy(level.playerStart); player.vel.set(0, 0, 0); player.yaw = level.playerYaw; player.pitch = 0;
  player.health = 100; player.dead = false;
  G.weapon.ammo = 30; G.weapon.reserve = 180; G.pistol.ammo = 15; G.pistol.reserve = 60; G.dmr.ammo = 20; G.dmr.reserve = 80;
  for (const w of weapons) { w.reloading = false; w.equipT = 0; }
  if (weaponIdx !== 0) { started = true; weapon.root.visible = false; weaponIdx = 0; weapon = weapons[0]; weapon.root.visible = true; buildPips(); $('wname').textContent = weapon.label; }
  Object.assign(stats, freshStats()); score.total = 0; score.combo = 0; emp.charge = 0; emp.ready = false; updateEmpHud();
  gameOver = false; waves.done = false; waves.start();
}

// ------------------------------------------------------------------ shooting
const RIFLE_PATTERN = [0, 0.15, -0.1, 0.25, 0.4, 0.3, 0.05, -0.25, -0.45, -0.35, -0.1, 0.2, 0.45, 0.5, 0.3, 0, -0.3, -0.5, -0.4, -0.1, 0.25, 0.4, 0.3, 0.1, -0.2, -0.4, -0.3, 0, 0.2, 0.3];
const fwdFlash = () => camera.getWorldDirection(new THREE.Vector3());
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
function shoot(t) {
  killSource = { type: 'gun', w: weapon.kind, dist: 0 };
  const muzzle = weapon.fire();
  stats.shots++;
  audio.gunshot(weapon.ads > 0.5, weapon.kind);
  if (pad.active) rumble(weapon.kind === 'dmr' ? 0.6 : 0.25, 0.4, 70);
  effects.flash(muzzle.clone().addScaledVector(fwdFlash(), 0.9), new THREE.Color(1, 0.72, 0.4), 12, 0.05, 10);
  weapon.ejectBrass();
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  effects.muzzleSmoke(muzzle, fwd);
  // recoil: a fixed, learnable pattern for the rifle (climb, then a left-right
  // snake), small random jitter on top; the pistol just kicks up
  if (simTime - (weapon.lastShotT ?? -9) > 0.32) weapon.burst = 0;
  weapon.lastShotT = simTime; weapon.burst = (weapon.burst || 0) + 1;
  weapon.heat = (weapon.heat || 0) + 1;
  const k = weapon.burst - 1;
  const ctrl = (1 - weapon.ads * 0.35) * (1 - player.crouch * 0.3);
  let climb = 0.0058 * weapon.climb * ctrl, side;
  if (weapon.kind === 'rifle') {
    climb *= k < 8 ? 1.15 : 0.7;
    side = RIFLE_PATTERN[k % RIFLE_PATTERN.length] * 0.0042 * ctrl + (Math.random() - 0.5) * 0.0008;
  } else side = (Math.random() - 0.5) * 0.003;
  player.pitch += climb; player.yaw -= side;
  player.addRecoil(0.006, (Math.random() - 0.5) * 0.004);
  // ray with spread
  const sp = weapon.spread(player);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sp;
  const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  const origin = camera.position.clone();
  raycaster.set(origin, dir); raycaster.far = 400;
  const hits = raycaster.intersectObjects(level.rayMeshes, false);
  const wh = hits[0];
  let eh = enemies.raycast(origin, dir, wh ? wh.distance : 400);
  const bh = boss.raycast(origin, dir, eh ? eh.t : (wh ? wh.distance : 400));
  const wr = walkers.raycast(origin, dir, Math.min(bh ? bh.t : 400, eh ? eh.t : 400, wh ? wh.distance : 400));
  let end;
  if (wr) {
    end = wr.point; eh = null; killSource.dist = wr.t;
    const killed = walkers.damage(wr.walker, THREE.MathUtils.randFloat(weapon.damage[0], weapon.damage[1]), wr.part, dir);
    stats.hits++; hitT = 0.12; if (!killed) audio.hitmarker(false);
    audio.impact(wr.point, 'metal');
    const crit = wr.part === 'cell';
    for (let i = 0; i < (crit ? 16 : 8); i++) effects.add.emit({ pos: wr.point, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.3, size: 0.014, color: crit ? new THREE.Color(9, 6, 1) : new THREE.Color(8, 5, 2), gravity: 9.8, stretch: 0.035 });
  } else if (bh) {
    end = bh.point; eh = null;
    const r = boss.damage(bh.part, THREE.MathUtils.randFloat(weapon.damage[0], weapon.damage[1]), bh.point);
    if (r !== 'armor') { stats.hits++; hitT = 0.12; audio.hitmarker(r === 'kill'); if (r === 'kill') killT = 0.35; }
    audio.impact(bh.point, 'metal');
    for (let i = 0; i < 8; i++) effects.add.emit({ pos: bh.point, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.3, size: 0.012, color: new THREE.Color(8, 5, 2), gravity: 9.8, stretch: 0.035 });
  } else if (eh) {
    end = eh.point; killSource.dist = eh.t;
    stats.hits++; hitT = 0.12;
    const rotor = enemies.rotorHit(eh.enemy, eh.point);
    if (rotor && !eh.enemy.staggerHinted) { eh.enemy.staggerHinted = true; feed('击中旋翼 · 目标失衡'); }
    const killed = enemies.damage(eh.enemy, THREE.MathUtils.randFloat(weapon.damage[0], weapon.damage[1]) * (rotor ? 1.3 : 1), eh.point, dir);
    if (!killed) audio.hitmarker(false);
    const n = eh.point.clone().sub(eh.enemy.pos).normalize();
    for (let i = 0; i < 10; i++) effects.add.emit({ pos: eh.point, vel: n.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5)), life: 0.3 + Math.random() * 0.3, size: 0.012, color: new THREE.Color(8, 5, 2), gravity: 9.8, stretch: 0.035, bounce: true });
    effects.flash(eh.point, new THREE.Color(1, 0.7, 0.4), 8, 0.06, 4);
    audio.impact(eh.point, 'metal');
  } else if (wh) {
    end = wh.point;
    const n = wh.face.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    if (wh.object.userData.surf === 'glass') {
      const pane = level.breakPane(wh.object, wh.instanceId);
      if (pane) {
        for (let i = 0; i < 40; i++) effects.smoke.emit({ pos: pane.pos.clone().add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.7)), vel: new THREE.Vector3(0.5 + Math.random() * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).addScaledVector(dir, 2), life: 1.2 + Math.random(), size: 0.02 + Math.random() * 0.04, color: new THREE.Color(0.75, 0.8, 0.85), alpha: 0.9, alpha1: 0.6, gravity: 9.8, drag: 0.2, rotVel: (Math.random() - 0.5) * 25, bounce: true });
        for (let i = 0; i < 16; i++) effects.add.emit({ pos: pane.pos, vel: new THREE.Vector3(Math.random() * 3, Math.random() * 2, (Math.random() - 0.5) * 3), life: 0.6, size: 0.01, color: new THREE.Color(3, 3, 3.3), gravity: 9.8, stretch: 0.02, bounce: true });
        audio.glass && audio.glass(pane.pos);
      }
    } else effects.impact(wh.point, n, wh.object.userData.surf);
    if (wh.object.userData.prop) props.hit(wh.object.userData.prop, wh.point, dir, weapon.damage[1]);
    if (wh.object.userData.drum) hazards.damage(wh.object.userData.drum, THREE.MathUtils.randFloat(weapon.damage[0], weapon.damage[1]), wh.point.clone().addScaledVector(n, 0.03));
    audio.impact(wh.point, wh.object.userData.surf);
  } else end = origin.clone().addScaledVector(dir, 400);
  // rounds that reach the harbour basin kick up a splash
  if (!eh && dir.y < -0.002) {
    const tw = (-2.1 - origin.y) / dir.y;
    const wp = origin.clone().addScaledVector(dir, tw);
    if (wp.z < -27.2 && (!wh || tw < wh.distance) && tw < 300) {
      end = wp;
      for (let i = 0; i < 14; i++) effects.smoke.emit({ pos: wp, vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 0.8), life: 0.7, size: 0.05, size1: 0.18, color: new THREE.Color(0.8, 0.85, 0.88), alpha: 0.8, alpha1: 0, gravity: 9.8, drag: 0.5 });
      effects.puff(wp, new THREE.Vector3(0, 1, 0), new THREE.Color(0.85, 0.88, 0.9), 3, 0.3, 0.8);
      audio.splash && audio.splash(wp);
    }
  }
  if (weapon.kind === 'rifle' && weapon.shotsFired % 3 === 1) effects.tracer(muzzle, end);
}

// ------------------------------------------------------------------ ambient motes
function motes(dt) {
  const c = camera.position;
  for (let i = 0; i < 2; i++) {
    if (Math.random() > dt * 60) continue;
    const p = new THREE.Vector3(c.x + (Math.random() - 0.5) * 14, c.y + (Math.random() - 0.6) * 4, c.z + (Math.random() - 0.5) * 14);
    effects.add.emit({ pos: p, vel: new THREE.Vector3(0.25 + Math.random() * 0.2, (Math.random() - 0.4) * 0.08, 0.1), life: 5 + Math.random() * 4, size: 0.006 + Math.random() * 0.008, color: new THREE.Color(2.4, 1.6, 0.9), alpha: 0.0, alpha1: 0.0, fadeIn: 0 });
    const q = effects.add.p[effects.add.p.length - 1]; q.a0 = 0.6; q.a1 = 0; q.fadeIn = 1.5;
  }
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, simTime = 0;
let prevAds = false;
const noLoop = params.has('noloop');
// ------------------------------------------------------------------ gamepad
const pad = { prev: [], sprintLatch: false, active: false };
function rumble(strong, weak, ms) {
  const gp = navigator.getGamepads && [...navigator.getGamepads()].find((p) => p);
  if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}
function pollGamepad(dt) {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...gps].find((p) => p && p.connected);
  if (!gp) { if (pad.active) { input.moveX = input.moveY = 0; pad.active = false; } return; }
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const down = (i) => b(i) && !pad.prev[i];
  const up = (i) => !b(i) && pad.prev[i];
  const dz = (v, d = 0.16) => Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);
  const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0, 0.12), ry = dz(gp.axes[3] || 0, 0.12);
  if (lx || ly || rx || ry || gp.buttons.some((x) => x.pressed)) pad.active = true;
  if (!pad.active) return;
  input.moveX = lx; input.moveY = ly;
  // look: expo curve, ADS + aim-assist slowdown over targets
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  let assist = 1;
  for (const e of enemies.list.concat(walkers.list.filter((w) => w.alive))) {
    const to = e.pos.clone().sub(camera.position); const d = to.length();
    if (fwd.dot(to.normalize()) > Math.cos(Math.max(0.03, 1.2 / d))) { assist = 0.55; break; }
  }
  const rate = 3.1 * settings.sens * THREE.MathUtils.lerp(1, settings.adsSens * 0.8, weapon.ads) * THREE.MathUtils.lerp(1, weapon.kind === 'dmr' ? 0.4 : (weapon.opticSens || 1), weapon.ads) * assist;
  const cx = Math.sign(rx) * rx * rx, cy = Math.sign(ry) * ry * ry;
  player.yaw -= cx * rate * dt; player.pitch = THREE.MathUtils.clamp(player.pitch - cy * rate * 0.75 * dt, -1.5, 1.5);
  mouse.x += cx * 600 * dt; mouse.y += cy * 600 * dt;
  // buttons
  input.firing = (gp.buttons[7] && gp.buttons[7].value > 0.35) || false;
  if (input.firing && !pad.firePrev) input.triggerPulled = true;
  pad.firePrev = input.firing;
  const wasAds = input.ads; input.ads = (gp.buttons[6] && gp.buttons[6].value > 0.35) || false;
  if (input.ads && !wasAds) {
    // ADS snap: nudge toward the nearest target close to the crosshair
    let best = null, bestA = 0.1;
    for (const e of enemies.list.concat(walkers.list.filter((w) => w.alive))) {
      const to = e.pos.clone().sub(camera.position).normalize(); const a = Math.acos(THREE.MathUtils.clamp(fwd.dot(to), -1, 1));
      if (a < bestA && !segmentBlockedFn(camera.position, e.pos)) { bestA = a; best = to; }
    }
    if (best) { player.yaw = THREE.MathUtils.lerp(player.yaw, Math.atan2(-best.x, -best.z), 0.6); player.pitch = THREE.MathUtils.lerp(player.pitch, Math.asin(best.y), 0.6); }
  }
  if (down(0)) input.jump = true;
  if (down(1)) input.crouch = !input.crouch;
  if (b(10) && !pad.prev[10]) pad.sprintLatch = !pad.sprintLatch;
  if (ly > -0.3) pad.sprintLatch = false;
  input.sprint = pad.sprintLatch;
  if (down(2) && weapon.startReload()) audio.click(1200, 0.3);
  if (down(3)) switchWeapon((weaponIdx + 1) % weapons.length);
  if (down(4) && grenades.canThrow(weapon)) G.aimingGrenade = true;
  if (up(4) && G.aimingGrenade) { G.aimingGrenade = false; if (grenades.canThrow(weapon)) { grenades.throw(camera, player.vel); weapon.throwT = 0; } else grenades.hidePreview(); }
  if (down(5)) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
  if (down(12)) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
  if (down(15)) fireEMP();
  if (down(13)) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
  input.leanL = b(14); input.leanR = b(15);
  if (down(9)) document.exitPointerLock();
  pad.prev = gp.buttons.map((x) => x.pressed);
}
const segmentBlockedFn = (a, b) => { const d = b.clone().sub(a); const l = d.length(); return level.colliders.some((bx) => { const r = new THREE.Ray(a, d.clone().divideScalar(l)); const hit = r.intersectBox(bx, new THREE.Vector3()); return hit && hit.distanceTo(a) < l - 0.3; }); };

const slowmo = { t: 0 };
let meleePending = -1;
// resolve the strike a moment into the swing
function meleeStrike(t) {
  killSource = { type: 'melee' };
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const o = camera.position;
  const inCone = (p, r = 2.3) => { const d = p.clone().sub(o); const l = d.length(); return l < r && d.normalize().dot(fwd) > 0.62; };
  let hit = null;
  for (const e of enemies.list) if (e.alive && inCone(e.pos, 2.0 + e.radius)) { hit = e.pos.clone(); enemies.damage(e, 120, e.pos, fwd); }
  for (const w of walkers.list) if (w.alive && inCone(w.pos, 2.6)) { hit = w.pos.clone(); walkers.damage(w, 120, 'body', null); }
  for (const d of hazards.list) if (d.alive && inCone(d.pos, 1.9)) { hit = d.pos.clone(); hazards.damage(d, 15, d.pos); }
  if (!hit) {
    raycaster.set(o, fwd); raycaster.far = 1.9;
    const wh = raycaster.intersectObjects(level.rayMeshes, false)[0];
    if (wh) { hit = wh.point; effects.impact(wh.point, wh.face.normal.clone(), wh.object.userData.surf); }
  } else {
    for (let i = 0; i < 14; i++) effects.add.emit({ pos: hit, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.35, size: 0.015, color: new THREE.Color(8, 5, 2), gravity: 9.8, stretch: 0.04 });
    hitT = 0.15;
  }
  if (hit) { player.shake = Math.min(1, player.shake + 0.35); player.addRecoil(-0.02, 0.01); audio.melee && audio.melee(true); }
}
let killPulse = 0;
function loop() {
  if (!noLoop) requestAnimationFrame(loop);
  const realDt = Math.min(clock.getDelta(), 0.05);
  // cinematic slow motion (boss kill): 0.25x easing back to 1x
  if (slowmo.t > 0) slowmo.t -= realDt;
  const timeScale = slowmo.t > 0 ? THREE.MathUtils.lerp(1, 0.25, Math.min(1, slowmo.t / 0.6)) : 1;
  const dt = realDt * timeScale;
  const running = locked && !photo;
  if (running) simTime += dt;
  const t = simTime;
  FOG.uFogParams.value.w = t;

  if (photo) {
    const s = (input.sprint ? 12 : 3.5) * dt;
    const f = new THREE.Vector3(-Math.sin(photoCam.yaw) * Math.cos(photoCam.pitch), Math.sin(photoCam.pitch), -Math.cos(photoCam.yaw) * Math.cos(photoCam.pitch));
    const rgt = new THREE.Vector3(Math.cos(photoCam.yaw), 0, -Math.sin(photoCam.yaw));
    if (input.f) photoCam.pos.addScaledVector(f, s); if (input.b) photoCam.pos.addScaledVector(f, -s);
    if (input.r) photoCam.pos.addScaledVector(rgt, s); if (input.l) photoCam.pos.addScaledVector(rgt, -s);
    if (input.jump) photoCam.pos.y += s; if (input.crouch) photoCam.pos.y -= s;
    camera.position.copy(photoCam.pos); camera.rotation.set(photoCam.pitch, photoCam.yaw, ph('ph_roll'), 'YXZ');
    camera.fov = ph('ph_fov'); camera.updateProjectionMatrix();
    applyPhoto();
  } else if (running) {
    pollGamepad(realDt);
    player.update(dt, input, t);
    weapon.update(dt, t, player, input, mouse);
    mouse.x = 0; mouse.y = 0;
    if (!player.dead) {
      if ((weapon.auto ? input.firing : input.triggerPulled) && weapon.canFire()) shoot(t);
      else if (input.triggerPulled && weapon.ammo === 0 && !weapon.reloading) { audio.dryFire(); if (weapon.startReload()) hint('换弹中', 1); }
      if (weapon.ammo === 0 && !weapon.reloading && weapon.reserve > 0 && weapon.cool < -0.15) weapon.startReload();
      if (weapon.ammo === 0 && weapon.reserve === 0 && !weapon.reloading) hint('弹药耗尽', 1);
    }
    input.triggerPulled = false;
    if (input.ads !== prevAds) { audio.click(input.ads ? 900 : 700, 0.12); prevAds = input.ads; }
    if (player.health < 35 && !player.dead) { loop.hb = (loop.hb || 0) - dt; if (loop.hb <= 0) { audio.heartbeat(); loop.hb = 0.55 + player.health / 60; } }
    if (meleePending >= 0) { meleePending -= dt; if (meleePending < 0) meleeStrike(t); }
    waves.update(dt);
    // adaptive music + barrel heat smoke
    music.setIntensity(boss.active && !boss.falling ? 2 : (waves.active && (enemies.list.length || waves.queue.length)) ? (player.health < 35 ? 2 : 1) : 0);
    for (const w of weapons) { w.heat = Math.max(0, (w.heat || 0) - dt * (w === weapon && input.firing ? 0.4 : 1.6)); w.setHeat(w.heat); }
    if (weapon.heat > 7 && Math.random() < dt * 30) {
      const mp = weapon.muzzle.getWorldPosition(new THREE.Vector3());
      effects.smoke.emit({ pos: mp, vel: new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.05).add(player.vel.clone().multiplyScalar(0.8)), life: 1.4, size: 0.015, size1: 0.12, color: new THREE.Color(0.8, 0.8, 0.8).multiply(effects.ambient), alpha: Math.min(0.35, (weapon.heat - 7) * 0.04), alpha1: 0, drag: 1.5, gravity: -0.3, rotVel: (Math.random() - 0.5) * 3 });
    }
    enemies.update(dt, t, player);
    killSource = { type: 'boom' };
    grenades.update(dt, { enemies, player, t, onPlayerHit: enemies.onPlayerHit, boss, hazards, walkers });
    hazards.update(dt, { enemies, player, t, onPlayerHit: enemies.onPlayerHit, boss, walkers });
    props.update(dt, player);
    killSource = { type: 'other' };
    walkers.update(dt, t, player);
    boss.update(dt, t, player);
    if (G.aimingGrenade) grenades.showPreview(camera, player.vel); 
    pickups.update(dt, t, player, (kind) => {
      if (kind === 'med') {
        if (player.health >= player.maxHealth - 1) return false;
        player.health = Math.min(player.maxHealth, player.health + 50); feed('医疗包  +50 生命'); return true;
      }
      const W = G.weapon, P = G.pistol;
      if (W.reserve >= 270 && P.reserve >= 90 && grenades.count >= grenades.max) return false;
      W.reserve = Math.min(270, W.reserve + 60); P.reserve = Math.min(90, P.reserve + 15); G.dmr.reserve = Math.min(100, G.dmr.reserve + 10); grenades.count = Math.min(grenades.max, grenades.count + 1);
      feed('弹药箱  步枪 +60 · 手枪 +15 · 射手步枪 +10 · 手雷 +1'); return true;
    });
    for (const e of enemies.list) audio.updateHum(e.hum, e.vel.length());
    if (player.dead && !gameOver) defeat();
  }
  if (running || photo) {
    effects.update(running ? dt : 0, level);
    if (running && !G.rain) motes(dt);
    if (G.rain) {
      const fl = G.rain.update(dt, t, player);
      REFL.time.value = t;
      G.hemi.intensity = G.hemi.userData.base + fl * 4;
      R.final.uniforms.uFlash.value = fl * 1.5;
      // wet lens when exposed to the rain (not under the warehouse roof, not looking down)
      const exposed = !(player.pos.x < -18.3 && player.pos.z > -6.5 && player.pos.z < 7.5) && player.pitch > -0.35 && !photo;
      G.lensWet = THREE.MathUtils.clamp((G.lensWet || 0) + (exposed ? 0.06 : -0.25) * realDt, 0, 0.6);
      R.final.uniforms.uLensWet.value = G.lensWet;
    }
    ambient.update(running ? dt : 0, t, effects);
  }
  audio.updateListener();
  audio.updateSpace(realDt);
  if (level.water) {
    level.water.position.y = -2.1 + Math.sin(t * 0.55) * 0.05 + Math.sin(t * 0.23 + 1) * 0.03; // slow harbour swell
  }
  updateHUD(dt, t);
  // post FX uniforms
  const f = R.final.uniforms;
  f.uDamage.value = THREE.MathUtils.clamp(player.shake * 1.2, 0, 1);
  f.uLowHealth.value = THREE.MathUtils.clamp(1 - player.health / 40, 0, 1);
  f.uADS.value = weapon.ads;
  if (R.mblur) R.mblur.uniforms.uADS.value = weapon.ads * (weapon.kind === 'pistol' ? 1 : 0.7);
  killPulse = Math.max(0, killPulse - realDt * 2.2); f.uKill.value = killPulse;
  if (weapon.kind === 'dmr') weapon.renderScope(renderer, scene, weapons.map((w) => w.root));
  const now = performance.now();
  if (running && !noLoop) {
    R.adapt(now - (loop.last || now));
    // one-time performance check after ~10 s of play
    loop.perfT = (loop.perfT || 0) + realDt; loop.perfN = (loop.perfN || 0) + 1;
    if (!loop.perfDone && loop.perfT > 10) {
      loop.perfDone = true;
      const fps = loop.perfN / loop.perfT;
      if (fps < 35 && R.scale <= 0.6 && qualityName !== 'low') hint(`帧率约 ${Math.round(fps)} · 建议在菜单（Esc）把画质调低一档`, 6);
    }
  }
  loop.last = now;
  R.render(dt, now / 1000);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${R.q.label} · 渲染 ${Math.round(R.scale * 100)}%`; fpsAcc = 0; fpsN = 0; }
}

showMenu(false);
weapon.root.visible = false;
if (!noLoop) loop();

// debug / screenshot hooks
window.__game = { props, emp, fireEMP, stats, showEnd, G, walkers, REFL, rain: G.rain, hazards, pickups: G.pickups, music: G.music, boss, switchWeapon, weapons, get weapon() { return weapon; }, ambient, updateHUD, score, grenades, setLocked: (v) => { locked = v; }, loop, start: () => { started = true; waves.start(); }, FOG, sun: G.sun, THREE, scene, camera, player, enemies, effects, level, R, waves, renderer, togglePhoto, shoot, input };
