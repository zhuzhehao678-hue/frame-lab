import * as THREE from 'three';
import { installFog, FOG } from './fog.js';
import { Renderer, QUALITY, createSky } from './render.js';
import { buildMaterials } from './materials.js';
import { Level } from './level.js';
import { Player } from './player.js';
import { Weapon, Pistol } from './weapon.js';
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
const settings = { mblur: saved.mblur ?? true, diff: DIFF[saved.diff] ? saved.diff : 'normal', sens: saved.sens ?? 1, fov: saved.fov ?? 74, adsSens: saved.adsSens ?? 0.9, music: saved.music ?? 0.5 };
$('diff').value = settings.diff; $('mblur').checked = settings.mblur; $('quality').value = qualityName; $('tod').value = todName; $('sens').value = settings.sens; $('adssens').value = settings.adsSens; $('music').value = settings.music; $('fov').value = settings.fov;
const persist = () => LS.setItem('afterglow', JSON.stringify({ quality: qualityName, tod: todName, ...settings, best: saved.best || 0 }));

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
  scene.add(hemi);

  const level = new Level(scene, lib);
  for (const l of level.lights) { l.intensity *= TOD.lamps; l.visible = TOD.lamps > 0; }
  lib.M.lampLens.emissiveIntensity *= Math.max(TOD.lamps, 0.02);
  lib.M.windowLit.emissiveIntensity *= TOD.windows;
  for (const m of level.rayMeshes) if (m.name === 'static_chainlink') m.userData.noAO = true;
  scene.traverse((o) => { if (o.name === 'static_chainlink') o.userData.noAO = true; });

  await progress(0.86, '装配武器');
  const effects = new Effects(scene, lib, camera);
  effects.ambient.copy(TOD.smokeTint);
  const audio = new Audio(camera);
  const player = new Player(camera, level);
  const weapon = new Weapon(camera, lib, effects);
  const pistol = new Pistol(camera, lib, effects);
  weapon.baseFov = pistol.baseFov = settings.fov;
  pistol.root.visible = false;
  const enemies = new Enemies(scene, lib, effects, level, audio);
  const grenades = new Grenades(scene, lib, effects, level, audio);
  const ambient = new Ambient(scene, lib);
  const boss = new Boss(scene, lib, effects, level, audio, enemies);
  const music = new Music(audio);
  const pickups = new Pickups(scene, lib, audio);

  R.setup(scene, camera, sunDir);
  R.final.uniforms.uExposure.value = TOD.exposure;
  R.final.uniforms.uGrade.value.copy(TOD.grade);
  if (R.bloom) R.bloom.strength = TOD.bloom;
  if (R.god) { R.god.uniforms.uWeight.value = TOD.godWeight; R.god.enabled = TOD.godWeight > 0; }
  if (R.refl) {
    R.refl.hidden.push(weapon.root, pistol.root);
    scene.traverse((o) => { if (o.name === 'static_ground') R.refl.hidden.push(o); });
  }

  // pre-compile all shaders (incl. drone + explosion materials) to avoid hitches
  await progress(0.92, '预编译着色器');
  const warm = enemies.buildDrone(false).group; warm.position.set(0, -50, 0); scene.add(warm);
  const warmG = grenades.proto.clone(); warmG.position.set(0, -50, 0); warm.add(warmG);
  const warmB = boss.build(); warmB.position.set(0, -10, 0); warm.add(warmB);
  effects.flash(new THREE.Vector3(0, -50, 0), new THREE.Color(1, 1, 1), 0.001, 0.01);
  player.updateCamera(0.016, 0);
  await renderer.compileAsync(scene, camera);
  R.render(0.016, 0);
  scene.remove(warm);
  await progress(1, '就绪');

  return { lib, level, effects, audio, player, weapon, pistol, enemies, grenades, ambient, boss, music, pickups, sun };
}

