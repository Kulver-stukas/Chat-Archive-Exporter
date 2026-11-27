'use strict';
const assert=require('node:assert/strict');
const {createEnvironment}=require('./manual-fixtures');
(async()=>{
  const e=createEnvironment(),V=e.box.ChatArchiveVault,P=e.box.ChatArchivePaths;
  const old=P.createLayout('Workspace test').prefix,alias=P.createLayout('Workspace fallback').prefix;
  assert.equal(await V.resolveWorkspacePrefix(e.root,alias,e.account),alias,'empty Vault retains proposed path');
  await e.submit(e.opts('recovery-first',[e.chat(1)]));await e.drain();
  assert.equal((await e.C.inspect()).status,'completed');
  assert.equal(await V.resolveWorkspacePrefix(e.root,alias,e.account),old,'account index beats display name');
  const opts={...e.opts('recovery-second',[e.chat(2)]),display:'Workspace fallback'};
  await e.submit(opts);await e.drain();assert.equal((await e.C.inspect()).status,'completed');
  const index=await V.readIndex(e.root);
  assert(index.chats[e.account+'|'+e.chat(2).id].path.startsWith(old+'/'));
  assert.equal(await V.lookupFile(e.root,alias+'/.workspace.json'),null,'no duplicate directory');
  await assert.rejects(V.resolveWorkspacePrefix(e.root,old,'other-workspace'),/another workspace/);
  console.log('PASS: existing Vault by account ID, manual export preserves path, foreign directory rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
