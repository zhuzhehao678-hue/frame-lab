'use strict';
/* ============================================================
   3D 渲染
   ============================================================ */
const glc=document.getElementById('gl'),uic=document.getElementById('ui'),g=uic.getContext('2d');
const renderer=new THREE.WebGLRenderer({canvas:glc,antialias:true,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,300);
let world=null,itemLayer=null,anim=[],tileFx=[],chefs=[],amb=null,sun=null,camD=14,LW=960,LH=620,U=1;
const CEN=new THREE.Vector3(COLS/2,0,ROWS/2+.25),V=new THREE.Vector3();

/* ---- 画质（自动降档保证流畅） ---- */
let Q=TOUCH?1:2,autoQ=true,fpsN=0,fpsT=0;
const QN=['流畅','均衡','精美'];
function applyQ(){
  const dpr=Math.min([.8,1,1.5][Q],window.devicePixelRatio||1);
  renderer.setPixelRatio(dpr);renderer.setSize(innerWidth,innerHeight,false);
  const od=Math.min(Q?1.5:1,window.devicePixelRatio||1);uic.width=Math.round(innerWidth*od);uic.height=Math.round(innerHeight*od);
  const sh=Q>0;if(renderer.shadowMap.enabled!==sh){renderer.shadowMap.enabled=sh;scene.traverse(o=>{if(o.material)o.material.needsUpdate=true;});}
  if(sun){sun.castShadow=sh;const ms=Q===2?2048:1024;if(sun.shadow.mapSize.x!==ms){sun.shadow.mapSize.set(ms,ms);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}}}
  for(const m of meshOf.values())if(m.g)m.g.traverse(o=>{if(o.isMesh)o.castShadow=Q===2;});
  const b=document.getElementById('qb');if(b)b.textContent='画质：'+(autoQ?'自动（'+QN[Q]+'）':QN[Q]);
}
function watchFps(dt){
  if(dt>1.5||state==='pause'){fpsN=fpsT=0;return;}
  fpsN++;fpsT+=dt;if(fpsT<2)return;const fps=fpsN/fpsT;fpsN=fpsT=0;
  if(autoQ&&fps<43&&Q>0){Q--;applyQ();}
}

/* ---- 资源缓存 ---- */
const GEO={},MAT={};
function mt(color,rough,metal,o){const key=color+'|'+rough+'|'+metal+'|'+JSON.stringify(o||0);
  return MAT[key]||(MAT[key]=new THREE.MeshStandardMaterial(Object.assign({color,roughness:rough==null?.75:rough,metalness:metal||0},o||{})));}
function geo(key,f){return GEO[key]||(GEO[key]=f());}
function rbox(w,h,d,r){return geo('rb'+[w,h,d,r],()=>{
  const b=Math.min(r*.6,h*.3),s=new THREE.Shape(),x=-w/2+b,y=-d/2+b,ww=w-2*b,dd=d-2*b,q=Math.max(.001,r-b);
  s.moveTo(x+q,y);s.lineTo(x+ww-q,y);s.quadraticCurveTo(x+ww,y,x+ww,y+q);s.lineTo(x+ww,y+dd-q);s.quadraticCurveTo(x+ww,y+dd,x+ww-q,y+dd);
  s.lineTo(x+q,y+dd);s.quadraticCurveTo(x,y+dd,x,y+dd-q);s.lineTo(x,y+q);s.quadraticCurveTo(x,y,x+q,y);
  const ge=new THREE.ExtrudeGeometry(s,{depth:h-2*b,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2,curveSegments:3});
  ge.rotateX(-Math.PI/2);ge.translate(0,b,0);return ge;});}