const G = await boot();
const { level, effects, audio, player, enemies, grenades, ambient, boss, music, pickups } = G;
function applyDifficulty() {
  const D = DIFF[settings.diff];
  player.dmgScale = D.dmg; enemies.hpMult = D.hp; enemies.fireMult = D.fire;
}
applyDifficulty();
R.motionBlur = settings.mblur;
// ------------------------------------------------------------------ loadout
const weapons = [G.weapon, G.pistol];
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
  if (e.code === 'KeyR' && locked && !photo) { if (weapon.startReload()) audio.click(1200, 0.3); }
  if (e.code === 'KeyG' && locked && !photo && !player.dead && grenades.canThrow(weapon)) { grenades.throw(camera, player.vel); weapon.throwT = 0; }
  if (e.code === 'KeyF') $('fps').classList.toggle('hidden');
  if (e.code === 'KeyP' && locked) togglePhoto();
});
addEventListener('keyup', (e) => { if (keymap[e.code]) input[keymap[e.code]] = false; if (e.code === 'Space') input.jump = false; });
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
  const s = 0.0021 * settings.sens * THREE.MathUtils.lerp(1, settings.adsSens, weapon.ads);
  if (photo) { photoCam.yaw -= e.movementX * s; photoCam.pitch = THREE.MathUtils.clamp(photoCam.pitch - e.movementY * s, -1.5, 1.5); return; }
  player.look(e.movementX, e.movementY, s);
  mouse.x += e.movementX; mouse.y += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === $('view');
  if (!locked) {
    for (const k in input) input[k] = false;
    if (!gameOver) showMenu(true);
  }
});

$('sens').oninput = (e) => { settings.sens = +e.target.value; persist(); };
$('mblur').onchange = (e) => { settings.mblur = e.target.checked; R.motionBlur = settings.mblur; persist(); };
$('diff').onchange = (e) => { settings.diff = e.target.value; applyDifficulty(); persist(); };
$('music').oninput = (e) => { settings.music = +e.target.value; music.setVolume(settings.music); persist(); };
$('adssens').oninput = (e) => { settings.adsSens = +e.target.value; persist(); };
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
  $('view').requestPointerLock();
  if (!started) { started = true; waves.start(); weapon.root.visible = true; weapon.equipT = 0; }
};
$('end').onclick = () => { restart(); $('end').classList.add('hidden'); $('view').requestPointerLock(); };

function showMenu(paused) {
  const o = $('overlay');
  o.classList.remove('hidden', 'loading');
  $('loadwrap').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('paused').classList.toggle('hidden', !paused || !started);
  $('play').textContent = started ? '继续' : '开始作战';
  $('hud').classList.remove('on');
}
function hideMenu() { $('overlay').classList.add('hidden'); if (!photo) $('hud').classList.add('on'); }
document.addEventListener('pointerlockchange', () => { if (locked) hideMenu(); });

