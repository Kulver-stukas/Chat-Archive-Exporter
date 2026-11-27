/* Provider-neutral Markdown renderer of normalized records.
 * A presentation profile supplies labels, source fallback and generated-link syntax.
 * The legacy ChatGPT profile preserves output bytes exactly.
 */
(function(root){
  'use strict';
  const {iso,outsideCode}=root.ChatArchiveMarkdownPrimitives||require('./markdown-primitives.js');
  function createRenderer(profile){
    if(!profile||!/^\w[\w-]*$/.test(profile.providerId||'')||typeof profile.displayName!=='string'||/[\r\n]/.test(profile.displayName)||typeof profile.defaultSource!=='function'||typeof profile.mapSandboxLinks!=='function')throw Error('Invalid Markdown presentation profile.');
  function selectionPolicy() {
    if (root.ChatArchiveExportSelection) return root.ChatArchiveExportSelection;
    if (typeof require === 'function') return require('./export-selection.js');
    throw new Error('Selective export helper is unavailable. Reload the extension.');
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
    output.push(`### Thinking (provided by ${profile.displayName})`, '', quoteText(content), '');
  }

  function renderMarkdown(chat, info = {}) {
    if (info.exportSelection != null) return renderSelectedMarkdown(chat, info);
    if(chat.messages.some(m=>m.selectionOnly))chat={...chat,messages:chat.messages.filter(m=>!m.selectionOnly)};
    const value = chat.title.replace(/[\r\n]+/g, ' ').trim();
    const title = value.replace(/^(#+\s*)/, '\\$1');
    const output = [
      '---', `title: ${yamlValue(value)}`, `provider: ${profile.providerId}`,
      `workspace: ${yamlValue(info.workspace || '')}`,
      `project: ${yamlValue(info.project || chat.projectName || (chat.projectId ? 'Project_' + chat.projectId.slice(-12) : ''))}`,
      `project_id: ${yamlValue(chat.projectId||'')}`,
      `archived: ${chat.archived===true}`,
      ...(chat.gptId || info.gptId ? [`container_type: ${yamlValue('gpt')}`,
        `container_id: ${yamlValue(info.gptId || chat.gptId)}`,
        `gpt: ${yamlValue(info.gptName || chat.gptName || '')}`] : []),
      `conversation_id: ${yamlValue(chat.id)}`,
      `source: ${yamlValue(chat.source || profile.defaultSource(chat))}`,
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
      text=profile.mapSandboxLinks(text,ref=>{
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

    return Object.freeze({renderMarkdown,safeFilename,iso,outsideCode,messageDate,turnTiming,cleanThinking,localAttachmentPath});
  }
  const api=Object.freeze({createRenderer});
  root.ChatArchiveMarkdown=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
