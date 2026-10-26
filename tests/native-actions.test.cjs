const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope={};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../payload/content/native-actions.js'),'utf8'),scope);
function fixture() {
  const listeners=new Map();
  const menu=id=>({id,attrs:new Set(),toggleAttribute(k,v){v?this.attrs.add(k):this.attrs.delete(k);},
    hasAttribute(k){return this.attrs.has(k);},removeAttribute(k){this.attrs.delete(k);}});
  const folder=menu('zenFolderActions'),tabs=menu('tabContextMenu');
  const document={getElementById:id=>id===folder.id?folder:tabs,
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  let selection=[];
  const stop=scope.ArcNativeActions.install({document,contextTabs:()=>selection});
  return {folder,tabs,listeners,stop,select:rows=>selection=rows,
    show:target=>listeners.get('popupshowing')({target}),
    blocked(menu,id){let blocked=false;listeners.get('command')({target:{id,closest:()=>menu},preventDefault(){blocked=true;},stopImmediatePropagation(){}});return blocked;}};
}
test('live folders block structural edits, ordinary folders recover their actions',()=>{
  const f=fixture();
  f.folder.triggerNode={closest:()=>({isLiveFolder:true})};f.show(f.folder);
  for(const id of scope.ArcNativeActions.folderActions)assert.ok(f.blocked(f.folder,id));
  for(const id of ['context_zenFolderRename','context_zenFolderDelete','context_zenFolderUnloadAll','context_zenShareFolder','context_zenChangeFolderSpace'])assert.equal(f.blocked(f.folder,id),false);
  f.folder.triggerNode={closest:()=>({isLiveFolder:false})};f.show(f.folder);
  assert.equal(f.blocked(f.folder,'context_zenFolderUnpack'),false);
});
test('provider-owned tabs suppress source edits, including mixed selections, but detached tabs do not',()=>{
  const f=fixture();const live={group:{isLiveFolder:true},hasAttribute:()=>true};
  f.select([{},live]);f.show(f.tabs);
  for(const id of scope.ArcNativeActions.tabActions)assert.ok(f.blocked(f.tabs,id));
  for(const id of ['context_closeTab','context_zenMoveToFolder','context_zen-reset-pinned-tab'])assert.equal(f.blocked(f.tabs,id),false);
  live.group=null;f.show(f.tabs);assert.equal(f.blocked(f.tabs,'context_zen-edit-tab-title'),false);
});
test('submenu events do not clear ownership and teardown removes listeners and markers',()=>{
  const f=fixture();f.folder.triggerNode={closest:()=>({isLiveFolder:true})};f.show(f.folder);
  f.show({id:'submenu'});assert.ok(f.blocked(f.folder,'context_zenFolderToSpace'));
  f.listeners.get('popuphidden')({target:f.folder});assert.equal(f.folder.attrs.size,0);
  f.show(f.folder);f.stop();assert.equal(f.listeners.size,0);assert.equal(f.folder.attrs.size,0);
});
