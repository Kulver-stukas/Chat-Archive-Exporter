'use strict';
// Regression: Chrome sets runtime.lastError during Port.onDisconnect when a
// tab has no receiving content script. All listeners must read it synchronously.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(base, f), 'utf8');

(async () => {
  const failure = 'Could not establish connection. Receiving end does not exist.';
  let errorReads = 0;
  let disconnectCallback;
  const mockRuntime = {
    get lastError() { errorReads++; return {message: failure}; }
  };
  const port = {
    onMessage: {addListener() {}},
    onDisconnect: {addListener(cb) { disconnectCallback = cb; }},
    postMessage() {},
    disconnect() {}
  };
  const world = {
    chrome: {runtime: mockRuntime, tabs: {connect() { return port; }}},
    console, setTimeout, clearTimeout
  };
  world.globalThis = world;
  vm.runInNewContext(source('lib/sync-rpc.js'), world);
  const client = world.ChatArchiveSyncRPC.connect(1);
  const request = client.call('CAE_STATUS');
  disconnectCallback();
  await assert.rejects(request, /Could not establish connection/);
  assert.equal(errorReads, 1, 'Background RPC must acknowledge runtime.lastError');

  let contentConnect;
  const events = () => ({addListener(fn) { return fn; }});
  const contentWorld = {
    chrome: {runtime: {
      id: 'self',
      get lastError() { errorReads++; return {message: failure}; },
      onConnect: {addListener(fn) { contentConnect = fn; }}
    }},
    window: {addEventListener() {}},
    document: {readyState: 'loading', addEventListener() {}, getElementById(){return null;}, visibilityState: 'hidden'},
    location: {pathname: '/'},
    setTimeout, clearTimeout, setInterval() {},
    AbortController, console
  };
  vm.runInContext(source('content.js'), require('./provider-bootstrap').boot(contentWorld));
  let contentDisconnect;
  contentConnect({
    name: 'CAE_API', sender: {id: 'self'},
    onDisconnect: {addListener(fn) { contentDisconnect = fn; }},
    onMessage: events()
  });
  contentDisconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errorReads, 2, 'Content Port must acknowledge runtime.lastError');

  const panel = source('panel.js');
  const match = panel.match(/activePort\.onDisconnect\.addListener\(\(\) => \{([\s\S]*?)\n    \}\);/);
  assert(match, 'Panel disconnect handler exists');
  assert(match[1].includes('chrome.runtime.lastError?.message'), 'Panel must acknowledge error');
  assert(match[1].indexOf('chrome.runtime.lastError') < match[1].indexOf('if (state.port !== activePort)'),
    'Read lastError before stale-port guard');
  assert(match[1].includes('disconnect();'), 'Keep connection lifecycle cleanup');
  console.log('PASS: Port disconnect errors acknowledged in panel, content and background RPC');
})().catch(e => {console.error(e); process.exitCode = 1;});
