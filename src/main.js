const { app, BrowserWindow, dialog, ipcMain, Menu, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let win;
let projectRoot = null;
let trustedRoots = [];
let ollamaController = null;
let selectedModel = process.env.QWEN_AGENT_MODEL || 'qwen3-coder:30b-64k';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const changeHistory = [];
let checkpoint = null;
const backgroundJobs = new Map();
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
const checkpointFile = () => path.join(app.getPath('userData'), 'checkpoint.json');
const backgroundFile = () => path.join(app.getPath('userData'), 'background-jobs.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1080, minHeight: 700, title: 'Qwen Agent',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('context-menu', (_event, params) => {
    const editable = params.isEditable, hasSelection = Boolean(params.selectionText);
    const template = editable
      ? [{role:'cut',enabled:hasSelection},{role:'copy',enabled:hasSelection},{role:'paste'},{role:'selectAll'}]
      : [{role:'copy',enabled:hasSelection},{role:'selectAll'}];
    template.push({type:'separator'},{label:'Paste Plain Text',enabled:editable&&clipboard.readText().length>0,click:()=>editable&&win.webContents.insertText(clipboard.readText())});
    Menu.buildFromTemplate(template).popup({window:win});
  });
}
app.whenReady().then(async()=>{restoreWorkspace();createWindow(); if(!projectRoot){ setTimeout(async()=>{ try { const r=await dialog.showOpenDialog(win,{title:'Choose Qwen Agent Project',message:'Select the project folder Qwen should work inside.',properties:['openDirectory','createDirectory']}); if(!r.canceled){projectRoot=path.resolve(r.filePaths[0]);saveSession({projectRoot,trustedRoots,model:selectedModel});win.webContents.send('workspace-selected',{path:projectRoot,tree:listTree(projectRoot)});}} catch(e){} },450); }});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});

