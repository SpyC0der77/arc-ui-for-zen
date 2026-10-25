const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const appRoot=process.argv[2]||path.join(__dirname,'..');
const engine=require(path.join(appRoot,'installer','engine.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
process.env.ARC_INSTALLER_SMOKE='1';
app.disableHardwareAcceleration();
let fixture;
const originalInstall=engine.install,originalRemove=engine.remove;
engine.install=(installation,profile)=>originalInstall(installation,profile,{checkClosed:async()=>{}});
engine.remove=(installation,profile)=>originalRemove(installation,profile,{checkClosed:async()=>{}});
app.whenReady().then(async()=>{
 fixture=await fs.mkdtemp(path.join(os.tmpdir(),'zen-arc-ui-'));
 const zen=path.join(fixture,'Zen'),profile=path.join(fixture,'Profile');await fs.mkdir(zen);await fs.mkdir(profile);
 await fs.writeFile(path.join(zen,'zen.exe'),'fixture');await fs.writeFile(path.join(zen,'application.ini'),'[App]\nVersion=1.23.4b\n');await fs.writeFile(path.join(profile,'prefs.js'),'user_pref("untouched", true);\n');
 engine.discover=async()=>({platform:'win32',version:engine.VERSION,supportedZen:engine.SUPPORTED,apps:[zen],profiles:[{name:'Verification profile',path:profile,installed:false}]});
 require(path.join(appRoot,'installer','main.cjs'));
 let window;
 for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&!window.webContents.isLoading()&&await window.webContents.executeJavaScript('!!window.zenInstaller && document.getElementById("status")?.textContent.includes("Choose your Zen profile")'))break;await delay(50);}
 assert.ok(window);
 const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined');
 assert.equal(await window.webContents.executeJavaScript('typeof process'),'undefined');
 await window.webContents.executeJavaScript('document.getElementById("install").click()');
 for(let i=0;i<100;i++){if(await window.webContents.executeJavaScript('document.getElementById("status").textContent.startsWith("Installed.")'))break;await delay(50);}
 assert.ok(await fs.stat(engine.receiptFile(profile)));
 await window.webContents.executeJavaScript('document.getElementById("remove").click()');
 for(let i=0;i<100;i++){if(await window.webContents.executeJavaScript('document.getElementById("status").textContent.startsWith("Removed." )'))break;await delay(50);}
 await assert.rejects(fs.access(engine.receiptFile(profile)));
 assert.equal(await fs.readFile(path.join(profile,'prefs.js'),'utf8'),'user_pref("untouched", true);\n');
 assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'),true);
 window.showInactive();await delay(250);
 const artifacts=path.join(__dirname,'..','artifacts');await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,'installer.png'),(await window.webContents.capturePage()).toPNG());
 assert.deepEqual(errors,[]);
 console.log('PASS: Electron UI install/remove, profile preservation, renderer isolation, layout');
 window.destroy();await fs.rm(fixture,{recursive:true,force:true});app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>{console.error('UI verification timed out');app.exit(1);},20000);
