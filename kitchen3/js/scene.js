'use strict';
/* ---- 主厨模型 ---- */
function mkChef(p){
  const gr=G(world),body=G(gr),cream=mt('#fffaf2',.6,0,{emissive:'#ffe8d8',emissiveIntensity:.22});gr.scale.setScalar(1.22);
  const b=M(sph(.34,28,20),cream,0,.37,0,body);b.scale.set(1,.9,1);
  for(let i=0;i<9;i++){const a=i/9*6.283,pl=M(sph(.05,8,6),mt('#f9eede',.7,0,{emissive:'#ffe8d8',emissiveIntensity:.2}),Math.sin(a)*.1,.655,Math.cos(a)*.1,body);pl.scale.set(.5,.5,2.1);pl.rotation.y=a;pl.rotation.x=.55;}
  const hatM=mt('#ffffff',.5,0,{emissive:'#fff0f0',emissiveIntensity:.3});M(cyl(.17,.15,.16,18),hatM,0,.76,0,body);M(tor(.155,.03),mt(p.color,.5,0,{emissive:p.color,emissiveIntensity:.3}),0,.7,0,body).rotation.x=Math.PI/2;
  for(let i=0;i<5;i++){const a=i/5*6.283;M(sph(.105,12,10),hatM,Math.sin(a)*.1,.9,Math.cos(a)*.1,body);}M(sph(.12,12,10),hatM,0,.95,0,body);
  M(tor(.29,.095),mt(p.color,.55,0,{emissive:p.color,emissiveIntensity:.2}),0,.2,0,body).rotation.x=Math.PI/2;
  const tail=M(rbox(.1,.2,.05,.03),mt(p.color,.6),-.2,.02,.2,body);tail.rotation.set(.3,0,.3);
  for(const s of [-1,1]){M(sph(.042,10,8),mt('#3a2a3a',.2),s*.115,.42,.295,body);M(sph(.014,6,5),mt('#fff',.2),s*.105,.435,.33,body);
    const bl=M(sph(.05,8,6),mt('#ffb0b8',.8),s*.2,.345,.265,body);bl.scale.set(1,.6,.3);}
  const mo=M(tor(.035,.011,Math.PI),mt('#3a2a3a'),0,.37,.325,body);mo.rotation.z=Math.PI;
  const hands=[-1,1].map(s=>M(sph(.085,12,10),cream,s*.32,.3,.1,gr));
  const feet=[-1,1].map(s=>{const f=M(sph(.09,10,8),mt(p.color,.6),s*.13,.05,.02,gr);f.scale.set(1,.6,1.3);return f;});
  const ring=new THREE.Mesh(geo('ring',()=>new THREE.RingGeometry(.4,.48,40).rotateX(-Math.PI/2)),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.85,depthWrite:false}));
  ring.position.y=.025;world.add(ring);
  return {p,gr,body,hands,feet,ring,ang:0};
}

/* ---- 场景装饰 ---- */
function tree(x,z,s,cols,parent){const t=G(parent,x,0,z);t.scale.setScalar(s);
  const tr=M(cyl(.1,.17,1.3,8),mt('#8a5a4a',.9),0,.65,0,t);tr.rotation.z=.08;
  [[0,1.6,0,.75],[.55,1.4,.1,.55],[-.5,1.45,-.1,.58],[.1,2.05,-.2,.5],[-.15,1.3,.45,.45]].forEach(([a,b,c,r],i)=>M(ico(r,1),mt(cols[i%cols.length],.9,0,{flatShading:true}),a,b,c,t));return t;}
function pine(x,z,s,parent){const t=G(parent,x,0,z);t.scale.setScalar(s);M(cyl(.1,.13,.5,8),mt('#6a4a4a'),0,.25,0,t);
  for(let i=0;i<3;i++){M(cone(.75-i*.18,.8,9),mt('#4f8f86',.9,0,{flatShading:true}),0,.75+i*.5,0,t);M(cone(.5-i*.13,.42,9),mt('#f4f8ff',.9,0,{flatShading:true}),0,1.0+i*.5,0,t);}return t;}
