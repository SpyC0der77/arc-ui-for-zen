const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope={};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../payload/content/github.js'),'utf8'),scope);
function fixture() {
  const prefs=new Map();
  class GitHub {static type='github';constructor(type){this.state={type,options:{}};}requestSave(){this.saved=true;}}
  const manager={window:{closed:false},stateRestored:{promise:Promise.resolve()},liveFolders:new Map(),calls:[],
    async createFolder(type){this.calls.push(type);const id=String(this.calls.length);this.liveFolders.set(id,new GitHub(type.split(':')[1]));return id;},
    getFolder(id){return this.liveFolders.get(id);}};
  return {manager,prefs:{getBoolPref:(k,d)=>prefs.get(k)??d,setBoolPref:(k,v)=>prefs.set(k,v)}};
}
test('creates native lists once, includes authored, assigned and review requests',async()=>{
  const f=fixture();await Promise.all([scope.ArcGitHub.setup(f),scope.ArcGitHub.setup(f)]);
  assert.deepEqual(f.manager.calls,['github:pull-requests','github:issues']);
  const [pr,issue]=f.manager.liveFolders.values();
  assert.equal(pr.state.options.authorMe,true);assert.equal(pr.state.options.assignedMe,true);
  assert.equal(pr.state.options.reviewRequested,true);assert.equal(issue.state.options.reviewRequested,false);
  assert.ok(pr.saved&&issue.saved);
  f.manager.liveFolders.clear();await scope.ArcGitHub.setup(f);
  assert.equal(f.manager.calls.length,2,'user-deleted folders remain deleted');
});
test('preserves existing native folders and filters',async()=>{
  const f=fixture();await f.manager.createFolder('github:issues');
  const existing=f.manager.getFolder('1');
  const filters={authorMe:false,assignedMe:false,reviewRequested:true,repoExcludes:new Set(['owner/repo'])};
  Object.assign(existing.state.options,filters);
  await scope.ArcGitHub.setup(f);
  assert.deepEqual(f.manager.calls,['github:issues','github:pull-requests']);
  assert.deepEqual(existing.state.options,filters);
  assert.equal(existing.saved,undefined);
});
test('waits for native restore; skips private and closed windows',async()=>{
  const f=fixture();let restore;
  f.manager.stateRestored.promise=new Promise(r=>restore=r);
  const setup=scope.ArcGitHub.setup(f);assert.equal(f.manager.calls.length,0);restore();await setup;
  for(const extra of [{isPrivate:true},{isPrivateWindow:()=>true}]){
    const skipped=fixture();await scope.ArcGitHub.setup({...skipped,...extra});assert.equal(skipped.manager.calls.length,0);
    assert.equal(skipped.prefs.getBoolPref('arc-ui.github-folders-initialized',false),false);
  }
  f.prefs.setBoolPref('arc-ui.github-folders-initialized',false);f.manager.window.closed=true;
  assert.equal(await scope.ArcGitHub.setup(f),false);
});
test('shared setup follows the remaining native window after its initiator closes',async()=>{
  const f=fixture();let restore;
  f.manager.stateRestored.promise=new Promise(r=>restore=r);
  const original=f.manager.window;
  const first=scope.ArcGitHub.setup(f),second=scope.ArcGitHub.setup(f);
  original.closed=true;f.manager.window={closed:false};restore();
  await Promise.all([first,second]);
  assert.deepEqual(f.manager.calls,['github:pull-requests','github:issues']);
});
test('setup handles a missing native window without marking initialization complete',async()=>{
  const f=fixture();f.manager.window=null;
  assert.equal(await scope.ArcGitHub.setup(f),false);
  assert.equal(f.prefs.getBoolPref('arc-ui.github-folders-initialized',false),false);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function runner(f) {
  const tasks=new Map(),errors=[];let next=0,closed=false;
  const stop=scope.ArcGitHub.start({...f,isClosed:()=>closed,
    schedule:(fn,delay)=>{const id=++next;tasks.set(id,{fn,delay});return id;},cancel:id=>tasks.delete(id),onError:e=>errors.push(e)});
  return {tasks,errors,stop,close:()=>{closed=true;},async retry(){const [id,task]=tasks.entries().next().value;tasks.delete(id);await task.fn();}};
}
test('retries transient partial setup in the same session without duplicate folders',async()=>{
  const f=fixture(),create=f.manager.createFolder.bind(f.manager);let fail=true;
  f.manager.createFolder=type=>type==='github:issues'&&fail?Promise.reject(Error('transient')):create(type);
  const r=runner(f);await tick();
  assert.equal(r.errors.length,1);assert.equal(r.tasks.size,1);
  assert.equal([...r.tasks.values()][0].delay,1000);
  fail=false;await r.retry();
  assert.deepEqual(f.manager.calls,['github:pull-requests','github:issues']);assert.equal(r.tasks.size,0);
  r.stop();
});
test('retry stops when the caller closes or unloads, including during an attempt',async()=>{
  for(const mode of ['closed','unloaded','pending']){
    const f=fixture();let restore;
    if(mode==='pending')f.manager.stateRestored.promise=new Promise(r=>restore=r);
    f.manager.window=null;const r=runner(f);await tick();
    if(mode==='closed')r.close();else r.stop();
    if(mode==='pending'){restore();await tick();}
    else if(mode==='closed')await r.retry();
    assert.equal(r.tasks.size,0,mode);
  }
});
test('private callers never create folders or schedule retries',async()=>{
  const f=fixture(),r=runner({...f,isPrivate:true});await tick();
  assert.equal(r.tasks.size,0);assert.equal(f.manager.calls.length,0);r.stop();
});
test('failed creation can retry without duplicating the successful folder',async()=>{
  const f=fixture(),create=f.manager.createFolder.bind(f.manager);
  f.manager.createFolder=async type=>type==='github:issues'?-1:create(type);
  await assert.rejects(scope.ArcGitHub.setup(f),/Could not create/);
  assert.equal(f.prefs.getBoolPref('arc-ui.github-folders-initialized',false),false);
  f.manager.createFolder=create;await scope.ArcGitHub.setup(f);
  assert.deepEqual(f.manager.calls,['github:pull-requests','github:issues']);
});
