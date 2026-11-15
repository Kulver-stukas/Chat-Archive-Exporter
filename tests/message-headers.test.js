const assert = require('node:assert/strict');
const N = require('../lib/normalize');
assert.equal(N.messageDate('2026-02-25T21:07:34Z', 'Europe/Moscow'), '2/26/2026, 12:07:34 AM');
assert.equal(N.messageDate('2026-11-08T17:33:48Z', 'Europe/Moscow'), '11/8/2026, 8:33:48 PM');
assert.equal(N.messageDate(1794159228, 'UTC'), N.messageDate(1794159228000, 'UTC'));
assert.equal(N.messageDate('no-date'), '');
const chat = {title:'Headers',id:'test',created:'2025-01-01',messages:[
  {role:'user',time:'2026-11-08T17:33:46Z',content:'Prompt text'},
  {role:'assistant',time:'2026-11-08T17:33:48Z',model:'gpt-6-thinking',content:'Preamble'},
  {role:'thinking',time:'2026-11-08T17:33:49Z',content:'**Inspecting**\n\nA summary.'},
  {role:'thinking',time:'2026-11-08T17:34:20Z',content:'Worked for 32s',duration:32},
  {role:'assistant',time:'2026-11-08T17:34:20Z',model:'gpt-6-thinking',content:'Final answer'},
  {role:'user',time:'2026-11-08T18:00:00Z',content:'Next'},
  {role:'thinking',time:'2026-11-08T18:00:01Z',content:'Thought for 1m 36s'},
  {role:'assistant',time:'2026-11-08T18:01:37Z',model:'gpt-6-thinking',content:'Second answer'}
]};
const md=N.renderMarkdown(chat,{timeZone:'Europe/Moscow'});
assert(md.includes('## Prompt:\n11/8/2026, 8:33:46 PM'));
assert(md.includes('## Response:\n11/8/2026, 8:33:48 PM \u00b7 gpt-6-thinking \u00b7 Worked for 32s'));
assert(md.includes('## Response:\n11/8/2026, 9:00:01 PM \u00b7 gpt-6-thinking \u00b7 Thinking for 1m 36s'));
assert.equal((md.match(/Worked for 32s/g)||[]).length,1);
assert.equal((md.match(/1m 36s/g)||[]).length,1);
assert(!md.includes('> Worked for'));
assert(md.includes('> A summary.'));
assert.equal((md.match(/^### Thinking/gm)||[]).length,1,'no empty thinking block for duration-only recap');
assert(md.indexOf('Preamble') < md.indexOf('**Inspecting**') && md.indexOf('**Inspecting**') < md.indexOf('Final answer'));
assert.equal(N.cleanThinking('An explanation of Worked for 32s.\n\nWorked for 32s'), 'An explanation of Worked for 32s.');
assert.equal(N.cleanThinking('```text\nWorked for 32s\n```'), '```text\nWorked for 32s\n```');
assert.equal(N.turnTiming([{role:'thinking',content:'Nothing',duration:0}]),'Worked for 0s');
const noTime=N.renderMarkdown({title:'x',id:'x',messages:[{role:'user',content:'Hello'},{role:'assistant',content:'World'}]});
assert(noTime.includes('## Prompt:\nTimestamp unavailable'));
assert(!noTime.includes('Invalid Date'));
console.log('PASS: Prompt/Response timestamps, midnight/noon, timezone, duration dedupe, missing metadata, preserved thinking/prose/code');
