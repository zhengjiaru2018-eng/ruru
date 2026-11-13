/* Read only what the signed-in user can already see on order/logistics pages.
   No private endpoints, cookie access, or captcha automation. */
(function () {
  "use strict";
  const platform=/(^|\.)pinduoduo\.com$|(^|\.)yangkeduo\.com$/.test(location.hostname)?"pdd":"taobao";
  const ORDER_RE=/(?:订单编号|订单号码|订单号|交易编号|交易单号|订单ID|订单 id)\s*[:：#]?\s*([0-9A-Za-z_-]{10,42})/gi;
  const TRACK_RE=/(?:物流运单号|快递单号|物流单号|运单号码|运单编号|运单号|包裹单号|快递编号)\s*[:：#]?\s*([0-9A-Za-z-]{8,48})/gi;
  const COMPANY_RE=/(?:快递公司|物流公司|承运商)\s*[:：]?\s*([\u3400-\u9fffA-Za-z0-9·-]{2,28})/i;
  const PRODUCT_LINK=/item\.taobao\.com|detail\.tmall\.com|goods(?:\.html|_id|\/)|mobile\.yangkeduo\.com\/goods|\/goods\/detail/i;
  const EXCLUDE=/查看|详情|物流|快递|退货|退款|售后|订单|评价|支付|客服|店铺|删除|确认|收货|复制|更多|全部|优惠|运费/;
  const MAX_SCAN_NODES=18000;
  function text(el) { return String(el && el.innerText || "").slice(0,14000); }
  function takeAll(regex,s) {
    const out=[], seen=new Set(); regex.lastIndex=0;
    for(const m of s.matchAll(regex)) {
      const v=m[1]; if(seen.has(v))continue;
      seen.add(v);out.push(v);
      if(out.length>=40) break;
    }
    return out;
  }
  function orderIds(s){return takeAll(ORDER_RE,s);}
  function trackNos(s){return takeAll(TRACK_RE,s);}
  function orderIdFromUrl(){
    try{
      const u=new URL(location.href);
      for (const [key,val] of u.searchParams) {
        if (/^(order_id|orderid|order_no|orderno|tradeid|trade_id)$/i.test(key) && /^[0-9A-Za-z_-]{10,42}$/.test(val)) return val;
      }
    }catch(e){}
    return "";
  }
  function extractProducts(root){
    const products=[],seen=new Set();
    function add(name,url){
      name=String(name||"").replace(/\s+/g," ").trim().slice(0,160);
      if(name.length<3 || EXCLUDE.test(name) || seen.has(name))return;
      seen.add(name);products.push({name:name,url:String(url||"").slice(0,400)});
    }
    const links=Array.from(root.querySelectorAll("a[href]")).slice(0,180);
    for(const a of links){
      if(PRODUCT_LINK.test(a.href || "")){
        add(a.innerText || a.querySelector("img")?.alt || a.title,a.href);
      }
      if(products.length>=25)break;
    }
    if(!products.length){
      const els=Array.from(root.querySelectorAll("[class*='item-title'],[class*='goods-title'],[class*='product-title'],[class*='goods-name'],[class*='itemName'],[class*='goodsName']")).slice(0,70);
      for(const el of els) {add(el.innerText || el.title,"");if(products.length>=20)break;}
    }
    return products;
  }
  function findScope(start){
    let n=start, best=null, depth=0;
    while(n && n!==document.documentElement && depth++<12){
      if(n.nodeType!==1){n=n.parentElement;continue;}
      const s=text(n); if(s.length>14000)break;
      const ids=orderIds(s);
      if(ids.length>1)break; // A page containing multiple orders is NOT one shipment.
      if(ids.length===1 && s.length<12500) best=n;
      n=n.parentElement;
    }
    return best;
  }
  function gatherRoots(){
    const found=[], seen=new Set();
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n,visited=0;
    while((n=walker.nextNode()) && visited++<MAX_SCAN_NODES){
      const s=(n.textContent||"").trim();
      if(s.length>280 || !/(订单|交易编号|物流|运单)/.test(s))continue;
      const candidate=findScope(n.parentElement);
      if(candidate && !seen.has(candidate)){seen.add(candidate);found.push(candidate);}
      if(found.length>=90)break;
    }
    // Some order IDs are HTML attributes instead of visible labels.
    for(const el of Array.from(document.querySelectorAll("[data-order-id],[data-orderid]")).slice(0,60)){
      if(!seen.has(el)){seen.add(el);found.push(el);}
    }
    return found;
  }
  function parseRoot(root,fallbackId){
    const s=text(root);
    const ids=orderIds(s);
    const attr=root.getAttribute?.("data-order-id") || root.getAttribute?.("data-orderid") || "";
    const no=ids.length===1?ids[0]:ids.length===0 && /^[0-9A-Za-z_-]{10,42}$/.test(attr)?attr:ids.length===0?fallbackId:"";
    if(!no || ids.length>1) return null;
    const products=extractProducts(root);
    const tracks=trackNos(s).filter(x=>x!==no);
    const companyMatch=s.match(COMPANY_RE);
    const company=companyMatch?companyMatch[1]:"";
    return {platform:platform,orderNo:no,products:products,
      packages:tracks.map(x=>({no:x,company:company,productName:products.length===1?products[0].name:""})),
      sourceUrl:location.href};
  }
  function collect(){
    if(!document.body)return [];
    const out=new Map(), roots=gatherRoots(), fallback=orderIdFromUrl();
    for(const root of roots){
      const parsed=parseRoot(root,"");
      if(!parsed)continue;
      const existing=out.get(parsed.orderNo);
      if(!existing){out.set(parsed.orderNo,parsed);continue;}
      const pNames=new Set(existing.products.map(x=>x.name));
      for(const p of parsed.products)if(!pNames.has(p.name)){existing.products.push(p);pNames.add(p.name);}
      const tracks=new Set(existing.packages.map(x=>x.no));
      for(const p of parsed.packages)if(!tracks.has(p.no)){existing.packages.push(p);tracks.add(p.no);}
    }
    if(!out.size && fallback) {
      const parsed=parseRoot(document.body,fallback);
      if(parsed)out.set(parsed.orderNo,parsed);
    }
    return Array.from(out.values()).slice(0,40);
  }
  function isOrderContext(){
    const clue=(location.href+" "+document.title).toLowerCase();
    return /(order|trade|logistic|express|package|买到的宝贝|订单|查看物流|我的拼单|物流详情)/.test(clue);
  }
  let scanning=false,last=0,timer=0;
  async function scan(force){
    if(scanning)return {ok:false,error:"正在识别，请稍后再试"};
    if(!force && !isOrderContext())return {ok:true,found:0,saved:0,skipped:true};
    if(!force && Date.now()-last<8000)return {ok:true,found:0,saved:0,skipped:true};
    scanning=true; last=Date.now();
    try{
      const orders=collect();
      if(!orders.length)return {ok:true,found:0,saved:0,tip:"没有找到可确认的订单号；请打开订单详情或手动新增"};
      return await chrome.runtime.sendMessage({type:"RURU_SCANNED",orders:orders});
    }catch(e){return {ok:false,error:String(e.message||e)};}
    finally{scanning=false;}
  }
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(msg?.type!=="RURU_SCAN_NOW")return false;
    scan(true).then(respond).catch(e=>respond({ok:false,error:String(e.message||e)}));
    return true;
  });
  const observer=new MutationObserver(()=>{
    if(!isOrderContext())return;
    clearTimeout(timer);
    timer=setTimeout(()=>scan(false),2400);
  });
  function start(){
    if(!document.body)return;
    observer.observe(document.body,{subtree:true,childList:true,characterData:false});
    setTimeout(()=>scan(false),1700);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
