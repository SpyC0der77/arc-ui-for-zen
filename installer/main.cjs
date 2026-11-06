const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch } = require('./launch.cjs');
const engine = require('./engine.cjs');
const page = path.join(__dirname,'ui','index.html');
let window, busy=false;
let launchArgs=process.argv,pendingArgs;
function acceptUpdate(args) {
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
  handle('arc:update-selection', () => {
    const args = launchArgs;
    const installation = args.indexOf('--installation'), profile = args.indexOf('--profile');
    return installation > 0 && profile > 0 ? selected({installation: args[installation + 1], profile: args[profile + 1]}) : null;
  });
  handle('arc:discover',()=>engine.discover());
  handle('arc:inspect',value=>{const choice=selected(value);return engine.inspect(choice.installation,choice.profile);});
  handle('arc:folder',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'Choose folder'});return result.canceled?null:result.filePaths[0];});
  handle('arc:apply',async(action,value)=>{
    if(busy)throw new Error('An installation operation is already running.');
    if(!['install','remove'].includes(action))throw new Error('Unknown operation.');
    const choice=selected(value);busy=true;
    try{return await engine[action](choice.installation,choice.profile);}
    finally{busy=false;if(pendingArgs){const args=pendingArgs;pendingArgs=null;acceptUpdate(args);}}
  });
  handle('arc:launch',async value=>{
    const choice=selected(value);
    return launch(choice.installation,choice.profile);
  });
  window=new BrowserWindow({width:1080,height:740,minWidth:900,minHeight:660,title:'Arc UI for Zen',show:false,backgroundColor:'#faf8fb',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==pathToFileURL(page).href)event.preventDefault();});
  window.on('close',event=>{if(busy)event.preventDefault();});
  await window.loadFile(page);if(!process.env.ARC_INSTALLER_SMOKE)window.show();
}
// A previous release's installer can remain open after launching Zen. Keep the
// downloaded installer's lock separate so that old code cannot intercept it.
// Apply to manual launches too, including installers opened from a macOS DMG.
const versionData = path.join(app.getPath('userData'), 'versions', app.getVersion());
require('node:fs').mkdirSync(versionData, {recursive:true});
app.setPath('userData', versionData);
if(!app.requestSingleInstanceLock())app.quit();
else {app.on('second-instance',(_event,args)=>{acceptUpdate(args);if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});app.whenReady().then(boot).catch(error=>{dialog.showErrorBox('Installer could not start',error.message);app.quit();});app.on('window-all-closed',()=>app.quit());}
