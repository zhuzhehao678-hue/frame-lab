'use strict';
/* ================= 交互提示与新手教学 ================= */
const STN={raw:'',chopped:'切好的',boiled:'煮好的',fried:'炒好的',burnt:'烧焦的'};
function nameOf(it){return it.kind==='ing'?STN[it.state]+CN[it.type]:it.kind==='plate'?(it.dirty?'脏盘子':it.contents.length?'这盘菜':'盘子'):it.kind==='pot'?'汤锅':it.kind==='wok'?'炒锅':'灭火器';}
function promptFor(p){
  const out=[],E=t=>out.push(['E',t]),F=t=>out.push(['F',t]),N=t=>out.push([null,t]);
  const t=targetOf(p),h=p.held;
  if(h&&h.kind==='ext')F('按住喷射灭火');
  if(h&&h.kind==='ing')F('投掷');
  if(!t)return out;
  if(t.fire>0){if(!(h&&h.kind==='ext'))N('着火了！快去拿灭火器');return out;}
  const it=t.item;
  if(!h){
    if(it){E('拿起'+nameOf(it));
      if(t.kind==='board'&&it.kind==='ing'&&it.state==='raw'){CHOP[it.type]?F('按住切菜'):N(CN[it.type]+'不用切，直接下汤锅');}
      if(isCook(it)&&it.burnt)N('烧焦了，端去倒进垃圾桶');}
    else if(t.kind==='crate')E('拿'+CN[t.crate]);
    else if(t.kind==='return'){t.dirty?E('拿脏盘子'):N('用过的盘子会回到这里');}
    else if(t.kind==='sink'){if(t.clean)E('拿干净盘子');if(t.dirty)F('按住洗盘子');if(!t.clean&&!t.dirty)N('脏盘子拿来这里洗');}
    else if(t.kind==='serve')N('把装好的菜端到这里');
    else if(t.kind==='board')N('把食材放上来再切');
    else if(t.kind==='trash')N('不要的东西倒这里');
    return out;
  }
  if(t.kind==='trash'){if(h.kind==='ing')E('丢掉');else if((h.kind==='plate'||isCook(h))&&h.contents.length)E('倒掉');return out;}
  if(t.kind==='serve'){h.kind==='plate'&&!h.dirty&&h.contents.length?E('出餐！'):N(h.kind==='plate'&&h.dirty?'脏盘子要先洗':'要用盘子装好菜');return out;}
  if(t.kind==='sink'){if(h.kind==='plate'&&h.dirty)E('放进水槽');return out;}
  if(t.kind==='crate'){if(h.kind==='ing'&&h.state==='raw'&&h.type===t.crate)E('放回去');return out;}
  if(t.kind==='return')return out;
  if(it){
    if(h.kind==='ing'&&isCook(it)){accepts(it,h)?E('下锅'):N(it.burnt?'锅烧焦了':it.contents.length>=3?'锅满了':h.state==='burnt'?'烧焦的只能扔掉':h.state==='raw'&&CHOP[h.type]?'要先切好':it.kind==='wok'?'这个要用汤锅煮':'这个要用炒锅');}
    else if(h.kind==='ing'&&it.kind==='plate'){!it.dirty&&plateable(h)?E('装盘'):N(it.dirty?'盘子是脏的':'还不能装盘');}
    else if(h.kind==='plate'&&it.kind==='ing'){if(!h.dirty&&plateable(it))E('装盘');}
    else if(h.kind==='plate'&&isCook(it)){h.dirty?N('盘子是脏的'):it.burnt?N('烧焦了'):!it.contents.length?N('锅是空的'):!it.done?N('还没熟，等一等'):E('盛到盘里');}
    else if(isCook(h)&&it.kind==='plate'){if(h.done&&!h.burnt&&!it.dirty)E('盛到盘里');}
    else if(isCook(h)&&it.kind==='ing'){if(accepts(h,it))E('下锅');}
    return out;
  }
  if(placeable(t))E(t.kind==='board'&&h.kind==='ing'&&h.state==='raw'&&CHOP[h.type]?'放上砧板':t.kind==='stove'&&isCook(h)?'放回灶台':'放下');
  return out;
}
const tilesWhere=f=>{const a=[];for(const r of grid)for(const t of r)if(f(t))a.push(t);return a;};
function tutFlags(){
  const f={A:0,B:0,C:0,D:0,E:0,F:0,burnt:0,plateHeld:players.some(p=>p.held&&p.held.kind==='plate')};
  const see=(it,t)=>{if(!it)return;
    if(it.kind==='ing'&&it.type==='cabbage'){if(it.state==='raw'){f.A=1;if(t&&t.kind==='board')f.B=1;}if(it.state==='chopped')f.C=1;}
    if(it.kind==='wok'){if(it.burnt)f.burnt=1;else if(it.contents.some(c=>c.type==='cabbage')){f.D=1;if(it.done)f.E=1;}}
    if(it.kind==='plate'&&it.contents.includes('cabbage:fried'))f.F=1;};
  for(const r of grid)for(const t of r)see(t.item,t);for(const p of players)see(p.held,null);
  return f;
}
const TUT=[
 ['走到白菜箱前，按 E 拿一颗白菜',t=>t.kind==='crate'&&t.crate==='cabbage'],
 ['把白菜放到砧板上：面向砧板按 E',t=>t.kind==='board'&&!t.item],
 ['空着手面向砧板，按住 F 把白菜切好',t=>t.kind==='board'&&t.item&&t.item.type==='cabbage'],
 ['拿起切好的白菜（E），放进黑色炒锅（E）',t=>t.item&&t.item.kind==='wok'],
 ['等它炒熟：圆圈转满后出现绿色对勾',t=>t.item&&t.item.kind==='wok'],
 ['拿一个盘子，面向炒锅按 E 把菜盛出来',(t,f)=>f.plateHeld?(t.item&&t.item.kind==='wok'):(t.item&&t.item.kind==='plate'&&!t.item.dirty)],
 ['把这盘菜端到绿色出餐口，按 E 出餐',t=>t.kind==='serve'],
];
function updTut(){
  const f=tutFlags(),S=served>0,d=[f.A||f.B||f.C||f.D||f.F||S,f.B||f.C||f.D||f.F||S,f.C||f.D||f.F||S,f.D||f.F||S,f.E||f.F||S,f.F||S,S];
  tut=d.findIndex(x=>!x);
  if(tut<0){tutDoneT=5;save.tut=1;store();sfx.rush();spawnT=1.5;}
  return f;
}

