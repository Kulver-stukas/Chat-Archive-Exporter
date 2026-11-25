'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
  const stored={},events=[],chrome={storage:{local:{
    get:async key=>{await new Promise(resolve=>setImmediate(resolve));return {[key]:structuredClone(stored[key])};},
    set:async value=>{Object.assign(stored,structuredClone(value));events.push(structuredClone(value));}
  }}};
  function worker(){const world={chrome};vm.createContext(world);for(const name of ['export-selection','export-preferences'])
    vm.runInContext(fs.readFileSync(__dirname+'/../lib/'+name+'.js','utf8'),world);return world.ChatArchiveExportPreferences;}
  const P=worker();assert.deepEqual({...await P.get()},{questions:true,answers:true,thinking:true,uploadedFiles:true,generatedFiles:true,completeConversation:true,_revision:0});
  // Two different extension pages begin with the same snapshot. Independent
  // field patches must both survive despite asynchronous storage reads.
  await Promise.all([P.patch({questions:false}),P.patch({thinking:false}),P.patch({completeConversation:false})]);
  let value=await P.get();assert.equal(value.questions,false);assert.equal(value.thinking,false);assert.equal(value.completeConversation,false);assert.equal(value.answers,true);
  assert.equal(events.length,3);
  assert.equal(value._revision,3,'storage events have monotonic revisions across extension pages');
  await assert.rejects(P.patch({messageIds:['private-message']}),/Invalid export preference/);
  await assert.rejects(P.patch({uploadedFiles:'false'}),/Invalid export preference/);
  await P.patch({answers:false});assert.equal((await P.get()).answers,false,'a rejected patch does not poison the write queue');
  const restarted=worker();assert.equal((await restarted.get()).questions,false,'profile preferences survive worker recreation');
  assert.equal((await restarted.get()).completeConversation,false);
  console.log('PASS: global defaults, serialized concurrent field patches, input validation, failure isolation, worker restart');
})().catch(e=>{console.error(e);process.exitCode=1;});
