/* User-initiated, read-only order discovery. Never click payment, receipts, refund. */
(()=>{
"use strict";
const ORDER=/(?:订单编号|订单号码|订单号|交易编号|交易单号|订单ID)\s*[:：#]?\s*([0-9A-Za-z_-]{10,42})/gi;
const TRACK=/(?:物流运单号|快递单号|物流单号|物流编号|运单号码|运单编号|运单号|包裹单号|快递编号)\s*[:：#]?\s*([0-9A-Za-z-]{8,48})/gi;
const COMPANY=/(?:快递公司|物流公司|承运商)\s*[:：]?\s*([\u3400-\u9fffA-Za-z0-9·-]{2,28})/i;
const PRODUCT=/item\.taobao\.com|detail\.tmall\.com|goods(?:\.html|_id|\/)|\/goods\/detail/i;
const platform=/pinduoduo\.com$|yangkeduo\.com$/.test(location.hostname)?"pdd":"taobao";
const isOrder=no=>/^[0-9A-Za-z_-]{10,42}$/.test(no||"");
const matches=(re,s)=>[...new Set([...s.matchAll(re)].map(x=>x[1]))];
const ids=s=>matches(ORDER,s);
const short=s=>String(s||"").replace(/\s+/g," ").trim();
const txt=el=>String(el?.innerText||"").slice(0,19000);
function url(href){
 try{
  const u=new URL(href,location.href);
  if(u.protocol!=="https:"|| !/(^|\.)((taobao|tmall|pinduoduo|yangkeduo)\.com)$/.test(u.hostname))return "";
  if(/\/(?:login|payment|pay|refund|return|cancel|delete|cart|confirm)(?:[\/.?_-]|$)/i.test(u.pathname))return "";
  u.hash="";return u.href.slice(0,900);
 }catch(e){return "";}
}
function nodeFor(el){
 let best=null;
 for(let d=0;el&&el!==document.body&&d<15;el=el.parentElement,d++){
  const s=txt(el);
  if(s.length>15000 || ids(s).length>1)break;
  if(ids(s).length===1)best=el;
 }
 return best;
}
function noFor(el){
 for(const k of ["data-order-id","data-orderid","data-trade-id"]){const v=el?.getAttribute?.(k);if(isOrder(v))return v;}
 const found=ids(txt(el));return found.length===1?found[0]:"";
}
function products(el){
 const arr=[],seen=new Set();
 for(const a of Array.from(el.querySelectorAll("a[href]")).slice(0,220)){
  if(!PRODUCT.test(a.href))continue;
  const name=short(a.innerText||a.title||a.querySelector("img")?.alt).slice(0,160);
  if(name.length<3||seen.has(name))continue;
  seen.add(name);arr.push({name,url:a.href.slice(0,400)});if(arr.length>=25)break;
 }
 if(!arr.length)for(const el2 of Array.from(el.querySelectorAll("[class*='goods-title'],[class*='item-title'],[class*='product-title'],[class*='goods-name']")).slice(0,60)){
  const name=short(el2.innerText).slice(0,160);
  if(name.length>=3&&!seen.has(name)){arr.push({name,url:""});seen.add(name);}
 }
 return arr.slice(0,25);
}
const READ_LOG=/^(?:查看物流|物流详情|物流信息|查看快递|查看物流详情|物流跟踪|物流轨迹)$/;
const READ_DETAIL=/^(?:订单详情|查看订单详情|交易详情|查看详情|订单明细)$/;
function kind(el){
 const label=short(el.innerText||el.textContent||el.title).replace(/\s+/g,"").slice(0,60);
 if(READ_LOG.test(label))return "logistics";
 if(READ_DETAIL.test(label))return "detail";
 const href=el.getAttribute("href")||"";
 if(/(?:^|[\/._-])(?:logistics?|express|tracking)(?:[\/.?_-]|$)/i.test(href))return "logistics";
 if(/(?:^|[\/._-])(?:orderdetail|trade_detail|order_detail)(?:[\/.?_-]|$)/i.test(href))return "detail";
 return "";
}
function links(el){
 const out={detail:[],logistics:[]};
 for(const a of Array.from(el.querySelectorAll("a[href]")).slice(0,300)){
  const k=kind(a),href=url(a.href);
  if(k&&href&&!out[k].includes(href))out[k].push(href);
 }
 out.detail=out.detail.slice(0,5);out.logistics=out.logistics.slice(0,5);
 return out;
}

function packageRows(root,candidates,orderNo){
 const body=txt(root),ns=matches(TRACK,body).filter(x=>x!==orderNo),cm=body.match(COMPANY);
 return ns.map(no=>{
  let productName=candidates.length===1?candidates[0].name:"";
  if(!productName && candidates.length>1){
   const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
   let node,count=0;
   while((node=walker.nextNode())&&++count<22000){
    if(!node.textContent?.includes(no))continue;
    for(let el=node.parentElement,d=0;el&&el!==root.parentElement&&d<7;el=el.parentElement,d++){
     const t=txt(el);
     if(t.length>5000)break;
     const names=candidates.filter(p=>t.includes(p.name));
     if(names.length===1 && matches(TRACK,t).filter(x=>x!==orderNo).length===1){
      productName=names[0].name;break;
     }
    }
    if(productName)break;
   }
  }
  return {no,company:cm?.[1]||"",productName};
 });
}
function record(el,no){
 const p=products(el),m=txt(el).match(COMPANY);
 return {orderNo:no,products:p,packages:packageRows(el,p,no),links:links(el)};
}
function discover(){
 const candidates=[],seen=new Set();
 const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 let n,i=0;
 while((n=walk.nextNode())&&++i<28000){
  const v=n.textContent||"";
  if(v.length>250||!/(订单|交易编号)/.test(v))continue;
  const el=nodeFor(n.parentElement);
  if(el&&!seen.has(el)){seen.add(el);candidates.push(el);}
  if(candidates.length>=120)break;
 }
 for(const el of Array.from(document.querySelectorAll("[data-order-id],[data-orderid],[data-trade-id]")).slice(0,100)){
  const scope=nodeFor(el)||el;if(!seen.has(scope)){seen.add(scope);candidates.push(scope);}
 }
 const rows=new Map();
 for(const el of candidates){
  const no=noFor(el);if(!isOrder(no))continue;
  const incoming=record(el,no),old=rows.get(no);
  if(!old){rows.set(no,incoming);continue;}
  const names=new Set(old.products.map(p=>p.name));
  for(const p of incoming.products)if(!names.has(p.name)){names.add(p.name);old.products.push(p);}
  const tracks=new Set(old.packages.map(p=>p.no));
  for(const pkg of incoming.packages)if(!tracks.has(pkg.no)){tracks.add(pkg.no);old.packages.push(pkg);}
  for(const k of ["detail","logistics"])for(const v of incoming.links[k])if(!old.links[k].includes(v))old.links[k].push(v);
 }
 let next="";
 for(const a of Array.from(document.querySelectorAll("a[href]")).slice(-300)){
  const label=short(a.innerText||a.textContent||a.title).replace(/\s+/g,"");
  if(/^(下一页|下页|后一页|下一页[>›»])$/.test(label) && !a.matches("[disabled],[aria-disabled=true],.disabled")){
   next=url(a.href);if(next)break;
  }
 }
 return {rows:[...rows.values()].slice(0,80),next,platform,current:location.href};
}
function extract(no,knownProducts=[]){
 if(!isOrder(no))return {ok:false,error:"无效的源订单号"};
 const body=txt(document.body),found=ids(body);
 let urlId="";
 try{for(const [k,v] of new URL(location.href).searchParams){if(/^(order_id|orderid|order_no|orderno|tradeid|trade_id)$/i.test(k)&&isOrder(v)){urlId=v;break;}}}catch(e){}
 if((urlId&&urlId!==no)||(found.length===1&&found[0]!==no)||found.length>1)
  return {ok:false,error:"页面的订单号与原订单不一致，已拒绝关联"};
 const p=products(document.body),candidates=p.length?p:Array.isArray(knownProducts)?knownProducts.slice(0,30):[];
 const packages=packageRows(document.body,candidates,no);
 return {ok:true,order:{platform,orderNo:no,products:p,packages,sourceUrl:location.href},links:links(document.body),found:packages.length,verification:/(滑块验证|请完成验证|验证码|安全验证|登录后查看)/.test(body.slice(0,1000))};
}
async function clickView(no,k,knownProducts=[]){
 const matcher=k==="logistics"?READ_LOG:READ_DETAIL,bodyIds=ids(txt(document.body));
 const candidates=Array.from(document.querySelectorAll("a,button,[role=button],[onclick]")).slice(0,2000);
 const found=candidates.find(el=>{
  if(!matcher.test(short(el.innerText||el.textContent||el.title).replace(/\s+/g,"")))return false;
  const scope=nodeFor(el);
  return (scope&&noFor(scope)===no) || (bodyIds.length===1&&bodyIds[0]===no);
 });
 if(!found)return {ok:false,error:"没有找到可安全点击的查看入口"};
 found.click();
 await new Promise(resolve=>setTimeout(resolve,1800));
 return {ok:true,result:extract(no,knownProducts),current:location.href};
}
chrome.runtime.onMessage.addListener((msg,sender,send)=>{
 if(!msg || !/^RURU_CRAWL_/.test(msg.type||""))return false;
 (async()=>{
  if(msg.type==="RURU_CRAWL_DISCOVER")return discover();
  if(msg.type==="RURU_CRAWL_EXTRACT")return extract(String(msg.orderNo||""),msg.products||[]);
  if(msg.type==="RURU_CRAWL_CLICK")return clickView(String(msg.orderNo||""),msg.kind==="logistics"?"logistics":"detail",msg.products||[]);
  return {ok:false,error:"未知请求"};
 })().then(send).catch(e=>send({ok:false,error:String(e.message||e)}));
 return true;
});
})();
