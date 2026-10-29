/* Window-local view fixtures, plus explicitly owned native tabs and Spaces. */
import {PAGE,PAGES,ownsPage,createDownloads} from "chrome://arc-ui/content/debug-data.mjs";
import {actionIcon} from "chrome://arc-ui/content/download-icons.sys.mjs";
const JOURNAL="arc-ui.debug.owned-data";
const TAB_KEY="arc-ui.debug.token";
const PLACEHOLDER_KEY="arc-ui.debug.placeholder";
let active=null;
let recovery=null;

function browserWindows() {return [...Services.wm.getEnumerator("navigator:browser")].filter(w=>!w.closed);}
function nativeTabs(win){return [...win.gZenWorkspaces.allStoredTabs];}
function journal() {
  try {
    const j=JSON.parse(Services.prefs.getStringPref(JOURNAL,"null"));
    return j&&typeof j.token==="string"&&/^[\w-]{36}$/.test(j.token)&&Array.isArray(j.spaces)?j:null;
  } catch {return null;}
}
function writeJournal(j){Services.prefs.setStringPref(JOURNAL,JSON.stringify(j));}

async function removeOwned(win,j) {
  const {SessionStore}=ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
  const owned=new Set(j.spaces);
  for(const id of owned) {
    const space=win.gZenWorkspaces.getWorkspaces().find(s=>s.uuid===id);
    if(space&&space.arcDebugToken!==j.token)throw new Error("Debug Space ownership no longer matches; leaving it intact.");
  }
  const destination=win.gZenWorkspaces.getWorkspaces().find(s=>s.uuid===j.originalSpace&&!owned.has(s.uuid))||
    win.gZenWorkspaces.getWorkspaces().find(s=>!owned.has(s.uuid));
  if(!destination)throw new Error("Cannot remove debug Spaces without a destination for normal tabs.");
  await win.gZenWorkspaces.changeWorkspaceWithID(destination.uuid);
  for(const w of browserWindows()) {
    for(const tab of nativeTabs(w)) {
      const tagged=SessionStore.getCustomTabValue(tab,TAB_KEY)===j.token;
      const url=tab.linkedBrowser?.currentURI?.spec||"";
      const placeholder=tagged&&url==="about:blank"&&SessionStore.getCustomTabValue(tab,PLACEHOLDER_KEY)==="1";
      const mock=(tagged&&ownsPage(url,j.token))||placeholder;
      if(mock)w.gBrowser.removeTab(tab,{animate:false,skipPermitUnload:true,skipSessionStore:true});
      else {
        if(owned.has(tab.getAttribute("zen-workspace-id")))w.gZenWorkspaces.moveTabToWorkspace(tab,destination.uuid);
        if(tagged){SessionStore.deleteCustomTabValue(tab,TAB_KEY);SessionStore.deleteCustomTabValue(tab,PLACEHOLDER_KEY);tab.removeAttribute("arc-debug-token");}
      }
    }
  }
  for(const id of owned) {
    const space=win.gZenWorkspaces.getWorkspaces().find(s=>s.uuid===id);
    if(!space)continue;
    await win.gZenWorkspaces.removeWorkspace(id);
  }
  // The only directory removed is this session's UUID-named temporary cache.
  const cache=PathUtils.join(PathUtils.tempDir,`arc-ui-debug-${j.token}`);
  if(PathUtils.parent(cache)===PathUtils.tempDir)await IOUtils.remove(cache,{recursive:true,ignoreAbsent:true});
  Services.prefs.clearUserPref(JOURNAL);
}

