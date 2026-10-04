const $=id=>document.getElementById(id);
const chat=$('chat'),input=$('input'),activity=$('activity'),root=$('tree'),projectLabel=$('projectLabel'),modelSelect=$('modelSelect'),jumpLatest=$('jumpLatest');
const chatTab=$('chatTab'),editorTab=$('editorTab'),terminalTab=$('terminalTab'),gitTab=$('gitTab'),tasksTab=$('tasksTab'),testsTab=$('testsTab'),chatWorkspace=$('chatWorkspace'),editorPanel=$('editorPanel'),terminalPanel=$('terminalPanel'),gitPanel=$('gitPanel'),tasksPanel=$('tasksPanel'),testsPanel=$('testsPanel'),editor=$('editor'),lineNumbers=$('lineNumbers'),editorFileLabel=$('editorFileLabel'),saveBtn=$('saveBtn'),diffBtn=$('diffBtn'),undoBtn=$('undoBtn'),diffPanel=$('diffPanel'),diffOutput=$('diffOutput'),closeDiff=$('closeDiff'),diffAllow=$('diffAllow'),diffDeny=$('diffDeny'),diffTitle=$('diffTitle'),diffStatus=$('diffStatus'),terminalInput=$('terminalInput'),terminalOutput=$('terminalOutput'),terminalRun=$('terminalRun'),terminalClear=$('terminalClear'),gitStatus=$('gitStatus'),gitDiff=$('gitDiff'),gitBranches=$('gitBranches'),searchInput=$('searchInput'),searchBtn=$('searchBtn'),stopBtn=$('stop'),modeSelect=$('mode'),tasksList=$('tasksList'),attachments=$('attachments'),trustedLabel=$('trustedLabel'),planBox=$('planBox');
let openFilePath=null,originalFileContent='',projectRoot=null,messages=[],busy=false,stopRequested=false,mode='manual',pendingAttachments=[],currentTask=null,taskSeq=0,terminalOff=null,backgroundOff=null;
window._tasks=[];
const toolDefs=[
{name:'list_files',description:'List files/folders in the selected project.',props:{path:{type:'string'}},req:[]},
{name:'read_file',description:'Read a UTF-8 text file.',props:{path:{type:'string'}},req:['path']},
{name:'search_files',description:'Find files by filename pattern.',props:{pattern:{type:'string'},path:{type:'string'}},req:['pattern']},
{name:'search_content',description:'Search text across project files.',props:{pattern:{type:'string'},path:{type:'string'}},req:['pattern']},
{name:'get_project_context',description:'Get the project tree and package metadata.',props:{},req:[]},
{name:'workspace_status',description:'Check the currently selected project root and whether file/terminal tools are available.',props:{},req:[]},
{name:'write_file',description:'Create or replace a UTF-8 file. Always use diff preview before applying.',props:{path:{type:'string'},content:{type:'string'}},req:['path','content']},
{name:'edit_file',description:'Make one exact replacement in an existing file.',props:{path:{type:'string'},old_text:{type:'string'},new_text:{type:'string'}},req:['path','old_text','new_text']},
{name:'run_command',description:'Run a zsh command in the project. Inspect failures and fix them; do not claim success without a passing result.',props:{command:{type:'string'}},req:['command']},
{name:'run_background',description:'Start a long-running shell command as a background task.',props:{command:{type:'string'},label:{type:'string'}},req:['command']},
{name:'run_parallel_background',description:'Start multiple independent long-running shell commands in parallel. Use only when tasks do not depend on each other.',props:{tasks:{type:'array',items:{type:'object',properties:{command:{type:'string'},label:{type:'string'}}}}},req:['tasks']},
{name:'get_task_status',description:'Get the current status and recent output of a background task.',props:{task_id:{type:'string'}},req:['task_id']},
{name:'create_plan',description:'Create a concise ordered plan for the current task.',props:{title:{type:'string'},steps:{type:'array',items:{type:'string'}}},req:['title','steps']},
{name:'web_search',description:'Search the public web for current documentation, examples, or information.',props:{query:{type:'string'}},req:['query']},
{name:'fetch_url',description:'Fetch and read a public HTTP/HTTPS webpage or documentation URL.',props:{url:{type:'string'}},req:['url']},
{name:'github_search',description:'Search public GitHub code repositories.',props:{query:{type:'string'}},req:['query']},
{name:'npm_info',description:'Get current npm package metadata and latest version.',props:{name:{type:'string'}},req:['name']}
].map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:{type:'object',properties:t.props,required:t.req}}}));
function nearBottom(){return chat.scrollHeight-chat.scrollTop-chat.clientHeight<120}function scrollLatest(force=false){if(force||nearBottom())chat.scrollTop=chat.scrollHeight}function add(role,text,cls=''){const d=document.createElement('div');d.className=`msg ${role} ${cls}`;d.textContent=text;chat.appendChild(d);scrollLatest(true);return d}function log(text,task=currentTask){const row=document.createElement('div');row.className='activity-row';row.innerHTML=`<span class="time">${new Date().toLocaleTimeString()}</span><span>${escapeHtml(text)}</span>`;if(task)row.dataset.task=task.id;activity.appendChild(row);activity.scrollTop=activity.scrollHeight;if(task){task.events.push(text);renderTasks()}}function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function normalized(x){return typeof x==='string'?x:JSON.stringify(x)}
function setWorkspace(which){const map={chat:chatWorkspace,editor:editorPanel,terminal:terminalPanel,git:gitPanel,tasks:tasksPanel,tests:testsPanel};Object.entries(map).forEach(([k,e])=>e.classList.toggle('hidden',k!==which));[chatTab,editorTab,terminalTab,gitTab,tasksTab,testsTab].forEach(b=>b.classList.remove('active'));({chat:chatTab,editor:editorTab,terminal:terminalTab,git:gitTab,tasks:tasksTab,tests:testsTab}[which]).classList.add('active');if(which==='editor')editor.focus();if(which==='terminal')terminalInput.focus()}
function renderTree(items,relPrefix=''){const f=document.createDocumentFragment();for(const x of items){const d=document.createElement('div');d.className=`tree-item ${x.type}`;const rel=relPrefix?`${relPrefix}/${x.name}`:x.name;d.innerHTML=`<span class="tree-icon">${x.type==='dir'?'▸':'•'}</span><span>${escapeHtml(x.name)}</span>`;d.title=rel;if(x.type==='file'){d.classList.add('clickable');d.onclick=()=>openFile(rel)}else d.onclick=()=>d.classList.toggle('expanded');f.appendChild(d);if(x.children){const c=document.createElement('div');c.className='tree-children';c.appendChild(renderTree(x.children,rel));f.appendChild(c)}}return f}
async function refresh(){const t=await window.qwen.tree();root.innerHTML='';root.appendChild(t.length?renderTree(t):document.createTextNode('Empty folder'))}
function updateTrusted(list){trustedLabel.textContent=list.length?`Trusted folders: ${list.join(', ')}`:'Trusted folders: none'}
async function choose(){const r=await window.qwen.chooseFolder();if(!r)return;projectRoot=r.path;projectLabel.textContent=r.path;root.innerHTML='';root.appendChild(renderTree(r.tree));log('Project selected: '+r.path);await saveSession()}
async function trustFolder(){const r=await window.qwen.chooseTrustedFolder();if(r?.roots)updateTrusted(r.roots);if(r?.path)log(`Trusted folder added: ${r.path}`);await saveSession()}
function updateLines(){const n=editor.value.split('\n').length;lineNumbers.textContent=Array.from({length:n},(_,i)=>i+1).join('\n')}
function makeDiff(a,b){const A=a.split('\n'),B=b.split('\n'),o=[],m=Math.max(A.length,B.length);for(let i=0;i<m;i++){if(A[i]===B[i])o.push(`  ${A[i]??''}`);else{if(A[i]!==undefined)o.push(`- ${A[i]}`);if(B[i]!==undefined)o.push(`+ ${B[i]}`)}}return o.join('\n')}
async function openFile(rel){try{const c=await window.qwen.readFile(rel);openFilePath=rel;originalFileContent=c;editor.value=c;updateLines();editorFileLabel.textContent=rel;saveBtn.classList.remove('hidden');diffBtn.classList.remove('hidden');setWorkspace('editor');log(`Opened ${rel}`)}catch(e){add('system',`Could not open ${rel}: ${e.message}`)}}
function showAgentDiff(rel,oldText,newText,title='DIFF PREVIEW'){openFilePath=rel;originalFileContent=oldText;editor.value=newText;updateLines();editorFileLabel.textContent=rel;saveBtn.classList.add('hidden');diffBtn.classList.remove('hidden');diffTitle.textContent=title;diffOutput.textContent=makeDiff(oldText,newText);diffPanel.classList.remove('hidden');setWorkspace('editor');log(`Diff preview: ${rel}`)}
function requestAgentDiffApproval(rel,oldText,newText,label){showAgentDiff(rel,oldText,newText,`PROPOSED ${label.toUpperCase()}`);if(mode==='plan')return Promise.resolve(false);if(mode==='auto')return Promise.resolve(true);diffAllow.classList.remove('hidden');diffDeny.classList.remove('hidden');diffStatus.textContent=' Awaiting approval';return new Promise(resolve=>{const done=v=>{diffAllow.onclick=null;diffDeny.onclick=null;diffAllow.classList.add('hidden');diffDeny.classList.add('hidden');diffStatus.textContent=v?' Approved':' Denied';if(!v)editor.value=oldText;updateLines();resolve(v)};diffAllow.onclick=()=>done(true);diffDeny.onclick=()=>done(false)})}
function askApproval(title,detail){if(mode==='auto')return Promise.resolve(true);if(mode==='plan')return Promise.resolve(false);return new Promise(resolve=>{const o=document.createElement('div');o.className='approval-overlay';const c=document.createElement('div');c.className='approval-modal';c.innerHTML=`<strong>${escapeHtml(title)}</strong><pre>${escapeHtml(detail)}</pre>`;const a=document.createElement('div');a.className='approval-actions';const y=document.createElement('button');y.textContent='Allow';const n=document.createElement('button');n.textContent='Deny';n.className='secondary';const done=v=>{o.remove();resolve(v)};y.onclick=()=>done(true);n.onclick=()=>done(false);a.append(y,n);c.append(a);o.append(c);document.body.append(o);y.focus()})}
function dangerousCommand(c){return /(^|\s)(sudo|rm\s+-rf|mkfs|diskutil\s+erase|shutdown|reboot)(\s|$)/i.test(c)||/curl\s+.*\|\s*(sh|bash|zsh)/i.test(c)}
async function saveEditorFile(){if(!openFilePath)return;const c=editor.value;if(c===originalFileContent)return;const ok=await askApproval('Save file',openFilePath);if(!ok)return;await window.qwen.writeFile(openFilePath,c);originalFileContent=c;log(`✓ Saved ${openFilePath}`);refresh()}
function parseRefs(text){const refs=[];for(const m of String(text).matchAll(/@(file|folder):([^\s]+)/g))refs.push({type:m[1],path:m[2]});return refs}
async function enrichRefs(text){const refs=parseRefs(text),blocks=[];for(const r of refs){try{if(r.type==='file'){const c=await window.qwen.readFile(r.path);blocks.push(`\n[ATTACHED FILE ${r.path}]\n${c.slice(0,60000)}\n[/ATTACHED FILE]`)}else{const tree=await window.qwen.tree(r.path);blocks.push(`\n[ATTACHED FOLDER ${r.path}]\n${JSON.stringify(tree)}\n[/ATTACHED FOLDER]`)}}catch(e){blocks.push(`\n[REFERENCE ERROR ${r.path}] ${e.message}`)}}return text+blocks.join('\n')}
function buildSystemPrompt(){let modeText=mode==='plan'?'PLAN mode: inspect/read/search/web/plan tools are allowed, but NEVER modify files or run shell commands. Return a useful ordered plan.':mode==='auto'?'AUTO mode: use safe tools directly; destructive commands still require confirmation.':'MANUAL mode: writes/edits/commands require approval.';return `You are Qwen Agent V13, a local desktop coding + cowork-style agent. Project root: ${projectRoot}. Trusted folders: ${JSON.stringify(window._trustedRoots||[])}. ${modeText}\nUse tools instead of merely describing actions. Inspect before modifying. Never claim success without a real tool result. For coding tasks, test the result. If a command fails, read the exact stdout/stderr, diagnose it, fix the relevant file, and rerun the test. Do not repeat the same failing command more than 2 times without changing the diagnosis. For current documentation or external research, use web_search/fetch_url. Use @file and @folder references when supplied. For long-running work use run_background or run_parallel_background when tasks are independent. Use get_task_status to monitor background work. You may create a plan with create_plan before execution. Work autonomously through multi-step tasks until the requested outcome is actually verified. Prefer parallel safe reads/searches when the model returns multiple independent tool calls. Never stop at a plan unless the user explicitly requested plan-only work.`}
function showPlan(title,steps){planBox.classList.remove('hidden');planBox.textContent=`${title}\n\n`+steps.map((s,i)=>`${i+1}. ${s}`).join('\n');setWorkspace('tasks');log(`Plan created: ${title}`)}
function renderTasks(){tasksList.innerHTML='';for(const t of window._tasks||[]){const d=document.createElement('div');d.className='task-card';d.innerHTML=`<div><b>${escapeHtml(t.label)}</b><span class="task-state ${t.state}">${t.state}</span></div><small>${escapeHtml(t.command||'Agent task')} · ${t.events?.length||0} events</small><pre>${escapeHtml((t.events||[]).slice(-8).join('\n'))}</pre>`;if(t.backgroundId&&['running','paused','interrupted','failed','stopped'].includes(t.state)){const a=document.createElement('div');a.className='task-actions';if(t.state==='running'){const b=document.createElement('button');b.textContent='Pause';b.onclick=async()=>{const r=await window.qwen.pauseBackground(t.backgroundId);if(r.ok)t.state='paused';renderTasks();saveSession()};a.appendChild(b)}if(['paused','interrupted','failed','stopped'].includes(t.state)){const b=document.createElement('button');b.textContent='Resume';b.onclick=async()=>{const r=await window.qwen.resumeBackground(t.backgroundId);if(r.ok)t.state='running';renderTasks();saveSession()};a.appendChild(b)}if(['running','paused'].includes(t.state)){const b=document.createElement('button');b.textContent='Stop';b.onclick=async()=>{await window.qwen.stopBackground(t.backgroundId);t.state='stopped';renderTasks();saveSession()};a.appendChild(b)}d.appendChild(a)}tasksList.appendChild(d)}}
async function runBackground(command,label='Background command'){if(dangerousCommand(command)){const ok=await askApproval('Potentially dangerous background command',command);if(!ok)return null}const id=await window.qwen.startBackground(command,label);const t={id:++taskSeq,label,command,state:'running',events:[`Started ${command}`],backgroundId:id.id};window._tasks.unshift(t);renderTasks();setWorkspace('tasks');log(`Background task started: ${label}`,t);await saveSession();return t}
async function executeTool(call){const name=call?.function?.name;let args={};try{const raw=call?.function?.arguments;args=typeof raw==='object'?raw:(raw?JSON.parse(raw):{})}catch{return{error:'Invalid tool arguments'}}log(`→ ${name}`);try{
if(name==='list_files'){const r=await window.qwen.tree(args.path||'.');log('✓ list_files');return{tree:r}}
if(name==='read_file'){const r=await window.qwen.readFile(args.path);log(`✓ read_file ${args.path}`);return{path:args.path,content:r}}
if(name==='search_files'){const r=await window.qwen.searchFiles(args.pattern,args.path||'.');log('✓ search_files');return{matches:r}}
if(name==='search_content'){const r=await window.qwen.searchContent(args.pattern,args.path||'.');log('✓ search_content');return{matches:r}}
if(name==='get_project_context'){const r=await window.qwen.projectContext();log('✓ project_context');return r}
if(name==='workspace_status'){const r=await window.qwen.workspaceStatus();log('✓ workspace_status');return r}
if(name==='create_plan'){showPlan(String(args.title||'Plan'),Array.isArray(args.steps)?args.steps.map(String):[]);return{ok:true,title:args.title,steps:args.steps}}
if(name==='web_search'){const r=await window.qwen.webSearch(args.query);log(`✓ web_search: ${args.query}`);return r}
if(name==='fetch_url'){const r=await window.qwen.fetchUrl(args.url);log(`✓ fetch_url: ${args.url}`);return{url:args.url,status:r.status,contentType:r.contentType,text:r.text.slice(0,120000)}}
if(name==='github_search'){const r=await window.qwen.githubSearch(args.query);log(`✓ github_search: ${args.query}`);return{matches:r}}
if(name==='npm_info'){const r=await window.qwen.npmInfo(args.name);log(`✓ npm_info: ${args.name}`);return r}
if(name==='write_file'){const p=String(args.path),n=String(args.content??'');let o='';try{o=await window.qwen.readFile(p)}catch{}const ok=await requestAgentDiffApproval(p,o,n,'file write');if(!ok){log('✗ denied write_file');return{denied:true}}await window.qwen.writeFile(p,n);await refresh();log(`✓ write_file ${p}`);return{ok:true,path:p}}
if(name==='edit_file'){const p=String(args.path),o=await window.qwen.readFile(p),expected=String(args.old_text??''),n=o.includes(expected)?o.replace(expected,String(args.new_text??'')):o;if(!o.includes(expected))return{error:'old_text not found'};const ok=await requestAgentDiffApproval(p,o,n,'file edit');if(!ok){log('✗ denied edit_file');return{denied:true}}await window.qwen.editFile(p,expected,String(args.new_text??''));await refresh();log(`✓ edit_file ${p}`);return{ok:true,path:p}}
if(name==='run_command'){if(mode==='plan')return{denied:true,reason:'Plan mode'};if(dangerousCommand(args.command)){const ok=await askApproval('Potentially dangerous command',args.command);if(!ok)return{denied:true}}else{const ok=await askApproval('Allow terminal command',args.command);if(!ok)return{denied:true}}setWorkspace('terminal');terminalOutput.textContent+=`\n$ ${args.command}\n`;const r=await window.qwen.runCommand(args.command);if(!r.ok)log(`✗ command failed (exit ${r.code})`);else log('✓ command passed');return r}
if(name==='run_background'){if(mode==='plan')return{denied:true,reason:'Plan mode'};const t=await runBackground(args.command,args.label||args.command);return t?{started:true,taskId:t.id,label:t.label}:{denied:true}}
if(name==='run_parallel_background'){if(mode==='plan')return{denied:true,reason:'Plan mode'};const tasks=Array.isArray(args.tasks)?args.tasks.slice(0,8):[];const started=await Promise.all(tasks.map(x=>runBackground(x.command,x.label||x.command)));return{started:started.filter(Boolean).map(t=>({taskId:t.backgroundId,label:t.label,command:t.command}))}}
if(name==='get_task_status'){const id=String(args.task_id||'');const t=(window._tasks||[]).find(x=>x.backgroundId===id)||null;if(t)return{taskId:id,state:t.state,label:t.label,command:t.command,recentOutput:(t.events||[]).slice(-12)};return await window.qwen.backgroundStatus(id)}
return{error:'Unknown tool '+name}}catch(e){log(`✗ ${name}: ${e.message}`);return{error:e.message}}}


