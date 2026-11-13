importScripts("storage.js");
const JOB_KEY="ruru_fw_batch_job_v1";
const TAOBAO_ORDERS="https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm";
let running=false;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function eligible(u,p){
 try{
  const v=new URL(u);
  if(v.protocol!=="https:")return false;
  return p==="pdd"?/(^|\.)(pinduoduo|yangkeduo)\.com$/.test(v.hostname):
   /(^|\.)(taobao|tmall)\.com$/.test(v.hostname);
 }catch(e){return false;}
}
async function updateJob(diff){
 const old=(await chrome.storage.local.get(JOB_KEY))[JOB_KEY]||{};
 const next=Object.assign({},old,diff,{updatedAt:Date.now()});
 await chrome.storage.local.set({[JOB_KEY]:next});
 return next;
}
async function isCancelled(){
 const job=(await chrome.storage.local.get(JOB_KEY))[JOB_KEY];
 return job?.cancelRequested===true;
}
async function tabReady(id){
 // A session may redirect to login. Respect it; don't bypass authentication.
 for(let tries=0;tries<25;tries++){
  const tab=await chrome.tabs.get(id);
  if(tab.status==="complete"){await pause(1550);return tab;}
  await pause(500);
 }
 throw Error("订单页面加载超时，可能需要登录或完成安全验证");
}
async function message(id,type,extra={}){
 let last="";
 for(let attempt=0;attempt<4;attempt++){
  try{
   const res=await chrome.tabs.sendMessage(id,Object.assign({type},extra));
   if(res)return res;
  }catch(e){last=String(e.message||e);}
  await pause(650);
 }
 throw Error("无法读取网页：请检查登录状态，刷新购物网站后重试。"+last.slice(0,110));
}
async function visit(id,u,p){
 if(!eligible(u,p))throw Error("跳过不属于购物平台的链接");
 await chrome.tabs.update(id,{url:u});
 const tab=await tabReady(id);
 if(!eligible(tab.url,p))throw Error("页面已跳转到登录或验证域名，请先完成登录");
 return tab;
}
async function saveOrder(row,p){
 if(!row||!row.orderNo)return false;
 try{
  const saved=await RuruStore.upsert({platform:p,orderNo:row.orderNo,products:row.products||[],
    packages:row.packages||[],sourceUrl:row.sourceUrl||""},false);
  return saved.synced||saved.unchanged;
 }catch(e){return false;}
}
async function scanDetails(id,row,p,listUrl){
 const no=row.orderNo;
 const target=[...(row.links?.logistics||[]),...(row.links?.detail||[])].find(u=>eligible(u,p));
 let details=null,found=0,attempted=false;
 if(target){
  attempted=true;
  await visit(id,target,p);
  details=await message(id,"RURU_CRAWL_EXTRACT",{orderNo:no});
  if(details?.verification)throw Error("需要完成账号验证");
  if(details?.ok){await saveOrder(details.order,p);found+=details.found||0;}
  else if(details?.error)throw Error(details.error);
  // If we visited order details, follow its read-only logistics link.
  const logistics=(details?.links?.logistics||[]).find(u=>eligible(u,p)&&u!==target);
  if(!found && logistics){
   await visit(id,logistics,p);
   const again=await message(id,"RURU_CRAWL_EXTRACT",{orderNo:no});
   if(again?.verification)throw Error("需要完成账号验证");
   if(again?.ok){await saveOrder(again.order,p);found+=again.found||0;}
  }
 }
 if(!found){
  // Fallback for SPA sites that use a button without a normal URL.
  await visit(id,listUrl,p);
  const clicked=await message(id,"RURU_CRAWL_CLICK",{orderNo:no,kind:"logistics"}).catch(()=>null);
  if(clicked?.ok){
   attempted=true;
   if(clicked.result?.ok){await saveOrder(clicked.result.order,p);found+=clicked.result.found||0;}
   if(!found){
    await pause(900);
    const again=await message(id,"RURU_CRAWL_EXTRACT",{orderNo:no}).catch(()=>null);
    if(again?.ok){await saveOrder(again.order,p);found+=again.found||0;}
   }
  }else if(!target){
   const detail=await message(id,"RURU_CRAWL_CLICK",{orderNo:no,kind:"detail"}).catch(()=>null);
   if(detail?.ok){
    attempted=true;
    if(detail.result?.ok){await saveOrder(detail.result.order,p);found+=detail.result.found||0;}
    const link=(detail.result?.links?.logistics||[]).find(u=>eligible(u,p));
    if(!found&&link){
     await visit(id,link,p);
     const again=await message(id,"RURU_CRAWL_EXTRACT",{orderNo:no});
     if(again?.ok){await saveOrder(again.order,p);found+=again.found||0;}
    }
   }
  }
 }
 return {found,attempted};
}
async function runJob(platform,startUrl){
 let work=null,blocked=false,job=null;
 running=true;
 try{
  job=await updateJob({state:"running",platform,completed:0,found:0,total:0,page:0,
   current:"打开已购买订单列表",errors:[],startedAt:Date.now(),cancelRequested:false});
  work=await chrome.tabs.create({url:startUrl,active:false});
  await updateJob({workerTabId:work.id});
  const visitedPages=new Set(),processed=new Set();
  let pageUrl=startUrl,complete=0,found=0,failures=[];
  for(let page=1;page<=5&&pageUrl&&!visitedPages.has(pageUrl);page++){
   if(await isCancelled())break;
   visitedPages.add(pageUrl);
   const tab=await visit(work.id,pageUrl,platform);
   await updateJob({page,current:"读取第 "+page+" 页订单"});
   const data=await message(work.id,"RURU_CRAWL_DISCOVER");
   if(!data.rows?.length){
    blocked=page===1;
    const reason=page===1?"未在已购买订单列表找到订单。可能未登录、出现验证，或网页结构已改变。":"后续页面未找到可识别订单";
    failures.push(reason);
    break;
   }
   const queue=data.rows.filter(r=>/^[0-9A-Za-z_-]{10,42}$/.test(r.orderNo)&&!processed.has(r.orderNo));
   const available=queue.slice(0,Math.max(0,40-processed.size));
   await updateJob({total:processed.size+available.length,current:"已识别 "+available.length+" 笔订单，开始逐单读取"});
   for(const r of available)await saveOrder(r,platform);
   for(const row of available){
    if(await isCancelled())break;
    processed.add(row.orderNo);
    await updateJob({total:Math.max(processed.size,job?.total||0),current:"读取订单 "+row.orderNo,completed:complete});
    try{
     const info=await scanDetails(work.id,row,platform,pageUrl);
     if(!info.found)failures.push("订单 "+row.orderNo+" 未找到可确认的运单号");
     found+=info.found;
    }catch(e){
     const reason=String(e.message||e);
     failures.push("订单 "+row.orderNo+"："+reason.slice(0,85));
     if(/验证|登录/.test(reason)){blocked=true;break;}
    }
    complete++;
    await updateJob({completed:complete,found:found,errors:failures.slice(-12),
      current:"完成 "+complete+" 笔订单，找到 "+found+" 个运单号"});
   }
   if(blocked||await isCancelled()||processed.size>=40)break;
   pageUrl=data.next&&eligible(data.next,platform)?data.next:"";
  }
  const cancelled=await isCancelled();
  await updateJob({state:cancelled?"stopped":blocked?"needs-attention":"done",
    completed:complete,found,errors:failures.slice(-12),current:cancelled?"用户停止批量抓取":
     blocked?"需要登录、验证或人工检查订单页面":"批量抓取结束",
    finishedAt:Date.now()});
 }catch(e){
  blocked=true;
  await updateJob({state:"needs-attention",current:"批量抓取中断",
   errors:[String(e.message||e).slice(0,250)],finishedAt:Date.now()});
 }finally{
  running=false;
  // Preserve tab when sign-in, verification or page inspection is needed.
  if(work?.id && !blocked){
   try{await chrome.tabs.remove(work.id);}catch(e){}
  }else if(work?.id){
   try{await chrome.tabs.update(work.id,{active:true});}catch(e){}
  }
 }
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
 if(msg?.type==="RURU_SCANNED"){
  (async()=>{
   const entries=Array.isArray(msg.orders)?msg.orders.slice(0,40):[];
   let saved=0,unchanged=0,failed=0;
   for(const row of entries)try{
    if(sender.url&&!row.sourceUrl)row.sourceUrl=sender.url;
    const r=await RuruStore.upsert(row,false);
    if(r.unchanged)unchanged++;else if(r.synced)saved++;else failed++;
   }catch(e){failed++;}
   respond({ok:true,found:entries.length,saved,unchanged,failed});
  })().catch(e=>respond({ok:false,error:String(e.message||e)}));
  return true;
 }
 if(msg?.type==="RURU_CRAWL_START"){
  (async()=>{
   if(running){respond({ok:false,error:"已有批量抓取正在运行"});return;}
   const p=msg.platform==="pdd"?"pdd":"taobao";
   const url=p==="taobao"?TAOBAO_ORDERS:String(msg.sourceUrl||"");
   if(!eligible(url,p)){respond({ok:false,error:"拼多多：请先打开已登录的订单列表页面再启动"});return;}
   running=true;
   respond({ok:true});
   void runJob(p,url);
  })().catch(e=>respond({ok:false,error:String(e.message||e)}));
  return true;
 }
 if(msg?.type==="RURU_CRAWL_STOP"){
  updateJob({cancelRequested:true,current:"正在停止，当前订单完成后退出…"}).then(()=>respond({ok:true}))
   .catch(e=>respond({ok:false,error:String(e.message||e)}));
  return true;
 }
 return false;
});
