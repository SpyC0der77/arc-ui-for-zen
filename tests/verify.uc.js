(async () => {
  const result = {checks:[],errors:[]};
  const wait = ms => new Promise(resolve => window.setTimeout(resolve,ms));
  const check = (condition,label) => {result.checks.push({label,pass:!!condition});};
  try {
    await wait(2500);
    check(!!window.ZenArc,'startup loader and patch');
    if(!window.ZenArc)throw new Error('ZenArc did not initialize');
    const nativeLibrary=document.querySelector('zen-library');
    const {ProvidersManager}=ChromeUtils.importESModule('moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs');
    const commandProvider=ProvidersManager.getInstanceForSap('urlbar').getProvider('ArcCommandProvider');
    check(!!commandProvider,'native command provider registered');
    if(!commandProvider)throw new Error('Command provider missing');
    check(document.documentElement.hasAttribute('data-arc-ui'),'theme marker');
    const topControls=document.getElementById('arc-top-controls');
    const nativeTopRow=document.getElementById('zen-sidebar-top-buttons');
    check(nativeTopRow.getBoundingClientRect().height===0,'hidden native controls reserve no toolbar height');
    check(Math.abs(document.getElementById('nav-bar').getBoundingClientRect().top-topControls.getBoundingClientRect().bottom-8)<1,'search keeps the existing 8px gap below top controls');

    const label=document.querySelector('.tab-label');
    check(label&&getComputedStyle(label).fontFamily.includes('Geist'),'native tab uses theme typography');
    check(label&&getComputedStyle(label).fontWeight==='500','tab labels use medium weight');
    check(document.fonts.check('14px Geist'),'bundled UI font loaded');
    const closedAddressBackground=getComputedStyle(gURLBar.querySelector('.urlbar-background')).backgroundColor;
    const closedSurface=gURLBar.querySelector('.urlbar-background').getBoundingClientRect();
    const closedAddressText=getComputedStyle(gURLBar.inputField,gURLBar.inputField.value?null:'::placeholder').color;
    const fieldStyle=getComputedStyle(gURLBar.inputField);
    document.getElementById('urlbar-container').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const editorRect=gURLBar.inputField.editor?.rootElement?.getBoundingClientRect();
    const closedTextX=(editorRect?.width?editorRect.left:gURLBar.inputField.getBoundingClientRect().left+(parseFloat(fieldStyle.paddingLeft)||0)+(parseFloat(fieldStyle.borderLeftWidth)||0))+(parseFloat(fieldStyle.textIndent)||0);
    check(getComputedStyle(gURLBar.inputField).caretColor==='rgba(0, 0, 0, 0)','sidebar address field hides caret');
    gURLBar.focusedViaMousedown=true;
    gURLBar.focus();
    await gURLBar.startQuery({allowAutofill:false});
    await wait(250);
    check(gURLBar.hasAttribute('zen-floating-urlbar')&&gURLBar.hasAttribute('open'),'mouse-focused address field opens native centered search');
    const searchRect=gURLBar.getBoundingClientRect();
    check(Math.abs(searchRect.x+searchRect.width/2-window.innerWidth/2)<3,'search panel is horizontally centered');
    check(getComputedStyle(gURLBar.querySelector('.urlbar-background')).borderTopLeftRadius==='16px','search panel has rounded corners');
    check(getComputedStyle(gURLBar).animationName==='arc-search-open','search opening animation applied');
    const sidebarAddress=document.getElementById('arc-sidebar-address-label');
    check(sidebarAddress?.textContent.length>0&&getComputedStyle(sidebarAddress).display!=='none','sidebar address label remains visible during search');
    const openSurface=sidebarAddress.getBoundingClientRect();
    check(['left','top','width','height'].every(key=>Math.abs(openSurface[key]-closedSurface[key])<0.05),'sidebar address surface retains exact closed bounds');
    check(getComputedStyle(sidebarAddress).backgroundColor===closedAddressBackground,'sidebar placeholder retains closed field background');
    check(getComputedStyle(sidebarAddress.querySelector('.arc-sidebar-address-text')).color===closedAddressText,'sidebar placeholder retains closed field text color');
    const retainedIcon=sidebarAddress.querySelector('.arc-sidebar-address-icon');
    check(retainedIcon.hidden||getComputedStyle(retainedIcon).backgroundImage!=='none','sidebar icon follows native icon visibility');
    check(Math.abs(sidebarAddress.querySelector('.arc-sidebar-address-text').getBoundingClientRect().left-closedTextX)<0.05,'sidebar text preserves native editor subpixel position');
    result.addressGeometry={expected:closedTextX,actual:sidebarAddress.querySelector('.arc-sidebar-address-text').getBoundingClientRect().left,inline:sidebarAddress.querySelector('.arc-sidebar-address-text').style.left,container:document.getElementById('urlbar-container').getBoundingClientRect().toJSON(),editor:editorRect?.toJSON()};
    check(getComputedStyle(gURLBar.inputField).caretColor!=='rgba(0, 0, 0, 0)','centered search field retains visible caret');
    gURLBar.blur();gBrowser.selectedBrowser.focus();await wait(250);
    check(getComputedStyle(sidebarAddress).display==='none','sidebar placeholder hides when native address field returns');
    if(Services.appinfo.OS==='WINNT') {
      check(Services.prefs.getIntPref('gfx.font_rendering.cleartype_params.rendering_mode')===5&&Services.prefs.getIntPref('gfx.font_rendering.cleartype_params.cleartype_level')===0,'Windows natural symmetric rendering and grayscale preference');
      check(Services.prefs.getIntPref('gfx.font_rendering.cleartype_params.enhanced_contrast')===50,'Windows text contrast restores stroke strength');
    }
    check(!!document.getElementById('arc-top-controls'),'navigation controls');
    const {ZenLiveFoldersManager:liveFolders}=ChromeUtils.importESModule('resource:///modules/zen/ZenLiveFoldersManager.sys.mjs');
    await liveFolders.stateRestored.promise;
    if(liveFolders.arcGitHubSetup)await liveFolders.arcGitHubSetup;
    const githubFolders=[...liveFolders.liveFolders.values()].filter(f=>f.constructor.type==='github');
    check(githubFolders.length===2,'native GitHub issues and PR folders created');
    check(githubFolders.every(f=>f.state.options.authorMe&&f.state.options.assignedMe),'GitHub authored and assigned filters enabled');
    check(githubFolders.find(f=>f.state.type==='pull-requests')?.state.options.reviewRequested,'GitHub PR review requests included');
    const prFolder=githubFolders.find(f=>f.state.type==='pull-requests');
    for(const f of githubFolders)f.stop();
    if(prFolder) {
      // Test the native lazy-tab lifecycle without depending on a GitHub login.
      liveFolders.onLiveFolderFetch(prFolder,[{id:'arc-test#1',title:'Runtime test pull request',url:'https://github.com/example/test/pull/1'}]);
      await wait(100);
      const nativeFolder=liveFolders.getFolderForLiveFolder(prFolder);
      const actions=document.getElementById('zenFolderActions');
      const originalTrigger=Object.getOwnPropertyDescriptor(actions,'triggerNode');
      const openTestMenu=folder=>{
        Object.defineProperty(actions,'triggerNode',{configurable:true,value:folder.labelElement});
        actions.dispatchEvent(new Event('popupshowing',{bubbles:true}));
      };
      try {
        openTestMenu(nativeFolder);
        for(const id of ['context_zenFolderUnpack','context_zenFolderNewSubfolder','context_zenFolderToSpace']) {
          const item=document.getElementById(id);
          check(getComputedStyle(item).display==='none',id+' hidden for live folders');
          check(!item.dispatchEvent(new Event('command',{bubbles:true,cancelable:true})),id+' command blocked for live folders');
        }
        check(getComputedStyle(document.getElementById('context_zenFolderDelete')).display!=='none','live folder deletion remains available');
        const ordinary=gZenFolders.createFolder([],{label:'Menu test',renameFolder:false});
        openTestMenu(ordinary);
        check(getComputedStyle(document.getElementById('context_zenFolderUnpack')).display!=='none','ordinary folder retains Unpack after live menu');
        await ordinary.delete();
      } finally {
        actions.dispatchEvent(new Event('popuphidden',{bubbles:true}));
        if(originalTrigger)Object.defineProperty(actions,'triggerNode',originalTrigger);else delete actions.triggerNode;
      }
      check(nativeFolder.tabs.some(t=>t.hasAttribute('zen-live-folder-item-id')&&t.label==='Runtime test pull request'),'GitHub entry creates a native lazy tab');
      liveFolders.onLiveFolderFetch(prFolder,'zen-live-folder-failed-fetch');
      check(nativeFolder.tabs.some(t=>t.hasAttribute('zen-live-folder-item-id')),'fetch error preserves existing GitHub entries');
      liveFolders.onLiveFolderFetch(prFolder,[]);await wait(500);
      check(!nativeFolder.tabs.some(t=>t.hasAttribute('zen-live-folder-item-id')),'GitHub entry disappears when it no longer matches');
    }
    check(ZenArc.diagnostics().archiveHours===(nativeLibrary?12:null),'auto-archive requires native Archive storage');
    if(nativeLibrary)check(Services.prefs.getBoolPref('zen.library.history.closed-tabs',false),'library Archive view enabled');
    else check(!Services.prefs.prefHasUserValue('arc-ui.archive-initialized'),'legacy startup does not initialize native Archive');
    const toggleRect=document.getElementById('arc-sidebar-toggle').getBoundingClientRect();
    const controlsRect=document.getElementById('arc-top-controls').getBoundingClientRect();
    check(Math.abs(toggleRect.left-controlsRect.left-2)<1&&toggleRect.width===32,'sidebar toggle moves left with full hit area');
    const savedSide=document.documentElement.getAttribute('zen-right-side');
    const navBefore=document.getElementById('arc-navigation-controls').getBoundingClientRect();
    document.documentElement.setAttribute('zen-right-side','true');
    const rightToggle=document.getElementById('arc-sidebar-toggle');
    check(getComputedStyle(rightToggle).insetInlineStart==='8px'&&rightToggle.getBoundingClientRect().width===32,'right-docked toggle moves toward the right frame edge with full hit area');
    if(savedSide===null)document.documentElement.removeAttribute('zen-right-side');else document.documentElement.setAttribute('zen-right-side',savedSide);
    check(Math.abs(document.getElementById('arc-navigation-controls').getBoundingClientRect().left-navBefore.left)<1,'toggle side changes preserve navigation position');
    check(document.querySelectorAll('#arc-sidebar-toggle').length===1&&['zen-toggle-compact-mode','zen-expand-sidebar-button'].every(id=>!document.getElementById(id)||getComputedStyle(document.getElementById(id)).display==='none'),'one visible sidebar toggle');
    check(nativeLibrary?typeof nativeLibrary.constructor.animateProgress==='function':!!document.getElementById('arc-legacy-library'),'functional library or native fallback menu available');
    check(['zen-library-button','library-button','downloads-button'].every(id=>!document.getElementById(id)||getComputedStyle(document.getElementById(id)).display==='none'),'duplicate native library and downloads buttons hidden');
    check(getComputedStyle(document.getElementById('navigator-toolbox')).backgroundColor==='rgb(206, 199, 212)','lavender palette');
    const frameNodes=['zen-browser-background','zen-toolbar-background','zen-appcontent-wrapper','zen-tabbox-wrapper'];
    const savedTheme=document.documentElement.getAttribute('style');
    document.documentElement.style.setProperty('--zen-main-browser-background','linear-gradient(#aaffcc,#ffaaaa)');
    document.documentElement.style.setProperty('--zen-main-browser-background-old','#22aa66');
    check(frameNodes.every(id=>getComputedStyle(document.getElementById(id)).backgroundColor==='rgb(206, 199, 212)'),'entire browser frame stays lavender despite custom Zen theme');
    check(['::before','::after'].every(pseudo=>getComputedStyle(document.getElementById('zen-browser-background'),pseudo).display==='none'),'custom workspace background layers are suppressed');
    if(savedTheme===null)document.documentElement.removeAttribute('style');else document.documentElement.setAttribute('style',savedTheme);
    const gift=document.getElementById('arc-gift-button');
    gift.dispatchEvent(new PointerEvent('pointerenter'));await wait(100);
    check(ZenArc.diagnostics().popup,'gift hover opens download menu');
    const nativeDownloadList=document.getElementById('zen-library-download-list');
    check(!nativeDownloadList||getComputedStyle(nativeDownloadList).display==='none','native Zen hover download list is absent or hidden');
    check(getComputedStyle(document.getElementById('arc-download-popup')).display!=='none','custom download popup is visible on library hover');
    check(document.getElementById('arc-download-popup').matches(':popover-open'),'custom menu paints in the top layer');
    check(document.querySelector('.arc-download-empty')&&!document.querySelector('.arc-download-footer'),'empty menu uses the custom layout instead of the old footer');
    const giftBounds=gift.getBoundingClientRect(),giftX=giftBounds.x+giftBounds.width/2,giftY=giftBounds.y+giftBounds.height/2;
    check(gift.contains(document.elementFromPoint(giftX,giftY)),'gift is the actual mouse hit target');
    gift.doCommand();
    if(nativeLibrary)check(nativeLibrary.style.transform==='translateX(-100%)','library is positioned offscreen before its first visible frame');
    await wait(1000);
    check(ZenArc.diagnostics().rail&&!ZenArc.diagnostics().popup,'gift click opens native library and hides hover menu');
    gift.doCommand();await wait(1000);check(!ZenArc.diagnostics().rail,'gift click closes native library');
    await DownloadsPanel.showPanel();check(ZenArc.diagnostics().popup,'native download panel requests use Arc download menu');ZenArc.hideDownloads();
    const before=ZenArc.diagnostics().compact;
    ZenArc.toggleDock();
    // Snapshot capture can take longer on older engines. Observe the actual
    // animation rather than assuming it starts within a fixed 100 ms.
    if(nativeLibrary)for(let i=0;i<200&&!document.getElementById('zen-tabbox-wrapper').getAnimations().length;i++)await wait(10);
    else await wait(100);
    const pageAnimations=document.getElementById('zen-tabbox-wrapper').getAnimations();
    if(nativeLibrary){
      check(pageAnimations.some(a=>a.effect.getKeyframes().some(k=>k.width)&&a.effect.getKeyframes().every(k=>!k.transform?.includes('scale'))),'sidebar transition resizes page without stretching text');
      if(!before)check(!!document.getElementById('arc-sidebar-transition'),'sidebar animates out using captured chrome');
    }
    await wait(500);check(ZenArc.diagnostics().compact!==before,'sidebar toggles');
    ZenArc.toggleDock();await wait(550);check(ZenArc.diagnostics().compact===before,'sidebar redocks');
    check(!document.getElementById('arc-sidebar-transition')&&!document.documentElement.hasAttribute('data-arc-sidebar-animating'),'sidebar transition cleans up');
    const start=ZenArc.diagnostics().downloads;
    const flight=ZenArc.previewDownload({clientX:700,clientY:300});
    await wait(120);check(!!document.querySelector('[data-arc-flight]'),'file flight starts');
    gift.dispatchEvent(new PointerEvent('pointerenter'));
    await DownloadsPanel.showPanel();
    check(!ZenArc.diagnostics().popup,'hover and native download requests cannot open menu during flight');
    await wait(1100);check(!ZenArc.diagnostics().popup&&!!document.querySelector('[data-arc-flight]'),'menu stays closed until file reaches gift');
    await flight;check(!document.querySelector('[data-arc-flight]'),'file flight completes');check(ZenArc.diagnostics().downloads===start,'preview creates no downloads');
    check(ZenArc.diagnostics().popup,'arrival opens downloads');
    ZenArc.hideDownloads();
    const tab=window.openTrustedLinkIn('chrome://arc-ui/content/home.xhtml','tab');
    await wait(1800);
    check(gBrowser.currentURI.spec==='chrome://arc-ui/content/home.xhtml','demo page opens');
    const home = gBrowser.selectedBrowser.contentDocument;
    check(!!home?.getElementById('preview'),'demo button renders in chrome page');
    home?.getElementById('preview')?.click();
    await wait(1900);
    check(home?.getElementById('status')?.textContent.includes('No file was downloaded'),'demo button plays animation');
    check(ZenArc.diagnostics().downloads===start,'demo page creates no downloads');
    check(['back','forward','reload','stop'].every(name=>typeof BrowserCommands[name]==='function'),'native navigation command bindings');
    const wasCompact=ZenArc.diagnostics().compact;
    if(!wasCompact)ZenArc.toggleDock();
    await wait(600);
    const hiddenFlight=ZenArc.previewDownload({clientX:700,clientY:300});
    await wait(100);
    check(!!document.querySelector('.arc-fallback-gift'),'hidden sidebar download target');
    await hiddenFlight;
    if(!wasCompact)ZenArc.toggleDock();
    await wait(500);
    const originalMotion=Services.prefs.prefHasUserValue('ui.prefersReducedMotion')?Services.prefs.getIntPref('ui.prefersReducedMotion'):null;
    Services.prefs.setIntPref('ui.prefersReducedMotion',1);await wait(100);
    gURLBar.focus();await gURLBar.startQuery({allowAutofill:false});await wait(100);
    check(getComputedStyle(gURLBar).animationName==='none','reduced motion skips search animation');
    gURLBar.blur();gBrowser.selectedBrowser.focus();
    await ZenArc.previewDownload();
    check(!document.querySelector('[data-arc-flight]')&&ZenArc.diagnostics().popup,'reduced motion skips file flight and keeps feedback');
    if(originalMotion===null)Services.prefs.clearUserPref('ui.prefersReducedMotion');else Services.prefs.setIntPref('ui.prefersReducedMotion',originalMotion);
    const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
    const source=PathUtils.join(PathUtils.profileDir,'download-source.txt');
    const target=PathUtils.join(PathUtils.profileDir,'download-result.txt');
    await IOUtils.writeUTF8(source,'Local integration fixture.');
    const download=await Downloads.createDownload({source:PathUtils.toFileURI(source),target});
    const downloadList=await Downloads.getList(Downloads.PUBLIC);await downloadList.add(download);await download.start();await wait(100);
    check(ZenArc.diagnostics().downloads===start+1,'real browser download is listed');
    check(!!document.querySelector('[aria-label="Show download-result.txt in folder"]'),'completed download offers reveal action');
    check(!gift.hasAttribute('tooltiptext'),'library hover has no overlapping native tooltip');
    ZenArc.openDownloads();await wait(250);
    check(!ZenArc.diagnostics().popup,'real download keeps menu closed during its flight');
    await wait(1500);check(ZenArc.diagnostics().popup,'real download opens menu on arrival');
    check(getComputedStyle(document.querySelector('.arc-download-icon')).width==='40px','download rows use Arc-sized file previews');
    check(getComputedStyle(document.getElementById('arc-download-popup')).boxShadow==='none'&&!document.querySelector('.arc-download-header'),'recent files appear without a popup card or heading');
    check(getComputedStyle(document.querySelector('.arc-download-list')).maxHeight==='288px','download list retains bounded scrolling');
    const popupShot=await new Promise(resolve=>{const c=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');c.width=innerWidth;c.height=innerHeight;const ctx=c.getContext('2d');ctx.drawWindow(window,0,0,innerWidth,innerHeight,'white');c.toBlob(async blob=>resolve(new Uint8Array(await blob.arrayBuffer())));});
    await IOUtils.write(PathUtils.join(PathUtils.profileDir,'download-popup.png'),popupShot);
    const originalReveal=download.showContainingDirectory,originalLaunch=download.launch;
    let revealClosed=false,launchClosed=false;
    try {
      download.showContainingDirectory=async()=>{revealClosed=!ZenArc.diagnostics().popup;};
      document.querySelector('[aria-label="Show download-result.txt in folder"]').click();
      check(revealClosed,'show in folder dismisses recent files before invoking the native action');
      window.dispatchEvent(new FocusEvent('focus'));await wait(200);
      check(!ZenArc.diagnostics().popup,'recent files stay closed when focus returns after reveal');
      download.launch=async()=>{launchClosed=!ZenArc.diagnostics().popup;};
      ZenArc.openDownloads();
      document.querySelector('[aria-label="Open download-result.txt"]').click();
      check(launchClosed,'opening a file dismisses recent files before invoking its native action');
    } finally {
      download.showContainingDirectory=originalReveal;download.launch=originalLaunch;
    }
    gift.dispatchEvent(new Event('command'));await wait(1000);
    check(ZenArc.diagnostics().rail,'gift click still opens the real library from recent files');
    ZenArc.setRail(false);await wait(800);
    await downloadList.remove(download);
    result.diagnostics={...ZenArc.diagnostics(),hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,homeStatus:home?.getElementById('status')?.textContent};
    ZenArc.hideDownloads();
    const library=document.querySelector('zen-library');
    async function commandQuery(text){
      gURLBar.search(text);
      const context=await gURLBar.lastQueryContextPromise;
      await wait(300);
      return context.results.filter(row=>row.providerName==='ArcCommandProvider');
    }
    let commands=await commandQuery('downloads');
    check(commands.length===1&&commands[0].payload.commandId==='downloads','typing downloads produces a native command result');
    check(!!document.querySelector('.urlbarView-row[dynamicType="arc-command"]'),'command result renders in native suggestion list');
    const commandRow=document.querySelector('.urlbarView-row[dynamicType="arc-command"] .urlbarView-row-inner');
    commandRow.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
    commandRow.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));await wait(800);
    if(library)check(library.activeTab==='downloads'&&ZenArc.diagnostics().rail,'mouse pick runs Downloads command');
    else {
      const organizer=Services.wm.getMostRecentWindow('Places:Organizer');
      check(!!organizer,'legacy Downloads command opens native organizer');
      organizer?.close();
    }
    await ZenArc.setRail(false);
    commands=await commandQuery('archive');
    gURLBar.view.selectedRowIndex=commands[0].rowIndex;
    gURLBar.handleCommand(new KeyboardEvent('keydown',{key:'Enter',code:'Enter'}));await wait(800);
    check(library?library.activeTab==='history'&&library.querySelector('zen-library-history-section')?.activeFilters.has('source:closed')&&ZenArc.diagnostics().rail:ZenArc.diagnostics().rail,'keyboard selection opens Archive or native recently closed menu');
    await ZenArc.setRail(false);
    check((await commandQuery('archive.org')).length===0,'URL query has no command results');
    check((await commandQuery('downloads for windows')).length===0,'ordinary search has no command results');
    commands=await commandQuery('split view');
    check(commands.some(row=>row.payload.commandId==='split'),'split command available with multiple tabs');
    gURLBar.view.selectedRowIndex=commands.find(row=>row.payload.commandId==='split').rowIndex;
    gURLBar.handleCommand(new KeyboardEvent('keydown',{key:'Enter',code:'Enter'}));await wait(700);
    check(gZenViewSplitter.splitViewActive,'Split View command creates a real native split');
    commands=await commandQuery('unsplit');
    check(commands.length===1,'Unsplit command available in a split');
    gURLBar.view.selectedRowIndex=commands[0].rowIndex;
    gURLBar.handleCommand(new KeyboardEvent('keydown',{key:'Enter',code:'Enter'}));await wait(700);
    check(!gZenViewSplitter.splitViewActive,'Unsplit command removes native split');
    if(library){
    const debugSpaceCount=gZenWorkspaces.getWorkspaces().length;
    const {SessionStore}=ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs');
    const debugClosedCount=SessionStore.getClosedTabCountForWindow(window);
    commands=await commandQuery('debug');
    check(commands.length===1&&commands[0].payload.title==='Enable Debug Mode','debug command is available while fixtures are off');
    gURLBar.view.selectedRowIndex=commands[0].rowIndex;
    gURLBar.handleCommand(new KeyboardEvent('keydown',{key:'Enter',code:'Enter'}));
    for(let i=0;i<80&&document.documentElement.getAttribute('data-arc-debug')!=='true';i++)await wait(50);
    check(ZenArc.debug.enabled&&ZenArc.diagnostics().downloads===7,'keyboard command activates mock downloads and debug mode');
    check(gZenWorkspaces.getWorkspaces().length===debugSpaceCount+2,'debug mode creates two owned native Spaces');
    check(gZenWorkspaces.allStoredTabs.filter(t=>t.hasAttribute('arc-debug-token')).length>=10,'mock tabs, folders and favorites use native tab objects');
    check((await commandQuery('reset debug data'))[0]?.payload.commandId==='debug-reset','reset command appears while debug mode is active');
    gURLBar.view.close();
    await ZenArc.debug.toggle();
    check(!ZenArc.debug.enabled&&gZenWorkspaces.getWorkspaces().length===debugSpaceCount,'debug toggle removes only its temporary Spaces');
    check(!gZenWorkspaces.allStoredTabs.some(t=>t.linkedBrowser?.currentURI?.spec.startsWith('chrome://arc-ui/content/debug.xhtml')),'all mock tabs are removed across inactive Spaces');
    check(SessionStore.getClosedTabCountForWindow(window)===debugClosedCount,'debug cleanup does not add mock tabs to Archive');
    check(!document.documentElement.hasAttribute('data-arc-debug')&&!Services.prefs.prefHasUserValue('arc-ui.debug.owned-data'),'debug marker and cleanup journal are removed');
    }else {
      check(!ZenArc.debug.available,'legacy version does not offer unsupported library mock views');
      check((await commandQuery('debug')).length===0,'legacy command provider hides unavailable debug mode');
    }
    await commandQuery('split');
    document.title='Arc UI verification';
  } catch(error){result.errors.push(String(error)+'\n'+error.stack);}
  // Capture failures too, before the disposable browser shuts down.
  try {
      const snapshot = await window.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0,0,innerWidth,innerHeight),1,'white');
      const canvas = document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
      canvas.width=innerWidth;canvas.height=innerHeight;canvas.getContext('2d').drawImage(snapshot,0,0);snapshot.close();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve));
      await IOUtils.write(PathUtils.join(PathUtils.profileDir,'verified.png'),new Uint8Array(await blob.arrayBuffer()));
      result.checks.push({label:'browser chrome screenshot',pass:true});
  }catch(error){result.screenshotError=String(error);}
  await IOUtils.writeJSON(PathUtils.join(PathUtils.profileDir,'verification.json'),result);
  if(!Services.prefs.getBoolPref('arc-ui.test.pointer',false))
    window.setTimeout(()=>Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit),100);
})();