/* ================= 更新 ================= */
function updPlayer(p,dt,inp){
  let mx=Math.max(-1,Math.min(1,inp.mx)),my=Math.max(-1,Math.min(1,inp.my));const len=Math.hypot(mx,my);
  if(len>.15){if(len>1){mx/=len;my/=len;}p.fx=mx/Math.hypot(mx,my);p.fy=my/Math.hypot(mx,my);}else{mx=my=0;}
  const here=tileAt(Math.floor(p.x/T),Math.floor(p.y/T)),ice=here&&here.kind==='ice';
  if(here&&here.kind==='portal'){
    if(!p.onPortal&&portals.length===2){const o=portals[0]===here?portals[1]:portals[0];
      puff(p.x,p.y,'#c9a8ff',14,.5);p.x=(o.x+.5)*T;p.y=(o.y+.5)*T;puff(p.x,p.y,'#c9a8ff',14,.5);sfx.tp();}
    p.onPortal=true;
  }else p.onPortal=false;
  p.cd-=dt;p.dashT-=dt;
  if(inp.dash&&p.cd<=0){p.dashT=.17;p.cd=p.dashCd;sfx.dash();puff(p.x,p.y,'#ffffff',6,.15);}
  if(p.dashT>0){p.vx=p.fx*p.speed*2.7;p.vy=p.fy*p.speed*2.7;}
  else{const a=Math.min(1,(ice?(len?2.2:.7):18)*dt);p.vx+=(mx*p.speed-p.vx)*a;p.vy+=(my*p.speed-p.vy)*a;}
  if(p.working){p.vx*=.5;p.vy*=.5;}
  p.x+=p.vx*dt;p.y+=p.vy*dt;p.walk+=Math.hypot(p.vx,p.vy)*dt;
  const R=19;
  for(let it=0;it<2;it++){
    const tx=Math.floor(p.x/T),ty=Math.floor(p.y/T);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const t=tileAt(tx+dx,ty+dy);if(t&&!t.solid)continue;
      const rx=(tx+dx)*T,ry=(ty+dy)*T,cx=Math.max(rx,Math.min(p.x,rx+T)),cy=Math.max(ry,Math.min(p.y,ry+T));
      let ox=p.x-cx,oy=p.y-cy,d=Math.hypot(ox,oy);
      if(d<R){if(d<.001){ox=0;oy=1;d=1;p.y=ry+T;}const push=R-d;p.x+=ox/d*push;p.y+=oy/d*push;
        if(Math.abs(ox)>Math.abs(oy))p.vx*=ice?-.3:0;else p.vy*=ice?-.3:0;}
    }
  }
  if(inp.pick)doPick(p);
  doAct(p,dt,inp);
  if(!p.working)p.auto=false;
}
function updFx(dt){
  clock+=dt;shake=Math.max(0,shake-dt);tutDoneT-=dt;overT-=dt;
  for(let i=parts.length-1;i>=0;i--){const q=parts[i];q.x+=q.vx*dt;q.y+=q.vy*dt;q.vh-=q.g*dt;q.h+=q.vh*dt;if(q.h<0){q.h=0;q.vh*=-.4;}q.life-=dt;if(q.life<=0)parts.splice(i,1);}
  for(let i=floats.length-1;i>=0;i--){floats[i].life-=dt;if(floats[i].life<=0)floats.splice(i,1);}
}
function update(dt){
  updFx(dt);
  if(readyT>0){readyT-=dt;return;}
  if(mode===1&&pr('Space','Tab')){players[active].auto=players[active].working;active=1-active;sfx.pick();}
  const inps=getInputs();
  players.forEach((p,i)=>updPlayer(p,dt,inps[i]));
  const [a,b]=players,dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
  if(d<38){const o=(38-d)/2;a.x-=dx/d*o;a.y-=dy/d*o;b.x+=dx/d*o;b.y+=dy/d*o;}
  updProjs(dt);
  for(const row of grid)for(const t of row){
    const it=t.item,cx=(t.x+.5)*T,cy=(t.y+.5)*T;
    if(t.kind==='stove'&&isCook(it)&&it.contents.length&&!it.burnt&&t.fire<=0){
      if(Math.random()<dt*5)P(cx,cy,1.25,it.done&&it.burn>.35?'#8a8090':'#ffffff',{spread:20,vh:.7,life:.8,s:2.6});
      if(!it.done){it.prog+=dt/cookTime(it);if(it.prog>=1){it.done=true;const s=it.kind==='pot'?'boiled':'fried';it.contents.forEach(c=>c.state=s);sfx.ding();}}
      else{it.burn+=dt/9;if(it.burn>=1)ignite(t);}
    }
    if(t.kind==='conv'&&it){
      const n=tileAt(t.x+t.dir[0],t.y+t.dir[1]),can=n&&n.kind==='conv'&&!n.item&&n.fire<=0;
      t.convT=can?t.convT+dt/.85:0;
      if(can&&t.convT>=1){n.item=it;t.item=null;t.convT=0;n.convT=0;}
    }
    if(t.fire>0){
      t.fire=Math.min(1,t.fire+dt*.15);t.spreadT+=dt;
      if(Math.random()<dt*12)P(cx,cy,.95,Math.random()<.5?'#ff9a2e':'#ffe14d',{spread:50,vh:1.4+Math.random(),life:.6,s:5+t.fire*4});
      if(t.spreadT>5.5){t.spreadT=0;
        const ns=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>tileAt(t.x+x,t.y+y)).filter(n=>n&&n.fire<=0&&['counter','board','stove','conv'].includes(n.kind));
        if(ns.length)ignite(ns[Math.random()*ns.length|0],.5);}
    }
  }
  if(tut>=0)updTut();else{timeLeft-=dt;elapsed+=dt;}
  const rs=L.time*.45,was=rushOn;rushOn=elapsed>rs&&elapsed<rs+26;
  if(rushOn&&!was){sfx.rush();spawnOrder();}
  if(tut<0)spawnT-=dt;if(spawnT<=0){spawnOrder();spawnT=L.interval*(rushOn?.5:1);}
  if(tut<0&&!orders.length&&spawnT>2.5)spawnT=2.5;
  for(let i=orders.length-1;i>=0;i--){const o=orders[i];if(tut<0)o.t-=dt;o.age+=dt;
    if(o.t<=0){orders.splice(i,1);score=Math.max(0,score-15);combo=0;missed++;floatTxt(20+i*142,128,'超时 -15','#ff7a8a',true);sfx.bad();shake=.3;}}
  for(let i=returns.length-1;i>=0;i--){returns[i]-=dt;if(returns[i]<=0){returns.splice(i,1);
    for(const row of grid)for(const t of row)if(t.kind==='return'){t.dirty++;}}}
  if(timeLeft<=0)finish();
}
function ignite(t,f){
  t.fire=f||.8;t.spreadT=0;sfx.fire();shake=.3;
  const it=t.item;if(isCook(it)&&it.contents.length){it.burnt=true;it.done=true;it.contents.forEach(c=>c.state='burnt');}
  else if(it&&it.kind==='ing')it.state='burnt';
}
function finish(){
  state='result';timeLeft=0;
  const st=L.stars.filter(s=>score>=s).length,b=save[lvIdx]||{score:0,stars:0};
  const rec=score>b.score;save[lvIdx]={score:Math.max(b.score,score),stars:Math.max(b.stars,st)};store();
  $('rt').textContent=st?['','勉强开张','生意兴隆','包你满意！'][st]:'今天亏本了…';
  $('rs').innerHTML='<b>'+'★'.repeat(st)+'</b>'+'★'.repeat(3-st);
  $('rsc').textContent=score+' 分';
  $('rd').textContent=`出餐 ${served} 单 · 超时 ${missed} 单 · 星级线 ${L.stars.join(' / ')}`+(rec?' · 新纪录！':'');
  $('next').style.display=lvIdx<LEVELS.length-1?'':'none';
  overT=1.7;const lv=lvIdx;setTimeout(()=>{if(state==='result'&&lvIdx===lv)$('res').classList.add('on');},1700);
  st?sfx.rush():sfx.bad();
}