function cloud(x,y,z,s,parent){const c=G(parent,x,y,z);c.scale.setScalar(s);const m=mt('#ffffff',1,0,{emissive:'#ffffff',emissiveIntensity:.42});
  [[0,0,0,.6],[.6,-.05,.1,.45],[-.6,-.08,0,.42],[.2,.25,-.1,.42],[-.25,.2,.15,.36]].forEach(([a,b,d,r])=>{const q=M(sph(r,14,10),m,a,b,d,c,true);q.scale.y=.72;});return c;}
function mountain(x,z,r,h,col,parent){return M(geo('mt'+r+h,()=>new THREE.ConeGeometry(r,h,6)),mt(col,1,0,{flatShading:true}),x,h/2-1.5,z,parent,true);}
function lantern(x,y,z,col,parent){const l=G(parent,x,y,z);M(sph(.16,12,10),mt(col,.5,0,{emissive:col,emissiveIntensity:1.6}),0,0,0,l,true).scale.y=.85;
  M(cyl(.07,.07,.04,8),mt('#3a2a3a'),0,.15,0,l,true);M(cyl(.07,.07,.04,8),mt('#3a2a3a'),0,-.15,0,l,true);glow(col,1.1,0,0,0,l,.32);return l;}
function buildEnv(){
  const th=TH,e=G(world);
  // 岛基
  const isl=(x0,x1,mg)=>{const w=x1-x0+(mg||1.3),b=M(rbox(w,.7,ROWS+1.3,.5),mt(th.base,.95),(x0+x1)/2,-.82,ROWS/2,e);b.castShadow=false;
    const r=M(geo('rock'+w,()=>new THREE.ConeGeometry(Math.min(w,ROWS+1.3)*.56,3.2,7)),mt(L.theme==='snow'?'#b8b0d8':L.theme==='sky'?'#c9b0e0':'#c9a586',1,0,{flatShading:true}),(x0+x1)/2,-2.4,ROWS/2,e,true);
    r.rotation.x=Math.PI;r.scale.set(w/(ROWS+1.3)*1.05,1,1);};
  if(L.theme==='sky'){isl(0,7,.5);isl(8,15,.5);}else isl(0,COLS);
  if(L.theme==='sakura'){
    const pond=M(geo('pl',()=>new THREE.CircleGeometry(60,48).rotateX(-Math.PI/2)),mt('#9fdcf0',.08,.1,{emissive:'#6ac0e0',emissiveIntensity:.25}),7.5,-1.25,0,e,true);pond.receiveShadow=true;
    const pink=['#ffc4d8','#ffaecb','#ffd9e6','#f79bbd'];
    [[-2.2,-1.5,1.5],[3.5,-2.6,1.8],[11,-2.8,1.7],[17.2,-1.2,1.5],[-2.6,5,1.2],[17.6,5.5,1.3],[7.5,-4,2.1]].forEach(([x,z,s])=>{const b=M(cyl(1.6*s*.6,1.9*s*.6,.5,9),mt('#b9e2a0',1,0,{flatShading:true}),x,-1.05,z,e);b.castShadow=false;tree(x,z,s,pink,e).position.y=-.8;});
    for(let i=0;i<9;i++){const a=i*2.4,r=11+((i*37)%7),x=7.5+Math.cos(a)*r,z=6+Math.sin(a)*r*.7;if(z<9.5&&x>-1&&x<16&&z>-1)continue;
      M(cyl(.45,.45,.03,14),mt('#8fd08a',.8),x,-1.22,z,e,true);if(i%2){const f=M(cone(.16,.22,6),mt('#ffb0cc',.6),x,-1.1,z,e,true);f.rotation.x=Math.PI;}}
    mountain(-14,-34,13,13,'#c9b8e8',e);mountain(6,-40,17,17,'#d9c4ee',e);mountain(28,-36,14,12,'#c4c0ee',e);
    cloud(-6,7,-22,3,e);cloud(20,9,-26,3.6,e);
  }else if(L.theme==='sunset'){
    const sea=M(geo('sea',()=>new THREE.PlaneGeometry(200,200).rotateX(-Math.PI/2)),mt('#4f9fd6',.1,.2,{emissive:'#ff9a7a',emissiveIntensity:.08}),7.5,-1.3,-20,e,true);sea.receiveShadow=true;
    glow('#ffd28a',34,7.5,3.5,-70,e,.95);glow('#ff9a5a',70,7.5,3,-71,e,.5);M(sph(4.2,24,16),new THREE.MeshBasicMaterial({color:'#fff0c0',fog:false}),7.5,2.2,-72,e,true);
    for(let i=0;i<14;i++)M(cyl(.13,.13,1.4,8),mt('#7a5a4a'),(i%7)*2.6-.3,-1.2,i<7?-.5:ROWS+.5,e,true);
    const boat=(x,z,s)=>{const b=G(e,x,-1.15,z);b.scale.setScalar(s);const hl=M(rbox(.7,.3,1.9,.25),mt('#a86a52',.8),0,0,0,b);M(cyl(.03,.03,1.6,6),mt('#6a4a3a'),0,1,0,b);
      const sh=new THREE.Shape();sh.moveTo(0,0);sh.lineTo(0,1.4);sh.lineTo(.9,.1);const sl=M(new THREE.ShapeGeometry(sh),mt('#fff3e0',.9,0,{side:THREE.DoubleSide}),.04,.35,0,b);sl.rotation.y=Math.PI/2;
      anim.push(t=>{b.position.y=-1.15+Math.sin(t*1.2+x)*.06;b.rotation.z=Math.sin(t*.9+x)*.05;});};
    boat(-3.5,-3,1.4);boat(19,-6,1.7);boat(4,-13,1.2);boat(18.5,6,1.1);
    const lh=G(e,-5,-1.3,-12);M(cyl(.9,1.2,.6,10),mt('#8a7a8a'),0,.3,0,lh);M(cyl(.45,.7,4,12),mt('#fff3ea',.7),0,2.6,0,lh);M(cyl(.47,.6,.8,12),mt('#f0786a',.7),0,2.2,0,lh);
    M(cyl(.5,.5,.5,10),mt('#ffe9a8',.4,0,{emissive:'#ffd070',emissiveIntensity:2}),0,4.85,0,lh);M(cone(.6,.6,10),mt('#f0786a'),0,5.4,0,lh);glow('#ffd070',4,0,4.85,0,lh,.7);
    mountain(-26,-60,16,9,'#8a6aa8',e);mountain(34,-62,20,11,'#7a62a0',e);cloud(-8,9,-30,4,e);cloud(22,11,-34,4.5,e);
  }else if(L.theme==='snow'){
    const gnd=M(geo('snowg',()=>new THREE.CircleGeometry(70,40).rotateX(-Math.PI/2)),mt('#e8ecff',.95),7.5,-1.2,0,e,true);gnd.receiveShadow=true;
    [[-2.4,-1.6,1.5],[-3.2,2.6,1.2],[2.5,-3.2,1.7],[12.5,-3.3,1.6],[17.5,-1.4,1.5],[18.3,3,1.2],[7.5,-5,2],[-2.8,7,1.1],[17.8,7.4,1.1]].forEach(([x,z,s])=>pine(x,z,s,e).position.y=-1.2);
    const cols=['#ff7a6a','#ffb04a','#ff8ab0','#ffd45a'];
    for(const zz of [-.9]){for(let i=0;i<9;i++){const x=-.5+i*2,y=2.6-Math.sin(i/8*Math.PI)*.5;const l=lantern(x,y,zz,cols[i%4],e);anim.push(t=>{l.rotation.z=Math.sin(t*1.3+i)*.12;});}
      M(cyl(.06,.08,4.2,8),mt('#5a4a6a'),-.9,.9,zz,e);M(cyl(.06,.08,4.2,8),mt('#5a4a6a'),15.9,.9,zz,e);}
    {const pl=new THREE.PointLight('#ffb070',40,16,2);pl.position.set(7.5,3.4,2.5);e.add(pl);}
    // 星空与极光
    const sg=new THREE.BufferGeometry(),sp=[];for(let i=0;i<260;i++)sp.push((Math.random()-.5)*160,10+Math.random()*45,-60-Math.random()*20);sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
    e.add(new THREE.Points(sg,new THREE.PointsMaterial({color:'#ffffff',size:2,sizeAttenuation:false,fog:false,transparent:true,opacity:.9})));
    glow('#fff6d8',9,-18,26,-70,e,.9);M(sph(2.6,20,14),new THREE.MeshBasicMaterial({color:'#fffbe8',fog:false}),-18,26,-71,e,true);
    for(let i=0;i<3;i++){const a=new THREE.Mesh(new THREE.PlaneGeometry(70,9,30,1),new THREE.MeshBasicMaterial({color:['#7affc8','#8ab8ff','#c89aff'][i],transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
      a.position.set(7.5+i*6-6,17+i*2.5,-55-i*2);const pos=a.geometry.attributes.position,base=pos.array.slice();e.add(a);
      anim.push(t=>{for(let k=0;k<pos.count;k++){const x=base[k*3];pos.array[k*3+1]=base[k*3+1]+Math.sin(x*.18+t*.5+i*2)*1.6;pos.array[k*3+2]=Math.cos(x*.12+t*.3+i)*2;}pos.needsUpdate=true;});}
    mountain(-20,-40,14,13,'#6a66b8',e);mountain(8,-46,18,16,'#7a72c4',e);mountain(32,-42,15,12,'#625fae',e);
  }else{
    for(let i=0;i<16;i++){const c=cloud((i*7.3)%44-14,-2.2-(i%4)*1.2,(i*5.1)%26-16,1.6+(i%3)*.9,e),sp=.15+(i%4)*.06,x0=c.position.x;anim.push(t=>{c.position.x=((x0+t*sp+14)%44)-14;});}
    cloud(-9,6,-24,3.4,e);cloud(24,8,-28,4,e);cloud(7,10,-34,3,e);
    ['#ff9aa8','#ffc48a','#fff0a0','#a8e8b0','#9ac8ff','#c8a8f5'].forEach((c,i)=>{const r=M(geo('rb'+i,()=>new THREE.TorusGeometry(19-i*.45,.24,6,60,Math.PI)),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.42,fog:false,depthWrite:false}),7.5,-4,-32,e,true);});
    for(const [x,z,s] of [[-5,-8,1],[21,-10,1.3],[-7,4,.8],[22,5,.9]]){const fi=G(e,x,-1,z);fi.scale.setScalar(s);M(cyl(1.4,1.6,.4,9),mt('#bfe6b0',1,0,{flatShading:true}),0,0,0,fi);const r=M(cone(1.4,2.4,7),mt('#c9b0e0',1,0,{flatShading:true}),0,-1.4,0,fi);r.rotation.x=Math.PI;
      tree(0,0,.9,['#ffd0e4','#e6c8ff','#fff0f6'],fi).position.y=.2;anim.push(t=>{fi.position.y=-1+Math.sin(t*.6+x)*.25;});}
  }
  // 氛围粒子
  const a=th.amb,pg=new THREE.BufferGeometry(),arr=new Float32Array(a.n*3);
  for(let i=0;i<a.n;i++){arr[i*3]=Math.random()*34-9.5;arr[i*3+1]=Math.random()*9-.5;arr[i*3+2]=Math.random()*24-12;}
  pg.setAttribute('position',new THREE.BufferAttribute(arr,3));
  amb=new THREE.Points(pg,new THREE.PointsMaterial({map:a.tex,color:a.c,size:a.size,transparent:true,depthWrite:false,opacity:.9,blending:a.add?THREE.AdditiveBlending:THREE.NormalBlending}));
  amb.userData=a;amb.frustumCulled=false;e.add(amb);
}

/* ---- 关卡场景构建 ---- */
function build3D(){
  if(world){scene.remove(world);world.traverse(o=>{if(o.isLight&&o.dispose)o.dispose();});}
  meshOf.clear();anim=[];tileFx=[];chefs=[];
  TH=THEMES[L.theme];world=G(scene);itemLayer=G(world);
  scene.background=ctex(4,256,(c,w,h)=>{const gr=c.createLinearGradient(0,0,0,h);gr.addColorStop(0,TH.sky[0]);gr.addColorStop(.55,TH.sky[1]);gr.addColorStop(1,TH.sky[2]);c.fillStyle=gr;c.fillRect(0,0,w,h);});
  scene.fog=new THREE.Fog(TH.fog,26,95);
  world.add(new THREE.HemisphereLight(TH.hemi[0],TH.hemi[1],TH.hemi[2]));
  sun=new THREE.DirectionalLight(TH.sun[0],TH.sun[1]);sun.position.set(CEN.x+TH.sun[2][0],TH.sun[2][1],CEN.z+TH.sun[2][2]);sun.target.position.copy(CEN);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);const sc=sun.shadow.camera;sc.left=-11;sc.right=11;sc.top=8;sc.bottom=-8;sc.near=1;sc.far=50;sun.shadow.bias=-.0004;sun.shadow.normalBias=.03;sun.shadow.radius=4;
  world.add(sun,sun.target);
  buildEnv();
  const fm=[mt(TH.floor[0],.8),mt(TH.floor[1],.8)],im=[mt('#d6f1ff',.06,.15),mt('#c2e8fb',.06,.15)],wall=mt(TH.wall,.7),top=mt(TH.top,.45);
  const batches=new Map(),inst=(ge,ma,x,y,z,cast)=>{const k=ge.uuid+ma.uuid;let b=batches.get(k);if(!b)batches.set(k,b={ge,ma,cast,pos:[]});b.pos.push(x,y,z);};
  for(const row of grid)for(const t of row){
    if(t.kind==='void')continue;
    const tg=G(world,t.x+.5,0,t.y+.5),fx={t};tileFx.push(fx);
    if(!t.solid){
      inst(rbox(.97,.12,.97,.07),(t.kind==='ice'?im:fm)[(t.x+t.y)%2],t.x+.5,-.12,t.y+.5,false);
      if(t.kind==='portal'){
        const r1=M(tor(.36,.045),mt('#c9a8ff',.3,0,{emissive:'#b58cff',emissiveIntensity:2.2}),0,.03,0,tg,true);r1.rotation.x=Math.PI/2;
        const r2=M(tor(.24,.03),mt('#ffb8e0',.3,0,{emissive:'#ff9ad0',emissiveIntensity:2.2}),0,.05,0,tg,true);r2.rotation.x=Math.PI/2;
        const gl=glow('#b58cff',1.1,0,.25,0,tg,.3);
        anim.push(tm=>{r1.rotation.z=tm*1.5;r2.rotation.z=-tm*2.2;r2.position.y=.08+Math.sin(tm*3)*.04;gl.material.opacity=.28+Math.sin(tm*3)*.1;});
      }
      continue;
    }
    inst(rbox(.98,.72,.98,.09),wall,t.x+.5,-.02,t.y+.5,true);
    const k=t.kind;
    if(k!=='crate')inst(rbox(1,.13,1,.11),k==='serve'?mt('#8fe0b8',.4,0,{emissive:'#5fd0a0',emissiveIntensity:.35}):k==='return'?mt('#cfc4e6',.5):k==='stove'?mt('#5a566e',.4,.3):top,t.x+.5,.69,t.y+.5,true);
    if(k==='board'){M(rbox(.72,.05,.52,.06),mt('#f6dfb4',.7),0,.82,0,tg);const kn=G(tg,.05,.875,.02);kn.rotation.y=.5;M(boxg(.3,.012,.075),mt('#e6ecf5',.2,.8),.08,0,0,kn);M(rbox(.14,.03,.05,.02),mt('#8a5a4a'),-.14,-.012,0,kn);fx.knife=kn;}
    else if(k==='stove'){const bm=new THREE.MeshStandardMaterial({color:'#8a86a0',roughness:.4,emissive:'#ff7a30',emissiveIntensity:0});const b=M(tor(.27,.035),bm,0,.835,0,tg,true);b.rotation.x=Math.PI/2;fx.burner=bm;fx.bglow=glow('#ff9a4a',1.5,0,.9,0,tg,0);}
    else if(k==='serve'){const s=sign('出餐','#2f9e74','#ffffff');s.position.set(0,.84,.05);s.rotation.x=-Math.PI/2;tg.add(s);
      const bell=G(tg,t.x===COLS-1?.3:-.3,.82,-.3);M(dome(.09),mt('#ffd45a',.25,.7),0,.02,0,bell);M(sph(.025,8,6),mt('#ffd45a',.25,.7),0,.12,0,bell);M(cyl(.11,.11,.02,14),mt('#8a6a4a'),0,.01,0,bell);}
    else if(k==='trash'){M(cyl(.33,.33,.06,22),mt('#7a7690',.5,.3),0,.83,0,tg);M(cyl(.26,.26,.065,22),mt('#1e1c2a',.9),0,.83,0,tg,true);}
    else if(k==='sink'){M(rbox(.84,.05,.76,.12),mt('#b8bfd6',.3,.6),0,.8,0,tg);const w=M(rbox(.72,.03,.64,.1),mt('#8fd6f5',.05,.1,{transparent:true,opacity:.85}),0,.835,0,tg,true);
      M(cyl(.03,.03,.22,8),mt('#d8deee',.2,.8),0,.93,-.33,tg);const fa=M(tor(.07,.025,Math.PI),mt('#d8deee',.2,.8),0,1.04,-.26,tg);fa.rotation.y=Math.PI/2;
      fx.dirty=[0,1,2].map(i=>{const m=buildItem(mkPlate(true));m.position.set(-.19,.86+i*.035,.05);m.scale.setScalar(.58);tg.add(m);return m;});
      fx.clean=[0,1,2].map(i=>{const m=buildItem(mkPlate());m.position.set(.19,.86+i*.035,.05);m.scale.setScalar(.58);tg.add(m);return m;});
      anim.push(tm=>{w.position.y=.835+Math.sin(tm*2+t.x)*.006;});}
    else if(k==='crate'){const wd=mt('#e0b07a',.85),dk=mt('#c08a58',.85);M(rbox(.9,.34,.9,.06),wd,0,.68,0,tg);
      for(const s of [-1,1]){M(boxg(.92,.06,.05),dk,0,.86,s*.44,tg);M(boxg(.05,.06,.92),dk,s*.44,.86,0,tg);}
      [[-.17,-.14],[.19,-.08],[0,.2]].forEach(([x,z],i)=>{const m=ingModel(t.crate,'raw');m.position.set(x,.98,z);m.rotation.y=i*2.2;m.scale.setScalar(.92);m.traverse(o=>{o.castShadow=false});tg.add(m);});}
    else if(k==='return'){const s=sign('回收','#8a72c0','#ffffff');s.position.set(0,.84,.05);s.rotation.x=-Math.PI/2;tg.add(s);
      fx.dirty=[0,1,2].map(i=>{const m=buildItem(mkPlate(true));m.position.set(0,.83+i*.04,0);m.scale.setScalar(.85);tg.add(m);return m;});}
    else if(k==='conv'){const b=new THREE.Mesh(geo('belt',()=>new THREE.PlaneGeometry(1,.8).rotateX(-Math.PI/2)),new THREE.MeshStandardMaterial({map:beltTex,roughness:.6}));
      b.position.y=.825;b.rotation.y=t.dir[0]===1?0:t.dir[0]===-1?Math.PI:t.dir[1]===1?-Math.PI/2:Math.PI/2;b.receiveShadow=true;tg.add(b);
      for(const s of [-1,1])M(boxg(1,.05,.07),mt('#d8d2ee',.3,.5),0,.84,s*.44,b.parent===tg&&t.dir[0]?tg:tg).rotation.y=t.dir[0]?0:Math.PI/2;}
    // 火焰
    const fg=G(tg,0,.85,0);fg.visible=false;fx.fire=fg;fx.flames=[['#ff6a2a',.3,.75],['#ffa53a',.22,.6],['#ffe27a',.13,.42]].map(([c,r,h],i)=>{
      const m=new THREE.Mesh(cone(r,h,10),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.92,fog:false}));m.position.y=h/2;fg.add(m);return m;});
    fx.fglow=glow('#ff8a3a',2.6,0,.4,0,fg,.7);
  }
  for(const b of batches.values()){const n=b.pos.length/3,im2=new THREE.InstancedMesh(b.ge,b.ma,n);
    for(let i=0;i<n;i++){DM.position.set(b.pos[i*3],b.pos[i*3+1],b.pos[i*3+2]);DM.scale.setScalar(1);DM.rotation.set(0,0,0);DM.updateMatrix();im2.setMatrixAt(i,DM.matrix);}
    im2.castShadow=b.cast;im2.receiveShadow=true;im2.frustumCulled=false;world.add(im2);}
  players.forEach(p=>chefs.push(mkChef(p)));
  // 目标高亮
  hl=players.map(p=>{const m=new THREE.Mesh(geo('hl',()=>new THREE.PlaneGeometry(1.04,1.04).rotateX(-Math.PI/2)),new THREE.MeshBasicMaterial({map:ringTex,color:p.color,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));m.visible=false;world.add(m);return m;});
  // 粒子
  pim=new THREE.InstancedMesh(sph(.06,6,5),new THREE.MeshBasicMaterial({transparent:true,opacity:.9}),500);pim.frustumCulled=false;pim.count=0;world.add(pim);
  applyQ();fitCamera();
}
let hl=[],pim=null;const DM=new THREE.Object3D(),DC=new THREE.Color();
const surfY=t=>!t.solid?.01:(t.kind==='board'||t.kind==='stove')?.87:.82;

