'use strict';
/* ================= 2D 叠加层（HUD） ================= */
function rr(x,y,w,h,r){g.beginPath();g.roundRect(x,y,w,h,r);}
function circ(x,y,r){g.beginPath();g.arc(x,y,r,0,7);}
function shade(hex,f){const n=parseInt(hex.slice(1),16),c=v=>Math.max(0,Math.min(255,Math.round(v*f)));return `rgb(${c(n>>16)},${c(n>>8&255)},${c(n&255)})`;}
function drawIng(type,st,x,y,s){
  const c=COL[type];g.save();g.translate(x,y);g.scale(s,s);g.lineWidth=1.6;g.strokeStyle='#5a3d6640';
  if(st==='raw'){
    if(type==='tomato'){g.fillStyle=c;circ(0,1,12);g.fill();g.stroke();g.fillStyle='#fff7';circ(-4,-3,3);g.fill();g.fillStyle='#4f9b45';circ(0,-10,3.5);g.fill();}
    else if(type==='cabbage'){g.fillStyle=c;circ(0,0,13);g.fill();g.stroke();g.strokeStyle='#e2f7cf';g.lineWidth=2;g.beginPath();g.arc(0,3,8,3.5,5.9);g.stroke();g.beginPath();g.arc(3,-1,10,4.2,5.6);g.stroke();}
    else if(type==='mushroom'){g.fillStyle='#fff3e0';rr(-4,0,8,12,3);g.fill();g.stroke();g.fillStyle=c;g.beginPath();g.arc(0,1,13,Math.PI,0);g.closePath();g.fill();g.stroke();}
    else if(type==='fish'){g.fillStyle='#6fb0e8';g.beginPath();g.ellipse(-2,0,12,7,0,0,7);g.fill();g.stroke();g.beginPath();g.moveTo(8,0);g.lineTo(15,-7);g.lineTo(15,7);g.closePath();g.fill();g.fillStyle='#fff';circ(-8,-2,2.4);g.fill();g.fillStyle='#223';circ(-8.4,-2,1.1);g.fill();}
    else if(type==='rice'){g.fillStyle='#ecd9b0';rr(-10,-11,20,23,5);g.fill();g.stroke();g.fillStyle='#8a6a3a';g.font='bold 12px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('米',0,1);}
    else{g.strokeStyle=c;g.lineWidth=4.5;g.lineCap='round';for(let i=-1;i<=1;i++){g.beginPath();g.moveTo(-11,i*7);g.bezierCurveTo(-4,i*7-6,4,i*7+6,11,i*7);g.stroke();}}
  }else
  if(st==='chopped'){
    for(const [px,py,a] of [[-8,-5,.3],[8,-4,-.4],[0,7,.1]]){g.save();g.translate(px,py);g.rotate(a);g.fillStyle=c;rr(-6.5,-5,13,10,3.5);g.fill();g.stroke();g.fillStyle='#fff7';rr(-3.5,-2.5,7,5,2);g.fill();g.restore();}
  }else{
    if(st==='boiled'){g.fillStyle='#cfeeff';circ(0,0,15);g.fill();g.strokeStyle='#7fc4ec';g.stroke();}
    g.fillStyle=st==='fried'?shade(c,.88):c;g.beginPath();for(let i=0;i<8;i++){const a=i*.785,r=10.5+(i%2?2.5:0);g.lineTo(Math.cos(a)*r,Math.sin(a)*r);}g.closePath();g.fill();
    g.strokeStyle=st==='fried'?'#b0621e':'#5a3d6650';g.lineWidth=st==='fried'?2.6:1.6;g.stroke();
    g.fillStyle='#fff8';circ(-3,-3,3);g.fill();
    if(st==='fried'){g.fillStyle='#b0621e';circ(4,3,1.8);g.fill();circ(-4,5,1.5);g.fill();}
  }
  g.restore();
}
function badge(x,y,ok){g.fillStyle=ok?'#5ed68a':'#ff5a5a';circ(x,y,11);g.fill();g.strokeStyle='#fff';g.lineWidth=3;g.lineCap='round';g.beginPath();
  if(ok){g.moveTo(x-5,y);g.lineTo(x-1,y+4);g.lineTo(x+5,y-4);}else{g.moveTo(x,y-5);g.lineTo(x,y+1);g.moveTo(x,y+5);g.lineTo(x,y+5.1);}g.stroke();}
function bar(x,y,v,c){g.fillStyle='#ffffffe0';rr(x-25,y-6,50,12,6);g.fill();g.fillStyle=c;rr(x-22,y-3,44*Math.max(.04,Math.min(1,v)),6,3);g.fill();}
const keyLabel=(i,k)=>TOUCH?(k==='E'?'拿/放':'操作'):mode===2&&i===1?(k==='E'?'K':'L'):k;
function pill(x,y,key,txt){
  g.font='bold 13px sans-serif';const tw=g.measureText(txt).width,kw=key?Math.max(22,g.measureText(key).width+12):0,w=tw+kw+(key?22:20),x0=x-w/2;
  g.fillStyle=key?'#3a2a44e6':'#fff3d0f4';rr(x0,y-13,w,26,13);g.fill();
  if(key){g.fillStyle='#fff';rr(x0+4,y-9,kw,18,6);g.fill();g.fillStyle='#7a4a9a';g.textAlign='center';g.fillText(key,x0+4+kw/2,y+.5);}
  g.fillStyle=key?'#fff':'#8a5a1a';g.textAlign='left';g.fillText(txt,x0+(key?kw+10:10),y+.5);
}
function drawUI(){
  g.textBaseline='middle';
  // 世界标注
  for(const row of grid)for(const t of row){
    const it=t.item,cx=(t.x+.5)*T,cy=(t.y+.5)*T;
    if(t.kind==='board'&&it&&it.kind==='ing'&&it.chop>0&&it.state==='raw'){const [x,y]=proj(cx,cy,1.45);bar(x,y,it.chop,'#7ad66a');}
    if(t.kind==='sink'){if(t.wash>0){const [x,y]=proj(cx,cy,1.5);bar(x,y,t.wash,'#6ac4ff');}
      if(t.dirty>3||t.clean>3){const [x,y]=proj(cx,cy,1.25);g.font='bold 13px sans-serif';g.textAlign='center';g.fillStyle='#fff';g.fillText('脏×'+t.dirty+' 净×'+t.clean,x,y);}}
    if(t.kind==='return'&&t.dirty>3){const [x,y]=proj(cx,cy,1.3);g.font='bold 14px sans-serif';g.textAlign='center';g.fillStyle='#fff';g.fillText('×'+t.dirty,x,y);}
    if(isCook(it)&&it.contents.length&&!it.burnt){const [x,y]=proj(cx,cy,1.55);
      if(!it.done){g.fillStyle='#ffffffe6';circ(x,y,15);g.fill();g.strokeStyle='#ffb84a';g.lineWidth=5;g.lineCap='round';g.beginPath();g.arc(x,y,10,-1.57,-1.57+6.283*Math.max(.02,it.prog));g.stroke();}
      else if(it.burn>.35){if(Math.sin(clock*14)>-.3)badge(x,y,false);}else badge(x,y,true);}
  }
  chefs.forEach((c,i)=>{const p=c.p,[x,y]=proj(p.x,p.y,0);g.font='bold 13px sans-serif';g.textAlign='center';g.lineWidth=4;g.strokeStyle='#ffffffd0';g.strokeText(p.name,x,y+18);g.fillStyle=shade(p.color,.8);g.fillText(p.name,x,y+18);
    if(mode===1&&i===active){const [ax,ay]=proj(p.x,p.y,1.15),b=Math.sin(clock*6)*3;g.fillStyle='#fff';g.strokeStyle=p.color;g.lineWidth=2.5;g.lineJoin='round';g.beginPath();g.moveTo(ax-8,ay-8+b);g.lineTo(ax+8,ay-8+b);g.lineTo(ax,ay+3+b);g.closePath();g.fill();g.stroke();}});
  // 情境按键提示
  if(state==='play'&&readyT<=0&&showHelp)chefs.forEach((c,i)=>{if(mode===1&&i!==active)return;
    const ps=promptFor(c.p);if(!ps.length)return;const [bx,by]=proj(c.p.x,c.p.y,1.95);
    ps.forEach((q,j)=>pill(bx,by-j*29,q[0]?keyLabel(i,q[0]):null,q[1]));});
  // 教学箭头
  if(state==='play'&&tut>=0&&readyT<=0){const fl=tutFlags(),b=Math.abs(Math.sin(clock*5))*9;
    const cur=targetOf(players[mode===1?active:0]);for(const t of tilesWhere(t=>TUT[tut][1](t,fl))){if(t===cur)continue;const [x,y]=proj((t.x+.5)*T,(t.y+.5)*T,1.75);
      g.fillStyle='#ffd23c';g.strokeStyle='#fff';g.lineWidth=3;g.lineJoin='round';g.beginPath();g.moveTo(x-11,y-22-b);g.lineTo(x+11,y-22-b);g.lineTo(x+11,y-10-b);g.lineTo(x+19,y-10-b);g.lineTo(x,y+8-b);g.lineTo(x-19,y-10-b);g.lineTo(x-11,y-10-b);g.closePath();g.stroke();g.fill();}}
  for(const f of floats){let x=f.x,y=f.y;if(!f.hud)[x,y]=proj(f.x,f.y,1.3+(1.5-f.life)*.8);else y-=(1.5-f.life)*20;
    g.globalAlpha=Math.min(1,f.life*2);g.font='bold 22px sans-serif';g.textAlign='center';g.lineWidth=5;g.lineJoin='round';g.strokeStyle='#5a3d66';g.strokeText(f.txt,x+(f.hud?50:0),y);g.fillStyle=f.c;g.fillText(f.txt,x+(f.hud?50:0),y);}
  g.globalAlpha=1;
  // 订单（带做法步骤）
  const STEPC={切:'#6cc46a',煮:'#5aaee8',炒:'#f0903c'};
  orders.forEach((o,i)=>{
    const x=12+i*142,w=134,f=o.t/o.max,slide=Math.max(0,1-o.age*3)*40;
    g.save();g.translate(x+slide,12);g.globalAlpha=Math.min(1,o.age*3);
    if(Q===2){g.shadowColor='#5a3d6630';g.shadowBlur=14;g.shadowOffsetY=4;}
    g.fillStyle=f<.25&&Math.sin(clock*12)>0?'#ffe0e0f4':'#fffffff4';rr(0,0,w,104,16);g.fill();g.shadowColor='transparent';
    if(i===0){g.strokeStyle='#f08aa8';g.lineWidth=2.5;g.stroke();}
    g.fillStyle='#5a3d66';g.font='bold 14px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(o.r.name,w/2,15);
    const n=o.r.comp.length,gap=42,sx=w/2-(n-1)*gap/2;
    o.r.comp.forEach((c,j)=>{const [ty,st]=c.split(':'),cx=sx+j*gap;
      g.fillStyle='#f6eef8';rr(cx-18,26,36,62,9);g.fill();
      drawIng(ty,'raw',cx,43,.72);
      const steps=st==='chopped'?['切']:st==='boiled'?(CHOP[ty]?['切','煮']:['煮']):['切','炒'];
      steps.forEach((sn,q)=>{const yy=64+q*13-(steps.length-1)*0+ (steps.length===1?6:0);g.fillStyle=STEPC[sn];rr(cx-11,yy-6,22,12,6);g.fill();g.fillStyle='#fff';g.font='bold 9.5px sans-serif';g.textAlign='center';g.fillText(sn,cx,yy+.5);});
    });
    g.fillStyle='#efe4f2';rr(8,93,w-16,6,3);g.fill();g.fillStyle=f>.5?'#7ad68a':f>.25?'#ffc24a':'#ff6a6a';rr(8,93,(w-16)*f,6,3);g.fill();
    g.restore();
  });
  // 右侧信息卡
  const px=LW-236;if(Q===2){g.shadowColor='#5a3d6630';g.shadowBlur=14;g.shadowOffsetY=4;}g.fillStyle='#fffffff0';rr(px,12,224,84,16);g.fill();g.shadowColor='transparent';
  const m=Math.max(0,Math.ceil(timeLeft)),low=timeLeft<15&&Math.sin(clock*10)>0;
  g.textAlign='right';g.fillStyle=low?'#ff5a5a':'#5a3d66';g.font='bold 32px sans-serif';g.fillText((m/60|0)+':'+String(m%60).padStart(2,'0'),LW-26,38);
  g.fillStyle='#e86a92';g.font='bold 22px sans-serif';g.fillText(score+' 分',LW-26,74);
  g.textAlign='left';g.font='bold 12px sans-serif';g.fillStyle='#9a86a5';g.fillText((lvIdx+1)+' · '+L.name,px+14,28);
  for(let i=0;i<4;i++){g.fillStyle=i<combo?'#f08aa8':'#eadff0';circ(px+21+i*17,50,6.5);g.fill();}
  g.fillStyle=combo>1?'#e86a92':'#b8a8c0';g.fillText(combo>1?'连击 ×'+combo:'连击',px+14,68);
  {const bw=118,bx=px+14,by=85,mx=L.stars[2];g.fillStyle='#eadff0';rr(bx,by-3,bw,6,3);g.fill();g.fillStyle='#ffc24a';rr(bx,by-3,bw*Math.min(1,score/mx),6,3);g.fill();
    g.font='13px sans-serif';g.textAlign='center';L.stars.forEach(sv=>{g.fillStyle=score>=sv?'#ffb020':'#cfc0d8';g.fillText('★',bx+bw*sv/mx-(sv===mx?5:0),by-1);});g.textAlign='left';}
  if(rushOn){g.fillStyle=`rgba(255,120,150,${.06+.04*Math.sin(clock*6)})`;g.fillRect(0,0,LW,LH);
    g.fillStyle='#ff6a8a';rr(LW/2-115,108,230,36,18);g.fill();g.fillStyle='#fff';g.font='bold 17px sans-serif';g.textAlign='center';g.fillText('高峰期 · 得分 ×2',LW/2,127);}
  // 底部：教学面板与常驻操作栏
  let by=LH-22;
  if(showHelp&&!TOUCH&&state==='play'){
    const items=mode===1?[['WASD','移动'],['E','拿/放'],['F','操作(按住)'],['Shift','冲刺'],['空格','换人'],['Esc','暂停'],['H','隐藏提示']]
      :[['WASD E F 左Shift','阿橙'],['方向键 K L 右Shift','小蓝'],['Esc','暂停'],['H','隐藏提示']];
    g.font='bold 12px sans-serif';let tw=0;const ws=items.map(([k,t])=>{const a=g.measureText(k).width+12,b=g.measureText(t).width;tw+=a+b+22;return [a,b];});
    let x=LW/2-tw/2;g.fillStyle='#3a2a44b8';rr(x-10,by-15,tw+10,30,15);g.fill();
    items.forEach(([k,t],i)=>{const [a,b]=ws[i];g.fillStyle='#fff';rr(x,by-10,a,20,6);g.fill();g.fillStyle='#7a4a9a';g.textAlign='center';g.fillText(k,x+a/2,by+.5);g.fillStyle='#fff';g.textAlign='left';g.fillText(t,x+a+5,by+.5);x+=a+b+22;});
    by-=42;
  }
  if(state==='play'&&(tut>=0||tutDoneT>0)){const txt=tut>=0?TUT[tut][0]:'教学完成！接下来看左上角订单，自由发挥吧',hd=tut>=0?'新手教学 '+(tut+1)+'/7':'太棒了';
    g.font='bold 18px sans-serif';const w=g.measureText(txt).width+150;g.shadowColor='#5a3d6640';g.shadowBlur=16;g.fillStyle='#fffffff6';rr(LW/2-w/2,by-22,w,44,22);g.fill();g.shadowColor='transparent';
    g.fillStyle='#f08aa8';rr(LW/2-w/2+6,by-16,108,32,16);g.fill();g.fillStyle='#fff';g.font='bold 13px sans-serif';g.textAlign='center';g.fillText(hd,LW/2-w/2+60,by+.5);
    g.fillStyle='#5a3d66';g.font='bold 18px sans-serif';g.textAlign='left';g.fillText(txt,LW/2-w/2+126,by+1);}
  if(state==='result'&&overT>0){g.fillStyle='#ffffff60';g.fillRect(0,0,LW,LH);g.textAlign='center';g.font='900 96px sans-serif';g.lineWidth=12;g.lineJoin='round';g.strokeStyle='#fff';g.strokeText('时间到！',LW/2,LH/2);g.fillStyle='#e86a92';g.fillText('时间到！',LW/2,LH/2);}
  if(readyT>0){g.fillStyle='#ffffff50';g.fillRect(0,0,LW,LH);g.textAlign='center';g.font='900 120px sans-serif';g.lineWidth=12;g.lineJoin='round';g.strokeStyle='#fff';
    const tx=readyT>.6?String(Math.ceil((readyT-.6)/.67)):'开火！';g.strokeText(tx,LW/2,LH/2);g.fillStyle='#e86a92';g.fillText(tx,LW/2,LH/2);
    g.font='bold 22px sans-serif';g.lineWidth=6;g.strokeText(L.name+' — '+L.desc,LW/2,LH/2+95);g.fillStyle='#5a3d66';g.fillText(L.name+' — '+L.desc,LW/2,LH/2+95);}
}

/* ================= 主循环与界面 ================= */
const $=id=>document.getElementById(id);
function resize(){
  U=Math.max(.5,Math.min(1.6,Math.min(innerWidth/960,innerHeight/620)));LW=innerWidth/U;LH=innerHeight/U;
  applyQ();
  if(L)fitCamera();
}
addEventListener('resize',resize);
let last=performance.now();
function frame(now){
  const raw=(now-last)/1000,dt=Math.min(.1,raw);last=now;watchFps(raw);
  if(pr('KeyM'))toggleMusic();if(pr('KeyH'))showHelp=!showHelp;
  if(state==='play'){
    if(pr('Escape','KeyP')){state='pause';$('pause').classList.add('on');}
    else{let left=dt;while(left>1e-4&&state==='play'){const st=Math.min(left,1/60);update(st);left-=st;pressed.clear();}}
  }else{if(state==='pause'){if(pr('Escape','KeyP'))resume();}else updFx(dt);}
  pressed.clear();music(dt);
  if(L){sync3D(dt);
    g.setTransform(uic.width/LW,0,0,uic.height/LH,0,0);g.clearRect(0,0,LW,LH);
    if(state!=='menu')drawUI();}
  requestAnimationFrame(frame);
}
function resume(){state='play';$('pause').classList.remove('on');}
function toggleMusic(){musicOn=!musicOn;$('mus').textContent='音乐：'+(musicOn?'开':'关');}
function showMenu(){
  document.querySelectorAll('.ov').forEach(o=>o.classList.remove('on'));$('menu').classList.add('on');
  setupLevel(lvIdx);state='menu';
  const box=$('levels');box.innerHTML='';
  LEVELS.forEach((lv,i)=>{const b=document.createElement('button');b.className='lv';b.style.setProperty('--c',lv.accent);const s=save[i]||{score:0,stars:0};
    b.innerHTML=`<b>${i+1}. ${lv.name}</b><span>${lv.desc}</span><span><i>${'★'.repeat(s.stars)}${'☆'.repeat(3-s.stars)}</i>　最高 ${s.score}</span>`;
    b.onclick=()=>loadLevel(i);b.onmouseenter=()=>{if(state==='menu'&&lvIdx!==i){setupLevel(i);state='menu';}};box.appendChild(b);});
}
$('m1').onclick=()=>{mode=1;$('m1').classList.add('sel');$('m2').classList.remove('sel');};
$('m2').onclick=()=>{mode=2;$('m2').classList.add('sel');$('m1').classList.remove('sel');};
$('mus').onclick=toggleMusic;
$('qb').onclick=()=>{if(autoQ){autoQ=false;Q=2;}else if(Q>0)Q--;else{autoQ=true;Q=2;}applyQ();};
$('tutb').onclick=()=>{save.tut=0;store();$('tutb').textContent='已重置：进入第 1 关开始教学';};
$('again').onclick=()=>loadLevel(lvIdx);$('next').onclick=()=>loadLevel(lvIdx+1);$('back').onclick=showMenu;
$('resume').onclick=resume;$('quit').onclick=showMenu;
$('rec').innerHTML=Object.values(RECIPES).map(r=>`<b>${r.name}</b> = ${r.comp.map(c=>{const [t,s]=c.split(':');return STCN[s]+CN[t];}).join(' + ')}`).join('<br>');

if(TOUCH){
  $('touch').classList.add('on');
  const j=$('joy'),kn=$('knob');
  const mv=e=>{const r=j.getBoundingClientRect();let x=(e.clientX-r.left-65)/45,y=(e.clientY-r.top-65)/45;const l=Math.hypot(x,y);if(l>1){x/=l;y/=l;}joy.x=x;joy.y=y;kn.style.left=40+x*40+'px';kn.style.top=40+y*40+'px';};
  const end=()=>{joy.x=joy.y=0;kn.style.left=kn.style.top='40px';};
  j.addEventListener('pointerdown',e=>{j.setPointerCapture(e.pointerId);mv(e);});j.addEventListener('pointermove',e=>{if(e.buttons||e.pointerType==='touch')mv(e);});
  j.addEventListener('pointerup',end);j.addEventListener('pointercancel',end);
  document.querySelectorAll('.tb').forEach(b=>{const c=b.dataset.k;
    b.addEventListener('pointerdown',e=>{e.preventDefault();keys.add(c);pressed.add(c);b.classList.add('dn');});
    const up=()=>{keys.delete(c);b.classList.remove('dn');};b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('pointerleave',up);});
}
window.__g={get s(){return {state,score,combo,orders,players,grid,timeLeft,projs,served,portals,tut}},promptFor,loadLevel,doPick,doAct,RECIPES,tileAt,set time(v){timeLeft=v},set ready(v){readyT=v},update,ignite,
  setOrders(ids){orders=ids.map(i=>({r:RECIPES[i],t:60,max:60,age:1}))},renderer};
resize();showMenu();requestAnimationFrame(frame);
