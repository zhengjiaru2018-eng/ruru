/* Popup & dashboard: deliberately no external network, templates escape page data. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const isPopup=document.body.classList.contains("popup");
  let orders=[],refreshing=false,refreshQueued=false;
  function safe(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function date(v){return v?new Date(v).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"}):"";}
  function setNotice(msg,warn){const n=$("notice");n.textContent=msg||"";n.classList.toggle("warn",!!warn);}
  function getState(r){
    if(!r.packages.length)return r.transferred?"done":"noTracking";
    const count=r.packages.filter(p=>p.transferred).length;
    if(count===r.packages.length)return "done";
    return "pending";
  }
  function countStats(){
    let pending=0,done=0;
    for(const r of orders) {
      for(const p of r.packages){if(p.transferred)done++;else pending++;}
    }
    $("stats").innerHTML="<div><b>"+orders.length+"</b><small>总订单</small></div>"+
      "<div><b>"+pending+"</b><small>待转运包裹</small></div>"+
      "<div><b>"+done+"</b><small>已转运包裹</small></div>";
  }
  function render(){
    const q=$("search").value.trim().toLowerCase(),filter=$("filter").value,platform=$("platform").value;
    let rows=orders.filter(r=>(platform==="all"||platform===r.platform) &&
      (filter==="all"||getState(r)===filter||(filter==="pending" && getState(r)==="noTracking")) &&
      (!q || [r.orderNo,r.note,...r.products.map(p=>p.name),...r.packages.map(p=>p.no),...r.packages.map(p=>p.company)].join(" ").toLowerCase().includes(q)));
    const total=rows.length;
    if(isPopup)rows=rows.slice(0,15);
    if(!rows.length){$("list").innerHTML='<div class="empty">还没有匹配的订单。打开订单或物流详情页后点击「抓取当前页面」，也可以手动新增。</div>';return;}
    $("list").innerHTML=rows.map(r=>{
      const status=getState(r),hasMany=r.products.length>1&&r.packages.length>1;
      const packageHtml=r.packages.length?r.packages.map(p=>{
        const options=['<option value="">— 选择对应商品 —</option>'].concat(r.products.map(g=>
          '<option value="'+safe(g.name)+'" '+(p.productName===g.name?'selected':'')+'>'+safe(g.name)+'</option>')).join("");
        return '<div class="parcel"><div class="parcel-top"><div><div class="tracking">'+safe(p.no)+'</div>'+
          '<div class="carrier">'+safe(p.company || "未识别快递公司")+'</div></div>'+
          '<span class="status '+(p.transferred?"done":"")+'">'+(p.transferred?"✓ 已转运":"○ 待转运")+'</span></div>'+
          '<div class="parcel-actions">'+
          '<button class="primary" data-action="copy" data-no="'+safe(p.no)+'">复制运单号</button>'+
          '<button class="secondary '+(p.transferred?"done":"")+'" data-action="mark" data-key="'+safe(r.key)+'" data-no="'+safe(p.no)+'" data-next="'+(!p.transferred)+'">'+(p.transferred?"撤销已转运":"✓ 标记已转运")+'</button></div>'+
          (r.products.length?'<label class="link-product">关联商品 <select data-link="'+safe(r.key)+'" data-no="'+safe(p.no)+'">'+options+'</select></label>':'')+
          '</div>';
      }).join(""):'<div class="no-track">尚未识别到物流单号；可以打开物流详情页重新抓取，或手动补录。</div>';
      const note=r.note?'<div class="note">备注：'+safe(r.note)+'</div>':"";
      return '<article class="order-card"><div class="order-head"><div><div class="order-id"><span class="pill '+(r.platform==="pdd"?"pdd":"")+'">'+
        (r.platform==="pdd"?"拼多多":"淘宝/天猫")+'</span> '+safe(r.orderNo)+'</div>'+
        '<div class="date">更新 '+safe(date(r.updatedAt))+(r.syncPending?' · 仅本机，待同步':'')+'</div></div>'+
        '<span class="status '+(status==="done"?"done":"")+'">'+(status==="done"?"✓ 已完成":status==="noTracking"?"待补运单":"进行中")+'</span></div>'+
        '<div class="products">'+(r.products.length?r.products.map(p=>'<span class="product" title="'+safe(p.name)+'">'+safe(p.name)+'</span>').join(""):'<span class="muted">尚未识别商品名称</span>')+'</div>'+
        (hasMany?'<div class="note">多商品多包裹：请确认每个运单对应的商品，不自动猜测。</div>':"")+
        packageHtml+note+
        '<div class="card-actions"><button class="text-btn" data-action="copy" data-no="'+safe(r.orderNo)+'">复制订单号</button>'+
        (!r.packages.length?'<button class="text-btn" data-action="mark" data-key="'+safe(r.key)+'" data-no="" data-next="'+(!r.transferred)+'">'+(r.transferred?"撤销整单标记":"标记整单已转运")+'</button>':'')+
        '<button class="text-btn" data-action="note" data-key="'+safe(r.key)+'">编辑备注</button>'+
        '<button class="text-btn" data-action="remove" data-key="'+safe(r.key)+'">删除</button></div></article>';
    }).join("")+(isPopup&&total>rows.length?'<div class="empty">另外 '+(total-rows.length)+' 条记录请在「管理全部」中查看。</div>':"");
  }
  async function load(){
    if(refreshing){refreshQueued=true;return;}
    refreshing=true;
    try{
      orders=await RuruStore.list(); countStats();render();
      const info=await RuruStore.syncInfo();
      $("syncState").textContent="Chrome 同步存储 "+(info.bytes/1024).toFixed(1)+"/100 KB"+
        (info.pending?" ｜ "+info.pending+" 条待同步":" ｜ 本地记录已提交");
      if(info.pending)setNotice("有 "+info.pending+" 条仅保存在本机，跨电脑可能尚未同步。"+(info.error?" 原因："+info.error:""),true);
    }catch(e){setNotice("读取数据失败："+String(e.message||e),true);}
    finally {refreshing=false;if(refreshQueued){refreshQueued=false;setTimeout(load,120);}}
  }
  async function copyText(v){
    try{await navigator.clipboard.writeText(v);}
    catch(e){
      const ta=document.createElement("textarea");
      ta.value=v;ta.style.position="fixed";ta.style.left="-9999px";document.body.appendChild(ta);
      ta.select();const ok=document.execCommand("copy");ta.remove();
      if(!ok)throw Error("浏览器拒绝访问剪贴板");
    }
    setNotice("已复制："+v);
  }
  async function scan(){
    const b=$("scan");b.disabled=true;setNotice("正在读取当前页面…");
    try{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      const tab=tabs[0];
      if(!tab || !/^https:\/\/([^/]*\.)?(taobao\.com|tmall\.com|pinduoduo\.com|yangkeduo\.com)\//.test(tab.url||""))
        throw Error("请先切换到淘宝、天猫或拼多多的订单/物流页面");
      const response=await chrome.tabs.sendMessage(tab.id,{type:"RURU_SCAN_NOW"});
      if(!response?.ok)throw Error(response?.error||"网页暂未加载识别脚本，尝试刷新网页");
      setNotice("识别到 "+response.found+" 笔订单；新保存或更新 "+response.saved+" 笔。"+
        (response.failed?" 同步失败 "+response.failed+" 笔，请检查下方状态。":"")+
        (response.tip?" "+response.tip:""),!!response.failed);
      await load();
    }catch(e){setNotice(String(e.message||e)+"；如刚安装插件请刷新购物网站页面。",true);}
    finally{b.disabled=false;}
  }
  function download(filename,content,mime){
    const url=URL.createObjectURL(new Blob([content],{type:mime}));
    const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  function csvCell(v){
    let s=String(v==null?"":v);
    if(/^[\s]*[=+@-]/.test(s))s="'"+s; // Prevent spreadsheet formula execution.
    return '"'+s.replace(/"/g,'""')+'"';
  }
  function exportJson(){
    download("ruru-forwarding-"+new Date().toISOString().slice(0,10)+".json",
      JSON.stringify({app:"ruru-forwarding",version:1,exportedAt:new Date().toISOString(),orders:orders},null,2),
      "application/json;charset=utf-8");
    setNotice("已导出 JSON 完整备份");
  }
  function exportCsv(){
    const rows=[["平台","订单号","商品名称","物流公司","物流单号","关联商品","是否已转运","转运时间","备注","最后更新"]];
    for(const r of orders){
      const name=r.products.map(p=>p.name).join(" / ");
      if(!r.packages.length)rows.push([RuruStore.PLATFORM[r.platform],r.orderNo,name,"","","",r.transferred?"是":"否",date(r.transferredAt),r.note,date(r.updatedAt)]);
      for(const p of r.packages)rows.push([RuruStore.PLATFORM[r.platform],r.orderNo,name,p.company,p.no,p.productName,p.transferred?"是":"否",date(p.transferredAt),r.note,date(r.updatedAt)]);
    }
    const csv="\ufeff"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
    download("ruru-forwarding-"+new Date().toISOString().slice(0,10)+".csv",csv,"text/csv;charset=utf-8");
    setNotice("已导出 "+orders.length+" 笔订单的 CSV 表格");
  }
  async function importFile(file){
    if(!file)return;
    if(file.size>5*1024*1024)throw Error("文件过大，请使用不超过 5 MB 的 JSON 备份");
    const raw=JSON.parse(await file.text()), rows=Array.isArray(raw)?raw:raw.orders;
    if(!Array.isArray(rows) || rows.length>3000)throw Error("不是有效的订单备份，或超过单次 3000 条");
    let ok=0,fail=0;
    for(const row of rows){try{await RuruStore.upsert(RuruStore.normalize(row),true);ok++;}catch(e){fail++;}}
    await load();setNotice("导入完成："+ok+" 笔，失败 "+fail+" 笔。请检查同步状态。",!!fail);
  }
  $("search").addEventListener("input",render);
  $("filter").addEventListener("change",render);
  $("platform").addEventListener("change",render);
  $("scan").addEventListener("click",scan);
  $("openDash")?.addEventListener("click",()=>chrome.runtime.openOptionsPage());
  $("newOrder").addEventListener("click",()=>$("orderDialog").showModal());
  $("cancelOrder").addEventListener("click",()=>$("orderDialog").close());
  $("orderForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const form=e.currentTarget, fields=form.elements;
    try{
      const platform=fields.namedItem("platform").value,orderNo=fields.namedItem("orderNo").value.trim();
      const productName=fields.namedItem("productName").value.trim(),trackingNo=fields.namedItem("trackingNo").value.trim();
      const old=await RuruStore.getOne(RuruStore.keyFor(platform,orderNo));
      const row={platform,orderNo,products:productName?[{name:productName,url:""}]:[],
        packages:trackingNo?[{no:trackingNo,company:fields.namedItem("company").value,productName:productName}]:[],
        note:fields.namedItem("note").value.trim() || old?.note || "",
        transferred:old?.transferred||false,transferredAt:old?.transferredAt||0};
      const result=await RuruStore.upsert(row,true);
      $("orderDialog").close();form.reset();
      await load();setNotice(result.synced?"订单已保存至同步存储":"订单保存在本机，同步失败："+result.error,!result.synced);
    }catch(err){setNotice("保存失败："+String(err.message||err),true);}
  });
  $("list").addEventListener("click",async e=>{
    const b=e.target.closest("button[data-action]");if(!b)return;
    const a=b.dataset.action,key=b.dataset.key,no=b.dataset.no||"";
    try{
      if(a==="copy"){await copyText(no);return;}
      if(a==="remove"){
        if(!confirm("确定永久删除这笔订单及本插件的转运记录吗？购物平台中的订单不会被删除。"))return;
        const result=await RuruStore.remove(key);
        await load();setNotice(result.synced?"订单已删除":"本机已删除，但跨设备删除同步失败："+result.error,!result.synced);return;
      }
      if(a==="note"){
        const r=await RuruStore.getOne(key);
        const v=prompt("修改订单备注（请勿填入个人敏感信息）：",r?.note||"");
        if(v===null)return;
        const result=await RuruStore.setNote(key,v);await load();
        setNotice(result.synced?"备注已保存":"备注仅保存在本机",!result.synced);return;
      }
      if(a==="mark"){
        const result=await RuruStore.mark(key,no,b.dataset.next==="true");
        await load();setNotice(result.synced?"转运状态已保存":"状态已保存到本机，但尚未同步",!result.synced);
      }
    }catch(err){setNotice("操作失败："+String(err.message||err),true);}
  });
  $("list").addEventListener("change",async e=>{
    const s=e.target.closest("select[data-link]");if(!s)return;
    try{
      const result=await RuruStore.setProductLink(s.dataset.link,s.dataset.no,s.value);
      await load();setNotice(result.synced?"已关联包裹与商品":"关联保存在本机，等待同步",!result.synced);
    }catch(err){setNotice("关联失败："+String(err.message||err),true);}
  });
  $("retrySync").addEventListener("click",async()=>{
    try{const r=await RuruStore.retry();await load();setNotice("重试 "+r.retried+" 条；失败 "+r.failed.length+" 条",!!r.failed.length);}
    catch(e){setNotice("同步重试失败："+String(e.message||e),true);}
  });
  $("exportJson")?.addEventListener("click",exportJson);
  $("exportCsv")?.addEventListener("click",exportCsv);
  $("importJson")?.addEventListener("click",()=>$("importFile").click());
  $("importFile")?.addEventListener("change",async e=>{
    try{await importFile(e.target.files?.[0]);}
    catch(err){setNotice("导入失败："+String(err.message||err),true);}
    finally{e.target.value="";}
  });
  let updateTimer=0;
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="sync" && area!=="local")return;
    if(!Object.keys(changes).some(k=>k.startsWith(RuruStore.PREFIX)))return;
    clearTimeout(updateTimer);updateTimer=setTimeout(load,220);
  });

  // User-requested batch crawler, with persisted progress even when popup closes.
  const BATCH_KEY="ruru_fw_batch_job_v1";
  async function renderBatch(job){
    if(!job){$("crawlProgress").textContent="未启动批量抓取";return;}
    const active=job.state==="running" && Date.now()-(job.updatedAt||0)<5*60*1000;
    $("autoScan").disabled=active;
    $("stopScan").hidden=!active;
    let state=job.state==="done"?"已完成":job.state==="stopped"?"已停止":
      job.state==="needs-attention"?"需要人工处理":active?"正在抓取":"可能已中断，请重新启动";
    let info=state+"｜已处理 "+(job.completed||0)+" 单，提取 "+(job.found||0)+" 个运单号";
    if(job.current)info+="\n"+job.current;
    if(job.errors?.length)info+="\n提示："+job.errors.slice(-2).join("；").slice(0,250);
    $("crawlProgress").textContent=info;
  }
  async function refreshBatch(){
    try{
      const d=await chrome.storage.local.get(BATCH_KEY);
      await renderBatch(d[BATCH_KEY]);
    }catch(e){$("crawlProgress").textContent="无法读取抓取状态："+String(e.message||e);}
  }
  $("autoScan").addEventListener("click",async()=>{
    $("autoScan").disabled=true;
    $("crawlProgress").textContent="正在启动批量抓取…";
    try{
      const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
      let tab=tabs[0],src=tab?.url||"";
      const explicit=$("platform").value;
      let p=explicit!=="all"?explicit:/pinduoduo\.com|yangkeduo\.com/.test(src)?"pdd":"taobao";
      if(p==="pdd"&&!/https:\/\/[^/]*\.(pinduoduo\.com|yangkeduo\.com)\//.test(src)){
        const all=await chrome.tabs.query({});
        const candidate=all.find(x=>/https:\/\/[^/]*\.(pinduoduo\.com|yangkeduo\.com)\//.test(x.url||""));
        src=candidate?.url||"";
      }
      const response=await chrome.runtime.sendMessage({type:"RURU_CRAWL_START",platform:p,sourceUrl:src});
      if(!response?.ok)throw Error(response?.error||"启动失败");
      setNotice("已开始自动逐单抓取；可以关闭弹窗，进度会保存到插件。");
      await refreshBatch();
    }catch(err){setNotice("无法启动："+String(err.message||err),true);}
    finally{$("autoScan").disabled=false;await refreshBatch();}
  });
  $("stopScan").addEventListener("click",async()=>{
    $("stopScan").disabled=true;
    try{
      await chrome.runtime.sendMessage({type:"RURU_CRAWL_STOP"});
      setNotice("收到停止请求；本笔订单处理结束后停止。");
      await refreshBatch();
    }catch(e){setNotice("停止失败："+String(e.message||e),true);}
    finally{$("stopScan").disabled=false;}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==="local" && changes[BATCH_KEY]) {
      renderBatch(changes[BATCH_KEY].newValue);
      load();
    }
  });
  refreshBatch();
  load();
})();