export function install(win,{html,setDownloads,announce,isPrivate=false}) {
  const {document}=win;
  const library=document.querySelector("zen-library");
  const {SessionStore}=ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
  const available=!isPrivate&&win.gZenWorkspaces.workspaceEnabled;
  let enabled=false,destroyed=false,queue=Promise.resolve(),observer=null,data=null,downloads=[],files=[],tabs=[],originalTab=null,originalLibraryTab=null,originalRail=false,originalHistoryPref=null;
  const patches=new Map(),viewStates=new Map(),optInStates=new Map();
  const enqueue=fn=>(queue=queue.catch(()=>{}).then(fn));
  const patch=(node,key,value)=>{
    if(!patches.has(node))patches.set(node,new Map());
    const saved=patches.get(node);
    if(!saved.has(key))saved.set(key,Object.getOwnPropertyDescriptor(node,key));
    Object.defineProperty(node,key,{value,writable:true,configurable:true});
  };
  const refresh=()=>{
    if(!enabled)return;
    setDownloads(downloads);
    for(const section of library.querySelectorAll(".zen-library-section"))section.requestUpdate?.();
  };
  const mockAction=message=>announce(message);
  function pageURL(page){const u=new URL(PAGE);u.searchParams.set("debug",data.token);u.searchParams.set("title",page.title);u.searchParams.set("text",page.text||"Local sample content.");return u.href;}
  function newTab(page,workspaceId=win.gZenWorkspaces.activeWorkspace) {
    const tab=win.gBrowser.addTab(pageURL(page),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true,createLazyBrowser:true});
    SessionStore.setCustomTabValue(tab,TAB_KEY,data.token);
    tab.setAttribute("arc-debug-token",data.token);
    if(workspaceId)win.gZenWorkspaces.moveTabToWorkspace(tab,workspaceId);
    tab.setAttribute("label",page.title);
    win.gBrowser.setIcon(tab,"chrome://arc-ui/content/spaces.svg");
    tabs.push(tab);return tab;
  }
  function openPage(page) {
    const existing=tabs.find(t=>!t.closing&&t.linkedBrowser?.currentURI?.spec===pageURL(page));
    const tab=existing||newTab(page);
    win.gBrowser.selectedTab=tab;
    void win.ZenArc.setRail(false);
  }
  async function makeFiles() {
    const directory=PathUtils.join(PathUtils.tempDir,`arc-ui-debug-${data.token}`);
    await IOUtils.makeDirectory(directory,{ignoreExisting:true});
    files=[];
    for(let index=0;index<6;index++) {
      const canvas=document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
      canvas.width=480;canvas.height=300;
      const c=canvas.getContext("2d");
      c.fillStyle=index%2?"#eee9f2":"#cec7d4";c.fillRect(0,0,480,300);
      c.fillStyle="#f8f6f9";c.fillRect(104,16,360,268);
      c.fillStyle="#65556f";c.fillRect(16,24,66,8);
      for(let row=0;row<5;row++){c.fillStyle=row===index%5?"#bcb3c5":"#ded6e5";c.fillRect(12,60+row*34,78,24);}
      c.fillStyle="#443750";c.font="20px sans-serif";c.fillText(["Design notes","Components","Reading list","Release plan","Space layout","Download states"][index],124,55);
      for(let row=0;row<6;row++){c.fillStyle="#cec7d4";c.fillRect(124,85+row*27,270-(row%3)*45,8);}
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      if(!blob)throw new Error("Could not generate debug image.");
      const path=PathUtils.join(directory,["Sidebar study.png","Interface overview.png"][index]||`Preview ${index+1}.png`);
      await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));
      files.push(path);
    }
    for(const name of ["Design notes.pdf","Cancelled transfer.txt","Project files.zip","Walkthrough.mp4","Meeting notes.txt"])
      await IOUtils.writeUTF8(PathUtils.join(directory,name),"Local debug fixture. No external file action is performed.\n");
    return directory;
  }
  function visible(items,section,key=x=>x.title) {
    const query=(section.searchQuery||"").trim().toLowerCase();
    return items.filter(item=>!query||key(item).toLowerCase().includes(query));
  }
  function row(title,subtitle,icon,click,action=null) {
    return html`<div class="zen-library-row" data-arc-debug="true" @click=${click}>
      <img class="zen-library-row-icon" src=${icon} alt=""/>
      <div class="zen-library-row-text"><span class="zen-library-row-title">${title}</span><span class="zen-library-row-subtitle">${subtitle}</span></div>
      ${action||""}</div>`;
  }
  function renderDownloads(section) {
    const {fileGroupOf}=ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryUtils.sys.mjs");
    let items=visible(downloads,section,d=>PathUtils.filename(d.target.path));
    const types=[...section.activeFilters].filter(f=>f.startsWith("type:")).map(f=>f.slice(5));
    if(types.length)items=items.filter(d=>types.includes(fileGroupOf(PathUtils.filename(d.target.path))));
    if(section.activeWhenDays)items=items.filter(d=>Date.now()-d.startTime<section.activeWhenDays*86400000);
    if(!items.length)return empty();
    return html`<div class="zen-library-group">${[...items].reverse().map(d=>row(PathUtils.filename(d.target.path),
      d.succeeded?"Completed · Mock download":d.error?"Failed · Mock connection interrupted":d.canceled?(d.hasPartialData?"Paused · 38%":"Cancelled"):"Downloading · 38%",
      `moz-icon:${PathUtils.toFileURI(d.target.path)}?size=32`,()=>mockAction("Mock download selected"),
      html`<div class="zen-library-row-actions">${!d.succeeded?downloadAction(d):""}</div>`))}</div>`;
  }
  function downloadAction(d) {
    const resume=d.stopped&&d.canceled&&d.hasPartialData;
    const label=d.stopped?(resume?"Resume":"Retry"):"Pause";
    const image=actionIcon(!d.stopped?"pause":resume?"play":"rotate-cw");
    return html`<button class="arc-debug-action" title=${label} aria-label=${label} @click=${e=>{e.stopPropagation();void(d.stopped?d.start():d.cancel());}}><img src=${image} alt="" aria-hidden="true"/></button>`;
  }
  function renderHistory(section) {
    const closed=section.activeFilters.has("source:closed");
    const pages=visible(PAGES,section);
    if(!pages.length)return empty();
    return html`<div class="zen-library-group"><div class="zen-library-group-header">${closed?"Archived today":"Today"}</div>${pages.map((page,index)=>row(page.title,
      `${closed?"Archived":"Visited"} ${index+2} minutes ago · Mock page`,"chrome://arc-ui/content/spaces.svg",()=>openPage(page)))}</div>`;
  }
  function renderMedia(section) {
    const media=files.map((path,i)=>({path,title:["Design overview","Components","Reading list","Release plan","Space layout","Download states"][i]}));
    const items=visible(media,section);
    if(!items.length)return empty();
    return html`<div class="zen-library-media-grid">${items.map(item=>html`<button class="zen-library-media-item arc-debug-media-item" title=${item.title} @click=${()=>openPage({title:item.title,text:"Local mock media preview."})}><div class="zen-library-media-frame"><img class="zen-library-media-thumb" src=${PathUtils.toFileURI(item.path)} alt=${item.title}/></div></button>`)}</div>`;
  }
  const boosts=[{title:"Quiet reading",domain:"reading.example",on:true},{title:"Larger type",domain:"docs.example",on:true},{title:"Reduced page chrome",domain:"news.example",on:false}];
  function renderBoosts(section) {
    const items=visible(boosts,section,b=>b.title+" "+b.domain);
    if(!items.length)return empty();
    return html`<div class="zen-library-group">${items.map(b=>row(b.title,`${b.domain} · Mock boost`,"chrome://arc-ui/content/spaces.svg",()=>{b.on=!b.on;refresh();},
      html`<div class="zen-library-row-actions"><moz-toggle ?pressed=${b.on} aria-label=${b.title} @click=${e=>e.stopPropagation()} @toggle=${()=>{b.on=!b.on;refresh();}}></moz-toggle></div>`))}</div>`;
  }
  function empty(){return html`<div class="zen-library-empty">No matching mock data</div>`;}
  const renderers={downloads:renderDownloads,history:renderHistory,media:renderMedia,boosts:renderBoosts};
  function attachViews() {
    if(!enabled)return;
    for(const section of library.querySelectorAll(".zen-library-section")) {
      const render=renderers[section.dataset.section];
      if(!render||patches.has(section))continue;
      viewStates.set(section,{query:section.searchQuery,filters:new Set(section.activeFilters)});
      section.searchQuery="";
      if(section.dataset.section==="downloads")section.activeFilters.clear();
      const input=section.querySelector(".zen-library-search-box input");if(input)input.value="";
      patch(section,"renderItems",()=>render(section));
      if(section.dataset.section==="media") {
        const base=Object.getPrototypeOf(Object.getPrototypeOf(section));
        optInStates.set(section,section.hasAttribute("needs-opt-in"));
        patch(section,"updated",function(changed){base.updated?.call(this,changed);this.removeAttribute("needs-opt-in");});
      }
      section.requestUpdate();
    }
  }
  function blockContext(event){if(enabled){event.preventDefault();event.stopImmediatePropagation();announce("Debug mode uses local mock data.");}}
  function requireOpenWindow(){if(destroyed||win.closed)throw new Error("Debug window closed during activation.");}
  async function enable(preservedRail) {
    if(enabled||!available||destroyed||win.closed)return;
    await ready;
    if(destroyed||win.closed)return;
    if(active&&active!==controller)await active.disable();
    const old=journal();if(old)await removeOwned(win,old);
    if(destroyed||win.closed)return;
    originalTab=win.gBrowser.selectedTab;originalLibraryTab=library.activeTab;
    originalRail=preservedRail??!!win.ZenArc.diagnostics().rail;
    originalHistoryPref={user:Services.prefs.prefHasUserValue("zen.library.history.closed-tabs"),value:Services.prefs.getBoolPref("zen.library.history.closed-tabs",false)};
    data={token:Services.uuid.generateUUID().toString().slice(1,-1),spaces:[],originalSpace:win.gZenWorkspaces.activeWorkspace};
    writeJournal(data);enabled=true;active=controller;
    boosts.forEach((boost,index)=>{boost.on=index<2;});
    document.documentElement.setAttribute("data-arc-debug","loading");
    try {
      const directory=await makeFiles();
      requireOpenWindow();
      downloads=createDownloads({directory,image:[files[0],files[1]],join:(root,name)=>PathUtils.join(root,name),changed:refresh,action:mockAction});
      setDownloads(downloads);
      const originalRemove=win.gBrowser.removeTab;
      patch(win.gBrowser,"removeTab",function(tab,options){
        if(SessionStore.getCustomTabValue(tab,TAB_KEY)===data.token&&ownsPage(tab.linkedBrowser?.currentURI?.spec||"",data.token))options={...options,skipSessionStore:true};
        return originalRemove.call(this,tab,options);
      });
      for(const name of ["Debug Work","Debug Personal"]) {
        const space=await win.gZenWorkspaces.createAndSaveWorkspace(name,"chrome://arc-ui/content/spaces.svg",false,0,{beforeChangeCallback:space=>{
          space.arcDebugToken=data.token;win.gZenWorkspaces.saveWorkspace(space);data.spaces.push(space.uuid);writeJournal(data);
        }});
        requireOpenWindow();
        if(!space||!data.spaces.includes(space.uuid))throw new Error("Could not create a debug Space.");
      }
      await win.gZenWorkspaces.changeWorkspaceWithID(data.spaces[0]);
      requireOpenWindow();
      for(const group of ["Project","Reading"]) {
        const groupTabs=PAGES.filter(p=>p.group===group).map(p=>newTab(p,data.spaces[0]));
        const folder=win.gZenFolders.createFolder(groupTabs,{label:group,workspaceId:data.spaces[0],renameFolder:false,collapsed:group==="Reading"});
        for(const tab of folder.tabs) {
          SessionStore.setCustomTabValue(tab,TAB_KEY,data.token);
          if(!tabs.includes(tab))SessionStore.setCustomTabValue(tab,PLACEHOLDER_KEY,"1");
        }
      }
      for(const title of ["Mail","Calendar","Source code"])win.gZenPinnedTabManager.addToEssentials(newTab({title,text:"Mock favorite for checking Essentials."}));
      const selected=newTab(PAGES[5],data.spaces[0]);
      newTab(PAGES[4],data.spaces[0]);
      newTab(PAGES[6],data.spaces[1]);
      win.gBrowser.selectedTab=selected;
      observer=new win.MutationObserver(attachViews);observer.observe(library,{childList:true,subtree:true});
      library.addEventListener("contextmenu",blockContext,true);
      attachViews();document.documentElement.setAttribute("data-arc-debug","true");announce("Debug Mode enabled. Mock data is ready.");
    } catch(error){await disable();throw error;}
  }
  async function disable() {
    if(!enabled)return;
    enabled=false;observer?.disconnect();observer=null;
    library.removeEventListener("contextmenu",blockContext,true);
    for(const [node,properties] of patches) {
      for(const [key,descriptor] of properties) {if(descriptor)Object.defineProperty(node,key,descriptor);else delete node[key];}
      const state=viewStates.get(node);
      if(state&&!destroyed&&!win.closed) {
        node.searchQuery=state.query;node.activeFilters.clear();for(const filter of state.filters)node.activeFilters.add(filter);
        const input=node.querySelector(".zen-library-search-box input");if(input)input.value=state.query;
        node.onFiltersChanged();
      }
      if(!destroyed&&!win.closed)node.requestUpdate?.();
    }
    patches.clear();viewStates.clear();if(!destroyed&&!win.closed)setDownloads(null);
    if(originalHistoryPref.user)Services.prefs.setBoolPref("zen.library.history.closed-tabs",originalHistoryPref.value);
    else Services.prefs.clearUserPref("zen.library.history.closed-tabs");
    for(const [section,needed] of optInStates) {
      if(destroyed||win.closed)break;
      if(needed)section.setAttribute("needs-opt-in","");else section.removeAttribute("needs-opt-in");
      section.requestUpdate?.();
    }
    optInStates.clear();
    document.documentElement.removeAttribute("data-arc-debug");
    if(!destroyed&&!win.closed)await win.ZenArc.setRail(false);
    if(originalLibraryTab)library.activeTab=originalLibraryTab;
    try {
      await removeOwned(win,data);
      if(originalTab&&!originalTab.closing&&win.gBrowser.tabs.includes(originalTab))win.gBrowser.selectedTab=originalTab;
      if(!destroyed&&!win.closed)await win.ZenArc.setRail(originalRail);
      data=null;downloads=[];tabs=[];files=[];
      announce("Debug Mode disabled. Debug data was removed. Normal tabs moved into debug Spaces stayed in your original Space.");
    } finally {if(active===controller)active=null;}
  }
  const ready=available?(recovery??=Promise.resolve().then(async()=>{
    await SessionStore.promiseAllWindowsRestored;
    await win.gZenWorkspaces.promiseInitialized;
    for(let attempt=0;attempt<100&&!win.gZenWorkspaces.getWorkspaces().length;attempt++) {
      if(win.closed)throw new Error("Window closed before debug recovery.");
      await new Promise(resolve=>win.setTimeout(resolve,50));
    }
    const stale=journal();if(stale&&!active)await removeOwned(win,stale);
  }).finally(()=>{recovery=null;})):Promise.resolve();
  ready.catch(error=>console.error("[Arc UI] Debug recovery:",error));
  const controller={win,available,get enabled(){return enabled;},ready,
    toggle:()=>enqueue(()=>enabled?disable():enable()),
    enable:()=>enqueue(()=>enabled?undefined:enable()),disable:()=>enqueue(disable),
    reset:()=>enqueue(async()=>{if(enabled){const rail=originalRail;await disable();await enable(rail);}}),
    destroy(){destroyed=true;void controller.disable().catch(error=>console.error("[Arc UI] Debug cleanup:",error));},
  };
  return controller;
}
