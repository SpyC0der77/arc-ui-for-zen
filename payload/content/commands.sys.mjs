/* Local command results in Zen's native URL bar. No navigation interception. */
export const ACTIONS = Object.freeze([
  {id:"archive", title:"Open Archive", aliases:["archive", "open archive", "view archive"], icon:"archive"},
  {id:"downloads", title:"Open Downloads", aliases:["downloads", "open downloads", "show downloads"], icon:"download"},
  {id:"split", title:"Split View", aliases:["split", "split view", "add split view", "split side by side"], command:"cmd_zenSplitViewVertical", icon:"sidebars"},
  {id:"split-horizontal", title:"Split View Top to Bottom", aliases:["split top to bottom", "split horizontal", "horizontal split"], command:"cmd_zenSplitViewHorizontal", icon:"sidebars"},
  {id:"unsplit", title:"Unsplit View", aliases:["unsplit", "unsplit view", "close split view"], command:"cmd_zenSplitViewUnsplit", icon:"sidebars"},
  {id:"sidebar", title:"Toggle Sidebar", aliases:["sidebar", "toggle sidebar"], icon:"sidebars"},
  {id:"debug", title:"Toggle Debug Mode", aliases:["debug", "debug mode", "toggle debug", "toggle debug mode", "mock", "mock data"], icon:"debug"},
  {id:"debug-reset", title:"Reset Debug Data", aliases:["reset debug", "reset debug data", "reset mock", "reset mock data"], icon:"debug"},
]);

export function matchActions(input) {
  const query=String(input).trim().toLowerCase().replace(/\s+/g," ");
  // Require a deliberate prefix. URLs, search operators and unrelated phrases
  // never become commands; the native search result remains available.
  if(query.length<2)return [];
  return ACTIONS.filter(action=>action.aliases.some(alias=>alias.startsWith(query)))
    .sort((a,b)=>Number(b.aliases.includes(query))-Number(a.aliases.includes(query)));
}

const windows=new Set();
let provider=null, manager=null;

function available(action,win) {
  if(!win?.ZenArc||win.closed)return false;
  if(action.id==="debug")return !!win.ZenArc.debug?.available;
  if(action.id==="debug-reset")return !!win.ZenArc.debug?.enabled;
  if(!action.command)return true;
  const command=win.document.getElementById(action.command);
  if(!command||command.getAttribute("disabled")==="true")return false;
  if(action.id==="unsplit")return !!win.gZenViewSplitter?.splitViewActive;
  return win.gBrowser.visibleTabs.length>=2;
}

async function run(action,win) {
  if(!available(action,win))return;
  // Zen routes these through its commandset listener, not the browser's
  // controller dispatcher used by goDoCommand.
  if(action.command){
    win.document.getElementById(action.command).dispatchEvent(new win.Event("command",{bubbles:true}));
    return;
  }
  if(action.id==="sidebar"){win.ZenArc.toggleDock();return;}
  if(action.id==="debug"){await win.ZenArc.debug.toggle();return;}
  if(action.id==="debug-reset"){await win.ZenArc.debug.reset();return;}
  const library=win.document.querySelector("zen-library");
  if(action.id==="downloads")library.activeTab="downloads";
  else {
    win.Services.prefs.setBoolPref("zen.library.history.closed-tabs",true);
    library.activeTab="history";
    await library.updateComplete;
    const section=library.querySelector("zen-library-history-section");
    if(section){
      section.activeFilters.delete("source:history");
      section.activeFilters.add("source:closed");
      section.onFiltersChanged();
      section.requestUpdate();
    }
  }
  await win.ZenArc.setRail(true);
}

export function install(win) {
  windows.add(win);
  if(!provider){
    const {UrlbarProvider}=ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs");
    const {UrlbarShared}=ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarShared.mjs");
    const {UrlbarResult}=ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarResult.mjs");
    const {ProvidersManager}=ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs");
    manager=ProvidersManager.getInstanceForSap("urlbar");
    provider=new class ArcCommandProvider extends UrlbarProvider {
      contexts=new WeakMap();
      get type(){return UrlbarShared.PROVIDER_TYPE.PROFILE;}
      async isActive(context,controller){
        const target=controller.browserWindow;
        if(!windows.has(target)||context.searchMode||context.restrictInSearchMode())return false;
        this.contexts.set(context,target);
        return matchActions(context.searchString).some(action=>available(action,target));
      }
      async startQuery(context,add){
        const target=this.contexts.get(context);
        for(const [index,action] of matchActions(context.searchString).filter(a=>available(a,target)).entries()){
          add(this,new UrlbarResult({type:UrlbarShared.RESULT_TYPE.DYNAMIC,source:UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
            suggestedIndex:index+1,payload:{dynamicType:"arc-command",commandId:action.id,title:action.id==="debug"?`${target.ZenArc.debug.enabled?"Disable":"Enable"} Debug Mode`:action.title,input:context.searchString,
              icon:action.icon==="archive"?"chrome://browser/content/zen-images/downloads/archive.svg":
                action.icon==="download"?"chrome://browser/skin/downloads/downloads.svg":
                  action.icon==="debug"?"chrome://arc-ui/content/spaces.svg":
                  action.id==="sidebar"?"chrome://browser/skin/zen-icons/sidebar.svg":"chrome://browser/skin/zen-icons/split.svg"}}));
        }
      }
      getViewTemplate(){
        return {attributes:{selectable:true},children:[
          {name:"icon",tag:"img",attributes:{class:"urlbarView-favicon","aria-hidden":"true"}},
          {name:"title",tag:"span",attributes:{class:"urlbarView-title"}},
          {name:"hint",tag:"span"},
        ]};
      }
      getViewUpdate(result){return {
        icon:{attributes:{src:result.payload.icon}},title:{textContent:result.payload.title},hint:{textContent:"Run command"},
      };}
      onEngagement(context,controller,details){
        const action=ACTIONS.find(a=>a.id===details.result?.payload.commandId);
        const target=controller.browserWindow;
        if(action&&windows.has(target))void run(action,target).catch(error=>{
          console.error("[Arc UI] Command failed",error);
          target.document.getElementById("arc-live-status").textContent=`${action.title} failed. Please try again.`;
        });
      }
    };
    manager.registerProvider(provider);
  }
  return ()=>{
    windows.delete(win);
    if(!windows.size&&provider){manager.unregisterProvider(provider);provider=null;manager=null;}
  };
}
