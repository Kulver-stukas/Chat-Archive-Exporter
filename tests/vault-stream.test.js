const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('../lib/normalize');
require('../lib/hash');
require('../lib/paths');
const V = require('../lib/vault');
const S = require('../lib/sources');
const T = require('../lib/vault-transfer');
class FakeMissing extends Error { constructor(name) { super(name); this.name = 'NotFoundError'; } }
let tick = 1000;
class FakeFile {
  constructor(name) { this.kind = 'file'; this.name = name; this.bytes = Buffer.alloc(0); this.lastModified = tick++; }
  async getFile() {
    const b = new Blob([this.bytes]);
    b.lastModified = this.lastModified;
    b.name = this.name;
    return b;
  }
  async createWritable() {
    let chunks = [], closed = false;
    const write = async v => { if (closed) throw Error('closed'); chunks.push(Buffer.from(v)); };
    return {write, close: async () => {if (closed) throw Error('closed'); this.bytes = Buffer.concat(chunks); this.lastModified = tick++;closed=true;},
      abort:async()=>{closed=true;chunks=[];}};
  }
}
class FakeDir {
  constructor(name='root') { this.kind='directory'; this.name=name; this.children=new Map(); }
  async getDirectoryHandle(name,{create=false}={}) {
    if(!this.children.has(name)) { if(!create)throw new FakeMissing(name); this.children.set(name,new FakeDir(name)); }
    const dir=this.children.get(name); if(dir.kind!=='directory')throw Error('not a directory');return dir;
  }
  async getFileHandle(name,{create=false}={}) {
    if(!this.children.has(name)) { if(!create)throw new FakeMissing(name); this.children.set(name,new FakeFile(name)); }
    const file=this.children.get(name); if(file.kind!=='file')throw Error('not a file');return file;
  }
  async removeEntry(name) { if(!this.children.delete(name))throw new FakeMissing(name); }
}
const root = new FakeDir();
const get = async path => {let dir=root;for(const part of path.split('/').slice(0,-1))dir=await dir.getDirectoryHandle(part);return dir.getFileHandle(path.split('/').at(-1));};
const contents = async path => Buffer.from(await (await (await get(path)).getFile()).arrayBuffer());
const account = 'workspace_test_001';
const project = 'g-p-aabbccddaabbccddaabbccddaabbccdd';
const layout = ChatArchivePaths.createLayout('Workspace 123',[{id:project,name:'Project'}]);
const sourcePath = `${layout.projectPath(project,'Project')}/Sources/bytes.bin`;
const textPath = layout.chatPath({projectId:project,project:'Project',title:'Conversation',id:'conversation-1'});
const source = {key:`${project}:file_123`,projectId:project,fileId:'file_123',name:'bytes.bin',category:'uploaded_file',
  sourceModifiedMs:20261109,sourceLocation:'fs',expectedBytes:null,path:sourcePath,localPath:'Sources/bytes.bin'};