const sph=(r,w,h)=>geo('s'+[r,w,h],()=>new THREE.SphereGeometry(r,w||16,h||12));
const cyl=(a,b,h,n)=>geo('c'+[a,b,h,n],()=>new THREE.CylinderGeometry(a,b,h,n||18));
const cone=(r,h,n)=>geo('k'+[r,h,n],()=>new THREE.ConeGeometry(r,h,n||12));
const tor=(r,t,a)=>geo('t'+[r,t,a],()=>new THREE.TorusGeometry(r,t,8,24,a||Math.PI*2));
const ico=(r,d)=>geo('i'+[r,d],()=>new THREE.IcosahedronGeometry(r,d||0));
const dome=r=>geo('d'+r,()=>new THREE.SphereGeometry(r,16,8,0,Math.PI*2,0,Math.PI/2));
const boxg=(w,h,d)=>geo('b'+[w,h,d],()=>new THREE.BoxGeometry(w,h,d));
const lathe=(key,pts)=>geo('l'+key,()=>new THREE.LatheGeometry(pts.map(p=>new THREE.Vector2(p[0],p[1])),28));
function M(ge,ma,x,y,z,parent,noShadow){const m=new THREE.Mesh(ge,ma);m.position.set(x||0,y||0,z||0);if(!noShadow){m.castShadow=true;m.receiveShadow=true;}if(parent)parent.add(m);return m;}
function G(parent,x,y,z){const gr=new THREE.Group();gr.position.set(x||0,y||0,z||0);if(parent)parent.add(gr);return gr;}
function ctex(w,h,f){const c=document.createElement('canvas');c.width=w;c.height=h;f(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
const glowTex=ctex(128,128,(c)=>{const gr=c.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'#fff');gr.addColorStop(.3,'#ffffffaa');gr.addColorStop(1,'#fff0');c.fillStyle=gr;c.fillRect(0,0,128,128);});
const petalTex=ctex(64,64,(c)=>{c.fillStyle='#fff';c.beginPath();c.ellipse(32,32,26,14,.6,0,7);c.fill();});
const ringTex=ctex(128,128,(c)=>{c.strokeStyle='#fff';c.lineWidth=10;c.beginPath();c.roundRect(12,12,104,104,24);c.stroke();c.globalAlpha=.25;c.fillStyle='#fff';c.fill();});
const beltTex=ctex(64,64,(c)=>{c.fillStyle='#4a4660';c.fillRect(0,0,64,64);c.strokeStyle='#a9a4c8';c.lineWidth=7;c.lineCap='round';c.lineJoin='round';
  for(const x of [10,42]){c.beginPath();c.moveTo(x,12);c.lineTo(x+14,32);c.lineTo(x,52);c.stroke();}});
beltTex.wrapS=beltTex.wrapT=THREE.RepeatWrapping;beltTex.repeat.set(1.5,1);
function glow(color,size,x,y,z,parent,op){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:op==null?.8:op}));
  s.scale.set(size,size,1);s.position.set(x,y,z);parent.add(s);return s;}
