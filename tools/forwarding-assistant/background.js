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

function numberCount(response){
 if(!response?.ok)return 0;
 return (response.order?.packages||response.packages||[]).length;
}
async function readFromAllFrames(tabId,p,type,payload={}){
 let frames=[];
 try{frames=await chrome.webNavigation.getAllFrames({tabId})||[];}catch(e){}
 if(!frames.length)frames=[{frameId:0,url:(await chrome.tabs.get(tabId)).url||""}];
 // The logistics page might be an iframe, even if its parent contains other orders.
 const eligibleFrames=frames.filter(f=>eligible(f.url,p)||f.url==="about:blank")
   .sort((a,b)=>(a.frameId===0?1:0)-(b.frameId===0?1:0)).slice(0,22);
 let best=null;
 for(const frame of eligibleFrames){
  try{
   const res=await chrome.tabs.sendMessage(tabId,Object.assign({type},payload),{frameId:frame.frameId});
   if(!res)continue;
   if(numberCount(res)>numberCount(best))best=res;
   else if(!best && res.ok)best=res;
  }catch(e){/* frames without injected scripts are not read */}
 }
 return best||{ok:false,error:"物流页面可能尚未加载，或所在 iframe 不属于支持的购物平台"};
}
async function readNewShippingTabs(workerId,priorIds,p,type,payload){
 for(let attempt=0;attempt<5;attempt++){
  const all=await chrome.tabs.query({});
  const created=all.filter(t=>!priorIds.has(t.id)&&t.openerTabId===workerId);
  for(const tab of created){
   if(!eligible(tab.url||"",p))continue;
   try{
    await tabReady(tab.id);
    const result=await readFromAllFrames(tab.id,p,type,payload);
    if(numberCount(result)){
     try{await chrome.tabs.remove(tab.id);}catch(e){}
     return result;
    }
   }catch(e){}
  }
  await pause(500);
 }
 return null;
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
  details=await readFromAllFrames(id,p,"RURU_CRAWL_EXTRACT",{orderNo:no,products:row.products||[]});
  if(details?.verification)throw Error("需要完成账号验证");
  if(details?.ok){await saveOrder(details.order,p);found+=details.found||0;}
  else if(details?.error)throw Error(details.error);
  // If we visited order details, follow its read-only logistics link.
  const logistics=(details?.links?.logistics||[]).find(u=>eligible(u,p)&&u!==target);
  if(!found && logistics){
   await visit(id,logistics,p);
   const again=await readFromAllFrames(id,p,"RURU_CRAWL_EXTRACT",{orderNo:no,products:row.products||[]});
   if(again?.verification)throw Error("需要完成账号验证");
   if(again?.ok){await saveOrder(again.order,p);found+=again.found||0;}
  }
 }
 if(!found){
  // Fallback for SPA sites that use a button without a normal URL.
  await visit(id,listUrl,p);
  const priorTabs=new Set((await chrome.tabs.query({})).map(t=>t.id));
  const clicked=await message(id,"RURU_CRAWL_CLICK",{orderNo:no,kind:"logistics",products:row.products||[]}).catch(()=>null);
  if(clicked?.ok){
   attempted=true;
   if(clicked.result?.ok){await saveOrder(clicked.result.order,p);found+=clicked.result.found||0;}
   if(!found){
    await pause(900);
    const fromFrames=await readFromAllFrames(id,p,"RURU_CRAWL_EXTRACT",{orderNo:no,products:row.products||[]});
    if(fromFrames?.ok){await saveOrder(fromFrames.order,p);found+=fromFrames.found||0;}
   }
   if(!found){
    const fromNew=await readNewShippingTabs(id,priorTabs,p,"RURU_CRAWL_EXTRACT",{orderNo:no,products:row.products||[]});
    if(fromNew?.ok){await saveOrder(fromNew.order,p);found+=fromNew.found||0;}
   }
  }else if(!target){
   const detail=await message(id,"RURU_CRAWL_CLICK",{orderNo:no,kind:"detail",products:row.products||[]}).catch(()=>null);
   if(detail?.ok){
    attempted=true;
    if(detail.result?.ok){await saveOrder(detail.result.order,p);found+=detail.result.found||0;}
    const link=(detail.result?.links?.logistics||[]).find(u=>eligible(u,p));
    if(!found&&link){
     await visit(id,link,p);
     const again=await readFromAllFrames(id,p,"RURU_CRAWL_EXTRACT",{orderNo:no,products:row.products||[]});
     if(again?.ok){await saveOrder(again.order,p);found+=again.found||0;}
    }
   }
  }
 }
 return {found,attempted};
}

