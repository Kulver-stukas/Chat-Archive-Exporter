/* Same accessible list interaction for chats and Library files. No data access. */
(function(root){
  'use strict';
  const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
  function render(target,{groups,selected,collapsed,onSelect,onToggle,disabled=false,kind='chat'}){
    const scrollTop=target.scrollTop;
    const focusKey=target.contains(document.activeElement)?document.activeElement?.dataset?.focusKey:null;
    target.replaceChildren();target.setAttribute('role','list');
    for(const group of groups){
      const wrap=el('section','group');wrap.setAttribute('role','listitem');
      const head=el('div','group-head');const toggle=el('button','group-toggle',collapsed.has(group.id)?'\u25b8':'\u25be');
      toggle.type='button';toggle.setAttribute('aria-label',(collapsed.has(group.id)?'Expand ':'Collapse ')+group.name);
      toggle.title=(collapsed.has(group.id)?'Expand ':'Collapse ')+group.name;toggle.setAttribute('aria-expanded',String(!collapsed.has(group.id)));toggle.dataset.focusKey='toggle:'+group.id;
      toggle.addEventListener('click',()=>onToggle(group.id));
      const box=el('input','group-checkbox');box.type='checkbox';box.dataset.focusKey='group:'+group.id;
      const ids=group.selectableIds||[];const s=CAEUIState.selection(ids,selected);
      box.checked=s.checked;box.indeterminate=s.mixed;box.disabled=disabled||!ids.length;
      box.setAttribute('aria-label','Select all eligible items in '+group.name);box.title='Select the whole group, including filtered-out items';
      box.addEventListener('change',()=>onSelect(ids,box.checked));
      const name=el('span','group-name',group.name);const count=el('span','group-count',group.countText||String(group.items.length));
      head.append(toggle,box,name,count);wrap.append(head);
      const body=el('div','group-body');body.hidden=collapsed.has(group.id);
      if(group.hint)body.append(el('p','hint group-hint',group.hint));
      for(const item of group.items){
        const row=el('div',kind==='library'?'library-row':'chat-row');row.dataset.itemId=item.id;
        if(item.selectable!==false){
          const b=el('input',kind==='library'?'library-file-checkbox':'chat-checkbox');b.type='checkbox';b.checked=selected.has(item.id);
          b.disabled=disabled||!!item.disabled;b.dataset.focusKey='item:'+item.id;b.dataset.fileId=item.id;
          b.dataset.archived=String(!!item.archived);b.setAttribute('aria-label','Select '+item.title);b.title=item.reason||'Select '+item.title;
          b.addEventListener('change',()=>onSelect([item.id],b.checked));row.append(b);
        }else{const dash=el('span','unavailable-mark','\u2014');dash.title=item.reason||'Not selectable';row.append(dash);}
        const text=el('div','item-copy');const title=el('span','chat-text',item.title);title.title=item.title;text.append(title);
        if(item.note)text.append(el('span','library-note',item.note));row.append(text);
        if(item.badge){const badge=el('span','item-badge',item.badge);badge.title=item.reason||item.badge;row.append(badge);}
        body.append(row);
      }
      wrap.append(body);target.append(wrap);
    }
    if(!groups.length)target.append(el('p','empty-state','No matching items.'));
    target.scrollTop=scrollTop;
    if(focusKey)for(const node of target.querySelectorAll('[data-focus-key]'))if(node.dataset.focusKey===focusKey){node.focus({preventScroll:true});break;}
  }
  root.CAEUITree={render};
})(globalThis);