function sign(txt,bg,fg){const tx=ctex(160,80,(c)=>{c.fillStyle=bg;c.beginPath();c.roundRect(4,4,152,72,22);c.fill();c.fillStyle=fg;c.font='bold 40px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(txt,80,42);});
  return new THREE.Mesh(geo('sign',()=>new THREE.PlaneGeometry(.84,.42)),new THREE.MeshBasicMaterial({map:tx,transparent:true}));}

/* ---- 主题 ---- */
const THEMES={
 sakura:{sky:['#9fd0f5','#fbd3e0','#ffeef2'],fog:'#fde3ea',hemi:['#fff4f8','#f3b8c8',1.45],sun:['#fff0dc',2.3,[-7,13,6]],
   floor:['#fbe2c6','#f4d0ae'],wall:'#f2a0b8',top:'#fff1e6',base:'#b9e2a0',amb:{c:'#ffc1d6',n:260,fall:.7,size:.16,tex:petalTex}},
 sunset:{sky:['#5b6fc0','#f59a7a','#ffd9a0'],fog:'#f7b792',hemi:['#ffe8dc','#9a7ab8',1.85],sun:['#ffb070',3.0,[-10,7,-3]],
   floor:['#f6e2c8','#eccfae'],wall:'#6fb1c9',top:'#fff4e2',base:'#b98a62',amb:{c:'#ffe7a8',n:120,fall:-.25,size:.09,tex:glowTex,add:true}},
 snow:{sky:['#141b4d','#3a3f8f','#8f7fc8'],fog:'#57529c',hemi:['#aab8ff','#5a4a8a',1.5],sun:['#b8c8ff',1.6,[6,13,5]],
   floor:['#efe6f5','#e2d6ee'],wall:'#8d7fc4',top:'#f6f1ff',base:'#f4f7ff',amb:{c:'#ffffff',n:420,fall:1.1,size:.1,tex:glowTex},night:true},
 sky:{sky:['#7fb4f0','#c9b8f5','#ffd9e6'],fog:'#e6d4f5',hemi:['#ffffff','#c9a8e8',1.4],sun:['#fff2e0',2.2,[-6,13,7]],
   floor:['#f6dcee','#dccdf6'],wall:'#a98cf0',top:'#fbf2ff',base:'#d9ecff',amb:{c:'#fff6c8',n:140,fall:-.2,size:.1,tex:glowTex,add:true}},
};
let TH=null;

/* ---- 食材模型 ---- */
function ingModel(type,st){
  const gr=new THREE.Group(),c=COL[type];
  if(st==='raw'){
    if(type==='tomato'){M(sph(.17),mt(c,.3),0,.15,0,gr).scale.y=.86;M(cyl(.012,.02,.07,6),mt('#4f9b45'),0,.31,0,gr);const l=M(sph(.08,8,6),mt('#5fb04f'),0,.285,0,gr);l.scale.y=.22;}
    else if(type==='cabbage'){M(sph(.19),mt(c,.7),0,.18,0,gr);for(let i=0;i<3;i++){const l=M(sph(.2,12,8),mt(i%2?'#a6e083':'#7cc45a',.8),Math.cos(i*2.1)*.05,.16,Math.sin(i*2.1)*.05,gr);l.scale.set(1,.85,.55);l.rotation.y=i*2.1;}}
    else if(type==='mushroom'){M(cyl(.06,.08,.17),mt('#fff3e0'),0,.085,0,gr);M(dome(.19),mt(c,.6),0,.14,0,gr).scale.y=.8;for(const [x,z] of [[.08,.06],[-.07,.03],[0,-.09]])M(sph(.03,6,5),mt('#ffe9cf'),x,.265,z,gr);}
    else if(type==='fish'){const b=M(sph(.14),mt('#6fb0e8',.35),0,.085,0,gr);b.scale.set(1.7,.6,.75);const t=M(cone(.1,.16,4),mt('#5a9ad8',.4),.3,.085,0,gr);t.rotation.z=Math.PI/2;t.scale.z=.3;
      M(sph(.03,8,6),mt('#fff'),-.15,.13,.06,gr);M(sph(.016,6,5),mt('#223'),-.165,.14,.075,gr);const f=M(cone(.06,.1,4),mt('#5a9ad8'),0,.17,0,gr);f.scale.z=.3;}
    else if(type==='rice'){M(cyl(.13,.16,.24),mt('#ecd9b0',.9),0,.12,0,gr);const t=M(sph(.135),mt('#ecd9b0',.9),0,.24,0,gr);t.scale.y=.5;M(cyl(.07,.1,.06),mt('#d9bf8a'),0,.31,0,gr);M(tor(.08,.014),mt('#e86a92'),0,.29,0,gr).rotation.x=Math.PI/2;
      M(cyl(.07,.07,.01),mt('#fff'),0,.14,.15,gr).rotation.x=Math.PI/2;}
    else{for(let i=0;i<3;i++){const t=M(tor(.1-.01*i,.032),mt(c,.5),(i-1)*.04,.04+i*.05,(i%2)*.03,gr);t.rotation.x=Math.PI/2+.15*i;}}
  }else if(st==='chopped'){
    const n=type==='cabbage'?7:4;
    for(let i=0;i<n;i++){const a=i/n*6.28+.4,r=type==='cabbage'?.08:.1;let m;
      if(type==='tomato'){m=M(cyl(.075,.075,.035,12),mt(c,.3),Math.cos(a)*r,.03+i*.012,Math.sin(a)*r,gr);m.rotation.set(.25,a,.2);M(cyl(.045,.045,.037,10),mt('#ff9a8a',.3),0,0,0,m);}
      else if(type==='cabbage'){m=M(boxg(.16,.022,.045),mt(i%2?'#b8ec9a':c,.7),Math.cos(a)*r,.03+i*.014,Math.sin(a)*r,gr);m.rotation.set(.2,a*1.7,.1);}
      else if(type==='mushroom'){m=M(cyl(.07,.07,.03,10),mt('#fff0dc',.7),Math.cos(a)*r,.03+i*.012,Math.sin(a)*r,gr);m.rotation.set(.3,a,0);M(tor(.07,.012),mt(c),0,0,0,m).rotation.x=Math.PI/2;}
      else{m=M(rbox(.15,.05,.085,.03),mt(c,.35),Math.cos(a)*r,.01+i*.02,Math.sin(a)*r,gr);m.rotation.y=a;M(boxg(.02,.052,.087),mt('#fff5ee',.4),0,.026,0,m);}}
  }else{
    const burnt=st==='burnt',fried=st==='fried';
    if(!burnt&&type==='rice'){M(dome(.17),mt('#ffffff',.85),0,.01,0,gr).scale.y=.75;for(let i=0;i<6;i++)M(sph(.022,5,4),mt('#fff'),Math.cos(i)*.09,.1+(i%2)*.02,Math.sin(i)*.09,gr);}
    else if(!burnt&&type==='noodle'){for(let i=0;i<4;i++){const t=M(tor(.11-.02*i,.028),mt('#ffe08a',.35),(i%2)*.02,.03+i*.035,0,gr);t.rotation.x=Math.PI/2+(i%2?.2:-.2);t.rotation.z=i;}}
    else{
      const base=new THREE.Color(burnt?'#2e2830':c);if(fried)base.lerp(new THREE.Color('#b0621e'),.3);const hex='#'+base.getHexString();
      if(st==='boiled'){M(cyl(.17,.15,.05,20),mt(hex,.15),0,.03,0,gr);const hi=M(cyl(.13,.13,.052,20),mt('#ffffff',.2,0,{transparent:true,opacity:.25}),0,.031,0,gr);hi.castShadow=false;
        for(let i=0;i<3;i++)M(sph(.04,8,6),mt(hex,.3),Math.cos(i*2.1)*.07,.065,Math.sin(i*2.1)*.07,gr);}
      else for(let i=0;i<6;i++){const m=M(ico(.062+(i%3)*.012),mt(hex,burnt?.95:.4,0,{flatShading:true}),Math.cos(i*1.05)*(i<5?.085:0),.05+(i===5?.07:0),Math.sin(i*1.05)*(i<5?.085:0),gr);m.rotation.set(i,i*2,i*3);}
    }
  }
  return gr;
}
const SPOTS=[[],[[0,0]],[[-.11,0],[.11,0]],[[-.11,-.08],[.11,-.08],[0,.1]],[[-.11,-.11],[.11,-.11],[-.11,.11],[.11,.11]]];
function buildItem(it){
  const gr=new THREE.Group();
  if(it.kind==='ing')gr.add(ingModel(it.type,it.state));
  else if(it.kind==='plate'){
    M(lathe('plate',[[0,0],[.2,0],[.31,.05],[.32,.065],[.3,.07],[.2,.03],[0,.03]]),mt(it.dirty?'#eadcc4':'#ffffff',.25),0,0,0,gr);
    M(tor(.305,.012),mt(it.dirty?'#d8c4a0':'#f6b8cc',.4),0,.062,0,gr).rotation.x=Math.PI/2;
    if(it.dirty)for(const [x,z,r] of [[-.08,-.05,.06],[.09,.04,.05],[-.02,.1,.04]])M(cyl(r,r,.008,10),mt('#a8845a',.9),x,.034,z,gr);
    const n=Math.min(4,it.contents.length),sp=SPOTS[n];
    it.contents.slice(0,4).forEach((c,i)=>{const [t,s]=c.split(':'),m=ingModel(t,s);m.position.set(sp[i][0],.03,sp[i][1]);m.scale.setScalar(n>1?.72:1);gr.add(m);});
  }else if(isCook(it)){
    const pot=it.kind==='pot',n=it.contents.length;
    if(pot){M(lathe('pot',[[0,0],[.26,0],[.3,.03],[.3,.3],[.325,.3],[.325,.33],[.27,.33],[.27,.06],[0,.06]]),mt('#aab6d6',.3,.55),0,0,0,gr);
      for(const s of [-1,1]){const h=M(tor(.07,.022,Math.PI),mt('#8a94b8',.4,.5),s*.33,.27,0,gr);h.rotation.set(Math.PI/2,0,s>0?-Math.PI/2:Math.PI/2);}
      if(n)M(cyl(.268,.268,.02,24),mt(it.burnt?'#2a2530':'#bfe6fa',.1),0,.24,0,gr).castShadow=false;}
    else{M(lathe('wok',[[0,.02],[.14,.035],[.26,.1],[.34,.2],[.365,.21],[.34,.225],[.25,.13],[.13,.07],[0,.055]]),mt('#3a3a48',.45,.5),0,0,0,gr);
      const h=M(cyl(.03,.035,.3,10),mt('#b98a5e',.7),.5,.215,0,gr);h.rotation.z=Math.PI/2;}
    const sp=SPOTS[n]||[];
    it.contents.forEach((c,i)=>{const m=ingModel(c.type,c.state);m.position.set(sp[i][0]*.9,pot?.2:.07,sp[i][1]*.9);m.scale.setScalar(n>1?.68:.9);gr.add(m);});
  }else if(it.kind==='ext'){
    M(cyl(.1,.1,.3),mt('#f0586a',.3),0,.15,0,gr);M(sph(.1),mt('#f0586a',.3),0,.3,0,gr).scale.y=.6;M(cyl(.04,.04,.08),mt('#444'),0,.38,0,gr);
    M(boxg(.16,.03,.04),mt('#444'),.06,.42,0,gr);M(boxg(.14,.1,.01),mt('#fff'),0,.17,.1,gr);
  }
  return gr;
}
const sigOf=it=>it.kind==='ing'?'i'+it.type+it.state:it.kind==='plate'?'p'+it.dirty+it.contents.join():it.kind==='ext'?'e':it.kind+it.burnt+it.contents.map(c=>c.type+c.state).join();
const meshOf=new Map();let frameId=0;
function placeItem(it,x,y,z,ry,sc,snap){
  let m=meshOf.get(it);const s=sigOf(it);
  if(!m){m={g:null,sig:'',fresh:true};meshOf.set(it,m);}
  if(m.sig!==s){if(m.g){itemLayer.remove(m.g);const o=m.g;m.g=buildItem(it);m.g.position.copy(o.position);}else m.g=buildItem(it);m.sig=s;itemLayer.add(m.g);m.pop=1;if(Q<2)m.g.traverse(o=>{o.castShadow=false;});}
  V.set(x,y,z);if(m.fresh||snap)m.g.position.copy(V);else m.g.position.lerp(V,.38);
  m.fresh=false;m.pop=Math.max(0,(m.pop||0)-.09);
  m.g.scale.setScalar((sc||1)*(1+Math.sin(m.pop*Math.PI)*.22));
  if(ry!=null)m.g.rotation.y=ry;m.seen=frameId;
}