function roots(){ return [projectRoot, ...trustedRoots].filter(Boolean).map(p=>path.resolve(p)); }
function resolveSafe(rel){
  if(!projectRoot) throw new Error('No project folder selected.');
  const raw=String(rel||'.');
  const candidates=path.isAbsolute(raw)?[path.resolve(raw)]:[path.resolve(projectRoot,raw)];
  const resolved=candidates[0];
  const allowed=roots().some(r=>resolved===r||resolved.startsWith(r+path.sep));
  if(!allowed) throw new Error('Path is outside the selected/trusted folders.');
  return resolved;
}
function relativeDisplay(p){
  const abs=path.resolve(p);
  if(projectRoot && (abs===path.resolve(projectRoot)||abs.startsWith(path.resolve(projectRoot)+path.sep))) return path.relative(projectRoot,abs)||'.';
  return abs;
}
function listTree(dir,depth=5){
  if(depth<0)return[];
  const ignored=new Set(['node_modules','.git','.DS_Store','dist','build','.next','.cache','coverage']);
  let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return[]}
  return entries.filter(e=>!ignored.has(e.name)).map(e=>{const full=path.join(dir,e.name),item={name:e.name,type:e.isDirectory()?'dir':'file'};if(e.isDirectory())item.children=listTree(full,depth-1);return item}).sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
}
function searchFiles(pattern,rel='.',content=false){
  const base=resolveSafe(rel),ignored=new Set(['node_modules','.git','dist','build','.next','.cache','coverage']),results=[];
  let rx;try{rx=new RegExp(pattern,'i')}catch{rx=new RegExp(pattern.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'i')}
  function walk(dir){let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return};for(const e of entries){if(ignored.has(e.name))continue;const full=path.join(dir,e.name),relative=relativeDisplay(full);if(e.isDirectory()){walk(full);continue}if(!content&&rx.test(e.name))results.push(relative);if(content){try{const st=fs.statSync(full);if(st.size<=1024*1024){const text=fs.readFileSync(full,'utf8');text.split(/\r?\n/).forEach((line,i)=>{if(rx.test(line))results.push({path:relative,line:i+1,text:line.slice(0,500)})})}}catch{}}if(results.length>=500)return}}
  walk(base);return results.slice(0,500);
}
function rememberBeforeWrite(rel){const p=resolveSafe(rel),existed=fs.existsSync(p);let content=null;if(existed){const stat=fs.statSync(p);if(stat.size>2*1024*1024)throw new Error('File is larger than 2 MB; refusing to keep an undo snapshot.');content=fs.readFileSync(p,'utf8')}changeHistory.push({path:relativeDisplay(p),existed,content});if(changeHistory.length>100)changeHistory.shift()}
function snapshotProject(){if(!projectRoot)return null;const ignored=new Set(['node_modules','.git','dist','build','.next','.cache','coverage']);const files={};function walk(dir){let es=[];try{es=fs.readdirSync(dir,{withFileTypes:true})}catch{return};for(const e of es){if(ignored.has(e.name))continue;const p=path.join(dir,e.name),rel=path.relative(projectRoot,p);if(e.isDirectory())walk(p);else{try{const st=fs.statSync(p);if(st.size<=2*1024*1024)files[rel]=fs.readFileSync(p,'utf8')}catch{}}}}walk(projectRoot);return files}
function restoreSnapshot(snap){if(!projectRoot||!snap)return;const current=snapshotProject()||{};for(const rel of Object.keys(current))if(!(rel in snap))try{fs.unlinkSync(resolveSafe(rel))}catch{}for(const [rel,content] of Object.entries(snap)){const p=resolveSafe(rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content,'utf8')}}
function saveSession(data){try{fs.mkdirSync(path.dirname(sessionFile()),{recursive:true});fs.writeFileSync(sessionFile(),JSON.stringify(data,null,2))}catch{}}
function loadSession(){try{return JSON.parse(fs.readFileSync(sessionFile(),'utf8'))}catch{return null}}
function loadJsonFile(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function saveJsonFile(file,data){try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2))}catch{}}
function restoreWorkspace(){const s=loadSession();if(s?.projectRoot && fs.existsSync(s.projectRoot) && fs.statSync(s.projectRoot).isDirectory()) projectRoot=path.resolve(s.projectRoot); if(Array.isArray(s?.trustedRoots)) trustedRoots=s.trustedRoots.filter(p=>p && fs.existsSync(p) && fs.statSync(p).isDirectory()).map(p=>path.resolve(p)); if(s?.model) selectedModel=String(s.model);
  const persistedCheckpoint=loadJsonFile(checkpointFile(),null);
  if(persistedCheckpoint?.files) checkpoint=persistedCheckpoint;
  const persistedJobs=loadJsonFile(backgroundFile(),[]);
  for(const j of persistedJobs){ if(j.state==='running'||j.state==='paused') j.state='interrupted'; backgroundJobs.set(j.id,j); }
}

