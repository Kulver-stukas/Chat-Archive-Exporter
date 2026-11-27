/* Pure text/record helpers shared by provider decoders and Markdown rendering. */
(function(root){
  'use strict';
  const asString = value => typeof value === 'string' ? value : '';
  function iso(value) {
    if (value === undefined || value === null || value === '') return '';
    const number = typeof value === 'number' ? value : Number(value);
    const date = Number.isFinite(number) && String(value).trim() !== ''
      ? new Date(number < 1e11 ? number * 1000 : number)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  // Protect fenced code and inline code spans, including tilde fences and long backtick runs.
  // A transformer only sees prose, so snippets containing literal LaTeX/citation markup survive.
  function outsideCode(markdown, transform) {
    const lines = String(markdown).split('\n');
    const output = [];
    const paragraph = [];
    let fence = null;
    const flush = () => {
      if (!paragraph.length) return;
      const source = paragraph.join('\n');
      const saved = [];
      const preserve = block => { saved.push(block); return '\u0001' + String(saved.length - 1) + '\u0002'; };
      const codeBlocksMasked = source.replace(/<CodeBlock\b[^>]*>[\s\S]*?<\/CodeBlock>/gi, preserve);
      const masked = codeBlocksMasked.replace(/(`+)([\s\S]*?)\1(?!`)/g, (match, ticks, body, at, original) => {
        if (at > 0 && original[at - 1] === '`') return match;
        return preserve(match);
      });
      const changed = transform(masked).replace(/\u0001(\d+)\u0002/g, (match, index) => saved[Number(index)] ?? match);
      output.push(changed);
      paragraph.length = 0;
    };
    for (const line of lines) {
      if (fence) {
        output.push(line);
        const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
        if (close && close[1][0] === fence.kind && close[1].length >= fence.length) fence = null;
        continue;
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (opening) {
        flush();
        fence = { kind: opening[1][0], length: opening[1].length };
        output.push(line);
      } else paragraph.push(line);
    }
    flush();
    return output.join('\n');
  }

  const api=Object.freeze({asString,iso,outsideCode});
  root.ChatArchiveMarkdownPrimitives=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