function sync3D(dt){
  frameId++;const tm=clock;
  for(const f of anim)f(tm);
  beltTex.offset.x=-(tm*.9)%1;
  // 台面物品与特效
  for(const fx of tileFx){const t=fx.t,it=t.item;
    if(it){let ox=0,oz=0;if(t.kind==='conv'){ox=t.dir[0]*t.convT;oz=t.dir[1]*t.convT;}
      placeItem(it,t.x+.5+ox,surfY(t),t.y+.5+oz,it.kind==='wok'?-.5:it.kind==='ing'&&t.kind==='board'&&it.chop>0&&it.state==='raw'?Math.sin(tm*30)*.06:null,1,t.kind==='conv');}
    if(fx.knife)fx.knife.visible=!it;
    if(fx.burner){const on=isCook(it)&&it.contents.length&&!it.burnt?1:0;fx.burner.emissiveIntensity=on*(2+Math.sin(tm*12)*.6);fx.bglow.material.opacity=on*(.35+Math.sin(tm*9)*.08);}
    if(fx.dirty)fx.dirty.forEach((m,i)=>m.visible=i<t.dirty);
    if(fx.clean)fx.clean.forEach((m,i)=>m.visible=i<t.clean);
    if(fx.fire){fx.fire.visible=t.fire>0;if(t.fire>0){const s=.6+t.fire*.7;fx.flames.forEach((m,i)=>{const w=1+Math.sin(tm*(11+i*3)+t.x*2+i)*.22;m.scale.set(s*(2-w*.9),s*w,s*(2-w*.9));m.position.x=Math.sin(tm*7+i*2)*.04;});fx.fglow.material.opacity=.5+Math.sin(tm*13)*.15;}}
  }
  // 主厨
  chefs.forEach((c,i)=>{const p=c.p,x=p.x/T,z=p.y/T,sp=Math.hypot(p.vx,p.vy)/p.speed;
    let d=Math.atan2(p.fx,p.fy)-c.ang;d=Math.atan2(Math.sin(d),Math.cos(d));c.ang+=d*Math.min(1,dt*16);
    const hop=Math.abs(Math.sin(p.walk*.11))*.07*Math.min(1,sp),dash=p.dashT>0;
    c.gr.position.set(x,hop,z);c.gr.rotation.y=c.ang;
    c.body.rotation.x+=((dash?.45:sp*.12)-c.body.rotation.x)*.3;
    const sq=1+Math.sin(tm*3+i*2)*.02-hop*.6;c.body.scale.set(1/Math.sqrt(sq),sq,1/Math.sqrt(sq));
    const hold=!!p.held;
    c.hands.forEach((h,j)=>{const s=j?1:-1;let hx=s*.33,hy=.3,hz=.08+Math.sin(p.walk*.11+j*Math.PI)*.12*Math.min(1,sp);
      if(hold){hx=s*.2;hy=.42;hz=.36;}
      if(p.working){hx=s*.16;hz=.42;hy=.62+Math.sin(tm*22+j*Math.PI)*.16;}
      h.position.x+=(hx-h.position.x)*.35;h.position.y+=(hy-h.position.y)*.5;h.position.z+=(hz-h.position.z)*.35;});
    c.feet.forEach((f,j)=>{f.position.z=.02+Math.sin(p.walk*.11+j*Math.PI)*.13*Math.min(1,sp);f.position.y=.05+Math.max(0,Math.sin(p.walk*.11+j*Math.PI))*.06*Math.min(1,sp);});
    const act=state==='play'&&(mode===2||i===active);
    c.ring.visible=state==='play';c.ring.position.set(x,.03,z);c.ring.rotation.y=tm*1.2;c.ring.material.color.set(p.color);c.ring.material.opacity=act?.9:.25;c.ring.scale.setScalar(act?1+Math.sin(tm*5)*.05:.8);
    if(p.held)placeItem(p.held,x+Math.sin(c.ang)*.42,.5+hop,z+Math.cos(c.ang)*.42,c.ang+(p.held.kind==='wok'?-1.2:0),.92);
    const t=act&&readyT<=0?targetOf(p):null,h=hl[i];h.visible=!!t;if(t){h.position.set(t.x+.5,(t.solid?(t.kind==='crate'?.9:.83):.02)+.012,t.y+.5);h.material.opacity=.65+Math.sin(tm*8)*.25;}
  });
  for(const q of projs){const u=q.d/(T*4.3);placeItem(q.item,q.x/T,.55+Math.sin(u*Math.PI)*.7,q.y/T,tm*9,1,true);}
  for(const [it,m] of meshOf)if(m.seen!==frameId){itemLayer.remove(m.g);meshOf.delete(it);}
  // 粒子
  let n=0;for(const q of parts){if(n>=500)break;const f=q.life/q.max;DM.position.set(q.x/T,q.h,q.y/T);DM.scale.setScalar(q.s/5*(.4+f));DM.updateMatrix();pim.setMatrixAt(n,DM.matrix);pim.setColorAt(n,DC.set(q.c));n++;}
  pim.count=n;pim.instanceMatrix.needsUpdate=true;if(pim.instanceColor)pim.instanceColor.needsUpdate=true;
  // 氛围
  if(amb){const a=amb.userData,ps=amb.geometry.attributes.position,ar=ps.array;
    for(let i=0;i<a.n;i++){ar[i*3+1]-=a.fall*dt*(.6+(i%5)*.2);ar[i*3]+=Math.sin(tm*.8+i)*dt*.35+dt*.15;ar[i*3+2]+=Math.cos(tm*.6+i*1.7)*dt*.25;
      if(ar[i*3+1]<-.8)ar[i*3+1]=8.5;if(ar[i*3+1]>8.6)ar[i*3+1]=-.6;if(ar[i*3]>24.5)ar[i*3]=-9.5;}
    ps.needsUpdate=true;if(a.add)amb.material.opacity=.6+Math.sin(tm*2)*.25;}
  // 相机
  const sw=state==='menu'?Math.sin(tm*.25)*2.2:Math.sin(tm*.3)*.12,sk=shake>0?(Math.random()-.5)*shake*.5:0;
  camera.position.set(CEN.x+sw+sk,camD*.8+sk,CEN.z+camD*.6);camera.lookAt(CEN.x+sw*.3,0,CEN.z-(state==='menu'?.5:0));
  renderer.render(scene,camera);
}
function fitCamera(){
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  const topLim=1-2*(132*U)/innerHeight,pts=[[-.3,0,-.3],[COLS+.3,0,-.3],[-.3,0,ROWS+.4],[COLS+.3,0,ROWS+.4],[-.3,1.5,-.3],[COLS+.3,1.5,-.3]];
  for(camD=9;camD<60;camD+=.25){
    camera.position.set(CEN.x,camD*.8,CEN.z+camD*.6);camera.lookAt(CEN.x,0,CEN.z);camera.updateMatrixWorld();
    if(pts.every(p=>{V.set(p[0],p[1],p[2]).project(camera);return Math.abs(V.x)<.97&&V.y>-.84&&V.y<topLim;}))break;
  }
}
function proj(px,py,h){V.set(px/T,h,py/T).project(camera);return [(V.x*.5+.5)*LW,(-V.y*.5+.5)*LH];}
