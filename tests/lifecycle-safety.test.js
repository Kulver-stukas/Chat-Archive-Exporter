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
const chrome = {runtime: {id:'mock-extension',onConnect: {addListener: () => {}}}};
const api = {status: async () => { throw new Error('No API requests permitted before export'); }};
vm.runInNewContext(source, {window, document, location, chrome, ChatArchiveApi:api, setInterval:cb=>{interval.push(cb)}, clearInterval:()=>{}, setTimeout:()=>{}}, {filename:'content.js'});
assert(nodes.has('cae-inpage-button'));
assert.strictEqual(window.fetch, fetch);
assert.equal(interval.length, 1);
for(let i=0;i<10000;i++) interval[0]();
assert.equal(nodes.size, 1, 'Only one button after repeated checks');
location.pathname = '/'; interval[0]();
assert.equal(nodes.size, 0, 'Button removed outside chat');
location.pathname = '/g/g-p-project/c/6ada08d0-8d20-83e9-b455-f1d305791006'; interval[0]();
assert.equal(nodes.size, 1, 'Button present on project chat route');
console.log('PASS: no automatic fetch, no page-world bridge, no DOM observer, bounded SPA route checks');