ipcMain.handle('choose-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});if(r.canceled)return null;projectRoot=path.resolve(r.filePaths[0]);saveSession({projectRoot,trustedRoots,model:selectedModel});return{path:projectRoot,tree:listTree(projectRoot)}});
ipcMain.handle('set-project-folder',(_,p)=>{const resolved=path.resolve(String(p||''));if(!fs.existsSync(resolved)||!fs.statSync(resolved).isDirectory())throw new Error('Project folder does not exist.');projectRoot=resolved;saveSession({projectRoot,trustedRoots,model:selectedModel});return{path:projectRoot,tree:listTree(projectRoot)}});
ipcMain.handle('choose-trusted-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});if(r.canceled)return null;const p=path.resolve(r.filePaths[0]);if(projectRoot&&p===path.resolve(projectRoot))return{path:p,duplicate:true};if(!trustedRoots.includes(p))trustedRoots.push(p);return{path:p,roots:trustedRoots}});
ipcMain.handle('trusted-roots',()=>trustedRoots.slice());
ipcMain.handle('workspace-status',()=>({projectRoot,trustedRoots,canReadWrite:!!projectRoot,platform:process.platform}));
ipcMain.handle('tree',(_,rel='.')=>projectRoot?listTree(resolveSafe(rel)):[]);
ipcMain.handle('read-file',(_,rel)=>{const p=resolveSafe(rel),st=fs.statSync(p);if(st.size>2*1024*1024)throw new Error('File is larger than 2 MB; read a smaller/targeted file.');return fs.readFileSync(p,'utf8')});
ipcMain.handle('write-file',(_,rel,content)=>{const p=resolveSafe(rel);rememberBeforeWrite(rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content,'utf8');return true});
ipcMain.handle('edit-file',(_,rel,oldText,newText)=>{const p=resolveSafe(rel),content=fs.readFileSync(p,'utf8'),count=content.split(oldText).length-1;if(!count)throw new Error('The exact old text was not found.');if(count>1)throw new Error('The old text occurs more than once; provide a larger unique block.');rememberBeforeWrite(rel);fs.writeFileSync(p,content.replace(oldText,newText),'utf8');return true});
ipcMain.handle('undo-last-change',()=>{const item=changeHistory.pop();if(!item)return{ok:false,message:'Nothing to undo.'};const p=resolveSafe(item.path);if(!item.existed){if(fs.existsSync(p))fs.unlinkSync(p)}else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,item.content,'utf8')}return{ok:true,path:item.path}});
ipcMain.handle('search-files',(_,pattern,rel='.')=>searchFiles(pattern,rel,false));
ipcMain.handle('search-content',(_,pattern,rel='.')=>searchFiles(pattern,rel,true));

function shellEnv(){return {...process.env,PWD:projectRoot||process.cwd()}}
function runShell(command,timeout=180000){return new Promise(resolve=>{if(!projectRoot)return resolve({ok:false,output:'Select a project folder first.',code:1});const child=spawn('/bin/zsh',['-lc',String(command)],{cwd:projectRoot,env:shellEnv()});let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);child.stdout.on('data',d=>{const t=d.toString();out+=t;win?.webContents.send('terminal-chunk',{stream:'stdout',text:t})});child.stderr.on('data',d=>{const t=d.toString();err+=t;win?.webContents.send('terminal-chunk',{stream:'stderr',text:t})});child.on('close',(code,signal)=>{clearTimeout(timer);resolve({ok:code===0,output:(out+err).trim(),stdout:out,stderr:err,code:code??1,signal:signal||null})})})}
ipcMain.handle('run-command',(_,command)=>runShell(command));

