const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert(manifest.content_scripts.length === 1, 'No MAIN world bridge allowed');
assert(manifest.content_scripts.every(x => x.world !== 'MAIN'), 'Page world injection is forbidden');
assert(!manifest.content_scripts.some(x => x.js.includes('workspace-bridge.js')));
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
assert(!source.includes('MutationObserver'), 'Full DOM observers are not allowed in safe mode');

const nodes = new Map();
nodes.set('cae-inpage-button',{remove(){nodes.delete('cae-inpage-button');}});
const interval = [];
const fetch = function originalFetch() { throw new Error('Startup must not fetch data'); };
const events = new Map();
const location = {pathname: '/c/6ada08d0-8d20-83e9-b455-f1d305791006'};
const document = {
  readyState: 'complete', visibilityState: 'visible',
  getElementById: id => nodes.get(id) || null,
  createElement: () => ({style: {}, addEventListener: () => {}, remove() {nodes.delete(this.id);}}),
  addEventListener: (name, cb) => events.set(name, cb),
  body: {appendChild: el => nodes.set(el.id, el)}
};
const window = {addEventListener: (name, cb) => events.set(name, cb), fetch};
let bridgeListeners=0;
const chrome = {runtime: {id:'mock-extension',getManifest:()=>({version:'0.1.9'}),onConnect: {addListener: () => {bridgeListeners++;}}}};
const api = {status: async () => { throw new Error('No API requests permitted before export'); }};
const context=vm.createContext({window, document, location, chrome, ChatArchiveApi:api,
  __CAE_CONTENT_BOOT_VERSION:'0.1.8',setInterval:cb=>{interval.push(cb)}, clearInterval:()=>{}, setTimeout:()=>{}});
vm.runInContext(source,context,{filename:'content.js'});
assert(!nodes.has('cae-inpage-button'),'A new content-script boot retires the legacy page button.');
assert.strictEqual(window.fetch, fetch);
assert.equal(interval.length,0,'Content bridge installs no page-button polling timer.');
for(const route of ['/','/c/6ada08d0-8d20-83e9-b455-f1d305791006','/g/g-p-project/c/6ada08d0-8d20-83e9-b455-f1d305791006']){
  location.pathname=route;
  for(let n=0;n<3;n++)vm.runInContext(source,context,{filename:'content.js'});
  assert.equal(nodes.size,0,'Reinjection/navigation must not create a page export button.');
}
assert.equal(bridgeListeners,1,'Repeated content injection keeps one bridge listener.');
assert.strictEqual(window.fetch,fetch,'Provider fetch remains uninstrumented.');
console.log('PASS: no automatic fetch, no page-world bridge, no DOM observer/polling, legacy button retired and bridge boot idempotent');
