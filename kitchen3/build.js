// 生成离线单文件版 offline.html（把 three.js 和 js/ 下的脚本全部内嵌，不联网也能玩）
// 用法：node build.js             （自动从 jsDelivr 下载 three.js）
//       node build.js three.min.js（使用本地 three.js 文件）
const fs=require('fs'),p=require('path'),https=require('https');
const URL='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
const get=u=>new Promise((ok,no)=>https.get(u,r=>{if(r.statusCode!==200)return no(new Error('HTTP '+r.statusCode));let d='';r.setEncoding('utf8');r.on('data',c=>d+=c);r.on('end',()=>ok(d));}).on('error',no));
(async()=>{
  let html=fs.readFileSync(p.join(__dirname,'index.html'),'utf8');
  const three=(process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):await get(URL)).replace(/^console\.warn\([^;]*\);/,'');
  html=html.replace(`<script src="${URL}"></script>`,()=>'<script>\n'+three+'\n</script>');
  html=html.replace(/<script src="(js\/[\w.-]+)"><\/script>/g,(m,f)=>'<script>\n'+fs.readFileSync(p.join(__dirname,f),'utf8')+'</script>');
  if(/<script src=/.test(html))throw new Error('还有未内嵌的脚本');
  fs.writeFileSync(p.join(__dirname,'offline.html'),html);
  console.log('offline.html',html.length);
})().catch(e=>{console.error(e.message);process.exit(1);});
