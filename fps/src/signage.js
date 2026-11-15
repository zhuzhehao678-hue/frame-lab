// Procedural liveries and signage: fictional shipping-line logos, ISO box
// codes, warehouse lettering and safety signs, all drawn on canvases at
// startup and worn with random paint loss so they read as real paint.
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// rough paint wear: punch irregular holes / streaks out of what was drawn
function weather(g, w, h, amount = 1, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1400 * amount; i++) {
    const x = rnd() * w, y = rnd() * h, r = rnd() * rnd() * 7 + 0.5;
    g.globalAlpha = 0.3 + rnd() * 0.7;
    g.beginPath(); g.ellipse(x, y, r * (1 + rnd() * 2), r, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  // vertical rain streaks
  for (let i = 0; i < 90 * amount; i++) {
    const x = rnd() * w, y = rnd() * h * 0.6, l = 20 + rnd() * h * 0.5;
    g.globalAlpha = 0.15 + rnd() * 0.25; g.fillRect(x, y, 1 + rnd() * 2, l);
  }
  g.restore();
}

function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const SANS = '"Arial Black","Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif';

export const BRANDS = [
  { name: 'NORDVAST', color: '#f2f2ee', sub: 'NORDVAST CONTAINER LINE', prefix: 'NVSU', mark: 'wave' },
  { name: 'TERRAMAR', color: '#f4f0e6', sub: 'TERRAMAR SHIPPING', prefix: 'TMRU', mark: 'circle' },
  { name: '远洋航运', color: '#f3efe6', sub: 'YUANYANG OCEAN LINES', prefix: 'YYLU', mark: 'diamond', cjk: true },
  { name: 'HANSA KAI', color: '#1b2a44', sub: 'HANSA KAI LOGISTICS', prefix: 'HKLU', mark: 'bars' },
];

function boxCode(prefix, n) {
  const num = String(100000 + (n * 7919) % 899999);
  return `${prefix} ${num} ${n % 10}`;
}

// Side livery for a 6 m container: big logo + small code block top-right
export function containerSide(brandIdx, serial) {
  const b = BRANDS[brandIdx % BRANDS.length];
  const W = 1536, H = 640, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = b.color; g.strokeStyle = b.color;
  // mark
  const mx = W * 0.2, my = H * 0.5, R = H * 0.2;
  g.lineWidth = 18;
  if (b.mark === 'wave') { for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = -R; x <= R; x += 4) g.lineTo(mx + x, my - 40 + k * 40 + Math.sin(x / R * Math.PI * 1.5) * 18); g.stroke(); } }
  else if (b.mark === 'circle') { g.beginPath(); g.arc(mx, my, R, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(mx, my, R * 0.45, 0, Math.PI * 2); g.fill(); }
  else if (b.mark === 'diamond') { g.beginPath(); g.moveTo(mx, my - R); g.lineTo(mx + R, my); g.lineTo(mx, my + R); g.lineTo(mx - R, my); g.closePath(); g.stroke(); g.fillRect(mx - 14, my - 14, 28, 28); }
  else { for (let k = 0; k < 4; k++) g.fillRect(mx - R + k * R * 0.55, my - R + k * 20, R * 0.35, R * 2 - k * 40); }
  // logo text
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = `${b.cjk ? 900 : 900} ${b.cjk ? 190 : 170}px ${SANS}`;
  g.fillText(b.name, W * 0.32, H * 0.5);
  g.font = `bold 34px ${SANS}`;
  g.fillText(b.sub, W * 0.325, H * 0.5 + (b.cjk ? 135 : 120));
  // code block (top-right, like the real ISO 6346 marking)
  g.textAlign = 'right';
  g.font = `bold 46px ${SANS}`;
  g.fillText(boxCode(b.prefix, serial), W - 40, 70);
  g.font = `bold 34px ${SANS}`;
  g.fillText('22G1', W - 40, 122);
  weather(g, W, H, 1.2, serial + brandIdx * 13);
  return tex(c);
}

