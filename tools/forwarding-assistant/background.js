importScripts("storage.js");
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(!msg || msg.type!=="RURU_SCANNED") return false;
  (async ()=>{
    const entries=Array.isArray(msg.orders)?msg.orders.slice(0,40):[];
    let added=0, updated=0, unchanged=0, failed=0;
    for(const order of entries) {
      try {
        if(sender.url && !order.sourceUrl) order.sourceUrl=sender.url;
        const saved=await RuruStore.upsert(order,false);
        if(saved.unchanged) unchanged++;
        else if(saved.synced) updated++;
        else failed++;
        if(!saved.unchanged) added++;
      }catch(e){failed++;}
    }
    sendResponse({ok:true,found:entries.length,saved:added,unchanged,failed});
  })().catch(e=>sendResponse({ok:false,error:String(e.message||e)}));
  return true;
});
