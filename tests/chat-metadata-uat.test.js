'use strict';
const assert=require('node:assert/strict'),{createEnvironment}=require('./manual-fixtures');
(async()=>{
 const e=createEnvironment();
 const basic={...e.chat(1,'My chat'),archived:false};
 await e.submit(e.opts('chat-metadata-first-123456',[basic]));
 let j=await e.drain();assert.equal(j.status,'completed');
 const idx='ChatGPT/Workspace test/.workspace.json';
 let ledger=JSON.parse(await e.read(idx));const firstPath=ledger.chats[basic.id].path;
 assert.equal(ledger.chats[basic.id].archived,false);
 assert((await e.read(firstPath)).includes('archived: false'));
 // Archiving the chat in ChatGPT does not change its updated timestamp.
 await e.submit(e.opts('chat-metadata-archive-12345',[{...basic,archived:true}]));
 j=await e.drain();assert.equal(j.status,'completed');
 ledger=JSON.parse(await e.read(idx));
 assert.equal(ledger.chats[basic.id].path,firstPath);
 assert.equal(ledger.chats[basic.id].archived,true);
 assert((await e.read(firstPath)).includes('archived: true'));
 // Removal from a Project is logical, not a file move.
 const unassigned={...basic,archived:true,project:'',projectId:'',containerObserved:true};
 await e.submit(e.opts('chat-metadata-unassign-1234',[unassigned]));
 j=await e.drain();assert.equal(j.status,'completed');
 ledger=JSON.parse(await e.read(idx));
 assert.equal(ledger.chats[basic.id].project_id,'');
 assert.equal(ledger.chats[basic.id].path,firstPath);
 assert((await e.read(firstPath)).includes('project_id: ""'));
 // A title change updates the front matter, while the disk path remains stable.
 await e.submit(e.opts('chat-metadata-rename-12345',[{...unassigned,title:'Renamed chat'}]));
 j=await e.drain();assert.equal(j.status,'completed');
 ledger=JSON.parse(await e.read(idx));
 assert.equal(ledger.chats[basic.id].path,firstPath);
 assert.equal(ledger.chats[basic.id].title,'Renamed chat');
 assert((await e.read(firstPath)).includes('title: "Renamed chat"'));
 console.log('PASS: archive flag, Project removal and renamed title update the YAML/index without moving old Vault files');
})().catch(e=>{console.error(e);process.exitCode=1;});