// ------------------------------------------------------------------ photo mode
const photoCam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
function togglePhoto() {
  photo = !photo;
  weapon.root.visible = !photo;
  $('hud').classList.toggle('on', !photo);
  if (photo) { photoCam.pos.copy(camera.position); photoCam.yaw = player.yaw; photoCam.pitch = player.pitch; hint('照片模式 · WASD 自由移动 · Shift 加速 · P 退出', 3); }
}

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
  const list = enemies.list;
  while (compass.enemies.length < list.length) { const e = document.createElement('i'); compass.el.appendChild(e); compass.enemies.push(e); }
  compass.enemies.forEach((el, i) => {
    const e = list[i];
    if (!e) { el.style.display = 'none'; return; }
    el.className = 'en' + (e.heavy ? ' heavy' : '') + (e.kami ? ' kami' : '');
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
  hud.wn.textContent = waves.index + 1;
  hud.score.textContent = score.total;
  hud.wleft.textContent = waves.active ? `剩余 ${enemies.list.length + waves.queue.length}` : (waves.index + 1 >= WAVES.length && waves.done ? '已肃清' : '准备');
}

// ------------------------------------------------------------------ gameplay hooks
const stats = { shots: 0, hits: 0, kills: 0, t0: 0, dmgTaken: 0 };
player.onStep = (sp, sprint) => audio.footstep(sprint);
player.onLand = (v) => audio.land(v);
effects.onBrass = (p) => audio.brass(p);
for (const w of weapons) {
  w.events.magout = () => audio.magOut();
  w.events.magin = () => audio.magIn();
  w.events.bolt = () => audio.bolt();
}
const NAMES = { normal: '哨兵无人机', heavy: '重型哨兵', kamikaze: '自爆蜂' };
const POINTS = { normal: 100, heavy: 250, kamikaze: 150 };
const score = { total: 0, combo: 0, last: -10, best: +(saved.best || 0) };
enemies.onKill = (e) => {
  stats.kills++; killT = 0.35;
  score.combo = simTime - score.last < 4 ? score.combo + 1 : 1;
  score.last = simTime;
  const pts = Math.round(POINTS[e.kind] * score.combo * DIFF[settings.diff].score);
  score.total += pts;
  feed(`${NAMES[e.kind]} 已摧毁  +${pts}${score.combo > 1 ? `  ×${score.combo} 连杀` : ''}`);
  audio.hitmarker(true);
};
boss.onPodDown = (left) => {
  stats.kills++; score.total += 300; feed(`旋翼舱已摧毁  +300  (剩余 ${left})`);
  if (left === 0) { banner('SHIELD DOWN', '护盾失效', '攻击下方核心', 2.5); }
};
boss.onDeath = () => { score.total += 3000; feed('母舰 WARDEN 已击落  +3000'); slowmo.t = 2.2; banner('TARGET DOWN', '母舰已击落', '', 3); };
boss.onExploded = () => { player.shake = 1; };
enemies.onPlayerHit = (from, dmg) => {
  stats.dmgTaken += dmg;
  audio.hurt();
  const el = document.createElement('div'); el.className = 'dd'; hud.dd.appendChild(el);
  dmgIndicators.push({ el, from: from.clone(), life: 1.4 });
};

// each wave: [normal, heavy, kamikaze]
const WAVES = [[3, 0, 0], [3, 1, 1], [4, 1, 2], [4, 2, 3], [2, 1, 2, 'boss']];
const CN = ['一', '二', '三', '四', '五'];
const waves = {
  index: 0, active: false, queue: [], timer: 0, spawnT: 0, done: false,
  start() { this.index = 0; this.begin(2.5); stats.t0 = performance.now(); },
  begin(delay) {
    this.active = false; this.timer = delay;
    const [n, h, k, special] = WAVES[this.index];
    this.bossPending = special === 'boss'; this.bossT = 4;
    const q = [...Array(n).fill('normal'), ...Array(h).fill('heavy'), ...Array(k).fill('kamikaze')];
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    this.queue = q;
    const parts = [`哨兵 ×${n}`]; if (h) parts.push(`重型哨兵 ×${h}`); if (k) parts.push(`自爆蜂 ×${k}`);
    if (special === 'boss') banner('FINAL WAVE', '母舰 · WARDEN', '摧毁四个旋翼舱使护盾失效，然后攻击核心 · 激光可被掩体阻挡', 5);
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
      // spawn away from the player
      const pts = level.spawnPoints.slice().sort((a, b) => b.distanceTo(player.pos) - a.distanceTo(player.pos));
      const p = pts[Math.floor(Math.random() * 3)].clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      enemies.spawn(p, kind);
      this.spawnT = 1.1;
    }
    if (!this.queue.length && enemies.list.length === 0 && enemies.falling.length === 0 && !this.bossPending && !boss.active) {
      if (this.index + 1 >= WAVES.length) { this.done = true; victory(); return; }
      this.index++;
      G.weapon.reserve = Math.min(G.weapon.reserve + 90, 270);
      G.pistol.reserve = Math.min(G.pistol.reserve + 30, 90);
      grenades.count = Math.min(grenades.max, grenades.count + 2);
      hint('弹药已补给 · 步枪 +90 · 手枪 +30 · 手雷 +2', 2.5);
      this.begin(6);
    }
  },
};

