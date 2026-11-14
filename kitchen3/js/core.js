'use strict';
/* ================= 基础数据 ================= */
const T=64,COLS=15,ROWS=8;
const COL={tomato:'#ef5a4c',cabbage:'#8fd46a',mushroom:'#c79a70',fish:'#f7a593',rice:'#fbf7ea',noodle:'#f6d063'};
const CN={tomato:'番茄',cabbage:'白菜',mushroom:'蘑菇',fish:'鱼',rice:'米',noodle:'面'};
const STCN={chopped:'切',boiled:'煮',fried:'炒'};
const CHOP={tomato:1,cabbage:1,mushroom:1,fish:1};
const CRATE={t:'tomato',c:'cabbage',m:'mushroom',f:'fish',r:'rice',n:'noodle'};
const RECIPES={
  salad:{name:'凉拌双丝',comp:['cabbage:chopped','tomato:chopped']},
  stirfry:{name:'清炒白菜',comp:['cabbage:fried']},
  tsoup:{name:'番茄浓汤',comp:['tomato:boiled','tomato:boiled']},
  sashimi:{name:'鱼生饭',comp:['rice:boiled','fish:chopped']},
  mnoodle:{name:'菌菇汤面',comp:['noodle:boiled','mushroom:boiled']},
  fishrice:{name:'番茄烧鱼饭',comp:['rice:boiled','fish:fried','tomato:fried']},
  chowmein:{name:'什锦炒面',comp:['noodle:boiled','cabbage:fried','mushroom:fried']},
};
for(const k in RECIPES){const r=RECIPES[k];r.id=k;r.key=r.comp.slice().sort().join('+');}
const LEVELS=[
 {name:'樱花小馆',desc:'热身：凉拌、清炒、煮汤',time:150,interval:17,stars:[80,170,270],theme:'sakura',accent:'#f29bb8',
  recipes:['salad','stirfry','tsoup'],
  map:['##ctBB#PW#pp#T#',
       '#.............#',
       '#.............#',
       '#..###...###..X',
       '#.............X',
       '#.1.........2.#',
       '#.............R',
       '###E##K###pp###']},
 {name:'落日码头',desc:'厨房隔成两半，靠传送带与投掷',time:190,interval:20,stars:[80,170,280],theme:'sunset',accent:'#f5a66a',
  recipes:['sashimi','stirfry','fishrice'],
  map:['#frB>>>>>>#PW##',
       '#......#......#',
       '#......#......X',
       'c..1...#...2..X',
       't......#......R',
       '#......#......#',
       '#......#......T',
       '#BK<<<<<<<pp#E#']},
 {name:'雪夜灯市',desc:'冰面打滑，两口锅同时开火',time:210,interval:17,stars:[90,190,310],theme:'snow',accent:'#7fa8e8',
  recipes:['mnoodle','chowmein','fishrice','salad'],
  map:['#nm#BB#T#PPW#E#',
       '#.............#',
       'c.~~~~~~~~~~~.X',
       '#.~~~~~~~~~~~.X',
       '#.~~~###~~~~~.R',
       't.~~~~~~~~~~~.#',
       '#.1.........2.#',
       '##K##pp#BB#rf##']},
 {name:'云上双岛',desc:'两座浮岛：隔空投掷 + 传送门',time:240,interval:18,stars:[90,200,330],theme:'sky',accent:'#b59cf0',
  recipes:['tsoup','mnoodle','fishrice','chowmein','sashimi'],
  map:['#ctmB## #PPW#T#',
       '#...... ......#',
       'f...... ......X',
       'r..1... ...2..X',
       'n...... ......R',
       '#...... ......#',
       '#O..... .....O#',
       '#B#K#B# #pE#pp#']},
];

/* ================= 状态 ================= */
let mode=1,state='menu',lvIdx=0,L=null,grid=[],players=[],active=0,portals=[];
let orders=[],score=0,combo=0,timeLeft=0,elapsed=0,spawnT=0,returns=[],projs=[],parts=[],floats=[];
let rushOn=false,readyT=0,served=0,missed=0,clock=0,shake=0,tut=-1,tutDoneT=0,overT=0,showHelp=true;
const TOUCH='ontouchstart' in window||navigator.maxTouchPoints>0;
let save={};try{save=JSON.parse(localStorage.getItem('bnmy3')||'{}')}catch(e){}
const store=()=>{try{localStorage.setItem('bnmy3',JSON.stringify(save))}catch(e){}};

