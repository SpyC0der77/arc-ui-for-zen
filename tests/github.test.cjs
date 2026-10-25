const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope={};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../payload/content/github.js'),'utf8'),scope);
function fixture() {
  const prefs=new Map();
  class GitHub {static type='github';constructor(type){this.state={type,options:{}};}requestSave(){this.saved=true;}}
  const manager={stateRestored:{promise:Promise.resolve()},liveFolders:new Map(),calls:[],
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
  const existing=f.manager.getFolder('1');existing.state.options.authorMe=false;
  await scope.ArcGitHub.setup(f);
  assert.equal(f.manager.calls.length,2);assert.equal(existing.state.options.authorMe,false);
  assert.equal(existing.saved,undefined);
});
test('waits for native restore; skips private and closed windows',async()=>{
  const f=fixture();let restore;
  f.manager.stateRestored.promise=new Promise(r=>restore=r);
  const setup=scope.ArcGitHub.setup(f);assert.equal(f.manager.calls.length,0);restore();await setup;
  for(const extra of [{isPrivate:true},{isClosed:()=>true}]){
    const skipped=fixture();await scope.ArcGitHub.setup({...skipped,...extra});assert.equal(skipped.manager.calls.length,0);
    assert.equal(skipped.prefs.getBoolPref('arc-ui.github-folders-initialized',false),false);
  }
});
test('failed creation can retry without duplicating the successful folder',async()=>{
  const f=fixture(),create=f.manager.createFolder.bind(f.manager);
  f.manager.createFolder=async type=>type==='github:issues'?-1:create(type);
  await assert.rejects(scope.ArcGitHub.setup(f),/Could not create/);
  assert.equal(f.prefs.getBoolPref('arc-ui.github-folders-initialized',false),false);
  f.manager.createFolder=create;await scope.ArcGitHub.setup(f);
  assert.deepEqual(f.manager.calls,['github:pull-requests','github:issues']);
});
