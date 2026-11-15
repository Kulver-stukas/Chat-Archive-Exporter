const assert = require('node:assert/strict');
const { normalizeChat, renderMarkdown, rewriteReferences, normalizeMath } = require('../lib/normalize.js');
const cite = '\uE200cite\uE202turn123search0\uE202turn123search1\uE201';
const unresolved = '\uE200cite\uE202turn999search9\uE201';
const directUrl = '\uE200url\uE202https://doi.org/10.1000/example\uE202DOI link\uE201';
const mk = (id, parent, role, type, payload, properties = {}) => ({
  id, parent, children: [], message: {
    author: { role }, content: { content_type: type, ...payload },
    create_time: 1780000000, metadata: {}, ...properties,
  }
});
const nodes = [
  mk('u', null, 'user', 'text', { parts: ['Review this.'] }, { metadata: { attachments: [{ name: 'Pasted text.txt' }] } }),
  mk('preamble', 'u', 'assistant', 'text', { parts: ['I will look into it.'] }, { metadata: { model_slug: 'gpt-6-thinking' }, channel: 'commentary' }),
  mk('tool1', 'preamble', 'assistant', 'code', { text: '{"path":"/files/search","args":{}}' }, { recipient: 'files.search' }),
  mk('tool2', 'tool1', 'assistant', 'text', { parts: ['{"path":"tool-call"}'] }, { recipient: 'to=functions.exec' }),
  mk('t1', 'tool2', 'assistant', 'thoughts', { thoughts: [
    { summary: 'Check references', content: 'Inspect the citations.' },
    { summary: 'Summarize', content: 'Ready to answer.' },
  ] }, { channel: 'analysis' }),
  mk('recap', 't1', 'assistant', 'reasoning_recap', { content: 'Finalized the comparison' }, { metadata: { finished_duration_sec: 145 }, channel: 'analysis' }),
  mk('answer', 'recap', 'assistant', 'text', { parts: ['This should not replace the fallback.'] }, {
    channel: 'final', metadata: {
      model_slug: 'gpt-6-thinking', model_dil_v2: {
        fallbackMarkdown: `Two sources ${cite}. Direct ${directUrl}. Here is math \\(a+b\\) and display \\[x^2+y^2\\].\n\n\`\\(literal\\)\`\n\n\`\`\`python\nprint('\\(literal\\)')\n\`\`\`\n\n~~~tex\n\\[untouched\\]\n~~~`
      },
      content_references: [{
        type: 'grouped_webpages', matched_text: cite, items: [
          { title: 'Paper A', url: 'https://example.org/paper?a=1' },
          { attribution: 'Paper B', url: 'https://example.org/path_(case)' },
        ]
      }]
    }
  }),
  mk('nextuser', 'answer', 'user', 'text', { parts: ['Continue.'] }),
  mk('final2', 'nextuser', 'assistant', 'text', { parts: [`Unresolved: ${unresolved}`] }, { channel: 'final' }),
];
const mapping = Object.fromEntries(nodes.map(n => [n.id, n]));
for (let i = 1; i < nodes.length; i++) nodes[i - 1].children = [nodes[i].id];
const raw = { mapping, current_node: 'final2', id: 'eeefefd0-8e20-83e9-b455-f1d305791006',
  title: 'Test conversation', gizmo_id: 'g-p-11111111111111111111111111111111' };
const chat = normalizeChat(raw);
const markdown = renderMarkdown(chat, { workspace: 'Workspace', project: 'PC' });
assert.equal(markdown.match(/^## Response:/gm)?.length, 2, 'one heading per assistant turn');
assert.equal(markdown.match(/### Thinking/g)?.length, 1, 'one thinking section per run');
assert(markdown.includes('I will look into it.'));
assert(markdown.includes('**Check references**'));
assert(markdown.includes('**Summarize**'));
assert(markdown.includes(' \u00b7 Worked for 2m 25s'));
assert(!markdown.includes('> Worked for'));
assert.equal(markdown.match(/Worked for/g)?.length, 1);
assert(!markdown.includes('/files/search'));
assert(!markdown.includes('tool-call'));
assert(!markdown.includes('This should not replace the fallback'));
assert.equal(chat.stats.droppedToolMessages, 2);
assert(markdown.includes('[Attachment: Pasted text.txt]'));
assert(markdown.includes('[Paper A](<https://example.org/paper?a=1>)'));
assert(markdown.includes('[Paper B](<https://example.org/path_(case)>)'));
assert(markdown.includes('[DOI link](<https://doi.org/10.1000/example>)'));
assert(!markdown.includes(cite));
assert(!markdown.includes(directUrl));
assert(markdown.includes('math $a+b$'));
assert(markdown.includes('$$\nx^2+y^2\n$$'));
assert(markdown.includes('`\\(literal\\)`'));
assert(markdown.includes("print('\\(literal\\)')"));
assert(markdown.includes('~~~tex\n\\[untouched\\]\n~~~'));
assert(markdown.includes(unresolved), 'unresolved citations must not be silently deleted');
assert(chat.warnings.some(w => w.includes('Unresolved web citations')));
assert(markdown.includes('source: "https://chatgpt.com/g/g-p-11111111111111111111111111111111/c/eeefefd0-8e20-83e9-b455-f1d305791006"'));
assert(markdown.includes('project: "PC"'));

// Direct converter edge cases, escaped/typed math, and unchanged normal Markdown.
assert.equal(normalizeMath('A \\(x\\).'), 'A $x$.');
assert.equal(rewriteReferences('Text **bold** and a \\[a=b\\] formula.', { metadata: {} }), 'Text **bold** and a \n$$\na=b\n$$\n formula.');
assert.equal(rewriteReferences('```md\n\\(do not alter\\)\n```\n\\(convert\\)', {metadata:{}}), '```md\n\\(do not alter\\)\n```\n$convert$');
assert.equal(rewriteReferences('~~\\(do not alter\\)~~', {metadata:{}}), '~~$do not alter$~~');
assert.equal(rewriteReferences('<CodeBlock language="latex">\\(leave alone\\)</CodeBlock> outside \\(change\\)', {metadata:{}}), '<CodeBlock language="latex">\\(leave alone\\)</CodeBlock> outside $change$');
console.log('PASS: grouped response, thinking, no tool traffic, citation URLs, math, code, attachments, source');
