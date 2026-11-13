/* Selective Taobao Excel import. No upload/network requests. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const state={rows:[],checked:new Set()};
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const trim=s=>String(s||"").replace(/\s+/g," ").trim();
const groupKey=r=>r.tracking?"T|"+r.tracking.toUpperCase():"N|"+trim(r.name);
function groups(rows){
 const result=new Map();
 for(const r of rows){
  const key=groupKey(r);
  if(!result.has(key))result.set(key,{key,tracking:r.tracking,company:r.company,products:new Map(),duplicates:0});
  const g=result.get(key);
  if(r.company&&!g.company)g.company=r.company;
  const name=trim(r.name);
  if(g.products.has(name))g.duplicates++;
  else g.products.set(name,{name:r.name,url:""});
 }
 return [...result.values()];
}
const selected=()=>state.rows.filter(r=>state.checked.has(r.id));
function filtered(){
 const q=trim($("importSearch").value).toLowerCase(),f=$("importFilter").value;
 return state.rows.filter(r=>(!q||[r.name,r.company,r.tracking].join(" ").toLowerCase().includes(q))&&
  (f==="all"||(f==="tracked"&&r.tracking)||(f==="pending"&&!r.tracking)||(f==="selected"&&state.checked.has(r.id))));
}
function notice(message,warn=false){const el=$("importNotice");el.textContent=message;el.classList.toggle("warn",warn);}
function render(){
 const tracked=state.rows.filter(r=>r.tracking);
 $("totalItems").textContent=state.rows.length;
 $("trackItems").textContent=tracked.length;
 $("uniqueParcels").textContent=new Set(tracked.map(r=>r.tracking.toUpperCase())).size;
 $("selectedItems").textContent=state.checked.size;
 const rows=filtered(),html=[];
 for(const r of rows.slice(0,350)){
  html.push('<article class="import-row '+(state.checked.has(r.id)?"checked":"")+'"><label class="import-check">'+
  '<input type="checkbox" data-select="'+r.id+'" '+(state.checked.has(r.id)?"checked":"")+
  ' aria-label="勾选第 '+r.sourceRow+' 行商品"><span class="import-content"><strong>'+esc(r.name)+
  '</strong><span class="import-meta"><span class="'+(r.tracking?"shipped":"waiting")+'">'+
  (r.tracking?"已有物流":"待补物流")+'</span>'+
  (r.tracking?'<span>'+esc(r.company||"快递公司未知")+'</span><code>'+esc(r.tracking)+'</code>':
    '<span>导入后可补录运单号</span>')+
  (r.warning?'<span class="waiting">原表运单格式异常，已按待补物流处理</span>':"")+
  '</span></span></label>'+
  (r.tracking?'<button type="button" class="text-btn" data-copy="'+esc(r.tracking)+'">复制单号</button>':"")+
  '</article>');
 }
 if(rows.length>350)html.push('<div class="empty">只显示前 350 条，共 '+rows.length+' 条；可搜索筛选查看更多。</div>');
 $("importRows").innerHTML=html.join("")||'<div class="empty">没有匹配的商品</div>';
 const picked=selected(),packets=groups(picked),withTracking=packets.filter(g=>g.tracking).length;
 $("selectionInfo").textContent=picked.length?
  "已勾选 "+picked.length+" 条商品 · "+packets.length+" 个记录组 · "+withTracking+" 个运单 · "+(packets.length-withTracking)+" 条待补":
  "请选择你希望管理的商品（不会自动全选）";
 $("confirmImport").disabled=!picked.length;
 $("confirmImport").textContent=picked.length?"导入选中 "+picked.length+" 条商品":"导入选中商品";
 $("copySelected").disabled=!withTracking;
 $("copySelected").textContent=withTracking?"复制选中的运单（"+withTracking+"）":"复制选中的运单";
}
function bulk(add){
 for(const r of filtered()){if(add)state.checked.add(r.id);else state.checked.delete(r.id);}
 render();
}
async function digestKey(s){
 const buffer=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
 return Array.from(new Uint8Array(buffer)).slice(0,12).map(n=>n.toString(16).padStart(2,"0")).join("");
}
async function importSelected(){
 const batches=groups(selected());
 if(!batches.length)return;
 if(batches.length>75){notice("一次最多导入 75 个包裹/待补记录，请分批勾选后导入。",true);return;}
 const btn=$("confirmImport");btn.disabled=true;
 const all=await RuruStore.list();
 let modified=0,unchanged=0,pending=0,notSynced=0,failed=0;
 for(const batch of batches){
  try{
   const products=[...batch.products.values()];
   const id="TBX-"+await digestKey("taobao-xlsx-v1|"+batch.key);
   const real=batch.tracking?all.filter(o=>o.platform==="taobao"&&!o.provisional&&
       o.packages.some(p=>p.no.toUpperCase()===batch.tracking.toUpperCase())):[];
   const orderNo=real.length===1?real[0].orderNo:id;
   const record={platform:"taobao",orderNo,provisional:real.length!==1,products,
    packages:batch.tracking?[{no:batch.tracking,company:batch.company,productName:products.length===1?products[0].name:""}]:[],
    sourceUrl:""};
   const saved=await RuruStore.upsert(record,false);
   if(saved.unchanged)unchanged++;else modified++;
   if(!saved.synced)notSynced++;
   if(!batch.tracking)pending++;
  }catch(e){failed++;}
 }
 notice("已处理 "+batches.length+" 组；新增或更新 "+modified+" 组，重复未改动 "+unchanged+
   " 组，待补物流 "+pending+" 组。"+(notSynced?" "+notSynced+" 组尚未完成云端同步（本地保留）。":"")+
   (failed?" "+failed+" 组失败，请检查 Excel 数据。":""),notSynced>0||failed>0);
 $("fileState").textContent="已完成选中商品的导入，可进入「管理全部」选择、复制或标记转运。";
 btn.disabled=false;render();
}
async function copy(s){
 try{await navigator.clipboard.writeText(s);notice("已复制 "+s.split("\n").length+" 个运单号");}
 catch(e){notice("复制失败，请检查浏览器剪贴板权限",true);}
}
$("excelFile").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;
 state.rows=[];state.checked.clear();$("importControls").hidden=true;
 $("fileState").textContent="正在读取 "+file.name+"…";
 try{
  const result=await RuruXlsx.parse(file);
  state.rows=result.rows;
  $("importControls").hidden=false;
  $("fileState").textContent="已读取 "+file.name+" · "+state.rows.length+" 条商品，请先选择再导入。";
  notice("表格未包含真实淘宝订单编号：导入记录会注明「订单号待核对」，共用运单的商品会合并保存。");
  render();
 }catch(err){
  $("fileState").textContent="表格读取失败："+String(err.message||err);
  notice("请确认这是包含商品名称、物流公司、物流单号的淘宝 .xlsx 文件。",true);
 }
});
$("importSearch").addEventListener("input",render);
$("importFilter").addEventListener("change",render);
$("chooseVisible").addEventListener("click",()=>bulk(true));
$("clearVisible").addEventListener("click",()=>bulk(false));
$("chooseTracked").addEventListener("click",()=>{
 state.checked.clear();for(const r of state.rows)if(r.tracking)state.checked.add(r.id);render();
});
$("clearAll").addEventListener("click",()=>{state.checked.clear();render();});
$("confirmImport").addEventListener("click",()=>importSelected().catch(e=>notice("导入失败："+String(e.message||e),true)));
$("viewOrders").addEventListener("click",()=>chrome.tabs.create({url:chrome.runtime.getURL("dashboard.html")}));
$("importRows").addEventListener("change",e=>{
 const box=e.target.closest("input[data-select]");if(!box)return;
 const i=Number(box.dataset.select);if(box.checked)state.checked.add(i);else state.checked.delete(i);render();
});
$("importRows").addEventListener("click",e=>{const b=e.target.closest("button[data-copy]");if(b)copy(b.dataset.copy);});
$("copySelected").addEventListener("click",()=>{
 const ns=groups(selected()).map(g=>g.tracking).filter(Boolean);
 if(ns.length)copy(ns.join("\n"));
});
})();
