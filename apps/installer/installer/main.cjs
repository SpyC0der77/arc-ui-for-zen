const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch } = require('./launch.cjs');
const engine = require('./engine.cjs');
const { readFont, readFamily, previewFace } = require('./custom-font.cjs');
const sfProRepository = 'https://github.com/sahibjotsaggu/San-Francisco-Pro-Fonts';
const sfProFile = 'SF-Pro.ttf';
const sfProSource = `${sfProRepository}/blob/master/${sfProFile}`;
const page = path.join(__dirname,'ui','index.html');
let window, fontFile, busy=false;
let launchArgs=process.argv,pendingArgs;
function acceptUpdate(args) {
  if(!Array.isArray(args)||!args.every(arg=>typeof arg==='string'))return;
  if(!args.includes('--installation')||!args.includes('--profile'))return;
  if(busy){pendingArgs=args;return;}
  launchArgs=args;
  window?.webContents.reload();
}
function authorize(event) {
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==pathToFileURL(page).href)throw new Error('Untrusted installer request.');
}
function selected(value) {
  if(!value||typeof value.installation!=='string'||typeof value.profile!=='string'||!value.installation.trim()||!value.profile.trim())throw new Error('Choose a Zen installation and profile first.');
  return {installation:value.installation,profile:value.profile};
}
function handle(name,fn) {ipcMain.handle(name,async(event,...args)=>{authorize(event);try{return {ok:true,value:await fn(...args)};}catch(error){return {ok:false,error:error.message};}});}
async function boot() {
  handle('zennia:update-selection', () => {
    const args = launchArgs;
    const installation = args.indexOf('--installation'), profile = args.indexOf('--profile');
    return installation > 0 && profile > 0 ? selected({installation: args[installation + 1], profile: args[profile + 1]}) : null;
  });
  handle('zennia:discover',()=>engine.discover());
  handle('zennia:inspect',value=>{const choice=selected(value);return engine.inspect(choice.installation,choice.profile);});
  handle('zennia:folder',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'Choose folder'});return result.canceled?null:result.filePaths[0];});
  handle('zennia:font-source',preset=>shell.openExternal(preset==='sf-pro-family'?sfProRepository:sfProSource));
  handle('zennia:font',async(preset)=>{
    if(preset==='sf-pro-family'){
      // The whole family: the folder the downloaded SF Pro fonts were unzipped into.
      const result=await dialog.showOpenDialog(window,{title:'Choose the folder with the SF Pro fonts',properties:['openDirectory'],defaultPath:app.getPath('downloads')});
      if(result.canceled)return null;
      const folder=result.filePaths[0];
      const family=await readFamily(folder);
      fontFile=folder;
      return {name:`${family.name} (${family.faces.length} fonts)`,bytes:previewFace(family).bytes};
    }
    const options={title:'Choose a font file',properties:['openFile'],filters:[{name:'Fonts',extensions:['otf','ttf','woff2']}]};
    if(preset==='sf-pro'){
      options.title='Choose the downloaded SF-Pro.ttf';
      options.defaultPath=path.join(app.getPath('downloads'),sfProFile);
    }
    const result=await dialog.showOpenDialog(window,options);
    if(result.canceled)return null;
    const file=result.filePaths[0];
    const {name,bytes}=await readFont(file);
    fontFile=file;
    return {name,bytes};
  });
  handle('zennia:apply',async(action,value,fontChoice)=>{
    if(busy)throw new Error('An installation operation is already running.');
    if(!['install','remove'].includes(action))throw new Error('Unknown operation.');
    const needsFile=['selected','sf-pro','sf-pro-family'].includes(fontChoice);
    if(![undefined,null,'geist','selected','sf-pro','sf-pro-family'].includes(fontChoice)||needsFile&&!fontFile)throw new Error('Choose a browser font first.');
    const choice=selected(value);busy=true;
    const customFont=needsFile?fontFile:fontChoice;
    const fontPreset=['sf-pro','sf-pro-family'].includes(fontChoice)?fontChoice:undefined;
    try{return await require('./elevation.cjs').apply(action,choice.installation,choice.profile,{engine,customFont,fontPreset,appPath:app.getAppPath(),packaged:app.isPackaged});}
    finally{busy=false;if(pendingArgs){const args=pendingArgs;pendingArgs=null;acceptUpdate(args);}}
  });
  handle('zennia:launch',async value=>{
    const choice=selected(value);
    return launch(choice.installation,choice.profile);
  });
  window=new BrowserWindow({width:1080,height:740,minWidth:900,minHeight:660,title:'Zennia',show:false,backgroundColor:'#faf8fb',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(page).href)event.preventDefault();});
  window.on('close',event=>{if(busy)event.preventDefault();});
  await window.loadFile(page);if(!process.env.ARC_INSTALLER_SMOKE)window.show();
}
// A previous release's installer can remain open after launching Zen. Keep the
// downloaded installer's lock separate so that old code cannot intercept it.
// Apply to manual launches too, including installers opened from a macOS DMG.
const elevation = require('./elevation.cjs');
const workerIndex = process.argv.indexOf(elevation.FLAG);
if(workerIndex >= 0) {
  app.whenReady().then(()=>elevation.worker(process.argv.slice(workerIndex+1),engine)).then(code=>app.exit(code)).catch(()=>app.exit(1));
} else {
const versionData = path.join(app.getPath('userData'), 'versions', app.getVersion());
require('node:fs').mkdirSync(versionData, {recursive:true});
app.setPath('userData', versionData);
if(!app.requestSingleInstanceLock({launchArgs:process.argv}))app.quit();
else {app.on('second-instance',(_event,_args,_cwd,data)=>{acceptUpdate(data?.launchArgs);if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});app.whenReady().then(boot).catch(error=>{dialog.showErrorBox('Installer could not start',error.message);app.quit();});app.on('window-all-closed',()=>app.quit());}

}