function saveBest() {
  const nb = score.total > score.best; if (nb) { score.best = score.total; saved.best = score.best; LS.setItem('afterglow', JSON.stringify({ ...JSON.parse(LS.getItem('afterglow') || '{}'), best: score.best })); }
  return nb ? `得分 ${score.total} · 新纪录` : `得分 ${score.total} · 最高 ${score.best}`;
}
function victory() {
  gameOver = true;
  const bonus = Math.max(0, Math.round(300 - (performance.now() - stats.t0) / 1000)) * 10 + Math.round(player.health) * 10;
  score.total += bonus;
  setTimeout(() => {
    const secs = (performance.now() - stats.t0) / 1000;
    $('et').textContent = '堆场已肃清';
    $('es').innerHTML = `${saveBest()}（含时间与生命奖励 +${bonus}）<br>用时 ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}<br>击毁 ${stats.kills} · 命中率 ${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}% · 承受伤害 ${Math.round(stats.dmgTaken)}`;
    $('end').classList.remove('hidden'); document.exitPointerLock();
  }, 2500);
}
function defeat() {
  gameOver = true;
  setTimeout(() => {
    $('et').textContent = '阵亡';
    $('es').innerHTML = `${saveBest()}<br>坚持到第 ${waves.index + 1} 波 · 击毁 ${stats.kills}`;
    $('end').classList.remove('hidden'); document.exitPointerLock();
  }, 2200);
}
function restart() {
  enemies.clear(); grenades.clear(); boss.clear(); pickups.reset();
  player.pos.copy(level.playerStart); player.vel.set(0, 0, 0); player.yaw = level.playerYaw; player.pitch = 0;
  player.health = 100; player.dead = false;
  G.weapon.ammo = 30; G.weapon.reserve = 180; G.pistol.ammo = 15; G.pistol.reserve = 60;
  for (const w of weapons) { w.reloading = false; w.equipT = 0; }
  if (weaponIdx !== 0) { started = true; weapon.root.visible = false; weaponIdx = 0; weapon = weapons[0]; weapon.root.visible = true; buildPips(); $('wname').textContent = weapon.label; }
  Object.assign(stats, { shots: 0, hits: 0, kills: 0, dmgTaken: 0 }); score.total = 0; score.combo = 0;
  gameOver = false; waves.done = false; waves.start();
}

