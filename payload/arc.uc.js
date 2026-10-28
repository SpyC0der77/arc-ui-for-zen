/* Arc UI for Zen 1.23.4b. Privileged browser UI only; no remote code. */
(() => {
  "use strict";
  if (window.ZenArc || !window.gBrowser) return;
  const HTML = "http://www.w3.org/1999/xhtml";
  const SVG = "http://www.w3.org/2000/svg";
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const root = document.documentElement;
  const folder = PathUtils.join(PathUtils.profileDir, "chrome", "arc-ui");
  const uri = "chrome://arc-ui-runtime/content/arc.css";
  window.windowUtils.loadSheetUsingURIString(uri, window.windowUtils.USER_SHEET);
  root.setAttribute("data-arc-ui", "0.1.0");
  const {actionIcon}=ChromeUtils.importESModule("chrome://arc-ui/content/download-icons.sys.mjs");
  const createMenu=document.getElementById("zenCreateNewPopup");
  if(createMenu) {
    const items=[
      ["cmd_zenOpenWorkspaceCreation","New Space","new-space"],
      ["cmd_zenOpenFolderCreation","New Folder","new-folder"],
      ["cmd_zenNewEmptySplit","New Split","new-split"],
      ["cmd_newNavigatorTab","New Tab","new-tab"]
    ];
    for(const [command,label,image] of items) {
      const item=createMenu.querySelector(`[command="${command}"]`);
      if(!item)continue;
      item.removeAttribute("data-l10n-id");item.setAttribute("label",label);
      item.setAttribute("image",`chrome://arc-ui/content/menu-icons/${image}.svg`);
      item.classList.add("menuitem-iconic");
      if(command==="cmd_newNavigatorTab")item.setAttribute("key","key_newNavigatorTab");
    }
    const split=createMenu.querySelector('[command="cmd_zenNewEmptySplit"]');
    const tab=createMenu.querySelector('[command="cmd_newNavigatorTab"]');
    const boost=document.createXULElement("menuitem");
    boost.id="arc-new-boost";boost.classList.add("menuitem-iconic");
    boost.setAttribute("label","New Boost");
    boost.setAttribute("image","chrome://arc-ui/content/menu-icons/new-boost.svg");
    boost.addEventListener("command",()=>document.getElementById("zen-site-data-boost").doCommand());
    if(split)createMenu.insertBefore(boost,split);
    if(tab)createMenu.insertBefore(document.createXULElement("menuseparator"),tab);
    createMenu.addEventListener("popupshowing",()=>{
      const uri=gBrowser.currentURI;
      boost.disabled=!(uri.schemeIs("https")||uri.schemeIs("http"));
    });
  }
  // Native menu internals have their own stylesheet and override ::part rules.
  // Keep native popup behavior, while theming that internal surface explicitly.
  document.addEventListener("popupshowing",event=>{
    const popup=event.target;
    if(!["appMenu-popup","zenCreateNewPopup"].includes(popup.id)||!popup.shadowRoot||popup.shadowRoot.querySelector("[data-arc-menu-style]"))return;
    const link=document.createElementNS(HTML,"link");
    link.rel="stylesheet";link.href="chrome://arc-ui/content/menu-popup.css";
    link.setAttribute("data-arc-menu-style","");popup.shadowRoot.append(link);
  });
  // Keep Zen's native splitter and persisted width after the initial theme setup.
  if (!Services.prefs.getBoolPref("arc-ui.width-initialized", false)) {
    const toolbox = document.getElementById("navigator-toolbox");
    toolbox.style.width = "264px";
    toolbox.style.setProperty("--zen-sidebar-width", "264px");
    toolbox.setAttribute("width", "264px");
    Services.prefs.setBoolPref("arc-ui.width-initialized", true);
  }
  const timers = new Set(), animations = new Set();
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const later = (fn, ms) => { const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const clear = id => { window.clearTimeout(id); timers.delete(id); };
  const animate = (el, frames, options) => {
    if (reduced()) return Promise.resolve();
    const a = el.animate(frames, options); animations.add(a);
    return a.finished.catch(() => {}).finally(() => { animations.delete(a); a.cancel(); });
  };
  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(HTML, tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const paths = {
    panel: ['M9 3v18','M3 3h18v18H3z'], back: ['m12 5-7 7 7 7','M5 12h14'],
    forward: ['m12 5 7 7-7 7','M5 12h14'], reload: ['M20 11a8 8 0 0 0-14.8-4L4 9','M4 4v5h5','M4 13a8 8 0 0 0 14.8 4L20 15','M20 20v-5h-5'],
    stop: ['M6 6h12v12H6z'], close: ['m6 6 12 12','M6 18 18 6'],
    gift: ['M3 8h18v4H3z','M5 12v9h14v-9','M12 8v13','M12 8H8a3 3 0 1 1 3-3z','M12 8h4a3 3 0 1 0-3-3z'],
    file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z','M14 2v6h6','M8 13h8','M8 17h6'],
    download: ['M12 3v12','m7 10 5 5 5-5','M5 17v4h14v-4'],
    media: ['M3 3h18v18H3z','m3 17 6-6 4 4 3-3 5 5'],
    film: ['M4 3h16v18H4z','M8 3v18','M16 3v18','M4 8h4','M4 16h4','M16 8h4','M16 16h4'],
    music: ['M9 18V5l12-2v13','M9 18a3 3 0 1 1-3-3h3','M21 16a3 3 0 1 1-3-3h3'],
    fileArchive: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z','M14 2v6h6','M9 3v2m0 2v2m0 2v2','M8 16h2v3H8z'],
    easels: ['M3 3h18v13H3z','m8 21 4-5 4 5'], spaces: ['M3 3h8v8H3z','M14 3h7v8h-7z','M3 14h8v7H3z','M14 14h7v7h-7z'],
    boosts: ['m14 3 7 7-10 10H4v-7z','m12 5 7 7'], archive: ['M3 3h18v4H3z','M5 7v14h14V7','M9 11h6'],
    pause: ['M8 5v14','M16 5v14'], play: ['m7 4 14 8-14 8z'], folder: ['M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z']
  };
  function icon(name) {
    const svg = document.createElementNS(SVG, "svg");
    // 2 units at 24px becomes 1.5px at our 18px toolbar size, matching Zen.
    for (const [k,v] of Object.entries({viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"})) svg.setAttribute(k,v);
    for (const d of paths[name] || paths.file) { const p = document.createElementNS(SVG,"path");p.setAttribute("d",d);svg.append(p); }
    return svg;
  }
  const nudges = {back:{x:-4},forward:{x:4},reload:{rotate:-50},panel:{x:-3},gift:{y:-3,rotate:-12},close:{rotate:90},file:{y:-2}};
  function nudge(button,name) {
    if (reduced()) return;
    const i = button.querySelector("svg"), p = nudges[name] || {};
    if (!i || i.getAnimations().length) return;
    const pose = `translate(${p.x||0}px,${p.y||0}px) rotate(${p.rotate||0}deg)`;
    void animate(i,[{transform:"none"},{transform:pose,offset:.35},{transform:"none"}],{duration:430,easing:"cubic-bezier(.22,1,.36,1)"});
  }
  function button(label,name,action) {
    const b=el("button",{type:"button",title:label,"aria-label":label,class:"arc-icon-button"});b.append(icon(name));
    b.addEventListener("click",action);b.addEventListener("pointerdown",e=>{if(e.button===0)nudge(b,name);});return b;
  }
  function downloadButton(label,name,action) {
    const b=el("button",{type:"button",title:label,"aria-label":label,class:"arc-icon-button"});
    b.append(el("img",{src:actionIcon(name),alt:"","aria-hidden":"true"}));
    b.addEventListener("click",action);return b;
  }
  function report(error) { console.error("[Arc UI]",error); status.textContent=error.message || String(error); }
  const toolbox=document.getElementById("navigator-toolbox");
  const content=document.getElementById("zen-tabbox-wrapper");
  if (!toolbox || !content || !window.gZenCompactModeManager) throw new Error("Unsupported Zen window layout");
  const cm=window.gZenCompactModeManager;
  // Zen resets the sidebar to its platform default on splitter double-click.
  // Intercept only that gesture; leave native pointer-based resizing intact.
  function preventSidebarWidthReset(event) {
    if(event.button!==0||event.target.id!=="zen-sidebar-splitter")return;
    event.preventDefault();event.stopImmediatePropagation();
  }
  window.addEventListener("dblclick",preventSidebarWidthReset,true);
  // The native URL bar moves into the popover. Keep its last sidebar text behind.
  const addressContainer=document.getElementById("urlbar-container");
  const addressLabel=el("span",{id:"arc-sidebar-address-label","aria-hidden":"true"});
  const addressIcon=el("span",{class:"arc-sidebar-address-icon"});
  const addressText=el("span",{class:"arc-sidebar-address-text"});
  addressLabel.append(addressIcon,addressText);
  addressContainer.append(addressLabel);
  let addressAnchor=null;
  function positionAddressLabel() {
    if(!addressAnchor)return;
    const current=addressContainer.getBoundingClientRect();
    addressLabel.style.left=`${addressAnchor.left-current.left}px`;
    addressLabel.style.top=`${addressAnchor.top-current.top}px`;
    addressLabel.style.right="auto";
    addressLabel.style.bottom="auto";
    addressLabel.style.width=`${addressAnchor.width}px`;
    addressLabel.style.height=`${addressAnchor.height}px`;
  }
  function rememberAddress() {
    if(gURLBar.hasAttribute("zen-floating-urlbar")||gURLBar.hasAttribute("breakout-extend")){positionAddressLabel();return;}
    const input=gURLBar.inputField;
    addressText.textContent=input.value||input.placeholder||"Search or enter address";
    const textStyle=getComputedStyle(input,input.value?null:"::placeholder");
    const inputStyle=getComputedStyle(input);
    const fieldRect=input.getBoundingClientRect(),containerRect=addressContainer.getBoundingClientRect();
    const background=gURLBar.querySelector(".urlbar-background");
    const surfaceRect=background?.getBoundingClientRect()||containerRect;
    addressAnchor={left:surfaceRect.left,top:surfaceRect.top,width:surfaceRect.width,height:surfaceRect.height};
    positionAddressLabel();
    // Native input text lives inside an anonymous editor, whose origin can differ
    // from the input border by a fractional pixel. Use that actual text origin.
    const editorRect=input.editor?.rootElement?.getBoundingClientRect();
    const textOrigin=editorRect?.width?editorRect.left:fieldRect.left+(parseFloat(inputStyle.paddingLeft)||0)+(parseFloat(inputStyle.borderLeftWidth)||0);
    const textLeft=textOrigin-addressAnchor.left-addressContainer.clientLeft+(parseFloat(inputStyle.textIndent)||0);
    addressText.style.left=`${textLeft}px`;
    for(const property of ["fontFamily","fontSize","fontWeight","fontStretch","fontStyle","letterSpacing","wordSpacing","direction"]){addressText.style[property]=inputStyle[property];}
    addressText.style.right=`${Math.max(0,surfaceRect.right-fieldRect.right)}px`;
    addressText.style.color=textStyle.color;
    addressText.style.opacity=textStyle.opacity;
    if(background)addressLabel.style.backgroundColor=getComputedStyle(background).backgroundColor;
    // Use the native visible identity/search icon, including its context paint.
    const nativeIcon=[...gURLBar.querySelectorAll("image, img, svg, [class*='icon']")].find(node=>{
      const s=getComputedStyle(node),r=node.getBoundingClientRect(),field=input.getBoundingClientRect();
      return r.width>0&&r.width<=24&&r.height>0&&r.height<=24&&r.right<=field.left+2&&s.visibility==="visible"&&Number(s.opacity)>0;
    });
    addressIcon.hidden=!nativeIcon;
    const iconStyle=nativeIcon&&getComputedStyle(nativeIcon);
    const iconRect=nativeIcon?.getBoundingClientRect();
    addressIcon.style.left=`${iconRect?iconRect.left-addressAnchor.left-addressContainer.clientLeft:Math.max(0,textLeft-24)}px`;
    addressIcon.style.width=`${iconRect?.width||16}px`;
    addressIcon.style.height=`${iconRect?.height||16}px`;
    addressIcon.style.backgroundImage=iconStyle?.listStyleImage!=="none"&&iconStyle?.listStyleImage||iconStyle?.backgroundImage!=="none"&&iconStyle?.backgroundImage||'url("chrome://global/skin/icons/search-glass.svg")';
    addressIcon.style.color=iconStyle?.color||textStyle.color;
    addressIcon.style.fill=iconStyle?.fill||"currentColor";
    addressIcon.style.fillOpacity=iconStyle?.fillOpacity||"1";
  }
  rememberAddress();
  const addressResizeObserver=new ResizeObserver(rememberAddress);
  addressResizeObserver.observe(addressContainer);
  addressContainer.addEventListener("pointerdown",rememberAddress,true);
  addressContainer.addEventListener("pointerenter",rememberAddress,true);
  let addressFrame=0;
  const addressObserver=new MutationObserver(()=>{
    if(addressFrame)return;
    addressFrame=window.requestAnimationFrame(()=>{addressFrame=0;rememberAddress();});
  });
  addressObserver.observe(gURLBar,{attributes:true,attributeFilter:["zen-floating-urlbar","open","breakout-extend"]});
  const controls=el("div",{id:"arc-top-controls",class:"arc-ui"});
  const toggle=button("Hide sidebar (Ctrl+B)","panel",()=>toggleDock());controls.append(toggle);
  toggle.id="arc-sidebar-toggle";
  const nav=el("div",{id:"arc-navigation-controls"});
  const back=button("Back","back",()=>BrowserCommands.back());
  const forward=button("Forward","forward",()=>BrowserCommands.forward());
  const reload=button("Reload","reload",()=>gBrowser.selectedBrowser.isLoadingDocument?BrowserCommands.stop():BrowserCommands.reload());
  const appMenu=document.getElementById("PanelUI-menu-button")||document.getElementById("zen-appmenu-button");
  nav.append(back,forward,reload);
  if(appMenu){appMenu.setAttribute("aria-label",appMenu.getAttribute("aria-label")||"Open menu");appMenu.setAttribute("label","");nav.append(appMenu);}
  controls.append(nav);toolbox.prepend(controls);
  const syncControlsHeight=()=>toolbox.style.setProperty("--arc-top-controls-height",`${controls.getBoundingClientRect().height}px`);
  syncControlsHeight();
  const controlsResizeObserver=new ResizeObserver(syncControlsHeight);
  controlsResizeObserver.observe(controls);
  const library=document.querySelector("zen-library");
  const NativeLibrary=library.constructor;
  const originalLibraryAnimate=NativeLibrary.animateProgress;
  function animateLibrary(target) {
    // Zen unhides the library before its spring's first progress update. Give
    // that first painted frame the same offscreen position as the slide.
    if(target===1&&library.openProgress===0) {
      library.style.transform=`translateX(${NativeLibrary.libraryOnRight?100:-100}%)`;
    }
    return originalLibraryAnimate.call(this,target);
  }
  NativeLibrary.animateProgress=animateLibrary;
  function setRail(open) { if(open)hideDownloads();gift.setAttribute("aria-pressed",String(open));return NativeLibrary.animateProgress(open?1:0); }
  const gift=document.createXULElement('toolbarbutton');
  gift.id='arc-gift-button';gift.className='toolbarbutton-1 zen-sidebar-action-button arc-icon-button arc-ui';
  gift.setAttribute('aria-label','Library (hover for downloads)');gift.append(icon('gift'));
  gift.addEventListener('command',()=>{hideDownloads();void setRail(!NativeLibrary.isLibrarySlightlyOpen).catch(report);});
  gift.addEventListener('pointerdown',e=>{if(e.button===0)nudge(gift,'gift');});
  gift.setAttribute("aria-pressed","false");gift.setAttribute("aria-expanded","false");gift.setAttribute("aria-controls","arc-download-popup");
  const libraryObserver=new MutationObserver(()=>gift.setAttribute("aria-pressed",String(NativeLibrary.isLibrarySlightlyOpen)));
  libraryObserver.observe(library,{attributes:true,attributeFilter:["open","hidden","transitioning"]});
  (document.getElementById("zen-sidebar-foot-buttons") || toolbox).prepend(gift);
  // Keep this in the sidebar's hover tree. The top layer lets it paint outside
  // Zen's sidebar clipping and stacking contexts without turning into a native panel.
  const popup=el("section",{id:"arc-download-popup",class:"arc-ui",hidden:"true",popover:"manual","data-arc-download-design":"arc","aria-label":"Downloads",role:"region"});
  const popupContent=el("div",{class:"arc-download-content"});
  const list=el("ul",{class:"arc-download-list"});
  popupContent.append(list);popup.append(popupContent);toolbox.append(popup);
  // Keep native download bookkeeping, but route native panel requests to this UI.
  const originalShowDownloadsPanel=window.DownloadsPanel.showPanel;
  window.DownloadsPanel.showPanel=function(){openDownloads();return Promise.resolve();};
  function interceptDownloadsPanel(event) {
    if(event.target.id!=="downloadsPanel")return;
    event.preventDefault();openDownloads();
  }
  document.addEventListener("popupshowing",interceptDownloadsPanel,true);
  const layer=el("div",{id:"arc-file-layer",class:"arc-ui","aria-hidden":"true"});document.body.append(layer);
  const status=el("div",{id:"arc-live-status",role:"status","aria-live":"polite","aria-atomic":"true"});document.body.append(status);
  let closeTimer=0,arrivalTimer=0,restoringGiftFocus=false,flightsInProgress=0,popupClosing=false,popupMotion=0;
  const inside=()=>popup.matches(":hover")||gift.matches(":hover")||popup.contains(document.activeElement)||gift===document.activeElement;
  function placePopup() {
    const r=gift.getBoundingClientRect();
    const sidebar=toolbox.getBoundingClientRect();
    const width=Math.min(Math.max(sidebar.width,200),264,innerWidth-16);
    const left=r.right>0?Math.max(0,sidebar.left):8;
    popup.style.width=`${width}px`;
    popup.style.left=`${Math.max(0,Math.min(innerWidth-width,left))}px`;
    popup.style.bottom=`${r.bottom>0?Math.max(12,innerHeight-r.top+6):52}px`;
  }
  function openDownloads() {
    if(flightsInProgress||NativeLibrary.isLibrarySlightlyOpen||root.hasAttribute("inDOMFullscreen"))return;
    clear(closeTimer);placePopup();
    const wasHidden=popup.hidden||popupClosing;popupClosing=false;++popupMotion;
    if(wasHidden)for(const detail of list.querySelectorAll("[data-download-time]"))detail.textContent=downloadAge({endTime:Number(detail.dataset.downloadTime)});
    if(wasHidden)for(const node of [popup,...list.children])for(const motion of node.getAnimations())motion.cancel();
    popup.hidden=false;gift.setAttribute("aria-expanded","true");
    if(!popup.matches(":popover-open"))popup.showPopover();
    if(wasHidden) {
      void animate(popup,[{opacity:0},{opacity:1}],{duration:160,easing:"ease-out"});
      const rows=[...list.children];
      for(const [index,row] of rows.entries()) {
        const rise=Math.max(8,Math.min(320,riseFromGift(row)));
        void animate(row,[{opacity:0,transform:`translateY(${rise}px) scale(.92)`},{opacity:1,transform:"none"}],{duration:260,delay:Math.min(rows.length-1-index,5)*24,easing:"cubic-bezier(.16,1,.3,1)",fill:"backwards"});
      }
    }
  }
  function riseFromGift(row){return gift.getBoundingClientRect().top-row.getBoundingClientRect().top;}
  function hideDownloads(soft=false){
    const motion=++popupMotion;
    gift.setAttribute("aria-expanded","false");clear(closeTimer);clear(arrivalTimer);
    const finish=()=>{
      if(motion!==popupMotion)return;
      if(popup.matches(":popover-open"))popup.hidePopover();
      popup.hidden=true;popupClosing=false;
    };
    for(const node of [popup,...list.children])for(const animation of node.getAnimations())animation.cancel();
    if(soft&&!popup.hidden&&!reduced()) {
      popupClosing=true;
      void animate(popup,[{opacity:1,transform:"none"},{opacity:0,transform:"translateY(8px)"}],{duration:140,easing:"ease-in"}).then(finish);
    } else finish();
  }
  function scheduleClose(){clear(closeTimer);closeTimer=later(()=>{if(!inside())hideDownloads(true);},160);}
  for(const node of [gift,popup]) {
    node.addEventListener("pointerenter",()=>{clear(closeTimer);if(!NativeLibrary.isLibrarySlightlyOpen)openDownloads();});
    node.addEventListener("pointerleave",scheduleClose);
    node.addEventListener("focusin",()=>{clear(closeTimer);if(!restoringGiftFocus&&!NativeLibrary.isLibrarySlightlyOpen)openDownloads();});
    node.addEventListener("focusout",scheduleClose);
  }
  function dismissDownloads(event) {
    if(!popup.hidden&&!popup.contains(event.target)&&!gift.contains(event.target))hideDownloads();
  }
  document.addEventListener("pointerdown",dismissDownloads,true);
  async function act(d,action) {
    try {
      if(action==="open"||action==="show")hideDownloads();
      if(action==="open")await d.launch();
      else if(action==="show")await d.showContainingDirectory();
      else if(action==="pause")await d.cancel();
      else if(action==="resume")await d.start();
      else if(action==="cancel"){await d.cancel();await d.removePartialData();}
    } catch(error){report(error);}
  }
  let records=[],ready=false,downloadList=null,debugDownloads=null;
  const relativeTime=new Intl.RelativeTimeFormat(undefined,{numeric:"auto"});
  function downloadAge(d) {
    const time=new Date(d.endTime||d.startTime).getTime();
    if(!Number.isFinite(time))return "Completed";
    const seconds=Math.max(0,(Date.now()-time)/1000);
    if(seconds<60)return "Just now";
    for(const [unit,length] of [["year",31536000],["month",2592000],["day",86400],["hour",3600],["minute",60]]) {
      if(seconds>=length)return relativeTime.format(-Math.floor(seconds/length),unit);
    }
  }
  function renderDownloads() {
    list.replaceChildren();
    for(const d of [...(debugDownloads??records)].reverse().slice(0,20)) {
      const row=el("li",{class:"arc-download-row"});
      const name=PathUtils.filename(d.target.path);
      const main=el("button",{type:"button",class:"arc-download-main","aria-label":d.succeeded?`Open ${name}`:name});
      const fileIcon=el("span",{class:"arc-download-icon","aria-hidden":"true"});
      fileIcon.append(icon(/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)?"media":/\.(zip|7z|rar|gz|tar)$/i.test(name)?"fileArchive":/\.(mp4|webm|mov|mkv)$/i.test(name)?"film":/\.(mp3|wav|ogg|flac|m4a)$/i.test(name)?"music":"file"));main.append(fileIcon);
      const fileImage=el("img",{class:"arc-download-file-icon",alt:"",loading:"lazy",src:`moz-icon://${d.target.path}?size=32${d.succeeded?"&state=normal":""}`});
      fileImage.addEventListener("load",()=>fileIcon.classList.add("has-file-icon"),{once:true});
      fileImage.addEventListener("error",()=>{fileIcon.classList.remove("has-file-icon");fileImage.remove();},{once:true});
      fileIcon.append(fileImage);
      if(d.succeeded&&/\.(png|jpe?g|gif|webp|avif)$/i.test(name)) {
        const preview=el("img",{class:"arc-download-preview",alt:"",loading:"lazy",decoding:"async",src:PathUtils.toFileURI(d.target.path)});
        preview.addEventListener("load",()=>fileIcon.classList.add("has-preview"),{once:true});
        preview.addEventListener("error",()=>{fileIcon.classList.remove("has-preview");preview.remove();},{once:true});
        fileIcon.append(preview);
      }
      main.disabled=!d.succeeded;main.addEventListener("click",()=>void act(d,"open"));
      const label=el("span",{class:"arc-download-label"});label.append(el("span",{class:"arc-download-name",title:name},name));
      const size=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:bytes>=1024?`${Math.round(bytes/1024)} KB`:`${bytes} B`;
      const meta=d.succeeded?downloadAge(d):d.error?"Failed":d.canceled?(d.hasPartialData?"Paused":"Cancelled"):d.hasProgress?`${size(d.currentBytes)} of ${size(d.totalBytes)}`:"Downloading";
      const detail=el("span",{class:"arc-download-meta"},meta);
      if(d.succeeded) {
        const time=new Date(d.endTime||d.startTime).getTime();
        if(Number.isFinite(time))detail.dataset.downloadTime=String(time);
        if(d.target.size>0)detail.title=size(d.target.size);
      }
      label.append(detail);
      if(!d.stopped&&d.hasProgress)label.append(el("progress",{max:100,value:d.progress,"aria-label":`Download progress for ${name}`}));
      main.append(label);row.append(main);
      if(d.succeeded)row.append(downloadButton(`Show ${name} in folder`,"folder-open",()=>void act(d,"show")));
      else if(!d.stopped||d.hasPartialData) {
        row.append(downloadButton(`${d.stopped?"Resume":"Pause"} ${name}`,d.stopped?"play":"pause",()=>void act(d,d.stopped?"resume":"pause")));
        row.append(downloadButton(`Cancel ${name}`,"x",()=>void act(d,"cancel")));
      }
      list.append(row);
    }
    if(!(debugDownloads??records).length) {
      const empty=el("li",{class:"arc-download-empty"});
      empty.textContent="No downloads yet";list.append(empty);
    }
  }
  const downloadView={
    onDownloadAdded(d){records.push(d);renderDownloads();if(debugDownloads===null&&ready&&Services.wm.getMostRecentWindow("navigator:browser")===window)void flight(window.gZenUIManager?._lastClickPosition);},
    onDownloadChanged(){renderDownloads();},
    onDownloadRemoved(d){records=records.filter(x=>x!==d);renderDownloads();}
  };
  // Keep private-window downloads in their own list.
  Downloads.getList(PrivateBrowsingUtils.isWindowPrivate(window)?Downloads.PRIVATE:Downloads.PUBLIC).then(async l=>{
    downloadList=l;await l.addView(downloadView);ready=true;renderDownloads();
  }).catch(report);
  function arrival() {
    nudge(gift,"gift");
    void animate(gift,[{backgroundColor:"#44375000"},{backgroundColor:"#44375024"},{backgroundColor:"#44375000"}],{duration:360,easing:"ease-out"});
    openDownloads();clear(arrivalTimer);arrivalTimer=later(()=>{if(!inside())hideDownloads();},3000);
    status.textContent="File added to downloads";
  }
  async function flight(position) {
    if(document.hidden||root.hasAttribute("inDOMFullscreen"))return;
    // Native panel requests and trigger hover can happen while the file flies.
    // Keep every entry point closed until the last file has reached its gift.
    flightsInProgress++;hideDownloads();
    let sprite,fallback;
    try {
      if(reduced())return;
      const r=gift.getBoundingClientRect();
      const visible=r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;
      const target=visible?{x:r.x+r.width/2,y:r.y+r.height/2}:{x:28,y:innerHeight-32};
      const origin={x:Math.max(20,Math.min(innerWidth-20,position?.clientX??innerWidth/2)),y:Math.max(24,Math.min(innerHeight-24,position?.clientY??innerHeight/2))};
      sprite=el("div",{class:"arc-flying-file","data-arc-flight":"true"});sprite.append(icon("file"));layer.append(sprite);
      if(!visible){fallback=el("div",{class:"arc-fallback-gift"});fallback.append(icon("gift"));fallback.style.left=`${target.x-10}px`;fallback.style.top=`${target.y-10}px`;layer.append(fallback);}
      const lift=Math.min(240,Math.max(130,Math.abs(target.x-origin.x)*.28));
      const apex=Math.max(24,Math.min(origin.y,target.y)-lift);
      const rise=Math.sqrt(Math.max(0,origin.y-apex)),fall=Math.sqrt(Math.max(0,target.y-apex));
      const gravity=(rise+fall)**2,launch=-2*rise*(rise+fall);
      const interpolate=(t,ts,vs)=>{let i=0;while(i<ts.length-2&&t>ts[i+1])i++;return vs[i]+(vs[i+1]-vs[i])*(t-ts[i])/(ts[i+1]-ts[i]);};
      const frames=Array.from({length:65},(_,i)=>{
        const t=i/64,x=origin.x+(target.x-origin.x)*t-18,y=origin.y+launch*t+gravity*t*t-22;
        const scale=interpolate(t,[0,.12,.9,1],[1,1.08,1,.12]),rotate=interpolate(t,[0,.3,.85,1],[-8,-26,14,0]),opacity=interpolate(t,[0,.05,.96,1],[0,1,1,0]);
        return {offset:t,transform:`translate(${x}px,${y}px) rotate(${rotate}deg) scale(${scale})`,opacity};
      });
      await animate(sprite,frames,{duration:1600,easing:"linear"});
    } finally {
      sprite?.remove();
      if(fallback)later(()=>fallback.remove(),240);
      flightsInProgress--;
      if(!flightsInProgress)arrival();
    }
  }
  const originalUpdate=cm._updateEvent;
  const originalExpand=cm._setElementExpandAttribute;
  let sidebarAnimating=false,sidebarRearmBounds=null,sidebarPointer=null;
  // A click on Undock leaves the pointer inside the old sidebar. Native hover
  // timers expire before the user has moved away, so require an actual exit.
  cm._setElementExpandAttribute=function(element,value,attr='zen-has-hover') {
    if(element===toolbox&&value&&attr==='zen-has-hover'&&sidebarRearmBounds)return;
    return originalExpand.call(this,element,value,attr);
  };
  function rearmSidebarHover(event) {
    sidebarPointer={x:event.clientX,y:event.clientY};
    if(!sidebarRearmBounds||sidebarAnimating)return;
    const away=cm.sidebarIsOnRight?event.clientX<sidebarRearmBounds.left-8:event.clientX>sidebarRearmBounds.right+8;
    if(away)sidebarRearmBounds=null;
  }
  window.addEventListener('pointermove',rearmSidebarHover,true);
  window.addEventListener('pointerdown',rearmSidebarHover,true);
  cm._updateEvent=async function(...args) {
    if(sidebarAnimating)return;
    sidebarAnimating=true;
    const before=content.getBoundingClientRect(),sideBefore=toolbox.getBoundingClientRect();
    const wasCompact=this.preference;
    const panel=document.getElementById('zen-toolbar-background');
    const panelBefore=panel.getBoundingClientRect(),panelStyle=getComputedStyle(panel);
    const peekVisible=wasCompact&&panelStyle.visibility==='visible'&&panelBefore.right>24&&panelBefore.left<innerWidth-24;
    const panelRadius=peekVisible?panelStyle.borderRadius:'12px';
    const panelShadow=peekVisible?panelStyle.boxShadow:'none';
    // These siblings are reparented by Zen when compact mode changes. Preserve
    // their screen positions independently of the sidebar's outer padding.
    const parts=peekVisible?['arc-top-controls','nav-bar','TabsToolbar'].map(id=>{
      const node=document.getElementById(id);return {node,before:node.getBoundingClientRect(),flex:node.getAttribute('flex')};
    }):[];
    const pointerOverSidebar=sidebarPointer?sidebarPointer.x>=sideBefore.left-8&&sidebarPointer.x<=sideBefore.right+8:toolbox.matches(':hover');
    sidebarRearmBounds=!wasCompact&&pointerOverSidebar?sideBefore:null;
    let snapshot=null,ghost=null,surface=null;
    try {
      if(!wasCompact&&!reduced()&&sideBefore.width&&sideBefore.height) {
        try { snapshot=await window.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(sideBefore.x,sideBefore.y,sideBefore.width,sideBefore.height),devicePixelRatio,'transparent'); }
        catch(error){console.warn('[Arc UI] Sidebar snapshot unavailable',error);}
      }
      // Capture the still sidebar before native hover state can move it.
      if(!wasCompact) {
        this.clearFlashTimeout('has-hover'+toolbox.id);
        originalExpand.call(this,toolbox,false);
        toolbox.removeAttribute('zen-user-show');
      }
      if(!reduced())root.setAttribute('data-arc-sidebar-animating',wasCompact?'opening':'closing');
      await originalUpdate.apply(this,args);
      const after=content.getBoundingClientRect(),sideAfter=toolbox.getBoundingClientRect();
      if(after.width&&after.height&&!reduced()&&wasCompact!==this.preference) {
        root.setAttribute('data-arc-sidebar-animating',this.preference?'closing':'opening');
        const timing={duration:this.preference?180:220,easing:'cubic-bezier(.2,.7,.3,1)',fill:'both'};
        // Resize live content on the same clock. Do not scale text or images.
        const motions=[animate(content,[
          {flex:'0 0 auto',width:`${before.width}px`,transform:`translateX(${before.x-after.x}px)`},
          {flex:'0 0 auto',width:`${after.width}px`,transform:'translateX(0)'}
        ],timing)];
        if(this.preference&&snapshot) {
          ghost=el('canvas',{id:'arc-sidebar-transition','aria-hidden':'true'});
          ghost.width=snapshot.width;ghost.height=snapshot.height;
          Object.assign(ghost.style,{left:`${sideBefore.x}px`,top:`${sideBefore.y}px`,width:`${sideBefore.width}px`,height:`${sideBefore.height}px`});
          ghost.getContext('2d').drawImage(snapshot,0,0);document.body.append(ghost);
          const exit=this.sidebarIsOnRight?innerWidth-sideBefore.left:-sideBefore.right;
          motions.push(animate(ghost,[
            {transform:'translateX(0)',clipPath:'inset(0px round 0px)'},
            {transform:`translateX(${exit}px)`,clipPath:'inset(5px 0px round 12px)'}
          ],timing));
        } else if(!this.preference) {
          const from=peekVisible?panelBefore.x-sideAfter.x:(this.sidebarIsOnRight?innerWidth-sideAfter.left:-sideAfter.right);
          const top=peekVisible?panelBefore.top-sideAfter.top:5;
          const bottom=peekVisible?sideAfter.bottom-panelBefore.bottom:5;
          const clip=`inset(${top}px 0px ${bottom}px 0px round ${panelRadius})`;
          // One painted surface, with the same outline clipping every native
          // child. A rounded background alone leaves square ancestors visible.
          surface=el('div',{id:'arc-sidebar-surface','aria-hidden':'true'});
          Object.assign(surface.style,{left:`${sideAfter.x}px`,top:`${sideAfter.y}px`,width:`${sideAfter.width}px`,height:`${sideAfter.height}px`});
          toolbox.after(surface);
          const partFrames=parts.map(({node,before})=>{
            const after=node.getBoundingClientRect();
            return {node,frames:[
              {flex:'0 0 auto',minHeight:'0px',transform:`translate(${before.x-after.x-from}px,${before.y-after.y}px)`,width:`${before.width}px`,height:`${before.height}px`},
              {flex:'0 0 auto',minHeight:'0px',transform:'translate(0px,0px)',width:`${after.width}px`,height:`${after.height}px`}
            ]};
          });
          // XUL's flex attribute has a UA-important sizing rule which outranks
          // Web Animations. Restore it after the measured heights have settled.
          for(const {node} of parts)node.removeAttribute('flex');
          motions.push(animate(surface,[
            {transform:`translateX(${from}px)`,top:`${sideAfter.top+top}px`,height:`${sideAfter.height-top-bottom}px`,borderRadius:panelRadius,boxShadow:panelShadow},
            {transform:'translateX(0)',top:`${sideAfter.top}px`,height:`${sideAfter.height}px`,borderRadius:'0px',boxShadow:'none'}
          ],timing));
          motions.push(animate(toolbox,[
            {transform:`translateX(${from}px)`,clipPath:clip},
            {transform:'translateX(0)',clipPath:'inset(0px round 0px)'}
          ],timing));
          for(const {node,frames} of partFrames)motions.push(animate(node,frames,timing));
        }
        await Promise.all(motions);
      }
    } finally {
      for(const {node,flex} of parts)if(flex!==null)node.setAttribute('flex',flex);
      snapshot?.close();ghost?.remove();surface?.remove();root.removeAttribute('data-arc-sidebar-animating');sidebarAnimating=false;updateNav();
    }
  };
  function toggleDock() { if(sidebarAnimating)return;hideDownloads();cm.toggle(true); }
  function updateNav() {
    rememberAddress();
    back.disabled=!gBrowser.canGoBack;forward.disabled=!gBrowser.canGoForward;
    const loading=gBrowser.selectedBrowser.isLoadingDocument;
    reload.replaceChildren(icon(loading?"stop":"reload"));
    reload.setAttribute("aria-label",loading?"Stop loading":"Reload");reload.title=reload.getAttribute("aria-label");
    toggle.setAttribute("aria-label",`${cm.preference?"Dock":"Hide"} sidebar (Ctrl+B)`);toggle.title=toggle.getAttribute("aria-label");
  }
  const navObserver={onLocationChange:updateNav,onStateChange:updateNav};gBrowser.addProgressListener(navObserver);
  gBrowser.tabContainer.addEventListener("TabSelect",updateNav);
  function key(e){
    if(e.key==="b"&&(e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey){e.preventDefault();e.stopImmediatePropagation();toggleDock();}
    if(e.key==="Escape"&&!popup.hidden){
      e.preventDefault();hideDownloads();restoringGiftFocus=true;
      try {gift.focus();} finally {restoringGiftFocus=false;}
    }
  }
  window.addEventListener("keydown",key,true);
  const onResize=()=>{if(!popup.hidden)placePopup();};window.addEventListener("resize",onResize);
  let archiveAPI=null,stopArchive=()=>{};
  window.ZenArc={version:"0.1.0",previewDownload:position=>flight(position),toggleDock,setRail,openDownloads,hideDownloads,diagnostics:()=>({version:"0.1.0",browser:Services.appinfo.version,compact:cm.preference,sidebarHoverBlocked:!!sidebarRearmBounds,downloads:(debugDownloads??records).length,realDownloads:records.length,debug:!!window.ZenArc.debug?.enabled,private:PrivateBrowsingUtils.isWindowPrivate(window),rail:NativeLibrary.isLibrarySlightlyOpen,popup:!popup.hidden,archiveHours:archiveAPI?archiveAPI.hours(Services.prefs):null})};
  updateNav();renderDownloads();
  function archiveTabInfo(tab) {
    return {tab,closed:tab.closed,pinned:tab.pinned,essential:tab.hasAttribute("zen-essential"),
      selected:tab.selected,multiselected:tab.hasAttribute("multiselected"),
      splitview:!!tab.splitview,grouped:!!tab.group,folded:!!tab.closest("zen-folder"),
      audible:tab.audible||tab.hasAttribute("soundplaying"),busy:tab.hasAttribute("busy"),
      attention:tab.hasAttribute("attention"),url:tab.linkedBrowser?.currentURI?.spec||"",
      lastAccessed:tab.lastAccessed};
  }
  // Zen keeps the table for the library's Archive tab; reuse it instead of a second store.
  function announceArchive(count) {
    const container=document.getElementById("zen-toast-container");
    if(!container)return;
    const toast=document.createXULElement("hbox");toast.className="zen-toast";
    const box=document.createXULElement("vbox"),label=document.createXULElement("label");
    label.textContent=count===1?"1 idle tab archived":`${count} idle tabs archived`;
    box.append(label);toast.append(box);container.removeAttribute("hidden");container.append(toast);
    void animate(toast,[{opacity:0,transform:"scale(.9)"},{opacity:1,transform:"none"}],{duration:180,easing:"ease-out"});
    later(()=>{void animate(toast,[{opacity:1},{opacity:0}],{duration:160,easing:"ease-in"}).then(()=>{
      toast.remove();if(!container.children.length)container.setAttribute("hidden","true");
    });},2400);
  }
  if (!PrivateBrowsingUtils.isWindowPrivate(window)) {
    try {
      const archive={};
      Services.scriptloader.loadSubScript("chrome://arc-ui/content/archive.js",archive,"UTF-8");
      archiveAPI=archive.ArcArchive;
      // Show the Archive view by default once; switching the library back to
      // History is the user's choice and survives the next start.
      if(!Services.prefs.getBoolPref("arc-ui.archive-initialized",false)){
        Services.prefs.setBoolPref("zen.library.history.closed-tabs",true);
        Services.prefs.setBoolPref("arc-ui.archive-initialized",true);
      }
      stopArchive=archiveAPI.start({
        getHours:()=>archiveAPI.hours(Services.prefs),
        tabs:()=>gBrowser.tabContainer.hasAttribute("movingtab")?[]:[...gBrowser.tabs].map(archiveTabInfo),
        close:row=>gBrowser.removeTab(row.tab,{animate:false}),
        announce:announceArchive,isClosed:()=>window.closed,
        schedule:later,cancel:clear,
        onError:error=>console.error("[Arc UI] Auto-Archive failed",error)
      });
    } catch (error) { console.error("[Arc UI] Auto-Archive unavailable",error); }
  }
  const nativeActions = {};
  Services.scriptloader.loadSubScript("chrome://arc-ui/content/native-actions.js", nativeActions, "UTF-8");
  const stopNativeActions=nativeActions.ArcNativeActions.install({document,contextTabs:()=>{
    const tab=window.TabContextMenu.contextTab;
    return tab?.multiselected?[...gBrowser.selectedTabs]:[tab];
  }});
  let stopCommands=()=>{};
  try {
    const debug=ChromeUtils.importESModule("chrome://arc-ui/content/debug.sys.mjs");
    const {html}=ChromeUtils.importESModule("chrome://global/content/vendor/lit.all.mjs",{global:"current"});
    window.ZenArc.debug=debug.install(window,{html,isPrivate:PrivateBrowsingUtils.isWindowPrivate(window),
      setDownloads:items=>{if(debugDownloads!==items)hideDownloads();debugDownloads=items;renderDownloads();},
      announce:message=>{status.textContent=message;}});
  } catch(error){console.error("[Arc UI] Debug mode unavailable",error);}
  try {
    const commands=ChromeUtils.importESModule("chrome://arc-ui/content/commands.sys.mjs");
    stopCommands=commands.install(window);
  } catch(error){console.error("[Arc UI] Command bar actions unavailable",error);}
  let stopGithubSetup=()=>{};
  if (!PrivateBrowsingUtils.isWindowPrivate(window)) {
    try {
      const { ZenLiveFoldersManager } = ChromeUtils.importESModule("resource:///modules/zen/ZenLiveFoldersManager.sys.mjs");
      const github = {};
      Services.scriptloader.loadSubScript("chrome://arc-ui/content/github.js", github, "UTF-8");
      stopGithubSetup=github.ArcGitHub.start({manager:ZenLiveFoldersManager,prefs:Services.prefs,
        isPrivateWindow:win=>PrivateBrowsingUtils.isWindowPrivate(win),isClosed:()=>window.closed,
        schedule:later,cancel:clear,onError:error=>console.error("[Arc UI] GitHub Live Folders setup failed; retrying",error)});
    } catch (error) { console.error("[Arc UI] GitHub Live Folders unavailable",error); }
  }
  // Only open the demo once, after the browser's own onboarding has completed.
  if(!PrivateBrowsingUtils.isWindowPrivate(window)&&!Services.prefs.getBoolPref("arc-ui.demo-seen",false)&&Services.prefs.getBoolPref("zen.welcome-screen.seen",false)){
    Services.prefs.setBoolPref("arc-ui.demo-seen",true);
    later(()=>window.openTrustedLinkIn("chrome://arc-ui/content/home.xhtml","tab"),500);
  }
  window.addEventListener("unload",()=>{
    stopArchive();stopGithubSetup();stopNativeActions();stopCommands();window.ZenArc.debug?.destroy();
    window.removeEventListener("dblclick",preventSidebarWidthReset,true);
    if(NativeLibrary.animateProgress===animateLibrary)NativeLibrary.animateProgress=originalLibraryAnimate;
    libraryObserver.disconnect();window.DownloadsPanel.showPanel=originalShowDownloadsPanel;
    document.removeEventListener("popupshowing",interceptDownloadsPanel,true);
    document.removeEventListener("pointerdown",dismissDownloads,true);
    addressObserver.disconnect();
    if(addressFrame)window.cancelAnimationFrame(addressFrame);
    addressResizeObserver.disconnect();
    controlsResizeObserver.disconnect();
    addressContainer.removeEventListener("pointerdown",rememberAddress,true);
    addressContainer.removeEventListener("pointerenter",rememberAddress,true);
    for(const t of timers)window.clearTimeout(t);for(const a of animations)a.cancel();
    if(downloadList)downloadList.removeView(downloadView);
    gBrowser.removeProgressListener(navObserver);gBrowser.tabContainer.removeEventListener("TabSelect",updateNav);cm._updateEvent=originalUpdate;cm._setElementExpandAttribute=originalExpand;
    window.removeEventListener('pointermove',rearmSidebarHover,true);
    window.removeEventListener('pointerdown',rearmSidebarHover,true);
    window.removeEventListener("keydown",key,true);window.removeEventListener("resize",onResize);
  },{once:true});
})();