function persistBackgroundJobs(){
  const safe=[...backgroundJobs.values()].map(({pid,...j})=>j);
  saveJsonFile(backgroundFile(),safe.slice(-100));
}
function startBackground(command,label,existingId=null){
  if(!projectRoot)throw new Error('Select a project first.');
  const id=existingId||`bg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const child=spawn('/bin/zsh',['-lc',String(command)],{cwd:projectRoot,env:shellEnv(),detached:true});
  const previous=backgroundJobs.get(id)||{};
  const job={...previous,id,label,command,state:'running',startedAt:new Date().toISOString(),pid:child.pid,output:previous.output||'',resumedAt:existingId?new Date().toISOString():undefined};
  backgroundJobs.set(id,job);persistBackgroundJobs();
  const send=(type,data)=>win?.webContents.send('background-event',{id,type,...data});
  child.stdout.on('data',d=>{const text=d.toString();job.output+=text;send('chunk',{stream:'stdout',text});persistBackgroundJobs()});
  child.stderr.on('data',d=>{const text=d.toString();job.output+=text;send('chunk',{stream:'stderr',text});persistBackgroundJobs()});
  child.on('close',(code,signal)=>{job.state=code===0?'done':(job.state==='stopped'?'stopped':'failed');job.code=code;job.signal=signal||null;job.finishedAt=new Date().toISOString();job.pid=undefined;persistBackgroundJobs();send('done',{job});});
  return{...job};
}
ipcMain.handle('start-background',(_,command,label)=>startBackground(command,label||command));
function signalJobGroup(job, signal){
  if(!job?.pid) throw new Error('Background process is no longer running.');
  // Background jobs are started detached, so their PID is also the process-group ID.
  // Signalling the negative PID controls the shell AND its descendants (e.g. sleep/python/node).
  process.kill(-Math.abs(job.pid), signal);
}
ipcMain.handle('pause-background',(_,id)=>{
  const j=backgroundJobs.get(id);
  if(!j||!j.pid)return{ok:false,message:'Running background task not found.'};
  if(j.state!=='running')return{ok:false,message:`Task is ${j.state}.`};
  try{
    signalJobGroup(j,'SIGSTOP');
    j.state='paused';
    j.pausedAt=new Date().toISOString();
    persistBackgroundJobs();
    win?.webContents.send('background-event',{id,type:'state',job:j});
    return{ok:true,state:'paused'};
  }catch(e){return{ok:false,message:e.message}}
});
ipcMain.handle('resume-background',(_,id)=>{
  const j=backgroundJobs.get(id);
  if(!j)return{ok:false,message:'Background task not found.'};
  if(j.pid&&j.state==='paused'){
    try{
      signalJobGroup(j,'SIGCONT');
      j.state='running';
      j.resumedAt=new Date().toISOString();
      persistBackgroundJobs();
      win?.webContents.send('background-event',{id,type:'state',job:j});
      return{ok:true,resumed:true,state:'running'};
    }catch(e){return{ok:false,message:e.message}}
  }
  if(j.state==='interrupted'||j.state==='failed'||j.state==='stopped')return startBackground(j.command,`${j.label} (resumed)`,id);
  return{ok:false,message:'Task is already running.'};
});
ipcMain.handle('stop-background',(_,id)=>{
  const j=backgroundJobs.get(id);
  if(!j)return{ok:false,message:'Background task not found.'};
  if(j.pid){
    try{signalJobGroup(j,'SIGTERM')}catch{}
  }
  j.state='stopped';
  j.finishedAt=new Date().toISOString();
  j.pid=undefined;
  persistBackgroundJobs();
  win?.webContents.send('background-event',{id,type:'done',job:j});
  return{ok:true,state:'stopped'};
});
ipcMain.handle('background-list',()=>[...backgroundJobs.values()].map(({pid,...j})=>j));
ipcMain.handle('background-status',(_,id)=>{const j=backgroundJobs.get(String(id));if(!j)return{ok:false,message:'Background task not found.'};return{ok:true,task:{...j,pid:undefined,recentOutput:String(j.output||'').split(/\r?\n/).slice(-20).join('\n')}}});

ipcMain.handle('git-status',()=>runShell('git status --short --branch'));
ipcMain.handle('git-diff',()=>runShell('git diff -- .'));
ipcMain.handle('git-branches',()=>runShell('git branch --all'));
ipcMain.handle('git-checkout',(_,branch)=>runShell(`git checkout -- ${JSON.stringify(String(branch))}`));
ipcMain.handle('git-commit',(_,message)=>runShell(`git add -A && git commit -m ${JSON.stringify(String(message))}`));
ipcMain.handle('git-init',()=>runShell('git init'));
ipcMain.handle('git-pull-update',()=>runShell('git pull --ff-only',300000));
ipcMain.handle('git-remotes',()=>runShell('git remote -v'));
ipcMain.handle('dev-update',async()=>{
  if(!projectRoot)return{ok:false,output:'Select the Qwen Agent project folder first.',code:1};
  const remote=await runShell('git remote -v');
  if(!remote.ok || !remote.output.trim()) return {ok:false,output:'No Git remote configured. Add a GitHub remote to this development copy first.',code:1};
  const pull=await runShell('git pull --ff-only',300000);
  if(!pull.ok)return pull;
  const install=await runShell('npm install',300000);
  if(!install.ok)return install;
  return {ok:true,output:[pull.output,install.output,'Update installed. Restarting Qwen Agent…'].filter(Boolean).join('\n')};
});

async function runRegressionSuite(){
  const startedAt=new Date().toISOString();
  const results=[];
  const add=(name,ok,detail='')=>results.push({name,ok,detail:String(detail||'').slice(0,1200)});
  const testDir='.qwen-agent-regression';
  const testFile=path.join(testDir,'fixture.txt');
  const testRel=path.join(testDir,'fixture.txt');
  if(!projectRoot) return {ok:false,startedAt,finishedAt:new Date().toISOString(),results:[{name:'Workspace',ok:false,detail:'No project folder selected.'}]};
  try{fs.mkdirSync(resolveSafe(testDir),{recursive:true});}catch(e){return {ok:false,startedAt,finishedAt:new Date().toISOString(),results:[{name:'Workspace write access',ok:false,detail:e.message}]};}
  try{const st=fs.statSync(projectRoot);add('Workspace',st.isDirectory(),projectRoot);}catch(e){add('Workspace',false,e.message)}
  try{fs.writeFileSync(resolveSafe(testRel),'QWEN REGRESSION TEST\n','utf8');const v=fs.readFileSync(resolveSafe(testRel),'utf8');add('File create/read',v==='QWEN REGRESSION TEST\n',v)}catch(e){add('File create/read',false,e.message)}
  try{fs.writeFileSync(resolveSafe(testRel),'QWEN REGRESSION EDITED\n','utf8');const v=fs.readFileSync(resolveSafe(testRel),'utf8');add('File edit',v.includes('EDITED'),v)}catch(e){add('File edit',false,e.message)}
  try{const r=searchFiles('QWEN REGRESSION EDITED',testDir,true);add('Project search',r.some(x=>x.path===testRel),JSON.stringify(r.slice(0,2)))}catch(e){add('Project search',false,e.message)}
  try{const r=await runShell('printf "TERMINAL_REGRESSION_OK\\n"');add('Terminal execution',r.ok&&r.output.includes('TERMINAL_REGRESSION_OK'),r.output)}catch(e){add('Terminal execution',false,e.message)}
  try{
    const {spawn}=require('child_process');
    const child=spawn('/bin/zsh',['-lc','for i in {1..8}; do echo BG_$i; sleep 0.25; done'],{cwd:projectRoot,detached:true,env:shellEnv()});
    const pgid=child.pid; let out=''; child.stdout.on('data',d=>out+=d.toString());
    await new Promise(r=>setTimeout(r,650));
    process.kill(-pgid,'SIGSTOP'); const before=out; await new Promise(r=>setTimeout(r,700)); const frozen=out===before;
    process.kill(-pgid,'SIGCONT'); const exit=await new Promise(resolve=>child.on('close',code=>resolve(code)));
    add('Background pause/resume',frozen&&exit===0,out.trim());
  }catch(e){add('Background pause/resume',false,e.message)}
  try{
    const jobs=await Promise.all([startBackground('echo PARALLEL_A; sleep 0.2; echo DONE_A','Regression A'),startBackground('echo PARALLEL_B; sleep 0.2; echo DONE_B','Regression B')]);
    await new Promise(r=>setTimeout(r,650)); const states=jobs.map(j=>backgroundJobs.get(j.id)?.state); add('Parallel background tasks',states.every(s=>s==='done'),states.join(', '));
  }catch(e){add('Parallel background tasks',false,e.message)}
  try{
    const snap=snapshotProject(); const rel='.qwen-agent-regression/rollback.txt'; fs.writeFileSync(resolveSafe(rel),'BEFORE\n','utf8'); const before=snapshotProject(); fs.writeFileSync(resolveSafe(rel),'AFTER\n','utf8'); restoreSnapshot(before); const v=fs.readFileSync(resolveSafe(rel),'utf8'); add('Checkpoint/rollback',v==='BEFORE\n',v);
    restoreSnapshot(snap);
  }catch(e){add('Checkpoint/rollback',false,e.message)}
  try{
    const git=await runShell('git --version');
    if(!git.ok){ add('Git integration',false,git.output||'Git is not installed.'); }
    else {
      const repo=await runShell('git rev-parse --is-inside-work-tree');
      let initializedBySuite=false;
      if(!repo.ok){ const init=await runShell('git init'); initializedBySuite=init.ok; }
      const check=await runShell('git rev-parse --is-inside-work-tree');
      add('Git integration',check.ok&&check.output.trim()==='true',check.ok?'Git repository commands working':'Git repository could not be initialized');
      if(initializedBySuite){ try{fs.rmSync(path.join(projectRoot,'.git'),{recursive:true,force:true});}catch{} }
    }
  }catch(e){add('Git integration',false,e.message)}
  try{const res=await fetch(`${OLLAMA_URL}/api/tags`);add('Ollama connection',res.ok,`HTTP ${res.status}`)}catch(e){add('Ollama connection',false,e.message)}
  try{const sess=loadSession();add('Persistent session',!!sess, sess? 'session.json available':'session.json not created yet')}catch(e){add('Persistent session',false,e.message)}
  try{fs.rmSync(resolveSafe(testDir),{recursive:true,force:true});add('Test cleanup',!fs.existsSync(resolveSafe(testDir)),'Temporary regression files removed')}catch(e){add('Test cleanup',false,e.message)}
  return {ok:results.every(x=>x.ok),startedAt,finishedAt:new Date().toISOString(),results,summary:{passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,total:results.length}};
}

ipcMain.handle('build-app',()=>runShell('npm run dist:dmg',300000));
ipcMain.handle('run-regression-suite',()=>runRegressionSuite());
ipcMain.handle('checkpoint-create',()=>{checkpoint={createdAt:new Date().toISOString(),files:snapshotProject()};saveJsonFile(checkpointFile(),checkpoint);return{ok:true,createdAt:checkpoint.createdAt,fileCount:Object.keys(checkpoint.files||{}).length}});
ipcMain.handle('checkpoint-info',()=>checkpoint?{ok:true,createdAt:checkpoint.createdAt,fileCount:Object.keys(checkpoint.files||{}).length}: {ok:false});
ipcMain.handle('checkpoint-rollback',()=>{if(!checkpoint)return{ok:false,message:'No checkpoint exists.'};restoreSnapshot(checkpoint.files);return{ok:true,createdAt:checkpoint.createdAt}});
ipcMain.handle('session-load',()=>loadSession());
ipcMain.handle('session-save',(_,data)=>{saveSession({...data,trustedRoots});return true});
ipcMain.handle('get-config',()=>({model:selectedModel,ollamaUrl:OLLAMA_URL,projectRoot,trustedRoots}));
ipcMain.handle('set-model',(_,model)=>{selectedModel=String(model||selectedModel);return selectedModel});
ipcMain.handle('list-models',async()=>{const res=await fetch(`${OLLAMA_URL}/api/tags`);if(!res.ok)throw new Error(`Ollama returned ${res.status}`);const data=await res.json();return(data.models||[]).map(m=>m.name)});
ipcMain.handle('ping',async()=>{const res=await fetch(`${OLLAMA_URL}/api/tags`);if(!res.ok)throw new Error(`Ollama returned ${res.status}`);return true});

function textFromHtml(html){return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
async function fetchText(url){const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw new Error('Only http/https URLs are allowed.');const res=await fetch(u,{headers:{'User-Agent':'Qwen-Agent/0.9'}});const text=await res.text();if(!res.ok)throw new Error(`HTTP ${res.status}: ${text.slice(0,300)}`);return{text:res.headers.get('content-type')?.includes('text/html')?textFromHtml(text):text.slice(0,120000),status:res.status,contentType:res.headers.get('content-type')||''}}
async function webSearch(query){const q=encodeURIComponent(String(query));const res=await fetch(`https://html.duckduckgo.com/html/?q=${q}`,{headers:{'User-Agent':'Mozilla/5.0 Qwen-Agent/0.9'}});if(!res.ok)throw new Error(`Search HTTP ${res.status}`);const html=await res.text();const results=[];const re=/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))&&results.length<8){let url=m[1];const title=textFromHtml(m[2]);const abs=url.startsWith('//')?'https:'+url:url;if(title)results.push({title,url:abs})}return{query:String(query),results}}
async function githubSearch(query){const url=`https://api.github.com/search/code?q=${encodeURIComponent(String(query))}&per_page=10`;const res=await fetch(url,{headers:{'Accept':'application/vnd.github+json','User-Agent':'Qwen-Agent/0.9'}});if(!res.ok)throw new Error(`GitHub HTTP ${res.status}: ${await res.text()}`);const d=await res.json();return(d.items||[]).map(x=>({name:x.name,path:x.path,repository:x.repository?.full_name,url:x.html_url}));}
async function npmInfo(name){const res=await fetch(`https://registry.npmjs.org/${encodeURIComponent(String(name))}`);if(!res.ok)throw new Error(`npm HTTP ${res.status}`);const d=await res.json();const v=d['dist-tags']?.latest;const info=d.versions?.[v]||{};return{name:d.name,version:v,description:d.description,homepage:d.homepage,repository:info.repository||d.repository,dependencies:info.dependencies||{},engines:info.engines||{}}}
ipcMain.handle('web-search',(_,query)=>webSearch(query));
ipcMain.handle('fetch-url',(_,url)=>fetchText(url));
ipcMain.handle('github-search',(_,query)=>githubSearch(query));
ipcMain.handle('npm-info',(_,name)=>npmInfo(name));
ipcMain.handle('open-url',(_,url)=>shell.openExternal(String(url)));

ipcMain.handle('project-context',()=>{if(!projectRoot)return{root:null};const tree=listTree(projectRoot,4);let packageJson=null;try{packageJson=JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8'))}catch{}return{root:projectRoot,tree,package:packageJson,trustedRoots}});

ipcMain.handle('ollama-chat',async(_,payload)=>{if(ollamaController)ollamaController.abort();ollamaController=new AbortController();try{const res=await fetch(`${OLLAMA_URL}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ollamaController.signal});const text=await res.text();if(!res.ok)throw new Error(`Ollama ${res.status}: ${text.slice(0,1000)}`);return JSON.parse(text)}finally{ollamaController=null}});
ipcMain.handle('ollama-chat-stream',async(_,payload)=>{if(ollamaController)ollamaController.abort();ollamaController=new AbortController();const requestId=`${Date.now()}-${Math.random().toString(16).slice(2)}`;try{const debugPayload={...payload,stream:true};
require('fs').writeFileSync('/tmp/qwen-ollama-payload.json',JSON.stringify(debugPayload,null,2));
console.log('=== OLLAMA PAYLOAD ===');
console.log(JSON.stringify(debugPayload,null,2));
const res=await fetch(`${OLLAMA_URL}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(debugPayload),signal:ollamaController.signal});if(!res.ok)throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0,1000)}`);const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',final=null;const accumulated={role:'assistant',content:'',tool_calls:[]};while(true){const{value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.trim())continue;let obj;try{obj=JSON.parse(line)}catch{continue}if(obj.message?.content)accumulated.content+=obj.message.content;if(Array.isArray(obj.message?.tool_calls))accumulated.tool_calls.push(...obj.message.tool_calls);if(obj.message?.content||obj.message?.tool_calls)win.webContents.send('ollama-chunk',{requestId,chunk:obj});if(obj.done)final=obj}}if(buffer.trim())try{final=JSON.parse(buffer)}catch{}return{...(final||{done:true}),message:accumulated}}finally{ollamaController=null}});
ipcMain.handle('cancel-chat',()=>{if(ollamaController)ollamaController.abort();return true});
