/* ChatGPT JSON normalization and Markdown export. No browser dependencies. */
(function (root) {
  'use strict';
  const asString = value => typeof value === 'string' ? value : '';
  const OPEN = '\uE200';
  const SEP = '\uE202';
  const CLOSE = '\uE201';

  function iso(value) {
    if (value === undefined || value === null || value === '') return '';
    const number = typeof value === 'number' ? value : Number(value);
    const date = Number.isFinite(number) && String(value).trim() !== ''
      ? new Date(number < 1e11 ? number * 1000 : number)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function partToMd(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.transcription === 'string') return part.transcription;
    if (typeof part.transcript === 'string') return part.transcript;
    if (typeof part.input_text === 'string') return part.input_text;
    if (Array.isArray(part.content)) return part.content.map(partToMd).filter(Boolean).join('\n');
    if (Array.isArray(part.parts)) return part.parts.map(partToMd).filter(Boolean).join('\n');
    if (part.content_type === 'image_asset_pointer' || part.asset_pointer || part.image_url)
      return '[Image omitted: binary media is not included]';
    if (part.content_type === 'audio_asset_pointer' || part.audio_asset_pointer)
      return '[Audio omitted: binary media is not included]';
    if (part.content_type === 'video_frame' || part.video_frame)
      return '[Video frame omitted: binary media is not included]';
    return '';
  }

  function payloadText(message) {
    const content = message.content || {};
    const fallback = message.metadata?.model_dil_v2?.fallbackMarkdown;
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
    if (typeof content.text === 'string') return content.text.trim();
    if (Array.isArray(content.parts)) return content.parts.map(partToMd).filter(Boolean).join('\n\n').trim();
    if (typeof content.content === 'string') return content.content.trim();
    if (Array.isArray(content.content)) return content.content.map(partToMd).filter(Boolean).join('\n\n').trim();
    return '';
  }

  function urlString(candidate) {
    if (typeof candidate === 'object' && candidate !== null) {
      candidate = candidate.uri || candidate.url || candidate.href || '';
    }
    if (typeof candidate !== 'string' || !candidate.trim()) return '';
    try {
      const url = new URL(candidate.trim());
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (_error) { return ''; }
  }

  function markdownLink(label, url) {
    const href = urlString(url);
    if (!href) return '';
    const display = asString(label).trim().replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[').replace(/\]/g, '\\]') || href;
    // Angle-bracket form safely handles parentheses in URLs.
    return `[${display}](<${href.replace(/>/g, '%3E')}>)`;
  }

  function referenceLinks(reference) {
    const candidates = Array.isArray(reference.items) && reference.items.length
      ? reference.items : [reference];
    const links = [], seen = new Set();
    for (const entry of candidates) {
      if (!entry || typeof entry !== 'object') continue;
      const url = urlString(entry.url || entry.href || entry.uri);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const label = entry.attribution || entry.title || entry.name || reference.attribution || reference.title || reference.alt || url;
      links.push(markdownLink(label, url));
    }
    return links;
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

  function normalizeMath(text) {
    return text
      .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, expression) => `\n$$\n${expression.trim()}\n$$\n`)
      .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, expression) => `$${expression}$`)
      .replace(new RegExp(OPEN + 'genui' + SEP + '(\\{[^\\n]*?\\})' + CLOSE, 'g'), (original, raw) => {
        try {
          const widget = JSON.parse(raw).math_block_widget_always_prefetch_v2;
          if (typeof widget?.content === 'string') return `\n$$\n${widget.content.trim()}\n$$\n`;
        } catch (_error) { /* Preserve unrecognized widgets. */ }
        return original;
      });
  }

  function rewriteReferences(text, message, warnings = []) {
    const metadata = message.metadata || {};
    const entries = Array.isArray(metadata.content_references) ? metadata.content_references : [];
    const refsByFile = metadata.content_references_by_file;
    const transform = source => {
      let result = source;
      // Direct URL markers carry their destinations in the visible payload.
      const directUrls = new RegExp(OPEN + 'url' + SEP + '([^' + CLOSE + ']*)' + CLOSE, 'g');
      result = result.replace(directUrls, (original, args) => {
        const fields = args.split(SEP);
        const link = markdownLink(fields[1] || fields[0], fields[0]);
        return link || original;
      });
      // ChatGPT API content_references map opaque cite markers to real source URLs.
      const replacementEntries = [...entries];
      if (refsByFile && typeof refsByFile === 'object') {
        for (const refs of Object.values(refsByFile)) {
          if (Array.isArray(refs)) replacementEntries.push(...refs);
        }
      }
      replacementEntries.sort((a, b) => asString(b?.matched_text).length - asString(a?.matched_text).length);
      for (const ref of replacementEntries) {
        if (!ref || !ref.matched_text || !result.includes(ref.matched_text)) continue;
        if (ref.type === 'file') {
          const name = asString(ref.name || ref.alt);
          if (name) result = result.split(ref.matched_text).join('`' + name.replace(/`/g, '') + '`');
          continue;
        }
        const links = referenceLinks(ref);
        if (!links.length) continue; // Never invent URLs for unresolvable references.
        result = result.split(ref.matched_text).join('(' + links.join('; ') + ')');
      }
      return result;
    };
    const revised = outsideCode(text, source => normalizeMath(transform(source)));
    const leftovers = revised.match(/\uE200cite\uE202[^\uE201]*\uE201/g) || [];
    if (leftovers.length) warnings.push(`Unresolved web citations: ${leftovers.length} (source URLs missing from API metadata).`);
    return revised;
  }

  function attachmentsMarkdown(message, text) {
    const attachments = Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : [];
    const result = [];
    const seen = new Set();
    for (const item of attachments) {
      const name = asString(item?.name || item?.file_name || item?.filename || item?.display_name).trim();
      if (!name || seen.has(name) || text.includes(`[Attachment: ${name}]`)) continue;
      seen.add(name);
      result.push(`[Attachment: ${name.replace(/[\r\n\]]/g, ' ')}]`);
    }
    return result.length ? [text, result.join('\n')].filter(Boolean).join('\n\n') : text;
  }

  function normalizeChat(raw, hints = {}) {
    if (!raw || !raw.mapping || typeof raw.mapping !== 'object' || !Object.keys(raw.mapping).length)
      throw new Error('Conversation has no readable mapping; refusing to export an empty document.');
    const mapping = raw.mapping;
    let leaf = raw.current_node;
    if (!leaf || !mapping[leaf]) {
      const leaves = Object.entries(mapping).filter(([, node]) => node &&
        (!Array.isArray(node.children) || !node.children.some(child => mapping[child])));
      if (!leaves.length) throw new Error('Current branch could not be identified.');
      leaves.sort((a, b) => (a[1]?.message?.create_time || 0) - (b[1]?.message?.create_time || 0));
      leaf = leaves.at(-1)[0];
    }
    const path = [], visited = new Set();
    for (let id = leaf; id && mapping[id]; id = mapping[id].parent) {
      if (visited.has(id)) throw new Error('Conversation has cyclic parent links.');
      visited.add(id);
      path.push(mapping[id]);
    }
    path.reverse();
    const messages = [], warnings = [], warningSet = new Set();
    const addWarning = warning => { if (!warningSet.has(warning)) { warnings.push(warning); warningSet.add(warning); } };
    let droppedToolMessages = 0;
    for (const node of path) {
      const msg = node?.message;
      if (!msg || msg.metadata?.is_visually_hidden_from_conversation) continue;
      const role = msg.author?.role;
      const channel = msg.channel || msg.author?.metadata?.channel || msg.metadata?.channel || msg.metadata?.message_type;
      const recipient = msg.recipient || msg.metadata?.recipient || msg.author?.recipient || '';
      const type = msg.content?.content_type || '';
      if (role !== 'assistant' && role !== 'user') continue;
      // Tool invocations and execution output are not conversational text. Code fences
      // inside normal assistant text are preserved by payloadText().
      if ((recipient && recipient !== 'all') || type === 'code' || type === 'execution_output') {
        droppedToolMessages++;
        continue;
      }
      const time = iso(msg.create_time);
      if (type === 'thoughts') {
        const thoughts = (msg.content?.thoughts || []).map(item => {
          const title = asString(item.summary).trim();
          const body = asString(item.content).trim();
          return [title && `**${title}**`, body].filter(Boolean).join('\n\n');
        }).filter(Boolean);
        if (thoughts.length) messages.push({ role: 'thinking', content: thoughts.join('\n\n'), time, id: node.id });
        continue;
      }
      if (type === 'reasoning_recap') {
        const recap = payloadText(msg);
        const duration = Number(msg.metadata?.finished_duration_sec);
        if (recap || Number.isFinite(duration) && msg.metadata?.finished_duration_sec != null)
          messages.push({ role: 'thinking', content: recap, time, id: node.id,
            duration: msg.metadata?.finished_duration_sec == null ? undefined : duration });
        continue;
      }
      // Visible thoughts and recap are handled above, even when they carry an analysis channel.
      if (channel === 'analysis' || channel === 'justify' || channel === 'confidence') continue;
      let body = payloadText(msg);
      if (!body && type && !['text', 'multimodal_text'].includes(type))
        addWarning(`Unsupported ${role} content type: ${type} (${node.id}).`);
      if (body) body = rewriteReferences(body, msg, warnings);
      if (role === 'user') body = attachmentsMarkdown(msg, body);
      if (!body) continue;
      messages.push({ role, content: body, time, id: node.id,
        model: asString(msg.metadata?.model_slug || msg.metadata?.default_model_slug),
        duration: role === 'assistant' && msg.metadata?.finished_duration_sec != null
          && Number.isFinite(Number(msg.metadata.finished_duration_sec))
          ? Number(msg.metadata.finished_duration_sec) : undefined });
    }
    // Dropped tool traffic is intentional and should not pollute the output document.
    if (!messages.some(message => message.role === 'user' || message.role === 'assistant'))
      throw new Error('No visible user/assistant text found in selected branch.');
    const id = asString(raw.conversation_id || raw.id || hints.id);
    const rawGizmoId = asString(hints.containerObserved===true ?
      (hints.gptId || hints.projectId || '') :
      (hints.gptId || hints.projectId || raw.gizmo_id || raw.gizmo?.id));
    const projectId = /^g-p-[a-f0-9]{32}(?=-|$)/i.exec(rawGizmoId)?.[0] || '';
    const gptId = !projectId && /^g-(?!p-)[a-z0-9_-]{6,128}$/i.test(rawGizmoId) ? rawGizmoId : '';
    const projectName = projectId ? asString(hints.project || raw.gizmo?.display?.name || raw.gizmo?.name) : '';
    const gptName = gptId ? asString(hints.gptName || raw.gizmo?.display?.name || raw.gizmo?.name) : '';
    const origin = asString(hints.origin || 'https://chatgpt.com').replace(/\/$/, '');
    const projectPath = /^g-p-[a-z0-9-]+$/i.test(projectId) ? `/g/${projectId}` : '';
    const source = asString(hints.source) || (origin + projectPath + '/c/' + encodeURIComponent(id));
    const genericTitle=x=>/^(new chat|untitled chat)$/i.test(String(x||'').trim());
    const title=genericTitle(raw.title)&&!genericTitle(hints.title)?hints.title:raw.title||hints.title;
    return { id, title: asString(title || 'Untitled chat'),
      created: iso(raw.create_time), updated: iso(raw.update_time),
      archived:typeof hints.archived==='boolean'?hints.archived:Boolean(raw.is_archived),
      projectId, projectName, gptId, gptName, source, messages, warnings: [...new Set(warnings)], branchNode: leaf,
      stats: { droppedToolMessages } };
  }

  function yamlValue(value) { return JSON.stringify(String(value ?? '')); }
  function humanDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor(rounded % 3600 / 60);
    const rest = rounded % 60;
    return [hours && `${hours}h`, minutes && `${minutes}m`, `${rest}s`].filter(Boolean).join(' ');
  }
  function quoteText(text) {
    return text.split('\n').map(line => line ? '> ' + line : '>').join('\n');
  }
  // Dates on message headings deliberately use the Exporter example's en-US
  // 12-hour notation, in the exporting browser's local timezone. YAML stays UTC.
  function messageDate(value, timeZone) {
    const timestamp = iso(value);
    if (!timestamp) return '';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric',
      minute: '2-digit', second: '2-digit', hour12: true,
      ...(timeZone ? { timeZone } : {})
    }).format(new Date(timestamp)).replace(/[\u00a0\u202f]/g, ' ');
  }
  function timingLine(line) {
    const plain = String(line).trim().replace(/^(?:>\s*)+/, '').replace(/^\*\*|\*\*$/g, '').trim();
    const m = /^(Worked|Thinking|Thought) for\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)\.?$/i.exec(plain);
    const durationOnly = /^Duration:\s*(\d+(?:\.\d+)?)\s*(?:s|seconds?)\.?$/i.exec(plain);
    if (durationOnly) return { seconds: Number(durationOnly[1]), label: 'Worked for' };
    if (!m) return null;
    let seconds = 0;
    for (const part of m[2].matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi)) {
      seconds += Number(part[1]) * (/^h/i.test(part[2]) ? 3600 : /^m/i.test(part[2]) ? 60 : 1);
    }
    return { seconds, label: /^work/i.test(m[1]) ? 'Worked for' : 'Thinking for' };
  }
  function cleanThinking(text) {
    // Only strip standalone generated duration lines in reasoning blocks.
    // Never strip user/assistant prose or code examples that happen to say this.
    return outsideCode(String(text || ''), prose => prose.split('\n')
      .filter(line => !timingLine(line)).join('\n')).trim();
  }
  function turnTiming(turn) {
    const captions = [];
    for (const m of turn) if (m.role === 'thinking') {
      outsideCode(String(m.content || ''), prose => {
        for (const line of prose.split('\n')) { const value = timingLine(line); if (value) captions.push(value); }
        return prose;
      });
    }
    const duration = [...turn].reverse().find(m => Number.isFinite(m.duration) && m.duration >= 0)?.duration;
    const caption = captions.at(-1);
    if (Number.isFinite(duration)) return `${caption?.label || 'Worked for'} ${humanDuration(duration)}`;
    return caption ? `${caption.label} ${humanDuration(caption.seconds)}` : '';
  }
  function renderThinking(items, output) {
    const content = items.map(item => cleanThinking(item.content)).filter(Boolean).join('\n\n');
    if (!content) return;
    output.push('### Thinking (provided by ChatGPT)', '', quoteText(content), '');
  }

  function renderMarkdown(chat, info = {}) {
    const value = chat.title.replace(/[\r\n]+/g, ' ').trim();
    const title = value.replace(/^(#+\s*)/, '\\$1');
    const output = [
      '---', `title: ${yamlValue(value)}`, 'provider: chatgpt',
      `workspace: ${yamlValue(info.workspace || '')}`,
      `project: ${yamlValue(info.project || chat.projectName || (chat.projectId ? 'Project_' + chat.projectId.slice(-12) : ''))}`,
      `project_id: ${yamlValue(chat.projectId||'')}`,
      `archived: ${chat.archived===true}`,
      ...(chat.gptId || info.gptId ? [`container_type: ${yamlValue('gpt')}`,
        `container_id: ${yamlValue(info.gptId || chat.gptId)}`,
        `gpt: ${yamlValue(info.gptName || chat.gptName || '')}`] : []),
      `conversation_id: ${yamlValue(chat.id)}`,
      `source: ${yamlValue(chat.source || 'https://chatgpt.com/c/' + chat.id)}`,
      `created: ${yamlValue(chat.created)}`,
      `updated: ${yamlValue(chat.updated)}`,
      `exported: ${yamlValue(info.exportedAt || new Date().toISOString())}`,
      '---', '', `# ${title}`, '',
    ];
    let i = 0;
    while (i < chat.messages.length) {
      const current = chat.messages[i];
      if (current.role === 'user') {
        output.push('## Prompt:', messageDate(current.time, info.timeZone) || 'Timestamp unavailable', '', current.content, '');
        i++;
        continue;
      }
      // One logical assistant response can contain a preamble, several reasoning
      // fragments, and a final answer. It must not receive multiple headings.
      const turn = [];
      while (i < chat.messages.length && chat.messages[i].role !== 'user') turn.push(chat.messages[i++]);
      const model = [...turn].reverse().find(message => message.model)?.model || '';
      const time = turn.find(message => iso(message.time))?.time;
      const header = [messageDate(time, info.timeZone) || 'Timestamp unavailable',
        model.replace(/[\r\n]/g, ''), turnTiming(turn)].filter(Boolean).join(' \u00b7 ');
      output.push('## Response:', header, '');
      let thinking = [];
      const flushThinking = () => { renderThinking(thinking, output); thinking = []; };
      for (const message of turn) {
        if (message.role === 'thinking') thinking.push(message);
        else {
          flushThinking();
          if (message.content.trim()) output.push(message.content, '');
        }
      }
      flushThinking();
    }
    if (chat.warnings?.length) {
      output.push('---', '', '### Export notes', '', ...chat.warnings.map(w => `- ${w}`), '');
    }
    return output.join('\n').trimEnd() + '\n';
  }

  function safeFilename(value, max = 100) {
    const text = String(value || 'Untitled').normalize('NFC')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/[.\s]+$/g, '').trim();
    return Array.from(text).slice(0, max).join('') || 'Untitled';
  }

  const api = { normalizeChat, renderMarkdown, safeFilename, iso, payloadText,
    normalizeMath, rewriteReferences, outsideCode, attachmentsMarkdown, messageDate, turnTiming, cleanThinking };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveNormalize = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