/* ================= 音效与音乐 ================= */
let ac=null,musicOn=true,musT=0,musStep=0,musNote=4;
function actx(){if(!ac){try{ac=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}return ac;}
function beep(f,d,type,v,slide){try{
  const a=actx();if(!a)return;const o=a.createOscillator(),ga=a.createGain();o.type=type||'square';o.frequency.value=f;
  if(slide)o.frequency.exponentialRampToValueAtTime(slide,a.currentTime+d);
  ga.gain.value=v||.05;ga.gain.exponentialRampToValueAtTime(.0001,a.currentTime+d);
  o.connect(ga);ga.connect(a.destination);o.start();o.stop(a.currentTime+d);}catch(e){}}
function tone(f,d,v){try{const a=actx();if(!a||a.state!=='running')return;const o=a.createOscillator(),ga=a.createGain(),t=a.currentTime;
  o.type='sine';o.frequency.value=f;ga.gain.setValueAtTime(.0001,t);ga.gain.linearRampToValueAtTime(v,t+.04);ga.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.connect(ga);ga.connect(a.destination);o.start();o.stop(t+d);}catch(e){}}
const SCALE=[196,220,261.6,293.7,329.6,392,440,523.3,587.3,659.3];
function music(dt){
  if(!musicOn||!ac)return;musT-=dt;if(musT>0)return;
  const fast=state==='play'&&(rushOn||timeLeft<20);musT=fast?.26:.42;musStep++;
  if(Math.random()<.78){musNote=Math.max(0,Math.min(9,musNote+[-2,-1,-1,1,1,2][Math.random()*6|0]));tone(SCALE[musNote]*2,1.3,.028);}
  if(musStep%8===0)tone(SCALE[[2,0,3,1][(musStep/8|0)%4]]/2,2.6,.05);
  if(musStep%4===2)tone(SCALE[[4,2,5,3][(musStep/8|0)%4]],1.6,.016);
}
const sfx={pick:()=>beep(620,.07,'sine',.07),put:()=>beep(390,.07,'sine',.07),chop:()=>beep(900,.03,'triangle',.04),
 no:()=>beep(150,.12,'triangle',.06),ok:()=>{beep(660,.12,'sine',.09);setTimeout(()=>beep(990,.2,'sine',.09),90)},
 bad:()=>beep(220,.3,'triangle',.08,100),ding:()=>beep(1250,.18,'sine',.06),fire:()=>beep(90,.4,'sawtooth',.06,50),
 dash:()=>beep(300,.1,'sine',.04,700),throw:()=>beep(400,.12,'sine',.05,800),tp:()=>beep(500,.25,'sine',.06,1500),
 rush:()=>{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,.16,'sine',.07),i*90))}};

/* ================= 物品 ================= */
const mkIng=type=>({kind:'ing',type,state:'raw',chop:0});
const mkPlate=dirty=>({kind:'plate',dirty:!!dirty,contents:[]});
const mkCook=kind=>({kind,contents:[],prog:0,burn:0,done:false,burnt:false});
const isCook=i=>i&&(i.kind==='pot'||i.kind==='wok');
const plateable=i=>i.kind==='ing'&&i.state!=='raw'&&i.state!=='burnt';
function accepts(cw,i){
  if(cw.burnt||cw.contents.length>=3||i.kind!=='ing')return false;
  if(cw.kind==='pot')return (i.state==='raw'&&(i.type==='rice'||i.type==='noodle'))||(i.state==='chopped'&&i.type!=='fish');
  return i.state==='chopped';
}
function addTo(cw,i){const n=cw.contents.length;cw.prog=Math.min(cw.prog,1)*n/(n+1);cw.done=false;cw.burn=0;cw.contents.push(i);}
function resetCook(cw){cw.contents=[];cw.prog=0;cw.burn=0;cw.done=false;cw.burnt=false;}
function transfer(cw,pl){
  if(!cw.done||cw.burnt||pl.dirty||pl.contents.length+cw.contents.length>4)return false;
  for(const i of cw.contents)pl.contents.push(i.type+':'+i.state);
  resetCook(cw);return true;
}
const cookTime=cw=>(cw.kind==='pot'?7:5)+(cw.contents.length-1)*(cw.kind==='pot'?1.5:1);