const bytes = crypto.randomBytes(1024 * 1024 + 89);
const SHA = crypto.createHash('sha256').update(bytes).digest('hex');
let started = 0, aborted = 0, served=0, failAfter=-1;
const mockTransport = () => ({
  async start() { started++; served=0; return {contentType:'application/octet-stream'}; },
  async read() {
    if(failAfter>=0 && served>=failAfter)throw Object.assign(Error('broken connection'),{code:'SOURCE_NETWORK'});
    if(served>=bytes.length)return {done:true,totalBytes:served};
    const n=Math.min(123457,bytes.length-served),chunk=bytes.subarray(served,served+n);served+=n;
    return {done:false,base64:chunk.toString('base64'),byteLength:n};
  },
  async close(){aborted++;}
});
(async()=>{
  assert(V.validPath(textPath));
  assert(!V.validPath('ChatGPT/../../bad.txt'));
  assert(!V.validPath('ChatGPT/A/C:/bad.txt'));
  assert(!V.validPath('ChatGPT/A/CON.txt'));
  const v=await V.openStore(root);
  await v.useWorkspace(layout.prefix,account);
  const chatText = body => `---\ntitle: \"Conversation\"\nconversation_id: \"conversation-1\"\nupdated: \"2026-11-09T15:03:47.465Z\"\n---\n\n${body}`;
  let r=await v.writeText(textPath,chatText('Original'),{kind:'chats',key:`${account}|conversation-1`});
  assert.equal(r.status,'saved');
  assert.equal((await contents(textPath)).toString(),chatText('Original'));
  r=await v.writeText(textPath,chatText('Original'),{kind:'chats',key:`${account}|conversation-1`});
  assert.equal(r.status,'skipped');
  r=await v.writeText(textPath,chatText('Remote changed'),{kind:'chats',key:`${account}|conversation-1`});
  assert.equal(r.status,'saved');
  const f=await get(textPath);const w=await f.createWritable();await w.write('Local modified');await w.close();
  r=await v.writeText(textPath,chatText('Server changed'),{kind:'chats',key:`${account}|conversation-1`});
  assert.equal(r.status,'conflict');
  assert.equal((await contents(textPath)).toString(),'Local modified');
  const v2=await V.openStore(root);
  assert.equal(Object.keys((await v2.useWorkspace(layout.prefix,account)).chats).length,1,'workspace index is durable');
  let report=await T.run([source],{transport:mockTransport(),vault:v2,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.saved,1);
  assert.equal(report.results[0].sha256,SHA);
  assert.deepEqual(await contents(sourcePath),bytes,'exact bytes persisted');
  assert.equal(started,1);
  const v3=await V.openStore(root);
  report=await T.run([source],{transport:mockTransport(),vault:v3,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.skipped,1);
  assert.equal(started,1,'second run did not make source requests');
  assert.equal(report.results[0].sha256,SHA);
  assert.equal(report.results[0].local_path,'Sources/bytes.bin');
  report=await T.run([{...source,sourceModifiedMs:20261110}],{transport:mockTransport(),vault:v3,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.changed,1);
  assert.equal(started,1,'remote change is reported, not overwritten');
  const sf=await get(sourcePath), writer=await sf.createWritable();await writer.write(Buffer.alloc(bytes.length,0));await writer.close();
  report=await T.run([source],{transport:mockTransport(),vault:v3,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.conflict,1);
  assert.equal(started,1,'locally edited files are not fetched');
  // A different source with the same preferred name must be written at a new path.
  const source2={...source,key:`${project}:file_456`,fileId:'file_456'};
  report=await T.run([source2],{transport:mockTransport(),vault:v3,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.saved,1);
  assert(report.results[0].local_path.includes('file_456'));
  assert.equal((await contents(sourcePath)).equals(Buffer.alloc(bytes.length,0)),true,'user-edited original preserved');
  // Network failure leaves no index record and no half-written final contents.
  const source3={...source,key:`${project}:file_789`,fileId:'file_789',path:`${layout.projectPath(project,'Project')}/Sources/failure.bin`};
  failAfter=100000; report=await T.run([source3],{transport:mockTransport(),vault:v3,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.failed,1);
  assert.equal(v3.getSourceIndex(`${account}|${source3.key}`),null);
  assert.equal(await V.openStore(root).then(v=>v.getSourceIndex(`${account}|${source3.key}`)),null);
  assert.equal(await V.openStore(root).then(async()=>{try{return (await get(source3.path)).name;}catch(e){return e.name;}}),'NotFoundError');
  failAfter=-1;
  report=await T.run([source3],{transport:mockTransport(),vault:v3,expectedAccountId:account,pause:async()=>{}});
  assert.equal(report.counts.saved,1);
  assert.deepEqual(await contents(source3.path),bytes);
  // Existing metadata written by a different process is never overwritten without a trusted index.
  const otherPath=`${layout.projectPath(project,'Project')}/_project.md`;
  const file=await V.parentDirectory(root,otherPath,true).then(({dir,filename})=>dir.getFileHandle(filename,{create:true}));
  const fw=await file.createWritable();await fw.write('Human-authored file');await fw.close();
  r=await v3.writeText(otherPath,'Generated',{kind:'metadata',key:`${account}|${otherPath}`});
  assert.equal(r.status,'skipped');assert.equal((await contents(otherPath)).toString(),'Human-authored file');
  // Abort a transfer leaves durable sources unchanged.
  report=await T.run([source3],{transport:mockTransport(),vault:v3,expectedAccountId:account,cancelled:()=>true});
  assert.equal(report.counts.cancelled,1);
  assert.deepEqual(await contents(source3.path),bytes);
  console.log('PASS: Vault byte streaming, durable index, dedupe, remote-change detection, conflict preservation, name collisions, abort cleanup and text safety');
})().catch(e=>{console.error(e);process.exitCode=1;});
