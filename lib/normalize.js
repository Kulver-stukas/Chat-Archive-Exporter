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

  function selectionPolicy() {
    if (root.ChatArchiveExportSelection) return root.ChatArchiveExportSelection;
    if (typeof require === 'function') return require('./export-selection.js');
    throw new Error('Selective export helper is unavailable. Reload the extension.');
  }

  function safeSandboxPath(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    let path = value.replace(/^sandbox:/, '');
    try { path = decodeURIComponent(path); } catch { return null; }
    if (!path.startsWith('/mnt/data/') || /[\\\x00-\x1f\x7f?#]/.test(path) ||
        path.split('/').slice(1).some(part => part === '.' || part === '..' || !part)) return null;
    if (path.endsWith('/')) return null;
    return path;
  }

  // Read only real Markdown links in prose. Examples inside fenced/inline code
  // remain examples and cannot authorize a file read.
  function mapSandboxLinks(text, transform) {
    return outsideCode(String(text || ''), prose => prose.replace(
      /(!?)\[([^\]\n]*(?:\\\][^\]\n]*)*)\]\(\s*(?:<(sandbox:\/[^>\r\n]+)>|(sandbox:\/(?:\\.|[^()\s]|\([^()]*\))+))\s*\)/g,
      (whole, image, label, angle, plain) => transform({whole, image:!!image, label,
        raw:angle || plain, path:safeSandboxPath(angle || plain)})));
  }

  function payloadTextWithoutFiles(message) {
    function textPart(part) {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      for (const key of ['text','content','transcription','transcript','input_text'])
        if (typeof part[key] === 'string') return part[key];
      if (Array.isArray(part.content)) return part.content.map(textPart).filter(Boolean).join('\n');
      if (Array.isArray(part.parts)) return part.parts.map(textPart).filter(Boolean).join('\n');
      return '';
    }
    const c=message.content || {}, fallback=message.metadata?.model_dil_v2?.fallbackMarkdown;
    if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
    if (typeof c.text === 'string') return c.text.trim();
    if (Array.isArray(c.parts)) return c.parts.map(textPart).filter(Boolean).join('\n\n').trim();
    if (typeof c.content === 'string') return c.content.trim();
    if (Array.isArray(c.content)) return c.content.map(textPart).filter(Boolean).join('\n\n').trim();
    return '';
  }

  function attachmentReferences(message, messageId, conversationId='', knownOrigins=null) {
    const role=message.author?.role,origin=role==='user'?'uploaded':role==='assistant'?'generated':null;
    if(!origin)return [];
    const output=[],seen=new Map(),explicitKeys=new Set();
    const goodFile=v=>typeof v==='string'&&/^file[_-][a-zA-Z0-9_-]{1,120}$/.test(v);
    function fileFrom(value){
      if(value&&typeof value==='object')value=value.file_id||value.id||value.asset_pointer;
      if(goodFile(value))return value;
      if(typeof value!=='string')return null;
      // Provider pointers can carry transformation query parameters. Keep only
      // the validated file ID, never the parameters or URL.
      const m=/^(?:sediment|file-service):\/\/(file[_-][a-zA-Z0-9_-]{1,120})(?:\?[^\s#]*)?$/.exec(value);
      return m?m[1]:null;
    }
    function add(raw, fallbackName, forcedOrigin=null){
      if(!raw||typeof raw!=='object')return;
      const fileId=[raw.file_id,raw.id,raw.asset_pointer,raw.audio_asset_pointer].map(fileFrom).find(Boolean)||null;
      const sandboxPath=safeSandboxPath(raw.sandbox_path||raw.sandboxPath||raw.path||'');
      const explicitName=raw.name||raw.file_name||raw.filename||raw.display_name;
      const name=asString(explicitName||raw.title||fallbackName||
        (sandboxPath?sandboxPath.split('/').at(-1):fileId||'Attachment')).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,1000).trim()||'Attachment';
      const mime=asString(raw.mime_type||raw.mimeType||raw.metadata?.mime_type||raw.content_type).slice(0,200)||null;
      const image=raw.content_type==='image_asset_pointer'||raw.type==='image_asset_pointer'||/^image\//i.test(mime||'')||/\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|svg|ico)$/i.test(name);
      const key=fileId?'file:'+fileId:sandboxPath?'sandbox:'+conversationId+':'+messageId+':'+sandboxPath:
        'unresolved:'+messageId+':'+output.length;
      const observedOrigin=raw.origin||raw.file_origin||raw.source_type;
      const explicit=forcedOrigin||(['uploaded','generated'].includes(observedOrigin)?observedOrigin:null);
      const resolvedOrigin=explicit||(origin==='generated'&&fileId&&knownOrigins?.get(fileId)==='uploaded'?'uploaded':origin);
      const old=seen.get(key);
      if(old){
        if(old.name==='Attachment'&&name!=='Attachment')old.name=name;
        if(image)old.mediaClass='image';
        if(image&&/^image\//i.test(mime||'')&&!/^image\//i.test(old.mimeType||''))old.mimeType=mime;
        if(explicit&&!explicitKeys.has(key)){old.origin=resolvedOrigin;explicitKeys.add(key);}
        return;
      }
      const size=raw.size_bytes??raw.file_size_bytes??raw.size;
      const item={key,origin:resolvedOrigin,fileId,sandboxPath,name,
        mimeType:mime,...(image?{mediaClass:'image'}:{}),
        sizeBytes:Number.isSafeInteger(size)&&size>=0?size:null,messageId};
      seen.set(key,item);output.push(item);if(explicit)explicitKeys.add(key);
    }
    for(const a of Array.isArray(message.metadata?.attachments)?message.metadata.attachments:[])add(a);
    let visited=0;
    function walk(part,depth=0){
      if(!part||typeof part!=='object'||depth>12||++visited>20000)return;
      if(Array.isArray(part)){for(const p of part)walk(p,depth+1);return;}
      const kind=asString(part.content_type||part.type);
      if(part.asset_pointer||part.audio_asset_pointer||part.file_id||
         /^(image_asset_pointer|audio_asset_pointer|file|file_asset_pointer|video_frame)$/.test(kind)){
        add(part,/image/.test(kind)?asString(message.metadata?.image_gen_title)||'Image '+(fileFrom(part.asset_pointer)||fileFrom(part.file_id)||'').slice(-12):/audio/.test(kind)?'Audio':/video/.test(kind)?'Video frame':'Attachment');
      }
      for(const k of ['parts','content','image','audio','video_frame','audio_asset_pointer'])
        if(part[k]&&typeof part[k]==='object')walk(part[k],depth+1);
    }
    walk(message.content);
    if(origin==='generated')mapSandboxLinks(payloadTextWithoutFiles(message),ref=>{
      if(ref.path)add({sandbox_path:ref.path,name:ref.path.split('/').at(-1)});return ref.whole;
    });
    // File citations can refer to an uploaded source inside an assistant answer.
    // Do not misclassify every citation as a newly generated attachment.
    const refs=[...(Array.isArray(message.metadata?.content_references)?message.metadata.content_references:[])];
    const byFile=message.metadata?.content_references_by_file;
    if(byFile&&typeof byFile==='object')for(const list of Object.values(byFile))if(Array.isArray(list))refs.push(...list);
    for(const ref of refs){
      if(ref?.type!=='file')continue;
      const explicit=ref.origin||ref.file_origin||ref.source_type;
      if(['uploaded','generated'].includes(explicit))add(ref,ref.alt,explicit);
      else if(safeSandboxPath(ref.url||ref.path||''))add({...ref,sandbox_path:ref.url||ref.path},ref.alt,'generated');
      else{
        const id=fileFrom(ref.file_id||ref.id),old=id?seen.get('file:'+id):null;
        if(old&&(!old.name||old.name===id))old.name=asString(ref.name||ref.alt)||old.name;
      }
    }
    if(knownOrigins)for(const a of output)if(a.fileId)knownOrigins.set(a.fileId,a.origin);
    return output;
  }

  // Image generation can put the visible binary result in a TOOL node rather
  // than an assistant text node. Recognize only explicit image-generation
  // results on the active branch, never arbitrary tool text or hidden context.
  // The shape (image_gen_title / image_asset_pointer.metadata.dalle) is also
  // handled by the supplied ChatGPT Exporter v6.13.2 reference implementation.
  function generatedToolImageParts(message) {
    if(message?.author?.role!=='tool'||message.metadata?.is_visually_hidden_from_conversation||
       message.metadata?.reasoning_status||['analysis','justify','confidence'].includes(message.channel))return [];
    const titled=typeof message.metadata?.image_gen_title==='string'&&!!message.metadata.image_gen_title.trim();
    const images=[];let count=0;
    function visit(part,depth=0){
      if(!part||typeof part!=='object'||depth>12||++count>20000)return;
      if(Array.isArray(part)){for(const p of part)visit(p,depth+1);return;}
      if(part.content_type==='image_asset_pointer'&&(titled||part.metadata?.dalle)){
        images.push(part);return;
      }
      for(const k of ['parts','content'])if(part[k]&&typeof part[k]==='object')visit(part[k],depth+1);
    }
    visit(message.content);
    return images;
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
    const knownFileOrigins=new Map();
    for (const node of path) {
      const msg = node?.message;
      if (!msg || msg.metadata?.is_visually_hidden_from_conversation) continue;
      const role = msg.author?.role;
      const channel = msg.channel || msg.author?.metadata?.channel || msg.metadata?.channel || msg.metadata?.message_type;
      const recipient = msg.recipient || msg.metadata?.recipient || msg.author?.recipient || '';
      const type = msg.content?.content_type || '';
      if(role==='tool'){
        const parts=generatedToolImageParts(msg);
        if(parts.length){
          const imageMessage={author:{role:'assistant'},content:{content_type:'multimodal_text',parts},
            metadata:{image_gen_title:msg.metadata?.image_gen_title}};
          const attachments=attachmentReferences(imageMessage,node.id,asString(raw.conversation_id||raw.id||hints.id),knownFileOrigins);
          if(attachments.length)messages.push({role:'assistant',content:'',textContent:'',attachments,
            legacyOmitted:true,selectionOnly:true,time:iso(msg.create_time),id:node.id,model:''});
        }
        continue;
      }
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
      const textContent = rewriteReferences(payloadTextWithoutFiles(msg), msg, []);
      const attachments = attachmentReferences(msg, node.id, asString(raw.conversation_id || raw.id || hints.id), knownFileOrigins);
      if (role === 'user') body = attachmentsMarkdown(msg, body);
      if (!body && !attachments.length) continue;
      messages.push({ role, content: body, textContent, attachments, legacyOmitted: !body, time, id: node.id,
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
    if (info.exportSelection != null) return renderSelectedMarkdown(chat, info);
    if(chat.messages.some(m=>m.selectionOnly))chat={...chat,messages:chat.messages.filter(m=>!m.selectionOnly)};
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
      if (current.legacyOmitted) { i++; continue; }
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

  function localAttachmentPath(value) {
    if(typeof value!=='string'||!value||value.length>2048||/^[\/\\]|[\\\x00-\x1f\x7f?#:]/.test(value))return null;
    let decoded;try{decoded=decodeURIComponent(value);}catch{return null;}
    if(/[\\\x00-\x1f\x7f?#:]/.test(decoded)||decoded.split('/').some(x=>!x||x==='.'||x==='..'))return null;
    return value.split('/').map(x=>encodeURIComponent(x)).join('/');
  }
  function fileLabel(value) {
    return String(value||'Attachment').replace(/[\r\n\x00-\x1f\x7f]/g,' ')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/[\\`*_[\]{}]/g,'\\$&');
  }
  function renderSelectedMarkdown(chat,info) {
    const E=selectionPolicy(),p=E.validate(chat,info.exportSelection),ids=p.completeConversation?null:new Set(p.messageIds);
    const results=new Map();
    for(const r of Array.isArray(info.attachmentResults)?info.attachmentResults:[]){
      if(typeof r?.key==='string')results.set(r.key,r);
      for(const key of Array.isArray(r?.keys)?r.keys:[])if(typeof key==='string')results.set(key,r);
    }
    function savedLink(a,label){
      const r=results.get(a.key),path=r?.status==='saved'?localAttachmentPath(r.localPath):null;
      return path?`[${fileLabel(label||a.name)}](<${path}>)`:null;
    }
    function body(m){
      let text=E.textOf(m);
      text=mapSandboxLinks(text,ref=>{
        const a=(m.attachments||[]).find(x=>x.sandboxPath===ref.path);
        if(a&&E.fileEnabled(a,p))return savedLink(a,ref.label)||fileLabel(ref.label||a.name)+' (file unavailable)';
        return fileLabel(ref.label||ref.path?.split('/').at(-1)||'File');
      });
      // Local machine links cannot be portable download targets. Preserve only
      // their display text, without interpreting their filesystem locations.
      return outsideCode(text,prose=>prose.replace(/!?\[([^\]\n]*)\]\(<?file:\/\/[^\s>]+>?\)/gi,(_all,label)=>fileLabel(label)));
    }
    function files(group,output){
      const selected=new Map();
      for(const m of group)for(const a of E.messageFiles(m,p))if(!selected.has(a.key))selected.set(a.key,a);
      for(const origin of ['uploaded','generated']){
        const entries=[...selected.values()].filter(a=>a.origin===origin);if(!entries.length)continue;
        output.push(origin==='uploaded'?'### Uploaded files':'### Generated files','');
        for(const a of entries){
          const link=savedLink(a);if(link){output.push('- '+link);continue;}
          const r=results.get(a.key),status=r?.status;
          const reason=status==='cancelled'?'transfer cancelled':status==='skipped'?'not downloaded':
            status==='failed'?'download failed':!a.fileId&&!a.sandboxPath?'original file identifier unavailable':'original not downloaded';
          output.push('- '+fileLabel(a.name)+' — unavailable ('+reason+').');
        }
        output.push('');
      }
    }
    // Reuse the established header without changing full Vault rendering.
    const header=renderMarkdown({...chat,messages:[],warnings:[]},{...info,exportSelection:undefined}).trimEnd().split('\n');
    const boundary=header.indexOf('---',1),categories=['questions','answers','thinking','uploadedFiles','generatedFiles'].filter(k=>p[k]);
    header.splice(boundary,0,`selection_scope: ${p.completeConversation?'complete':'selected'}`,
      `export_categories: ${JSON.stringify(categories)}`,
      `selected_message_ids: ${JSON.stringify((chat.messages||[]).filter(m=>!ids||ids.has(m.id)).map(m=>m.id))}`,
      `branch_node: ${yamlValue(chat.branchNode||'')}`);
    const output=[...header,''];
    for(const originalGroup of E.groups(chat)){
      const group=originalGroup.filter(m=>!ids||ids.has(m.id));
      if(!group.some(m=>E.messageEligible(m,p)))continue;
      const question=originalGroup[0].role==='user';
      if(question){
        const m=group[0];output.push('## Prompt:',messageDate(m.time,info.timeZone)||'Timestamp unavailable','');
        if(p.questions&&E.textOf(m).trim())output.push(body(m),'');files(group,output);continue;
      }
      const textGroup=group.filter(m=>E.textEnabled(m,p));
      const model=[...group].reverse().find(m=>m.model)?.model||'';
      const time=group.find(m=>iso(m.time))?.time;
      const caption=[messageDate(time,info.timeZone)||'Timestamp unavailable',model.replace(/[\r\n]/g,''),
        p.thinking?turnTiming(group):''].filter(Boolean).join(' \u00b7 ');
      output.push('## Response:',caption,'');
      let thinking=[];const flush=()=>{renderThinking(thinking,output);thinking=[];};
      for(const m of textGroup){
        if(m.role==='thinking')thinking.push({...m,content:body(m)});
        else{flush();if(E.textOf(m).trim())output.push(body(m),'');}
      }
      flush();files(group,output);
    }
    if(chat.warnings?.length)output.push('---','','### Export notes','',...chat.warnings.map(w=>'- '+w),'');
    return output.join('\n').trimEnd()+'\n';
  }

  function safeFilename(value, max = 100) {
    const text = String(value || 'Untitled').normalize('NFC')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/[.\s]+$/g, '').trim();
    return Array.from(text).slice(0, max).join('') || 'Untitled';
  }

  const api = { normalizeChat, renderMarkdown, safeFilename, iso, payloadText,
    normalizeMath, rewriteReferences, outsideCode, attachmentsMarkdown, messageDate, turnTiming, cleanThinking,
    attachmentReferences, safeSandboxPath, mapSandboxLinks, payloadTextWithoutFiles, localAttachmentPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatArchiveNormalize = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