// ------------------------------------------------------------------ shooting
const RIFLE_PATTERN = [0, 0.15, -0.1, 0.25, 0.4, 0.3, 0.05, -0.25, -0.45, -0.35, -0.1, 0.2, 0.45, 0.5, 0.3, 0, -0.3, -0.5, -0.4, -0.1, 0.25, 0.4, 0.3, 0.1, -0.2, -0.4, -0.3, 0, 0.2, 0.3];
const fwdFlash = () => camera.getWorldDirection(new THREE.Vector3());
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
function shoot(t) {
  const muzzle = weapon.fire();
  stats.shots++;
  audio.gunshot(weapon.ads > 0.5, weapon.kind);
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
  let end;
  if (bh) {
    end = bh.point; eh = null;
    const r = boss.damage(bh.part, THREE.MathUtils.randFloat(weapon.damage[0], weapon.damage[1]), bh.point);
    if (r !== 'armor') { stats.hits++; hitT = 0.12; audio.hitmarker(r === 'kill'); if (r === 'kill') killT = 0.35; }
    audio.impact(bh.point, 'metal');
    for (let i = 0; i < 8; i++) effects.add.emit({ pos: bh.point, vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.3, size: 0.012, color: new THREE.Color(8, 5, 2), gravity: 9.8, stretch: 0.035 });
  } else if (eh) {
    end = eh.point;
    stats.hits++; hitT = 0.12;
    const killed = enemies.damage(eh.enemy, THREE.MathUtils.randFloat(weapon.damage[0], weapon.damage[1]), eh.point, dir);
    if (!killed) audio.hitmarker(false);
    const n = eh.point.clone().sub(eh.enemy.pos).normalize();
    for (let i = 0; i < 10; i++) effects.add.emit({ pos: eh.point, vel: n.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5)), life: 0.3 + Math.random() * 0.3, size: 0.012, color: new THREE.Color(8, 5, 2), gravity: 9.8, stretch: 0.035, bounce: true });
    effects.flash(eh.point, new THREE.Color(1, 0.7, 0.4), 8, 0.06, 4);
    audio.impact(eh.point, 'metal');
  } else if (wh) {
    end = wh.point;
    const n = wh.face.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    effects.impact(wh.point, n, wh.object.userData.surf);
    audio.impact(wh.point, wh.object.userData.surf);
  } else end = origin.clone().addScaledVector(dir, 400);
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
const slowmo = { t: 0 };
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
    camera.position.copy(photoCam.pos); camera.rotation.set(photoCam.pitch, photoCam.yaw, 0, 'YXZ');
    camera.fov = settings.fov; camera.updateProjectionMatrix();
  } else if (running) {
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
    waves.update(dt);
    // adaptive music + barrel heat smoke
    music.setIntensity(boss.active && !boss.falling ? 2 : (waves.active && (enemies.list.length || waves.queue.length)) ? (player.health < 35 ? 2 : 1) : 0);
    for (const w of weapons) w.heat = Math.max(0, (w.heat || 0) - dt * (w === weapon && input.firing ? 0.4 : 1.6));
    if (weapon.heat > 7 && Math.random() < dt * 30) {
      const mp = weapon.muzzle.getWorldPosition(new THREE.Vector3());
      effects.smoke.emit({ pos: mp, vel: new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.05).add(player.vel.clone().multiplyScalar(0.8)), life: 1.4, size: 0.015, size1: 0.12, color: new THREE.Color(0.8, 0.8, 0.8).multiply(effects.ambient), alpha: Math.min(0.35, (weapon.heat - 7) * 0.04), alpha1: 0, drag: 1.5, gravity: -0.3, rotVel: (Math.random() - 0.5) * 3 });
    }
    enemies.update(dt, t, player);
    grenades.update(dt, { enemies, player, t, onPlayerHit: enemies.onPlayerHit, boss });
    boss.update(dt, t, player);
    pickups.update(dt, t, player, (kind) => {
      if (kind === 'med') {
        if (player.health >= player.maxHealth - 1) return false;
        player.health = Math.min(player.maxHealth, player.health + 50); feed('医疗包  +50 生命'); return true;
      }
      const W = G.weapon, P = G.pistol;
      if (W.reserve >= 270 && P.reserve >= 90 && grenades.count >= grenades.max) return false;
      W.reserve = Math.min(270, W.reserve + 60); P.reserve = Math.min(90, P.reserve + 15); grenades.count = Math.min(grenades.max, grenades.count + 1);
      feed('弹药箱  步枪 +60 · 手枪 +15 · 手雷 +1'); return true;
    });
    for (const e of enemies.list) audio.updateHum(e.hum, e.vel.length());
    if (player.dead && !gameOver) defeat();
  }
  if (running || photo) {
    effects.update(running ? dt : 0, level);
    if (running) motes(dt);
    ambient.update(running ? dt : 0, t, effects);
  }
  audio.updateListener();
  if (level.water) {
    level.M.water.normalMap.offset.set(t * 0.004, t * 0.0065);
  }
  updateHUD(dt, t);
  // post FX uniforms
  const f = R.final.uniforms;
  f.uDamage.value = THREE.MathUtils.clamp(player.shake * 1.2, 0, 1);
  f.uLowHealth.value = THREE.MathUtils.clamp(1 - player.health / 40, 0, 1);
  f.uADS.value = weapon.ads;
  const now = performance.now();
  if (running && !noLoop) R.adapt(now - (loop.last || now));
  loop.last = now;
  R.render(dt, now / 1000);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${R.q.label} · 渲染 ${Math.round(R.scale * 100)}%`; fpsAcc = 0; fpsN = 0; }
}

showMenu(false);
weapon.root.visible = false;
if (!noLoop) loop();

// debug / screenshot hooks
window.__game = { pickups: G.pickups, music: G.music, boss, switchWeapon, weapons, get weapon() { return weapon; }, ambient, updateHUD, score, grenades, setLocked: (v) => { locked = v; }, loop, start: () => { started = true; waves.start(); }, FOG, sun: G.sun, THREE, scene, camera, player, enemies, effects, level, R, waves, renderer, togglePhoto, shoot, input };
