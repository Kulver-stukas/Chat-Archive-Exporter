/* Offscreen Blob creation only. No provider/network/file writes here.
 * The controller owns jobs; this document owns their temporary object URLs. */
(() => {
  'use strict';
  const prepared=new Map(),holders=new Map(),preparing=new Map();
  const S=ChatArchiveManualStore;
  async function hold(id){
    const job=await S.get(id);if(!job||job.destination!=='vault')throw Error('Invalid Vault job.');
    const dir=await S.directory(id);if(!dir)throw Error('Manual Vault binding not found.');
    holders.set(id,dir);return {held:true};
  }
  async function prepare(id){
    if(prepared.has(id))return prepared.get(id);
    if(preparing.has(id))return preparing.get(id);
    const operation=(async()=>{
      const job=await S.get(id);
      if(!job||job.destination!=='download'||job.phase!=='deliver')throw Error('Job is not ready for delivery.');
      const records=await S.entries(id),byPath=new Map();
      // A cancellation report intentionally replaces an earlier complete report.
      for(const r of records.filter(x=>x.entryId!=='partial-report'))byPath.set(r.path,r);
      for(const r of records.filter(x=>x.entryId==='partial-report'))byPath.set(r.path,r);
      let blob,filename;
      if(job.mode==='current'){
        const rec=records.find(x=>x.entryId.startsWith('chat:'));
        if(!rec)throw Error('No Markdown staged.');blob=rec.blob;filename=rec.path.split('/').at(-1);
      }else{
        const writer=ChatArchiveZip.createWriter({maxBytes:S.MAX_BYTES});
        try{for(const e of [...byPath.values()].sort((a,b)=>a.path.localeCompare(b.path)))
          await writer.add(e.store?{path:e.path,bytes:e.blob,store:true}:{path:e.path,content:await e.blob.text()});
          blob=writer.finish();
        }finally{writer.dispose();}
        const stamp=job.created_at.replace(/[-:]/g,'').replace('T','-').slice(0,15);
        filename='ChatGPT-'+ChatArchivePaths.safe(job.display,45)+'-'+stamp+'-'+job.id.slice(-6)+(job.cancel_requested?'-partial':'')+'.zip';
      }
      const result={url:URL.createObjectURL(blob),filename,bytes:blob.size};prepared.set(id,result);return result;
    })().finally(()=>preparing.delete(id));
    preparing.set(id,operation);return operation;
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg?.target!=='cae-manual-output'||sender.id!==chrome.runtime.id||sender.tab||
      !['CAE_MANUAL_PREPARE','CAE_MANUAL_RELEASE','CAE_MANUAL_HOLD'].includes(msg.type))return false;
    const run=async()=>{
      if(!S.validId(msg.jobId))throw Error('Invalid manual job ID.');
      if(msg.type==='CAE_MANUAL_HOLD')return hold(msg.jobId);
      if(msg.type==='CAE_MANUAL_PREPARE')return prepare(msg.jobId);
      const p=prepared.get(msg.jobId);if(p)URL.revokeObjectURL(p.url);
      prepared.delete(msg.jobId);holders.delete(msg.jobId);return {released:true};
    };
    run().then(result=>reply({ok:true,result}),e=>reply({ok:false,error:String(e?.message||e).slice(0,300)}));return true;
  });
})();
