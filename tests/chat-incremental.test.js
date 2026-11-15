'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('../lib/normalize');
require('../lib/hash');
require('../lib/paths');
const Vault = require('../lib/vault');
let clock = 1700000000000;
class Missing extends Error { constructor() { super('Missing'); this.name = 'NotFoundError'; } }
class FileHandle {
  constructor(name) { this.name = name; this.bytes = Buffer.alloc(0); this.modified = ++clock; }
  async getFile() { const f = new Blob([this.bytes]); f.lastModified = this.modified; return f; }
  async createWritable() {
    const parts = [];
    return { write: async v => parts.push(Buffer.from(v)),
      close: async () => { this.bytes = Buffer.concat(parts); this.modified = ++clock; },
      abort: async () => { parts.length = 0; } };
  }
}
class Dir {
  constructor() { this.children = new Map(); }
  async getDirectoryHandle(name, options = {}) {
    if (!this.children.has(name)) { if (!options.create) throw new Missing(); this.children.set(name, new Dir()); }
    return this.children.get(name);
  }
  async getFileHandle(name, options = {}) {
    if (!this.children.has(name)) { if (!options.create) throw new Missing(); this.children.set(name, new FileHandle(name)); }
    return this.children.get(name);
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw new Missing(); }
}
const root = new Dir();
async function fileFor(path, create = false) {
  const parts = path.split('/'); let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, {create});
  return dir.getFileHandle(parts.at(-1), {create});
}
async function writeRaw(path, value) {
  const f = await fileFor(path, true), w = await f.createWritable();
  await w.write(value); await w.close(); return f;
}
async function readText(path) { return (await (await fileFor(path)).getFile()).text(); }
const account = 'acct-workspace', projectId = 'g-p-00000000000000000000000000000001';
const layout = ChatArchivePaths.createLayout('Workspace test', [{id: projectId, name: 'Lab'}]);
const item = { id: 'ab1dcd13-7823-4000-bade-123456789abc', title: 'Chat', project: 'Lab', projectId,
  updated: '2026-11-09T15:03:47.465Z', created: '2026-11-08T10:00:00Z' };