function shipmentFingerprint(pkgs){
 const str=pkgs.map(p=>p.no.toUpperCase()).sort().join("|");
 let hash=2166136261;
 for(const c of str){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 // Deliberately NOT a real order number; the UI marks it as pending verification.
 return "PDD-PENDING-"+(hash>>>0).toString(36).toUpperCase();
}
async function savePddResult(result,sourceUrl){
 if(!result?.ok||!Array.isArray(result.packages)||!result.packages.length)return {saved:false,reason:"物流页面没有可确认的运单号"};
 const packages=result.packages.filter(p=>/^[0-9A-Za-z-]{8,48}$/.test(p.no||"")).slice(0,20);
 if(!packages.length)return {saved:false,reason:"运单号格式无法确认"};
 const verified=/^[0-9A-Za-z_-]{10,42}$/.test(result.orderNo||"");
 const orderNo=verified?result.orderNo:shipmentFingerprint(packages);
 const record={platform:"pdd",orderNo,provisional:!verified,
  products:Array.isArray(result.products)?result.products.slice(0,20):[],
  packages,sourceUrl};
 const saved=await RuruStore.upsert(record,false);
 return {saved:saved.synced||saved.unchanged,localOnly:!saved.synced,
  count:packages.length,provisional:!verified};
}
async function runPddJob(startUrl){
 let work=null,blocked=false,done=0,found=0,failed=[];
 running=true;
 try{
  await updateJob({state:"running",platform:"pdd",completed:0,found:0,total:0,page:1,
   current:"分析拼多多商品卡片中的查看物流入口",errors:[],cancelRequested:false,startedAt:Date.now()});
  work=await chrome.tabs.create({url:startUrl,active:false});
  await updateJob({workerTabId:work.id});
  await tabReady(work.id);
  const data=await message(work.id,"RURU_PDD_DISCOVER");
  if(!data.ok||!data.rows?.length){
   blocked=true;
   throw Error("没有识别到拼多多「查看物流」商品卡片。请确认当前打开的是已购买订单列表，而非购物车，并检查是否需要登录。");
  }
  const queue=data.rows.slice(0,40);
  await updateJob({total:queue.length,current:"识别到 "+queue.length+" 个带查看物流的商品卡片"});
  for(const row of queue){
   if(await isCancelled())break;
   await updateJob({current:"逐单查看 "+(row.products?.[0]?.name||"商品").slice(0,44),
    completed:done,found:found});
   try{
    await visit(work.id,startUrl,"pdd");
    const refreshed=await message(work.id,"RURU_PDD_DISCOVER");
    const current=refreshed?.rows?.find(x=>x.fingerprint===row.fingerprint);
    if(!current)throw Error("网页卡片顺序变化，已跳过以避免配错运单");
    const beforeUrl=(await chrome.tabs.get(work.id)).url;
    const beforeTabs=new Set((await chrome.tabs.query({})).map(t=>t.id));
    let clicked=null;
    try{
     clicked=await message(work.id,"RURU_PDD_OPEN",{index:current.index,fingerprint:current.fingerprint});
    }catch(e){
     // SPA full navigation can close the content script port; inspect only the newly opened read-only page.
    }
    let result=clicked?.result||null;
    const actual=await chrome.tabs.get(work.id);
    if(!eligible(actual.url||"","pdd"))throw Error("购物平台跳转到其他域名或登录验证，请手动处理");
    if(!numberCount(result)){
     const extracted=await readFromAllFrames(work.id,"pdd","RURU_PDD_EXTRACT",{
      orderNo:current.orderNo||"",products:current.products||[]});
     if(numberCount(extracted))result=extracted;
    }
    if(!numberCount(result)){
     const other=await readNewShippingTabs(work.id,beforeTabs,"pdd","RURU_PDD_EXTRACT",{
      orderNo:current.orderNo||"",products:current.products||[]});
     if(numberCount(other))result=other;
    }
    if(result?.verification){blocked=true;throw Error("拼多多要求登录/安全验证");}
    const outcome=await savePddResult(result,startUrl);
    if(outcome.saved){found+=outcome.count;if(outcome.localOnly)failed.push("Chrome 同步失败，已保留本地记录");}
    else failed.push("商品 "+(current.products?.[0]?.name||"未知").slice(0,24)+"："+outcome.reason+
     (result?.diagnosis?"（"+result.diagnosis+"）":""));
   }catch(e){
    const messageText=String(e.message||e);
    failed.push("商品 "+(row.products?.[0]?.name||"未知").slice(0,20)+"："+messageText.slice(0,100));
    if(/验证|登录|其他域名/.test(messageText)){blocked=true;break;}
   }
   done++;
   await updateJob({completed:done,found:found,errors:failed.slice(-15),
    current:"已查看 "+done+" 个商品卡片，保存 "+found+" 个运单号"});
   await pause(550);
  }
  const cancelled=await isCancelled();
  await updateJob({state:cancelled?"stopped":blocked?"needs-attention":"done",
   completed:done,found:found,errors:failed.slice(-15),
   current:cancelled?"用户已停止":blocked?"需要手动登录/验证":"拼多多当前加载的商品卡片抓取结束",
   finishedAt:Date.now()});
 }catch(e){
  blocked=true;
  await updateJob({state:"needs-attention",current:"拼多多抓取停止",
   errors:[...failed,String(e.message||e)].slice(-15),completed:done,found,finishedAt:Date.now()});
 }finally{
  running=false;
  if(work?.id){
   try{if(blocked)await chrome.tabs.update(work.id,{active:true});else await chrome.tabs.remove(work.id);}catch(e){}
  }
 }
}
async function runJob(platform,startUrl){
 if(platform==="pdd")return runPddJob(startUrl);
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
