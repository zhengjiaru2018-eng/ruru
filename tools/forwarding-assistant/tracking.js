/* Shared, conservative shipping-number recognition. No site private APIs.
 * Read only displayed text; NEVER infer order number from tracking number. */
(()=>{
 "use strict";
 const valid=v=>/^[A-Za-z0-9][A-Za-z0-9-]{7,47}$/.test(v||"")&&((v||"").match(/\d/g)||[]).length>=8;
 const LABEL=/(?:快递单号|物流单号|物流运单号|运单号|运单编号|运单号码|包裹单号|快递编号|物流编号|快件单号|快递运单号|tracking(?:\s*(?:number|no\.?))?)\s*(?:[:：#]|复制|点击复制|\s){0,12}\s*([A-Z0-9][A-Z0-9-]{7,47})/gi;
 const LBL_LINE=/(?:快递单号|物流单号|物流运单号|运单号|运单编号|运单号码|包裹单号|快递编号|物流编号|快件单号|tracking(?:\s*(?:number|no))?)/i;
 const CODE=/(?<![A-Za-z0-9])(?:[A-Za-z]{1,5}[-]?)?\d{10,28}[A-Za-z0-9-]*(?![A-Za-z0-9])/g;
 const ORDER=/订单(?:编号|号|号码|ID)|交易(?:编号|号)|退款单号|退货单号|取件码|手机号码|手机号|联系电话|付款单号/i;
 const shipping=/物流|快递|承运|包裹|运输|运单|shipping|tracking/i;
 function clean(v){return String(v||"").trim().replace(/[\s，。,;；:：#]+$/,"");}
 function extract(input,{allowFallback=false}={}){
  const s=String(input||"").slice(0,100000);
  const result=[],seen=new Set();
  function add(raw,reason){
   const no=clean(raw);
   if(!valid(no)||seen.has(no.toUpperCase()))return;
   seen.add(no.toUpperCase());result.push({no,reason});
  }
  LABEL.lastIndex=0;
  for(const m of s.matchAll(LABEL))add(m[1],"label");
  // Some logistics popups render only "单号：" without the word "快递".
  if(shipping.test(s)){
   const general=/(?:^|[\r\n])\s*单号\s*[:：]\s*([A-Z0-9][A-Z0-9-]{7,47})/gim;
   for(const m of s.matchAll(general))add(m[1],"generic-logistics-label");
  }
  // Many pages render label and value in separate elements/lines.
  const lines=s.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
   if(!LBL_LINE.test(lines[i]) || ORDER.test(lines[i]))continue;
   for(let j=i+1;j<Math.min(i+4,lines.length);j++){
    const next=lines[j];
    if(ORDER.test(next)||LBL_LINE.test(next))break;
    const values=[...next.matchAll(CODE)].map(m=>m[0]);
    if(values.length===1){add(values[0],"adjacent-label");break;}
    if(next.length>100)break;
   }
  }
  if(!result.length && allowFallback && shipping.test(s)){
   const found=[];
   for(let i=0;i<lines.length;i++){
    if(ORDER.test(lines[i])||ORDER.test(lines[i-1]||""))continue;
    const context=[lines[i-1]||"",lines[i],lines[i+1]||""].join(" ");
    if(!/(复制|物流单号|快递单号|运单号|快递公司|物流公司|快递信息)/i.test(context))continue;
    for(const m of lines[i].matchAll(CODE)){
     const value=m[0];
     if(/^\d{11}$/.test(value))continue; // Avoid mobile phone numbers.
     found.push(value);
    }
   }
   // Unlabeled inference is permitted only for exactly one distinct candidate
   // in a logistics-only view, never across a full multi-order page.
   const uniq=[...new Set(found.map(clean))].filter(valid);
   if(uniq.length===1)add(uniq[0],"single-candidate");
  }
  return result.slice(0,25);
 }
 globalThis.RuruTracking={extract};
})();