const path = layout.chatPath(item), key = `${account}|${item.id}`;
const markdown = (chat, opts={}) => `---\ntitle: ${JSON.stringify(chat.title)}\nprovider: chatgpt\nworkspace: "Workspace test"\nproject: ${JSON.stringify(opts.project ?? chat.project ?? '')}\nconversation_id: ${JSON.stringify(chat.id)}\nsource: ${JSON.stringify(`https://chatgpt.com/g/${chat.projectId}/c/${chat.id}`)}\ncreated: "2026-07-10T21:27:59.859Z"\nupdated: ${JSON.stringify(opts.updated ?? chat.updated)}\nexported: "2026-11-09T17:40:15.442Z"\n---\n\n# Chat\n\n## Prompt:\nOld content.\n`;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const simpleRec = (path, text, fingerprint = null) => ({path, sha256: sha(Buffer.from(text)), bytes: Buffer.byteLength(text), local_last_modified: clock, saved_at: '2026-11-09T17:40:15.442Z', ...(fingerprint ? {remote_fingerprint:fingerprint}: {})});
(async () => {
  const v1 = await Vault.openStore(root);
  await v1.useWorkspace(layout.prefix, account);
  assert.equal((await v1.decideChat(item, {key,path})).action, 'fetch', 'first export needs content');
  assert.equal((await v1.writeText(path, markdown(item), {kind:'chats',key,remoteChat:item})).status,'saved');
  const wp = Vault.workspaceIndexPath(layout.prefix);
  const onDisk = JSON.parse(await readText(wp));
  assert.equal(onDisk.schema, Vault.WORKSPACE_SCHEMA);
  assert.equal(onDisk.account_id, account);
  assert.equal(onDisk.chats[item.id].updated, item.updated, 'archived YAML updated must be persisted');
  assert.equal(onDisk.chats[item.id].listed_updated_ms, Date.parse(item.updated));
  assert.equal(onDisk.chats[item.id].saved_at.startsWith('2026-'), true);
  assert.equal(onDisk.chats[item.id].sha256, sha(Buffer.from(markdown(item))));
  const v2 = await Vault.openStore(root); await v2.useWorkspace(layout.prefix, account);
  assert.equal((await v2.decideChat(item, {key,path})).action,'skip','must skip across separate store sessions');
  assert.equal((await v2.decideChat({...item, updated:'2026-11-09T15:05:00Z'}, {key,path})).action,'fetch','newer list revision requires content fetch');
  assert.equal((await v2.decideChat({...item, title:'Renamed'}, {key,path})).action,'fetch','title change requires refresh');
  assert.equal((await v2.decideChat({...item, updated:null}, {key,path})).action,'fetch','missing server version cannot prove unchanged');
  // All existing previous-version chat entries are migrated from the old global
  // index, including records not selected for the current run. Project YAML
  // display names can differ from the actual project name without invalidating
  // the archived conversation ID/version.
  const legacyItem={...item,id:'bbbbbbbb-1111-2222-3333-444444444444',title:'Legacy chat', updated:'2026-08-10T22:17:26.666Z'};
  const legacyPath=layout.chatPath(legacyItem), legacyKey=`${account}|${legacyItem.id}`;
  const legacyText=markdown(legacyItem,{project:'Project_d-s-o-r-gate'});
  await writeRaw(legacyPath,legacyText);
  const oldMarked={...item,id:'cccccccc-1111-2222-3333-444444444444',title:'Marked chat'};
  const oldMarkedPath=layout.chatPath(oldMarked), oldMarkedKey=`${account}|${oldMarked.id}`;
  const markedYamlUpdated='2026-11-01T15:03:47.465Z';
  const markedText=markdown(oldMarked,{updated:markedYamlUpdated});
  await writeRaw(oldMarkedPath,markedText);
  const older={...item,id:'dddddddd-1111-2222-3333-444444444444',title:'Older local',updated:'2026-11-08T20:00:00Z'};
  const olderPath=layout.chatPath(older), olderKey=`${account}|${older.id}`;
  const olderText=markdown(older,{updated:'2026-11-05T20:00:00Z'});
  await writeRaw(olderPath, olderText);
  const legacyIndex={schema:'cae.vault-index.v1',created_at:'2026-11-08T00:00:00Z',updated_at:null,
    sources:{},metadata:{},chats:{
      [legacyKey]:simpleRec(legacyPath,legacyText),
      [oldMarkedKey]:simpleRec(oldMarkedPath,markedText, Vault.chatFingerprint(oldMarked)),
      [olderKey]:simpleRec(olderPath,olderText)
    }};
  await writeRaw(Vault.INDEX_PATH,JSON.stringify(legacyIndex));
  const v3=await Vault.openStore(root); const ws=await v3.useWorkspace(layout.prefix, account);
  assert.equal(Object.keys(ws.chats).length,4,'migration imports all prior chats, not only selected');
  assert.equal(ws.chats[legacyItem.id].updated,'2026-08-10T22:17:26.666Z');
  assert.equal(ws.chats[legacyItem.id].listed_updated_ms,null,'legacy list update not fabricated');
  assert.equal((await v3.decideChat(legacyItem,{key:legacyKey,path:legacyPath})).action,'skip',
    'identical YAML updated implies unchanged even if project display differs');
  const stored=JSON.parse(await readText(wp));
  assert.equal(stored.chats[legacyItem.id].listed_updated_ms,Date.parse(legacyItem.updated));
  assert.equal((await v3.decideChat(oldMarked,{key:oldMarkedKey,path:oldMarkedPath})).action,'skip',
    'previous list update marker wins when YAML detail and list have different update semantics');
  assert.equal((await v3.decideChat(older,{key:olderKey,path:olderPath})).action,'fetch',
    'a later remote version must not be skipped even if a local Markdown exists');
  const v4=await Vault.openStore(root); await v4.useWorkspace(layout.prefix, account);
  assert.equal((await v4.decideChat(legacyItem,{key:legacyKey,path:legacyPath})).action,'skip','migration persists after restart');
  // File mtime is not a remote-version signal; identical bytes with changed
  // local timestamp remain unchanged.
  const fh=await fileFor(legacyPath); fh.modified=++clock;
  assert.equal((await v4.decideChat(legacyItem,{key:legacyKey,path:legacyPath})).action,'skip');
  // Same-size edits even with an unchanged filesystem timestamp must conflict.
  const live=await fileFor(path), untouchedMtime=live.modified;
  live.bytes=Buffer.from(markdown(item).replace('Old content','New content'));
  live.modified=untouchedMtime;
  const conflicted=await v4.decideChat(item,{key,path});
  assert.equal(conflicted.action,'skip'); assert.equal(conflicted.status,'conflict');
  const changedMarkdown=live.bytes.toString();
  assert.equal((await v4.writeText(path,markdown(item),{kind:'chats',key,remoteChat:item})).status,'conflict');
  assert.equal((await readText(path)),changedMarkdown,'locally edited file must never be overwritten');
  const {dir,filename}=await Vault.parentDirectory(root,path); await dir.removeEntry(filename);
  assert.equal((await v4.decideChat(item,{key,path})).action,'fetch','missing local file must be restored');
  // Untracked file gets no automatic trust or overwrite.
  const unknown={...item,id:'ffffffff-0000-1111-2222-333333333333'};
  const unknownPath=layout.chatPath(unknown);
  await writeRaw(unknownPath,markdown(unknown));
  const decision=await v4.decideChat(unknown,{key:`${account}|${unknown.id}`,path:unknownPath});
  assert.equal(decision.action,'skip');assert.equal(decision.status,'skipped');
  // Cross-account workspace use and malformed workspace manifest are rejected.
  const other=await Vault.openStore(root);
  await assert.rejects(()=>other.useWorkspace(layout.prefix,'some-other-account'),/another account/);
  const badText=await readText(wp);
  await writeRaw(wp,'{not json');
  const corrupted=await Vault.openStore(root);
  await assert.rejects(()=>corrupted.useWorkspace(layout.prefix,account),/invalid JSON/);
  await writeRaw(wp,badText);
  console.log('PASS: per-workspace durable YAML index, no-detail repeat, legacy import across sessions, differing project labels, remote version changes, mtime independence, local conflict, account and manifest safety');
})().catch(e=>{console.error(e);process.exitCode=1;});