// Door end: code, capacity table, brand
export function containerDoor(brandIdx, serial) {
  const b = BRANDS[brandIdx % BRANDS.length];
  const W = 512, H = 512, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = b.color;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.font = `bold 34px ${SANS}`; g.fillText(boxCode(b.prefix, serial), 270, 28);
  g.font = `bold 26px ${SANS}`; g.fillText('22G1', 270, 70);
  g.font = `bold 15px ${SANS}`;
  const rows = ['MAX GROSS  30,480 KG', '67,200 LB', 'TARE       2,200 KG', '4,850 LB', 'NET        28,280 KG', '62,350 LB', 'CU.CAP.    33.2 CU.M', '1,172 CU.FT'];
  rows.forEach((r, i) => g.fillText(r, 24, 30 + i * 22));
  g.font = `900 64px ${SANS}`; g.textAlign = 'center'; g.fillText(b.name, W / 2, 330);
  weather(g, W, H, 0.8, serial * 3 + 1);
  return tex(c);
}

export function warehouseSign() {
  const W = 2048, H = 512, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#e9e4d8'; g.textBaseline = 'middle';
  g.font = `900 360px ${SANS}`; g.textAlign = 'left'; g.fillText('9', 40, H / 2 + 20);
  g.font = `900 150px ${SANS}`; g.fillText('PIER 9', 300, H * 0.36);
  g.font = `bold 96px ${SANS}`; g.fillText('九号仓库  ·  BONDED STORE', 304, H * 0.74);
  weather(g, W, H, 2.2, 7);
  return tex(c);
}

export function plateSign(kind) {
  const W = 512, H = 340, c = canvas(W, H), g = c.getContext('2d');
  const yellow = '#e9b81c', red = '#c8241b', ink = '#121212';
  if (kind === 'danger') {
    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, W, H);
    g.fillStyle = red; g.fillRect(0, 0, W, 110);
    g.fillStyle = '#fff'; g.font = `900 72px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('危险 DANGER', W / 2, 58);
    g.fillStyle = ink; g.font = `900 54px ${SANS}`; g.fillText('码头作业区', W / 2, 175); g.font = `bold 38px ${SANS}`; g.fillText('NO UNAUTHORISED ENTRY', W / 2, 250);
    g.font = `bold 24px ${SANS}`; g.fillText('PIER 9 PORT AUTHORITY', W / 2, 305);
  } else if (kind === 'forklift') {
    g.fillStyle = yellow; g.fillRect(0, 0, W, H);
    g.fillStyle = ink; g.lineWidth = 16; g.strokeRect(14, 14, W - 28, H - 28);
    g.font = `900 64px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('注意叉车', W / 2, 120);
    g.font = `900 48px ${SANS}`; g.fillText('FORKLIFTS', W / 2, 200); g.fillText('OPERATING', W / 2, 260);
  } else if (kind === 'office') {
    g.fillStyle = '#1d3a5f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2f2f2'; g.font = `900 70px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('现场办公室', W / 2, 120); g.font = `bold 50px ${SANS}`; g.fillText('SITE OFFICE', W / 2, 210);
    g.font = `bold 26px ${SANS}`; g.fillText('VISITORS REPORT HERE', W / 2, 285);
  } else { // speed
    g.fillStyle = '#f5f5f0'; g.beginPath(); g.arc(W / 2, H / 2, H / 2 - 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = red; g.lineWidth = 36; g.beginPath(); g.arc(W / 2, H / 2, H / 2 - 26, 0, Math.PI * 2); g.stroke();
    g.fillStyle = ink; g.font = `900 140px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('10', W / 2, H / 2 + 6);
  }
  weather(g, W, H, 0.35, kind.length * 17);
  return tex(c);
}

export function floorStencil(text) {
  const W = 1024, H = 256, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#e8e4da'; g.font = `900 170px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 8);
  weather(g, W, H, 3, text.length * 5);
  return tex(c);
}
