/* Storage v1: one order per Chrome sync key, with local recovery.
   Auto-scan can add facts but never reset forwarded flags or notes. */
(function () {
  "use strict";
  const PREFIX = "ruru_fw_v1:";
  const ERROR_KEY = "ruru_fw_sync_error";
  const PLATFORM = { taobao: "淘宝", pdd: "拼多多" };
  function clean(v, max) { return String(v == null ? "" : v).trim().slice(0, max || 300); }
  function keyFor(p, n) { return PREFIX + p + ":" + clean(n, 42).replace(/[^0-9A-Za-z_-]/g, ""); }
  function isOrder(v) { return !!v && typeof v === "object" && PLATFORM[v.platform] && /^[0-9A-Za-z_-]{6,42}$/.test(String(v.orderNo || "")); }
  function uniqProducts(products) {
    const out = [], seen = new Set();
    for (const p of Array.isArray(products) ? products : []) {
      const title = clean(p.name || p.title, 160);
      const url = clean(p.url, 400);
      if (!title || seen.has(title + "|" + url)) continue;
      seen.add(title + "|" + url); out.push({name:title,url:url});
      if (out.length >= 30) break;
    }
    return out;
  }
  function uniqPackages(packages) {
    const out = [], seen = new Set();
    for (const p of Array.isArray(packages) ? packages : []) {
      const no = clean(p.no, 48).replace(/\s/g, "");
      if (!/^[0-9A-Za-z-]{8,48}$/.test(no) || seen.has(no.toUpperCase())) continue;
      seen.add(no.toUpperCase());
      out.push({no:no, company:clean(p.company, 35), transferred:!!p.transferred,
        transferredAt: Number(p.transferredAt) || 0, productName:clean(p.productName, 160)});
      if (out.length >= 25) break;
    }
    return out;
  }
  function normalize(raw) {
    if (!isOrder(raw)) throw Error("订单号须为 6–42 位字母、数字、下划线或短横线");
    return {key:keyFor(raw.platform, raw.orderNo), platform:raw.platform,
      orderNo:clean(raw.orderNo,42), provisional:!!raw.provisional, products:uniqProducts(raw.products),
      packages:uniqPackages(raw.packages), transferred:!!raw.transferred,
      transferredAt:Number(raw.transferredAt) || 0, note:clean(raw.note,700),
      sourceUrl:clean(raw.sourceUrl,400), createdAt:Number(raw.createdAt) || Date.now(),
      updatedAt:Number(raw.updatedAt) || Date.now(), syncPending:!!raw.syncPending};
  }
  function combine(existing, incoming, manual) {
    const b = existing ? normalize(existing) : null, a = normalize(incoming);
    if (!b) return a;
    const result = Object.assign({}, b);
    result.products = uniqProducts(b.products.concat(a.products));
    result.provisional = !!(b.provisional || a.provisional);
    const pkgs = new Map(b.packages.map(p=>[p.no.toUpperCase(),Object.assign({},p)]));
    for (const p of a.packages) {
      const k = p.no.toUpperCase(), old=pkgs.get(k);
      if (!old) pkgs.set(k,p);
      else pkgs.set(k,Object.assign({},old,{company: p.company || old.company,
        productName:old.productName || p.productName}));
    }
    result.packages = Array.from(pkgs.values());
    if (manual) {
      result.note = a.note;
      result.transferred = a.transferred;
      result.transferredAt = a.transferredAt;
      // Manually entered per-package links and forwarded status win.
      for (const pkg of a.packages) {
        const item = result.packages.find(x=>x.no.toUpperCase()===pkg.no.toUpperCase());
        if (item) { item.transferred=pkg.transferred; item.transferredAt=pkg.transferredAt; }
      }
    }
    result.sourceUrl = a.sourceUrl || b.sourceUrl;
    return result;
  }
  function signature(o) {
    if (!o) return "";
    const r = normalize(o);
    return JSON.stringify([r.provisional,r.products,r.packages,r.transferred,r.transferredAt,r.note,r.sourceUrl]);
  }
  async function getOne(key) {
    const [l,s] = await Promise.all([chrome.storage.local.get(key),chrome.storage.sync.get(key)]);
    const local=l[key], remote=s[key];
    if (!local) return remote || null;
    if (!remote) return local;
    if (local.syncPending) return local;
    return (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote;
  }
  async function save(record) {
    const row = normalize(record);
    await chrome.storage.local.set({[row.key]:Object.assign({},row,{syncPending:true})});
    try {
      const synced=Object.assign({},row,{syncPending:false});
      await chrome.storage.sync.set({[row.key]:synced});
      await chrome.storage.local.set({[row.key]:synced,[ERROR_KEY]:""});
      return {row:synced,synced:true};
    } catch(e) {
      const reason = String(e.message || e);
      await chrome.storage.local.set({[ERROR_KEY]:reason});
      return {row:Object.assign({},row,{syncPending:true}),synced:false,error:reason};
    }
  }
  async function upsert(raw, manual) {
    const r=normalize(raw), old=await getOne(r.key);
    const merged=combine(old,r,!!manual);
    if (old && signature(old)===signature(merged)) return {row:old,unchanged:true,synced:!old.syncPending};
    merged.createdAt=old ? old.createdAt : Date.now();
    merged.updatedAt=Date.now();
    return save(merged);
  }
  async function mark(key, trackingNo, state) {
    const old=await getOne(key);
    if(!old) throw Error("未找到订单");
    const next=normalize(old), t=Date.now();
    if (trackingNo) {
      const pkg=next.packages.find(x=>x.no===trackingNo);
      if(!pkg) throw Error("未找到运单号");
      pkg.transferred=!!state; pkg.transferredAt=state?t:0;
    } else {
      next.transferred=!!state; next.transferredAt=state?t:0;
    }
    next.updatedAt=t;
    return save(next);
  }
  async function setNote(key, note) {
    const old=await getOne(key);
    if(!old) throw Error("未找到订单");
    const next=normalize(old);
    next.note=clean(note,700);next.updatedAt=Date.now();
    return save(next);
  }
  async function setProductLink(key, no, name) {
    const old=await getOne(key); if(!old) throw Error("未找到订单");
    const next=normalize(old);
    const pkg=next.packages.find(x=>x.no===no); if(!pkg) throw Error("未找到运单号");
    pkg.productName=clean(name,160);
    next.updatedAt=Date.now(); return save(next);
  }
  async function list() {
    const [l,s] = await Promise.all([chrome.storage.local.get(null),chrome.storage.sync.get(null)]);
    const all=new Map();
    for (const source of [s,l]) for (const [k,v] of Object.entries(source)) {
      if(!k.startsWith(PREFIX) || !isOrder(v)) continue;
      const old=all.get(k);
      if(!old || (v.syncPending && source===l) || Number(v.updatedAt)>Number(old.updatedAt)) all.set(k,normalize(v));
    }
    return Array.from(all.values()).sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async function remove(key) {
    await chrome.storage.local.remove(key);
    try {await chrome.storage.sync.remove(key);return {synced:true};}
    catch(e){return {synced:false,error:String(e.message||e)};}
  }
  async function retry() {
    const rows=await list(); const failed=[];
    for(const r of rows.filter(x=>x.syncPending)) {
      const saved=await save(r); if(!saved.synced) failed.push(r.orderNo);
    }
    return {retried:rows.filter(x=>x.syncPending).length,failed:failed};
  }
  async function syncInfo() {
    const rows=await list(), local=await chrome.storage.local.get(ERROR_KEY);
    let used=0;
    try {used=await chrome.storage.sync.getBytesInUse(null);}catch(e){}
    return {orders:rows.length,pending:rows.filter(r=>r.syncPending).length,
      bytes:used,maxBytes:102400,error:local[ERROR_KEY] || ""};
  }
  globalThis.RuruStore={PREFIX,PLATFORM,normalize,keyFor,upsert,list,getOne,mark,
    setNote,setProductLink,remove,retry,syncInfo};
})();