/* ================= 关卡 ================= */
function tileAt(x,y){return x<0||y<0||x>=COLS||y>=ROWS?null:grid[y][x];}
function setupLevel(i){
  lvIdx=i;L=LEVELS[i];grid=[];players=[];portals=[];
  const sp=[];
  for(let y=0;y<ROWS;y++){grid.push([]);for(let x=0;x<COLS;x++){
    const ch=L.map[y][x],t={x,y,ch,kind:'counter',solid:true,item:null,fire:0,spreadT:0,dirty:0,clean:0,wash:0,convT:0};
    if(ch==='.'||ch==='1'||ch==='2'){t.kind='floor';t.solid=false;if(ch!=='.')sp[+ch-1]=[x,y];}
    else if(ch==='~'){t.kind='ice';t.solid=false;}
    else if(ch==='O'){t.kind='portal';t.solid=false;portals.push(t);}
    else if(ch===' '){t.kind='void';}
    else if(ch==='B')t.kind='board';
    else if(ch==='P'||ch==='W'){t.kind='stove';t.item=mkCook(ch==='P'?'pot':'wok');}
    else if(ch==='p')t.item=mkPlate();
    else if(ch==='E')t.item={kind:'ext'};
    else if(ch==='X')t.kind='serve';
    else if(ch==='T')t.kind='trash';
    else if(ch==='K')t.kind='sink';
    else if(ch==='R')t.kind='return';
    else if(CRATE[ch]){t.kind='crate';t.crate=CRATE[ch];}
    else if('><^v'.includes(ch)){t.kind='conv';t.dir={'>':[1,0],'<':[-1,0],'^':[0,-1],'v':[0,1]}[ch];}
    grid[y].push(t);}}
  const defs=[{name:'阿橙',color:'#ff9a52',chop:1.8,speed:225,dashCd:.7},{name:'小蓝',color:'#5cb8ff',chop:1,speed:262,dashCd:.45}];
  defs.forEach((d,k)=>players.push({...d,idx:k,x:(sp[k][0]+.5)*T,y:(sp[k][1]+.5)*T,vx:0,vy:0,fx:0,fy:1,held:null,dashT:0,cd:0,working:false,auto:false,walk:0,onPortal:false}));
  orders=[];score=0;combo=0;timeLeft=L.time;elapsed=0;spawnT=3;returns=[];projs=[];parts=[];floats=[];
  rushOn=false;served=0;missed=0;active=0;readyT=2.6;
  build3D();
}
function loadLevel(i){
  setupLevel(i);tut=-1;tutDoneT=0;overT=0;
  if(i===0&&!save.tut){tut=0;orders.push({r:RECIPES.stirfry,t:64,max:64,age:0});}else spawnOrder();
  state='play';
  document.querySelectorAll('.ov').forEach(o=>o.classList.remove('on'));
}
function spawnOrder(){
  if(orders.length>=5)return;
  const r=RECIPES[L.recipes[Math.random()*L.recipes.length|0]];
  const max=(50+14*r.comp.length)*(rushOn?.85:1);
  orders.push({r,t:max,max,age:0});sfx.ding();
}

/* ================= 输入 ================= */
const keys=new Set(),pressed=new Set(),joy={x:0,y:0};
addEventListener('keydown',e=>{
  actx();if(ac&&ac.state==='suspended')ac.resume();
  if(state==='play'||state==='pause'){if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code))e.preventDefault();}
  if(!e.repeat)pressed.add(e.code);keys.add(e.code);
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>keys.clear());
addEventListener('pointerdown',()=>{actx();if(ac&&ac.state==='suspended')ac.resume();});
const k=(...c)=>c.some(x=>keys.has(x))?1:0,pr=(...c)=>c.some(x=>pressed.has(x));
function getInputs(){
  if(mode===1){
    const a={mx:k('KeyD','ArrowRight')-k('KeyA','ArrowLeft')+joy.x,my:k('KeyS','ArrowDown')-k('KeyW','ArrowUp')+joy.y,
      pick:pr('KeyE'),act:pr('KeyF'),hold:!!k('KeyF'),dash:pr('ShiftLeft','ShiftRight')};
    const idle=i=>({mx:0,my:0,pick:false,act:false,hold:players[i].auto,dash:false});
    return active===0?[a,idle(1)]:[idle(0),a];
  }
  return [{mx:k('KeyD')-k('KeyA'),my:k('KeyS')-k('KeyW'),pick:pr('KeyE'),act:pr('KeyF'),hold:!!k('KeyF'),dash:pr('ShiftLeft')},
          {mx:k('ArrowRight')-k('ArrowLeft'),my:k('ArrowDown')-k('ArrowUp'),pick:pr('KeyK'),act:pr('KeyL'),hold:!!k('KeyL'),dash:pr('ShiftRight')}];
}

