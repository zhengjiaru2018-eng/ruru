/* Minimal offline OOXML worksheet reader.
 * Supports stored/deflate ZIP members, shared strings, inline strings and <v>.
 * Does not execute formulas, fetch external resources, or upload user files. */
(()=> {
 "use strict";
 const td=new TextDecoder("utf-8");
 const readU16=(v,o)=>v.getUint16(o,true),readU32=(v,o)=>v.getUint32(o,true);
 function ensure(ok,msg){if(!ok)throw Error(msg);}
 function zipEntries(buffer){
   const bytes=new Uint8Array(buffer),v=new DataView(buffer),tail=Math.max(0,bytes.length-66000);
   let end=-1;
   for(let i=bytes.length-22;i>=tail;i--){if(readU32(v,i)===0x06054b50){end=i;break;}}
   ensure(end>=0,"不是有效的 XLSX/ZIP 文件");
   const total=readU16(v,end+10),cdOffset=readU32(v,end+16);
   ensure(total<=300 && cdOffset<bytes.length,"Excel 文件结构异常或包含过多子文件");
   const entries=new Map();let pos=cdOffset;
   for(let i=0;i<total;i++){
     ensure(pos+46<=bytes.length&&readU32(v,pos)===0x02014b50,"ZIP 目录损坏");
     const method=readU16(v,pos+10),packed=readU32(v,pos+20),plain=readU32(v,pos+24);
     const namelen=readU16(v,pos+28),extra=readU16(v,pos+30),comment=readU16(v,pos+32);
     const offset=readU32(v,pos+42);
     ensure(pos+46+namelen+extra+comment<=bytes.length,"ZIP 目录内容超界");
     const name=td.decode(bytes.subarray(pos+46,pos+46+namelen));
     ensure(plain<=15*1024*1024,"Excel 工作表文件过大");
     entries.set(name,{method,packed,plain,offset});
     pos+=46+namelen+extra+comment;
   }
   return {v,bytes,entries};
 }
 async function readPart(zip,path){
   const ent=zip.entries.get(path);if(!ent)return "";
   const {v,bytes}=zip,o=ent.offset;
   ensure(o+30<=bytes.length&&readU32(v,o)===0x04034b50,"ZIP 文件头异常");
   const start=o+30+readU16(v,o+26)+readU16(v,o+28);
   ensure(start+ent.packed<=bytes.length,"ZIP 数据长度异常");
   const compressed=bytes.subarray(start,start+ent.packed);
   let out;
   if(ent.method===0)out=compressed;
   else if(ent.method===8){
     ensure(typeof DecompressionStream!=="undefined","当前浏览器不支持 Excel ZIP 解压");
     const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
     const raw=await new Response(stream).arrayBuffer();
     ensure(raw.byteLength<=15*1024*1024,"Excel 解压结果过大");
     out=new Uint8Array(raw);
   }else throw Error("不支持的 ZIP 压缩格式："+ent.method);
   return td.decode(out);
 }
 function parseXml(s){
   const doc=new DOMParser().parseFromString(s,"application/xml");
   ensure(!doc.getElementsByTagName("parsererror").length,"Excel XML 内容有误");
   return doc;
 }
 function nodes(el,tag){return Array.from(el.getElementsByTagNameNS("*",tag));}
 function one(el,tag){return el.getElementsByTagNameNS("*",tag)[0]||null;}
 function joinedT(el){return nodes(el,"t").map(x=>x.textContent||"").join("");}
 function column(ref){const match=/^[A-Z]+/.exec(ref||"");if(!match)return -1;
   let n=0;for(const c of match[0])n=n*26+c.charCodeAt(0)-64;return n-1;
 }
 function extractTable(xml,strings){
   const doc=parseXml(xml),out=[];
   const rows=nodes(doc,"row").slice(0,5000);
   for(const row of rows){
     const values=[];
     for(const c of nodes(row,"c")){
       const i=column(c.getAttribute("r"));if(i<0||i>150)continue;
       const type=c.getAttribute("t"),v=one(c,"v")?.textContent||"";
       values[i]=type==="s"?strings[Number(v)]||"":type==="inlineStr"?joinedT(one(c,"is")||c):v;
     }
     out.push({row:Number(row.getAttribute("r"))||out.length+1,values});
   }
   return out;
 }
 function colFor(headers,patterns,defaultIndex){
   const i=headers.findIndex(h=>patterns.some(p=>p.test(h)));
   return i<0?defaultIndex:i;
 }
 function trim(x,n=300){return String(x==null?"":x).replace(/\s+/g," ").trim().slice(0,n);}
 async function parse(file){
   ensure(file&&file.size>0,"请选择一个 Excel 文件");
   ensure(file.size<=8*1024*1024,"文件超过 8 MB，无法在插件内解析");
   ensure(/\.xlsx$/i.test(file.name||""),"请选择 .xlsx 格式的淘宝订单表");
   const zip=zipEntries(await file.arrayBuffer());
   const candidates=[...zip.entries.keys()].filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p));
   ensure(candidates.length>0,"文件中没有 Excel 工作表");
   const shared=await readPart(zip,"xl/sharedStrings.xml");
   const strings=shared?nodes(parseXml(shared),"si").map(x=>joinedT(x)):[];
   const table=extractTable(await readPart(zip,candidates[0]),strings);
   ensure(table.length>1,"Excel 没有可导入的数据");
   const hdr=table.findIndex(r=>r.values.some(v=>/商品名称|商品标题|宝贝名称/i.test(trim(v))));
   ensure(hdr>=0,"无法找到「商品名称」列；需要淘宝导出的商品名称/物流公司/物流单号表格");
   const headers=table[hdr].values.map(v=>trim(v));
   const ni=colFor(headers,[/商品名称/,/商品标题/,/宝贝名称/],0);
   const ci=colFor(headers,[/物流公司/,/快递公司/,/承运商/],1);
   const ti=colFor(headers,[/物流单号/,/快递单号/,/运单号/],2);
   const rows=[];
   for(const r of table.slice(hdr+1)){
     const name=trim(r.values[ni],160),company=trim(r.values[ci],35);
     let tracking=trim(r.values[ti],48).replace(/\s/g,"");
     if(!name)continue;
     // Reject unsafe or malformed tracking but allow no-tracking items.
     const warning=!!tracking&&!/^[A-Za-z0-9-]{8,48}$/.test(tracking);
     if(warning)tracking="";
     rows.push({id:rows.length,sourceRow:r.row,name,company,tracking,warning});
     if(rows.length>=3000)break;
   }
   ensure(rows.length>0,"表格中没有找到可导入的商品");
   return {rows,headers,sheet:candidates[0],fileName:file.name};
 }
 globalThis.RuruXlsx={parse};
})();