function parseToolArguments(raw){
  if(raw && typeof raw === 'object') return raw;
  if(!raw) return {};
  let text=String(raw).trim();

  // Remove common markdown fences.
  text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');

  try{return JSON.parse(text)}catch{}

  // Some Qwen outputs use Python-ish single quotes.
  try{
    const normalized=text
      .replace(/([{,]\s*)'([^']+?)'\s*:/g,'$1"$2":')
      .replace(/:\s*'([^']*)'/g,':"$1"');
    return JSON.parse(normalized);
  }catch{}

  return {};
}

function normalizeOneToolCall(name,args){
  name=String(name||'').trim();
  if(!name)return null;

  let parsedArgs={};

  if(args && typeof args==='object'){
    parsedArgs=args;
  }else if(typeof args==='string'){
    const text=args.trim();
    if(text){
      try{
        parsedArgs=JSON.parse(text);
      }catch{
        // Never send malformed JSON to Ollama.
        return null;
      }
    }
  }

  if(!parsedArgs || typeof parsedArgs!=='object' || Array.isArray(parsedArgs)){
    return null;
  }

  return {
    id:`call_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type:'function',
    function:{
      name,
      arguments:parsedArgs
    }
  };
}

function parseToolCalls(text){
  const source=String(text||'');
  const calls=[];

  // <tool_call>{"name":"list_files","arguments":{...}}</tool_call>
  for(const m of source.matchAll(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi)){
    const body=m[1].trim();
    try{
      const obj=JSON.parse(body);
      const c=normalizeOneToolCall(
        obj.name||obj.function?.name,
        obj.arguments??obj.function?.arguments??{}
      );
      if(c)calls.push(c);
    }catch{
      const name=body.match(/["']?name["']?\s*:\s*["']([^"']+)["']/i)?.[1];
      const args=body.match(/["']?arguments["']?\s*:\s*(\{[\s\S]*\})/i)?.[1];
      const c=normalizeOneToolCall(name,args||{});
      if(c)calls.push(c);
    }
  }

  // <function=list_files>...</function>
  for(const m of source.matchAll(/<function\s*=\s*([A-Za-z0-9_.:-]+)\s*>([\s\S]*?)<\/function>/gi)){
    const name=m[1];
    const body=m[2].trim();
    let args=parseToolArguments(body);

    // Handle <parameter=foo>bar</parameter>
    if(!Object.keys(args).length){
      const params={};
      for(const pm of body.matchAll(/<parameter\s*=\s*([^>]+)>([\s\S]*?)<\/parameter>/gi)){
        params[pm[1].trim()]=pm[2].trim();
      }
      args=params;
    }

    const c=normalizeOneToolCall(name,args);
    if(c)calls.push(c);
  }

  // Bare JSON tool call.
  for(const m of source.matchAll(/\{[\s\S]*?"(?:name|function)"\s*:[\s\S]*?\}/g)){
    try{
      const obj=JSON.parse(m[0]);
      const c=normalizeOneToolCall(
        obj.name||obj.function?.name,
        obj.arguments??obj.function?.arguments??{}
      );
      if(c && !calls.some(x=>x.function.name===c.function.name &&
        x.function.arguments===c.function.arguments)) calls.push(c);
    }catch{}
  }

  // Remove duplicate calls.
  return calls.filter((c,i,a)=>i===a.findIndex(x=>
    x.function.name===c.function.name &&
    x.function.arguments===c.function.arguments
  ));
}

function stripToolSyntax(text){
  return String(text||'')
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi,'')
    .replace(/<function\s*=[^>]+>[\s\S]*?<\/function>/gi,'')
    .trim();
}

function normalizeModelToolCalls(message, streamedText=''){
  const native=Array.isArray(message?.tool_calls)?message.tool_calls:[];
  const textual=parseToolCalls(
    `${message?.content||''}\n${streamedText||''}`
  );

  const calls=[];

  for(const c of native){
    const name=String(c?.function?.name||'').trim();
    if(!name)continue;

    let args={};
    try{
      const raw=c?.function?.arguments;
      args=raw && typeof raw==='object'
        ? raw
        : raw
          ? JSON.parse(String(raw))
          : {};
    }catch{
      log(`✗ Ignoring malformed native tool call: ${name}`);
      continue;
    }

    const normalized=normalizeOneToolCall(name,args);
    if(normalized)calls.push(normalized);
  }

  for(const c of textual){
    if(!c?.function?.name)continue;

    const duplicate=calls.some(x=>
      x.function.name===c.function.name &&
      String(x.function.arguments||'')===String(c.function.arguments||'')
    );

    if(!duplicate)calls.push(c);
  }

  return {
    calls,
    cleanContent:stripToolSyntax(message?.content||streamedText||'')
  };
}

async function agentLoop(userText){
  if(!projectRoot){add('system','Choose a project folder first.');return}
  if(busy)return;
  busy=true;stopRequested=false;stopBtn.classList.remove('hidden');
  currentTask={id:++taskSeq,label:userText.slice(0,70),state:'running',events:[],changes:[]};
  window._tasks.unshift(currentTask);renderTasks();add('user',userText);
  const enriched=await enrichRefs(userText);const userMsg={role:'user',content:enriched};
  const imgs=pendingAttachments.filter(a=>a.data).map(a=>a.data);if(imgs.length)userMsg.images=imgs;
  messages.push(userMsg);await saveSession();
  try{
    const config=await window.qwen.getConfig();let repeatedErrors=0,lastError='';
    const safeParallel=new Set(['list_files','read_file','search_files','search_content','get_project_context','workspace_status','web_search','fetch_url','github_search','npm_info','get_task_status']);
    for(let step=0;step<40&&!stopRequested;step++){
      log(`Model step ${step+1}`);let liveText='';document.querySelector('.msg.live')?.remove();
      const off=window.qwen.onChatChunk(({chunk})=>{const c=chunk?.message?.content||'';if(c){
          liveText+=c;
          const visible=stripToolSyntax(liveText);
          let el=document.querySelector('.msg.live');
          if(visible){
            if(!el){el=add('assistant','');el.classList.add('live')}
            el.textContent=visible;
          }else if(el){
            el.textContent='';
          }
        }});
      let r;try{r=await window.qwen.chatStream({model:config.model,messages:[{role:'system',content:buildSystemPrompt()},...messages],tools:toolDefs,options:{num_ctx:65536,temperature:.2}})}finally{off()}
      document.querySelector('.msg.live')?.classList.remove('live');
      const m=r.message||{};
      const normalizedTools=normalizeModelToolCalls(m,liveText);
      const calls=normalizedTools.calls;
      const cleanContent=normalizedTools.cleanContent;
      const am={role:'assistant',content:cleanContent};

      if(calls.length){
        am.tool_calls=calls.map(c=>({
          id:c.id,
          type:'function',
          function:{
            name:String(c.function?.name||''),
            arguments:c.function?.arguments || {}
          }
        }));
      }

      messages.push(am);
      if(!calls.length){
        const refusal=/restricted environment|cannot (create|modify|access) files|file operations (are|is) (disabled|limited)|no project folder|unable to (create|modify) files|can't (create|modify) files/i.test(m.content||liveText);
        if(refusal&&projectRoot&&step<3){messages.push({role:'user',content:'You are running inside a desktop app with a real selected project root and executable tools. Do not describe limitations. Use workspace_status first, then perform the requested task with the appropriate tool.'});log('Model refused tool use; sending workspace/tool-use correction');continue}
        log('Agent finished');break;
      }
      const groups=[];let current=[];
      for(const call of calls){if(safeParallel.has(call.function?.name))current.push(call);else{if(current.length)groups.push(current),current=[];groups.push([call])}}
      if(current.length)groups.push(current);
      for(const group of groups){
        if(stopRequested)break;
        const results=group.length>1?await Promise.all(group.map(executeTool)):[await executeTool(group[0])];
        for(let gi=0;gi<group.length;gi++){
          const call=group[gi],result=results[gi],resultText=normalized(result);
          const toolName=call.function?.name||'unknown';
          const toolCallId=call.id||call.tool_call_id||`call_${Date.now()}_${gi}`;

          messages.push({
            role:'tool',
            tool_call_id:toolCallId,
            name:toolName,
            content:String(resultText)
          });
          if(!result.ok&&result.error){const signature=String(result.error);if(signature===lastError)repeatedErrors++;else{lastError=signature;repeatedErrors=1}if(repeatedErrors>=3){log('Stopped repeated identical errors');add('system',`Stopped after 3 identical errors: ${signature}`);stopRequested=true;break}}
          else if(result.ok)repeatedErrors=0;
          if(['write_file','edit_file'].includes(call.function?.name)&&result.ok)currentTask.changes.push(call.function.arguments?.path||'unknown');
          await saveSession();
        }
      }
    }
  }catch(e){if(!stopRequested)add('system','Agent error: '+e.message)}
  finally{currentTask.state=stopRequested?'stopped':'done';renderTasks();busy=false;stopBtn.classList.add('hidden');await saveSession()}
}
async function saveSession(){await window.qwen.sessionSave({projectRoot,messages,mode,tasks:window._tasks,model:modelSelect.value||'',savedAt:new Date().toISOString()})}
async function resumeSession(){const s=await window.qwen.sessionLoad();if(!s)return;projectRoot=s.projectRoot||null;messages=s.messages||[];mode=s.mode||'manual';modeSelect.value=mode;window._tasks=(s.tasks||[]).map(t=>t.state==='running'?{...t,state:'interrupted'}:t);window._trustedRoots=s.trustedRoots||[];updateTrusted(window._trustedRoots);if(projectRoot){projectLabel.textContent=projectRoot;await refresh()}chat.innerHTML='';for(const m of messages){if(m.role==='user')add('user',m.content.replace(/\n\[ATTACHED[\s\S]*?\[\/ATTACHED (?:FILE|FOLDER)\]/g,''));else if(m.role==='assistant'&&m.content)add('assistant',m.content)}renderTasks();log('Session resumed')}
chatTab.onclick=()=>setWorkspace('chat');editorTab.onclick=()=>setWorkspace('editor');terminalTab.onclick=()=>setWorkspace('terminal');gitTab.onclick=()=>{setWorkspace('git');refreshGit()};tasksTab.onclick=()=>{setWorkspace('tasks');renderTasks()}; testsTab.onclick=()=>setWorkspace('tests');saveBtn.onclick=saveEditorFile;undoBtn.onclick=async()=>{const r=await window.qwen.undoLastChange();log(r.ok?`↶ reverted ${r.path}`:r.message);refresh()};diffBtn.onclick=()=>{diffOutput.textContent=makeDiff(originalFileContent,editor.value);diffPanel.classList.remove('hidden');setWorkspace('editor')};closeDiff.onclick=()=>diffPanel.classList.add('hidden');editor.addEventListener('input',updateLines);editor.addEventListener('scroll',()=>lineNumbers.scrollTop=editor.scrollTop);editor.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveEditorFile()}});
terminalOff=window.qwen.onTerminalChunk(({text})=>{terminalOutput.textContent+=text;terminalOutput.scrollTop=terminalOutput.scrollHeight});backgroundOff=window.qwen.onBackgroundEvent(async e=>{const t=window._tasks.find(x=>x.backgroundId===e.id);if(!t)return;if(e.type==='chunk'){t.events.push(e.text.slice(-500));renderTasks();if(setWorkspace){} }if(e.type==='done'){t.state=e.job.state;t.events.push(`Finished with exit ${e.job.code}`);renderTasks();await saveSession();log(`Background task ${t.state}: ${t.label}`,t)}});
async function runTerminal(bg=false){const c=terminalInput.value.trim();if(!c)return;terminalInput.value='';if(bg){await runBackground(c,'Terminal: '+c);return}terminalOutput.textContent+=`\n$ ${c}\n`;const ok=await askApproval('Run terminal command',c);if(!ok){terminalOutput.textContent+='[denied]\n';return}await window.qwen.runCommand(c)}
terminalRun.onclick=()=>runTerminal(false);$('backgroundTerminal').onclick=()=>runTerminal(true);terminalInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();runTerminal(false)}});terminalClear.onclick=()=>terminalOutput.textContent='';
async function refreshGit(){const[s,d,b]=await Promise.all([window.qwen.gitStatus(),window.qwen.gitDiff(),window.qwen.gitBranches()]);gitStatus.textContent=s.output||'Not a git repository.';gitDiff.textContent=d.output||'No working-tree diff.';gitBranches.innerHTML='';(b.output||'').split(/\n/).filter(Boolean).forEach(line=>{const btn=document.createElement('button');btn.className='branch';btn.textContent=line.trim();btn.onclick=async()=>{const name=line.replace(/^\*?\s*/,'').replace(/^remotes\/origin\//,'');const ok=await askApproval('Checkout branch',name);if(ok){const r=await window.qwen.gitCheckout(name);log(r.output||'Checkout complete');refreshGit()}};gitBranches.appendChild(btn)})}
$('gitInitBtn').onclick=async()=>{const ok=await askApproval('Initialize Git repository','Run git init in the selected project.');if(ok){const r=await window.qwen.gitInit();log(r.output||'Git initialized');refreshGit();}};
$('gitRefresh').onclick=refreshGit;$('gitCommitBtn').onclick=async()=>{const m=prompt('Commit message:');if(!m)return;const ok=await askApproval('Create git commit',m);if(ok){const r=await window.qwen.gitCommit(m);log(r.output||'Commit complete');refreshGit()}};
searchBtn.onclick=async()=>{const q=searchInput.value.trim();if(!q)return;searchResults.innerHTML='Searching…';try{const r=await window.qwen.searchContent(q);searchResults.innerHTML='';r.forEach(x=>{const b=document.createElement('button');b.className='search-result';b.textContent=`${x.path}:${x.line}  ${x.text}`;b.onclick=()=>openFile(x.path);searchResults.appendChild(b)});if(!r.length)searchResults.textContent='No matches.'}catch(e){searchResults.textContent=e.message}};searchInput.addEventListener('keydown',e=>{if(e.key==='Enter')searchBtn.click()});
$('runTestsBtn').onclick=async()=>{const btn=$('runTestsBtn');btn.disabled=true;btn.textContent='Running…';$('testSummary').textContent='Running full regression suite';$('testResults').innerHTML='';setWorkspace('tests');try{const r=await window.qwen.runRegressionSuite();$('testSummary').textContent=`${r.summary?.passed||0}/${r.summary?.total||0} passed`;r.results.forEach(x=>{const row=document.createElement('div');row.className='test-row '+(x.ok?'pass':'fail');row.innerHTML=`<div><b>${x.ok?'✓':'✕'} ${x.name}</b><small>${x.detail||''}</small></div><span>${x.ok?'PASS':'FAIL'}</span>`;$('testResults').appendChild(row)});log(`Regression suite: ${r.summary?.passed||0}/${r.summary?.total||0} passed`)}catch(e){$('testSummary').textContent='Suite failed';$('testResults').textContent=e.message;log('Regression suite error: '+e.message)}finally{btn.disabled=false;btn.textContent='Run All Tests'}};
$('runTestsBtn').onclick=async()=>{const btn=$('runTestsBtn');btn.disabled=true;btn.textContent='Running…';$('testSummary').textContent='Running full regression suite';$('testResults').innerHTML='';setWorkspace('tests');try{const r=await window.qwen.runRegressionSuite();$('testSummary').textContent=`${r.summary?.passed||0}/${r.summary?.total||0} passed`;r.results.forEach(x=>{const row=document.createElement('div');row.className='test-row '+(x.ok?'pass':'fail');const left=document.createElement('div'),b=document.createElement('b'),sm=document.createElement('small');b.textContent=`${x.ok?'✓':'✕'} ${x.name}`;sm.textContent=x.detail||'';left.append(b,sm);const tag=document.createElement('span');tag.textContent=x.ok?'PASS':'FAIL';row.append(left,tag);$('testResults').appendChild(row)});log(`Regression suite: ${r.summary?.passed||0}/${r.summary?.total||0} passed`)}catch(e){$('testSummary').textContent='Suite failed';$('testResults').textContent=e.message;log('Regression suite error: '+e.message)}finally{btn.disabled=false;btn.textContent='Run All Tests'}};
$('checkpointBtn').onclick=async()=>{const r=await window.qwen.checkpointCreate();log(r.ok?`✓ Checkpoint created (${r.fileCount||0} files)`:'Checkpoint failed')};$('rollbackBtn').onclick=async()=>{const ok=await askApproval('Rollback to checkpoint','All tracked project files will return to the checkpoint state.');if(ok){const r=await window.qwen.checkpointRollback();log(r.ok?'↩ Rolled back':'No checkpoint');refresh()}};$('clearTasks').onclick=()=>{window._tasks=[];renderTasks()};$('clear').onclick=()=>{messages=[];chat.innerHTML='';activity.innerHTML='';saveSession()};$('pick').onclick=choose;$('trustBtn').onclick=trustFolder;$('send').onclick=()=>{const t=input.value.trim();if(t){input.value='';pendingAttachments=[];attachments.innerHTML='';setWorkspace('chat');agentLoop(t)}};input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('send').click()}});modeSelect.onchange=()=>{mode=modeSelect.value;log('Mode: '+mode);saveSession()};stopBtn.onclick=async()=>{stopRequested=true;await window.qwen.cancelChat();log('Stop requested')};modelSelect.onchange=async()=>{await window.qwen.setModel(modelSelect.value);saveSession()};$('resumeBtn').onclick=resumeSession;
$('buildBtn').onclick=async()=>{if(!projectRoot){add('system','Choose a project first.');return}const ok=await askApproval('Build macOS DMG','Run npm run dist:dmg for this project.');if(!ok)return;setWorkspace('terminal');terminalOutput.textContent+='\n$ npm run dist:dmg\n';const r=await window.qwen.buildApp();terminalOutput.textContent+=r.output+'\n';terminalOutput.scrollTop=terminalOutput.scrollHeight};
$('updateBtn').onclick=async()=>{const ok=await askApproval('Update Qwen Agent','Pull the latest Git version, install dependencies, then restart the app.');if(!ok)return;setWorkspace('terminal');terminalOutput.textContent+='\n$ git pull --ff-only && npm install\n';const r=await window.qwen.devUpdate();terminalOutput.textContent+=(r.output||'')+'\n';terminalOutput.scrollTop=terminalOutput.scrollHeight;if(r.ok){setTimeout(()=>window.close(),700);}};
function handleFiles(files){[...files].forEach(f=>{const row=document.createElement('span');row.className='attachment';row.textContent=`📎 ${f.name}`;attachments.appendChild(row);if(f.type.startsWith('image/')){const reader=new FileReader();reader.onload=()=>pendingAttachments.push({name:f.name,type:f.type,data:String(reader.result).split(',')[1]});reader.readAsDataURL(f)}else pendingAttachments.push({name:f.name,type:f.type})})}input.addEventListener('dragover',e=>{e.preventDefault();input.classList.add('dropzone')});input.addEventListener('dragleave',()=>input.classList.remove('dropzone'));input.addEventListener('drop',e=>{e.preventDefault();input.classList.remove('dropzone');handleFiles(e.dataTransfer.files)});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();searchInput.focus();searchInput.select()}});
window.qwen.onWorkspaceSelected(({path,tree})=>{projectRoot=path;projectLabel.textContent=path;root.innerHTML='';root.appendChild(renderTree(tree));log('Project selected: '+path);saveSession()});
(async()=>{try{const c=await window.qwen.getConfig();projectRoot=c.projectRoot;window._trustedRoots=c.trustedRoots||[];updateTrusted(window._trustedRoots);try{const models=await window.qwen.listModels();modelSelect.innerHTML='';models.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;modelSelect.appendChild(o)});if(models.includes(c.model))modelSelect.value=c.model}catch{}await window.qwen.ping();$('connectionText').textContent='LOCAL • OLLAMA'}catch{$('connectionDot').style.background='#e06b75';$('connectionText').textContent='OLLAMA OFFLINE'}await resumeSession();if(!messages.length)add('system',projectRoot?'Ready.':'Choose a project folder to begin.')})();