/* ================= 粒子（x,y 为地图像素，h 为高度/格） ================= */
function P(x,y,h,c,o){o=o||{};const sp=o.spread||0;
  parts.push({x,y,h,c,s:o.s||5,life:o.life||.4,max:o.life||.4,vx:(o.vx||0)+(Math.random()-.5)*sp,vy:(o.vy||0)+(Math.random()-.5)*sp,vh:o.vh||0,g:o.g||0});}
function puff(x,y,c,n,h){for(let i=0;i<n;i++)P(x,y,h==null?.9:h,c,{spread:130,vh:.6+Math.random(),g:3});}
function floatTxt(x,y,txt,c,hud){floats.push({x,y,txt,c,life:1.5,hud});}

/* ================= 交互 ================= */
function targetOf(p,fireOnly){
  const tx=Math.floor(p.x/T),ty=Math.floor(p.y/T);let best=null,bs=-1e9;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const t=tileAt(tx+dx,ty+dy);if(!t||t.kind==='void')continue;
    if(fireOnly?t.fire<=0:(!t.solid&&!t.item))continue;
    const vx=(t.x+.5)*T-p.x,vy=(t.y+.5)*T-p.y,d=Math.hypot(vx,vy);
    if(d>T*(fireOnly?1.9:1.25))continue;
    const dot=d<1?1:(vx*p.fx+vy*p.fy)/d;
    if(dot<(fireOnly?.3:.45)&&d>22)continue;
    const s=dot*2-d/T;if(s>bs){bs=s;best=t;}
  }
  return best;
}
const placeable=t=>t.solid&&!t.item&&t.fire<=0&&['counter','board','stove','conv'].includes(t.kind);
function combine(h,o,p,t){
  const drop=()=>{if(p)p.held=null;return true;};
  if(h.kind==='ing'&&isCook(o)&&accepts(o,h)){addTo(o,h);return drop();}
  if(h.kind==='ing'&&o.kind==='plate'&&!o.dirty&&plateable(h)&&o.contents.length<4){o.contents.push(h.type+':'+h.state);return drop();}
  if(!p)return false;
  if(h.kind==='plate'&&!h.dirty&&o.kind==='ing'&&plateable(o)&&h.contents.length<4){h.contents.push(o.type+':'+o.state);t.item=null;return true;}
  if(h.kind==='plate'&&isCook(o))return transfer(o,h);
  if(isCook(h)&&o.kind==='plate')return transfer(h,o);
  if(isCook(h)&&o.kind==='ing'&&accepts(h,o)){addTo(h,o);t.item=null;return true;}
  return false;
}
function doPick(p){
  const t=targetOf(p);if(!t)return;
  if(t.fire>0){sfx.no();return;}
  const h=p.held;
  if(!h){
    if(t.item){p.held=t.item;t.item=null;t.convT=0;sfx.pick();}
    else if(t.kind==='crate'){p.held=mkIng(t.crate);sfx.pick();}
    else if(t.kind==='return'&&t.dirty>0){t.dirty--;p.held=mkPlate(true);sfx.pick();}
    else if(t.kind==='sink'&&t.clean>0){t.clean--;p.held=mkPlate();sfx.pick();}
    return;
  }
  if(t.kind==='trash'){
    if(h.kind==='ing')p.held=null;else if(h.kind==='plate')h.contents=[];else if(isCook(h))resetCook(h);else return sfx.no();
    puff((t.x+.5)*T,(t.y+.5)*T,'#b8a8c8',6);return sfx.put();
  }
  if(t.kind==='serve'){
    if(h.kind==='plate'&&!h.dirty&&h.contents.length){deliver(h,t);p.held=null;}else sfx.no();return;
  }
  if(t.kind==='sink'){if(h.kind==='plate'&&h.dirty){t.dirty++;p.held=null;sfx.put();}else sfx.no();return;}
  if(t.kind==='crate'){if(h.kind==='ing'&&h.state==='raw'&&h.type===t.crate){p.held=null;sfx.put();}else sfx.no();return;}
  if(t.kind==='return'){sfx.no();return;}
  if(t.item){combine(h,t.item,p,t)?sfx.put():sfx.no();return;}
  if(placeable(t)){t.item=h;p.held=null;t.convT=0;sfx.put();}else sfx.no();
}
function doAct(p,dt,inp){
  p.working=false;const h=p.held;
  if(h&&h.kind==='ext'){
    if(!inp.hold)return;
    for(let i=0;i<2;i++)P(p.x+p.fx*26,p.y+p.fy*26,.6,'#ffffff',{vx:p.fx*280,vy:p.fy*280,spread:150,vh:.8,life:.35,s:6});
    const t=targetOf(p,true);if(t){t.fire-=dt*1.6;if(t.fire<=0){t.fire=0;sfx.ding();}}
    return;
  }
  if(h&&h.kind==='ing'){if(inp.act)throwItem(p);return;}
  if(h||!inp.hold)return;
  const t=targetOf(p);if(!t||t.fire>0)return;
  const it=t.item;
  if(t.kind==='board'&&it&&it.kind==='ing'&&it.state==='raw'&&CHOP[it.type]){
    it.chop+=dt*p.chop/1.7;p.working=true;
    if(Math.random()<dt*10){sfx.chop();P((t.x+.5)*T,(t.y+.5)*T,1,COL[it.type],{spread:140,vh:1.5+Math.random(),g:6,s:4});}
    if(it.chop>=1){it.state='chopped';sfx.ding();}
  }else if(t.kind==='sink'&&t.dirty>0){
    t.wash+=dt/2.2;p.working=true;
    if(Math.random()<dt*9)P((t.x+.5)*T,(t.y+.5)*T,.95,'#cfeeff',{spread:110,vh:1.3+Math.random(),g:5,s:4});
    if(t.wash>=1){t.wash=0;t.dirty--;t.clean++;sfx.ding();}
  }
}
function throwItem(p){
  projs.push({item:p.held,x:p.x+p.fx*24,y:p.y+p.fy*24,vx:p.fx*560,vy:p.fy*560,d:0,owner:p,last:tileAt(Math.floor(p.x/T),Math.floor(p.y/T))});
  p.held=null;sfx.throw();
}
function dropFloor(t,item){
  if(!t)return;
  const q=[t],seen=new Set([t]);
  while(q.length){const c=q.shift();if(!c.item&&c.kind!=='portal'){c.item=item;return;}
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const n=tileAt(c.x+dx,c.y+dy);if(n&&!n.solid&&!seen.has(n)&&seen.size<14){seen.add(n);q.push(n);}}}
}
function updProjs(dt){
  for(let i=projs.length-1;i>=0;i--){
    const q=projs[i];q.x+=q.vx*dt;q.y+=q.vy*dt;q.d+=560*dt;let gone=false;
    for(const p of players)if(p!==q.owner&&!p.held&&Math.hypot(p.x-q.x,p.y-q.y)<30){p.held=q.item;gone=true;sfx.pick();floatTxt(p.x,p.y,'接住！','#ffffff');break;}
    if(!gone){
      const t=tileAt(Math.floor(q.x/T),Math.floor(q.y/T)),end=q.d>T*4.3;
      if(t&&t.kind==='void'){if(end){gone=true;puff(q.x,q.y,'#ffffff',8,.2);floatTxt(q.x,q.y,'掉下去了…','#ff8a9a');sfx.bad();}}
      else if(!t||t.solid){
        let ok=false;
        if(t&&t.fire<=0){
          if(t.kind==='trash')ok=true;
          else if(t.item)ok=combine(q.item,t.item,null,t);
          else if(placeable(t)){t.item=q.item;t.convT=0;ok=true;}
        }
        if(!ok)dropFloor(q.last,q.item);
        gone=true;sfx.put();
      }else{q.last=t;if(end){dropFloor(t,q.item);gone=true;sfx.put();}}
    }
    if(gone)projs.splice(i,1);
  }
}
function deliver(pl,t){
  const key=pl.contents.slice().sort().join('+'),idx=orders.findIndex(o=>o.r.key===key);
  const x=(t.x+.5)*T,y=(t.y+.5)*T;
  returns.push(5);
  if(idx<0){score=Math.max(0,score-10);combo=0;floatTxt(x,y,'没人点这个！-10','#ff7a8a');sfx.bad();shake=.25;return;}
  const o=orders[idx];
  combo=idx===0?Math.min(4,combo+1):1;
  const tip=Math.round(8*o.t/o.max)*combo,pts=(20*o.r.comp.length+tip)*(rushOn?2:1);
  score+=pts;served++;orders.splice(idx,1);
  floatTxt(x,y,'+'+pts+(combo>1?'  连击×'+combo:''),'#ffd84d');
  for(let i=0;i<22;i++)P(x,y,1,['#ffd84d','#ff9ab8','#9be07a','#8fc8ff'][i%4],{spread:300,vh:2+Math.random()*3,g:7,life:.9,s:5});
  sfx.ok();
}
