const assert = require('node:assert/strict');
const { normalizeChat, renderMarkdown, safeFilename, payloadText } = require('../lib/normalize.js');
function node(id, parent, role, content, options = {}) {
  return { id, parent, children: [], message: { author: { role }, content, metadata: options.metadata || {}, create_time: 1760000000 } };
}
const mapping = {
  root: { id: 'root', parent: null, children: ['user1'], message: null },
  user1: node('user1', 'root', 'user', { content_type: 'text', parts: ['Text **bold**, $x^2$, and \\(a+b\\).'] }),
  think: node('think', 'user1', 'assistant', { content_type: 'thoughts', thoughts: [{ summary: 'Comparing sources', content: 'Use API first.' }] }),
  answer: node('answer', 'think', 'assistant', { content_type: 'text', parts: ['Ignore me'] }, { metadata: { model_dil_v2: { fallbackMarkdown: 'Final with \\[x^2\\] and a link.' }, model_slug: 'gpt-6' } }),
  alt: node('alt', 'user1', 'assistant', { content_type: 'text', parts: ['Alternative branch'] }),
};
mapping.root.children = ['user1']; mapping.user1.children = ['think', 'alt']; mapping.think.children = ['answer'];
const raw = { id: 'a12345678-1234-1234-1234-123456789abc', title: 'Math / sample', mapping, current_node: 'answer', create_time: 1760000000 };
const chat = normalizeChat(raw);
assert.equal(chat.messages.length, 3);
assert.equal(chat.messages[0].role, 'user');
assert.equal(chat.messages[1].role, 'thinking');
assert.equal(chat.messages[2].role, 'assistant');
assert(!chat.messages.some(m => m.content.includes('Alternative branch')));
assert(chat.messages[2].content.startsWith('Final with'));
const md = renderMarkdown(chat, { workspace: 'Business workspace', project: 'Test project' });
assert(md.includes('provider: chatgpt'));
assert(md.includes('workspace: "Business workspace"'));
assert(md.includes('### Thinking (provided by ChatGPT)'));
assert(md.includes('Final with \n$$\nx^2\n$$\n'));
assert(md.includes('Text **bold**, $x^2$'));
assert(md.includes('and $a+b$'));
assert(!md.includes('Ignore me'));
assert.equal(safeFilename('Foo: Bar /? * "<>|'), 'Foo_ Bar __ _ ____');
assert.equal(payloadText({ content: { content_type: 'multimodal_text', parts: [{ text: 'typed' }, { transcription: 'spoken' }] } }), 'typed\n\nspoken');
assert.throws(() => normalizeChat({ mapping: {} }), /no readable mapping/);
// Reasoning recap: should be included in source order.
const recap = node('recap', 'user1', 'assistant', { content_type: 'reasoning_recap', content: 'A short recap' }, { metadata: { finished_duration_sec: 17 } });
const final = node('final', 'recap', 'assistant', { content_type: 'text', parts: ['Final answer'] });
const withRecap = normalizeChat({ mapping: { root: mapping.root, user1: mapping.user1, recap, final }, current_node: 'final' });
assert(withRecap.messages.some(m => m.role === 'thinking' && m.content === 'A short recap' && m.duration === 17));
console.log('PASS: normalization, active branch, fallbackMarkdown, thinking, LaTeX, frontmatter, filename, and errors');
