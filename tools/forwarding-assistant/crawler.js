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

// 拼多多：订单列表不一定公开订单号。通过卡片内的「查看物流」逐单获取。
// 只读取/点击当前账号可见的只读入口；不读取内部应用状态、Cookie 或私有接口。
function pddActions(){
 const out=[],seen=new Set(),walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 let n,steps=0;
 while((n=walk.nextNode())&&++steps<32000){
  if(short(n.textContent).replace(/\s+/g,"")!=="查看物流")continue;
  let el=n.parentElement;
  if(!el)continue;
  let target=el.closest("button,a,[role='button']");
  if(target && short(target.innerText||target.textContent).replace(/\s+/g,"")!=="查看物流")target=null;
  if(!target){
   target=el;
   for(let i=0;i<5&&target.parentElement;i++){
    const parent=target.parentElement;
    if(short(parent.innerText||parent.textContent).replace(/\s+/g,"")!=="查看物流")break;
    target=parent;
   }
  }
  if(seen.has(target)||!target.getClientRects().length)continue;
  const style=getComputedStyle(target);
  if(style.visibility==="hidden"||style.display==="none")continue;
  seen.add(target);out.push(target);
  if(out.length>=100)break;
 }
 return out;
}
function pddCard(target,actions){
 let el=target,best=target.parentElement||target;
 for(let i=0;el&&el!==document.body&&i<14;el=el.parentElement,i++){
  const s=txt(el);
  if(s.length>3400)break;
  if(actions.filter(a=>el.contains(a)).length>1)break;
  if(s.length>22 && (el.querySelector("img")||el.querySelector("a[href*='goods']")))best=el;
 }
 return best;
}
function pddProduct(card){
 const linked=products(card);
 if(linked.length)return linked.slice(0,8);
 const names=new Set(),candidates=[];
 const find=card.querySelectorAll("img[alt], [class*='goods'],[class*='title'],[class*='name'],[class*='desc'],[class*='product'],p");
 for(const el of Array.from(find).slice(0,160)){
  if(el.querySelectorAll && el.querySelectorAll("*").length>5)continue;
  const value=short(el.getAttribute?.("alt")||el.innerText||el.textContent).slice(0,160);
  if(value.length<9 || value.length>150 || names.has(value))continue;
  if(/查看物流|确认收货|申请退款|运费|支付|退款|领取|快递|店铺|已发货|待收货/.test(value))continue;
  if(/[¥￥]\s*\d/.test(value)||value.replace(/[^\u3400-\u9fff]/g,"").length<5)continue;
  names.add(value);candidates.push(value);
 }
 // 长标题通常是商品名称，短店铺名过滤。不能确定多个时留给人工核对。
 if(!candidates.length){
  const lines=String(card.innerText||"").split(/\n+/).map(x=>short(x).slice(0,160))
   .filter(x=>x.length>=9 && x.length<=150
    && !/查看物流|确认收货|申请退款|¥|￥|待收货|已发货|运费|物流|商家/.test(x)
    && x.replace(/[^\u3400-\u9fff]/g,"").length>=6);
  for(const line of lines)if(!names.has(line)){names.add(line);candidates.push(line);}
 }
 candidates.sort((a,b)=>b.length-a.length);
 return candidates.slice(0,3).map(name=>({name,url:""}));
}
function pddOrderNo(card){
 for(let el=card,i=0;el&&i<3;el=el.parentElement,i++){
  for(const k of ["data-order-sn","data-order-id","data-orderid","data-trade-id"]){
   const v=el.getAttribute?.(k);if(isOrder(v))return v;
  }
 }
 const a=ids(txt(card));return a.length===1?a[0]:"";
}
function pddHash(s){
 let h=2166136261;
 for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
 return (h>>>0).toString(36);
}
function pddRows(){
 const actions=pddActions();
 return actions.map((target,index)=>{
  const card=pddCard(target,actions),p=pddProduct(card),orderNo=pddOrderNo(card);
  const signature=short(txt(card)).slice(0,650);
  const fingerprint=pddHash([index,orderNo,p.map(x=>x.name).join("|"),signature].join("::"));
  return {index,fingerprint,orderNo,products:p,cardText:signature.slice(0,80)};
 });
}
function pddTracks(s){
 return [...new Set([...s.matchAll(TRACK)].map(m=>m[1]))].filter(n=>/^[0-9A-Za-z-]{8,48}$/.test(n));
}
function pddResult(root,prior,row){
 const all=txt(root);
 const dialogs=Array.from(document.querySelectorAll("[role=dialog],[aria-modal=true],[class*='modal'],[class*='Modal'],[class*='drawer'],[class*='Drawer'],[class*='popup'],[class*='Popup']")).filter(el=>{
  const t=txt(el);
  return t.length>12&&t.length<12000&&/物流|快递|运单|包裹/.test(t)&&el.getClientRects().length>0;
 });
 let scoped=dialogs.sort((a,b)=>txt(a).length-txt(b).length)[0];
 let source=txt(scoped||root);
 let nos=pddTracks(source).filter(n=>n!==row.orderNo);
 // In a popup the rest of the order list should not be associated with the clicked card.
 if(!scoped){
  const changed=pddTracks(all).filter(n=>!prior.has(n)&&n!==row.orderNo);
  if(changed.length>0&&changed.length<=10)nos=changed;
  else if(pddActions().length>1)nos=[]; // Multiple cards remain, so ambiguous.
 }
 nos=nos.slice(0,12);
 const nums=ids(source),realNo=isOrder(row.orderNo)?row.orderNo:nums.length===1?nums[0]:"";
 const carrier=source.match(COMPANY)?.[1]||"";
 const product=row.products||[];
 return {ok:true,orderNo:realNo,products:product,
  packages:nos.map(no=>({no,company:carrier,productName:product.length===1?product[0].name:""})),
  found:nos.length,needsReview:!realNo,modal:!!scoped,
  verification:/(滑块验证|请完成验证|验证码|安全验证|登录后查看)/.test(all.slice(0,1000))};
}
async function pddDiscover(){
 if(platform!=="pdd")return {ok:false,error:"这不是拼多多页面"};
 const original=window.scrollY||0;
 // Limited scrolling to allow lazy-loaded order cards, without bypassing pagination.
 for(let i=0;i<3;i++){
  window.scrollBy(0,Math.max(window.innerHeight,520));
  await new Promise(r=>setTimeout(r,430));
 }
 const rows=pddRows().slice(0,40);
 window.scrollTo(0,original);
 return {ok:true,rows,current:location.href,platform,found:rows.length};
}
async function pddOpen(msg){
 if(platform!=="pdd")return {ok:false,error:"非拼多多页面"};
 const index=Number(msg.index),expected=String(msg.fingerprint||"");
 const rows=pddRows(),row=rows[index];
 if(!row||row.fingerprint!==expected)return {ok:false,error:"订单列表顺序发生变化；为了避免串单，已跳过"};
 const target=pddActions()[index];
 if(!target)return {ok:false,error:"找不到对应的查看物流按钮"};
 const prior=new Set(pddTracks(txt(document.body)));
 target.scrollIntoView({block:"center",behavior:"instant"});
 await new Promise(r=>setTimeout(r,200));
 // Never click the adjacent 确认收货 / 退款 buttons.
 if(short(target.innerText||target.textContent).replace(/\s+/g,"")!=="查看物流")
  return {ok:false,error:"按钮文字不再是查看物流，已拒绝点击"};
 target.click();
 await new Promise(r=>setTimeout(r,1650));
 const result=pddResult(document.body,prior,row);
 return {ok:true,result,current:location.href,clicked:true};
}
function pddExtractDetail(msg){
 const row={orderNo:msg.orderNo||"",products:Array.isArray(msg.products)?msg.products.slice(0,15):[]};
 const page=txt(document.body);
 const idsOnPage=ids(page);
 if(idsOnPage.length>1)return {ok:false,error:"当前页面仍有多笔订单，无法唯一关联运单"};
 if(idsOnPage.length===1&&isOrder(row.orderNo)&&idsOnPage[0]!==row.orderNo)
  return {ok:false,error:"订单号不一致"};
 if(!row.products.length && !isOrder(row.orderNo))
  return {ok:false,error:"无法将新页面可靠关联到原始商品"};
 const outcome=pddResult(document.body,new Set(),row);
 if(pddActions().length>1&&!outcome.modal)return {ok:false,error:"仍是订单列表，无法确认单号对应关系"};
 return outcome;
}
chrome.runtime.onMessage.addListener((msg,sender,send)=>{
 if(!msg || !/^(RURU_CRAWL_|RURU_PDD_)/.test(msg.type||""))return false;
 (async()=>{
  if(msg.type==="RURU_PDD_DISCOVER")return pddDiscover();
   if(msg.type==="RURU_PDD_OPEN")return pddOpen(msg);
   if(msg.type==="RURU_PDD_EXTRACT")return pddExtractDetail(msg);
   if(msg.type==="RURU_CRAWL_DISCOVER")return discover();
  if(msg.type==="RURU_CRAWL_EXTRACT")return extract(String(msg.orderNo||""),msg.products||[]);
  if(msg.type==="RURU_CRAWL_CLICK")return clickView(String(msg.orderNo||""),msg.kind==="logistics"?"logistics":"detail",msg.products||[]);
  return {ok:false,error:"未知请求"};
 })().then(send).catch(e=>send({ok:false,error:String(e.message||e)}));
 return true;
});
})();
