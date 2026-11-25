/* Bounded original-file transfers for current-conversation downloads.
 * Authentication and original URL resolution stay inside the content bridge. */
(function(root){
  'use strict';
  const LIMITS=Object.freeze({maxFileBytes:25*1024*1024,maxTotalBytes:100*1024*1024,maxFiles:2000});
  function plan(chat,selection){
    const records=root.ChatArchiveExportSelection.attachments(chat,selection);
    if(records.length>LIMITS.maxFiles)throw Object.assign(Error('Too many attachments. Select fewer messages.'),{code:'SELECTION_INVALID'});
    const used={uploaded:new Set(),generated:new Set()};
    return records.map(a=>{
      const origin=a.origin==='uploaded'?'uploaded':'generated';
      const name=root.ChatArchivePaths.sourceFilename(a.name,a.fileId||a.key,a.mimeType,used[origin]);
      const path='attachments/'+(origin==='uploaded'?'Uploaded':'Generated')+'/'+name;
      return {...a,conversationId:chat.id,path,localPath:path};
    });
  }
  function result(a,extra={}){return {key:a.key,keys:a.keys||[a.key],name:a.name,origin:a.origin,
    fileId:a.fileId||null,messageId:a.messageId||null,messageIds:a.messageIds||[a.messageId].filter(Boolean),
    status:'unavailable',localPath:null,bytes:0,sha256:null,expectedBytes:Number.isFinite(a.sizeBytes)?a.sizeBytes:null,...extra};}
  const imageExtensions={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp',
    'image/avif':'.avif','image/bmp':'.bmp','image/tiff':'.tiff','image/svg+xml':'.svg','image/x-icon':'.ico','image/vnd.microsoft.icon':'.ico'};
  function imageExtension(bytes,mime){
    const ascii=(offset,len)=>String.fromCharCode(...bytes.subarray(offset,offset+len));
    if(bytes.length>=8&&bytes[0]===137&&ascii(1,3)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return '.png';
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return '.jpg';
    if(ascii(0,6)==='GIF87a'||ascii(0,6)==='GIF89a')return '.gif';
    if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP')return '.webp';
    if(ascii(4,4)==='ftyp'&&['avif','avis'].includes(ascii(8,4)))return '.avif';
    if(ascii(0,2)==='BM')return '.bmp';
    if(ascii(0,4)==='II*\x00'||ascii(0,4)==='MM\x00*')return '.tiff';
    if(bytes.length>=4&&bytes[0]===0&&bytes[1]===0&&bytes[2]===1&&bytes[3]===0)return '.ico';
    return imageExtensions[String(mime||'').toLowerCase().split(';')[0].trim()]||null;
  }
  function finalPath(a,bytes,mime,reservedPaths){
    if(a.mediaClass!=='image')return a.localPath;
    const ext=imageExtension(bytes,mime);
    // Never give an HTML/JSON error body an image filename. Unknown binary
    // formats retain the original name rather than guessing an extension.
    if(!ext&&/^(?:text\/html|application\/(?:problem\+)?json)(?:;|$)/i.test(mime||''))
      throw Object.assign(Error('Image original returned an HTML or JSON response.'),{code:'ATTACHMENT_INVALID_CONTENT'});
    if(!ext)return a.localPath;
    const old=a.localPath.match(/\.([a-z0-9]{1,8})$/i)?.[0]?.toLowerCase();
    if(old===ext||ext==='.jpg'&&old==='.jpeg'||ext==='.tiff'&&old==='.tif')return a.localPath;
    const slash=a.localPath.lastIndexOf('/'),dir=a.localPath.slice(0,slash+1);
    const used=new Set((reservedPaths||[]).filter(p=>p!==a.localPath&&p.startsWith(dir))
      .map(p=>p.slice(dir.length).toLowerCase()));
    const name=a.localPath.slice(slash+1).replace(/\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|svg|ico)$/i,'')+ext;
    return dir+root.ChatArchivePaths.sourceFilename(name,a.fileId||a.key,mime,used);
  }
  async function receive(a,{transport,maxBytes,cancelled=()=>false,progress=()=>{},reservedPaths=[]}){
    let bytes=0,chunks=[];
    const cap=Math.min(LIMITS.maxFileBytes,Number(maxBytes));
    try{
      if(cancelled())throw Object.assign(Error('Stopped by the user.'),{code:'CANCELLED'});
      if(!a.fileId&&!a.sandboxPath)throw Object.assign(Error('No downloadable original reference was provided.'),{code:'ATTACHMENT_UNAVAILABLE'});
      if(!(cap>0)||Number.isFinite(a.sizeBytes)&&a.sizeBytes>cap)
        throw Object.assign(Error('Original exceeds the remaining export limit (25 MiB per file, 100 MiB total).'),{code:'ATTACHMENT_LIMIT'});
      const started=await transport.start({attachment:{key:a.key,fileId:a.fileId||null,sandboxPath:a.sandboxPath||null,
        conversationId:a.conversationId,messageId:a.messageId},maxBytes:cap});
      while(true){
        if(cancelled())throw Object.assign(Error('Stopped by the user.'),{code:'CANCELLED'});
        const part=await transport.read();
        if(part.done){if(part.totalBytes!==bytes)throw Error('Final attachment byte count mismatch.');break;}
        const data=root.ChatArchiveSources.decode(part.base64,part.byteLength);bytes+=data.byteLength;
        if(bytes>cap)throw Object.assign(Error('Original exceeded the transfer limit.'),{code:'ATTACHMENT_LIMIT'});
        chunks.push(data);progress(bytes);
      }
      if(cancelled())throw Object.assign(Error('Stopped by the user.'),{code:'CANCELLED'});
      const blob=new Blob(chunks,{type:typeof started?.contentType==='string'?started.contentType:'application/octet-stream'});
      chunks=[];
      const data=new Uint8Array(await blob.arrayBuffer());
      const sha256=root.ChatArchiveHash.hex(data),localPath=finalPath(a,data,started?.contentType,reservedPaths);
      return {blob,result:result(a,{status:'saved',localPath,bytes,sha256,
        sizeMatches:Number.isFinite(a.sizeBytes)?bytes===a.sizeBytes:null,
        ...(Number.isFinite(a.sizeBytes)&&bytes!==a.sizeBytes?{warning:'Actual original size differs from provider metadata.'}:{})})};
    }catch(e){e.receivedBytes=bytes;throw e;}
    finally{chunks=[];await transport.close().catch(()=>{});}
  }
  root.ChatArchiveManualAttachments={LIMITS,plan,result,receive};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ChatArchiveManualAttachments;
})(globalThis);
