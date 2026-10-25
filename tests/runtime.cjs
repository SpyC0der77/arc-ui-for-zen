const fs=require('node:fs/promises');const path=require('node:path');const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const engine=require('../installer/engine.cjs');
(async()=>{
 const source=process.argv[2];if(!source)throw new Error('Pass the path to an installed Zen application folder.');
 const artifacts=path.join(__dirname,'..','artifacts');await fs.mkdir(artifacts,{recursive:true});
 const folder=await fs.mkdtemp(path.join(artifacts,'runtime-'));
 const app=path.join(folder,process.platform==='darwin'?'Zen.app':'Zen');const profile=path.join(folder,'profile');
 await fs.cp(source,app,{recursive:true});await fs.mkdir(profile);
 await fs.writeFile(path.join(profile,'prefs.js'),'// isolated verification profile\n');
 const user='user_pref("zen.welcome-screen.seen", true);\nuser_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\nuser_pref("arc-skeleton.demo-seen", true);\n';
 await fs.writeFile(path.join(profile,'user.js'),user);
 await engine.install(app,profile,{checkClosed:async()=>{}});
 const root=engine.layout(app).resources;
 const cfg=path.join(root,'zen-arc.cfg');const installedCfg=await fs.readFile(cfg);
 await fs.copyFile(path.join(__dirname,'verify.uc.js'),path.join(profile,'chrome','zen-arc','content','verify.uc.js'));
 // The verification hook is added only to this disposable application copy.
 await fs.appendFile(cfg,`\nServices.obs.addObserver({observe(win) { Services.scriptloader.loadSubScript('chrome://arc-skeleton/content/verify.uc.js',win,'UTF-8'); }}, 'browser-delayed-startup-finished');\n`);
 const logCode = `function arcTestLog(text) { try { const f=Services.dirsvc.get('ProfD',Ci.nsIFile);f.append('runtime-log.txt');const out=Cc['@mozilla.org/network/file-output-stream;1'].createInstance(Ci.nsIFileOutputStream);out.init(f,0x02|0x08|0x10,384,0);out.write(text+'\\n',text.length+1);out.close(); } catch(e){} }\narcTestLog('AutoConfig started, safe mode '+Services.appinfo.inSafeMode);Services.console.registerListener({observe(message){arcTestLog(message.message||String(message));}});\n`;
 const config=await fs.readFile(cfg,'utf8');
 await fs.writeFile(cfg,config.replace('\n','\n'+logCode));
 const child=spawn(engine.layout(app).exe,['-headless','-no-remote','-purgecaches','-profile',profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let launchError;child.on('error',error=>{launchError=error;});
 let result;
 try {
  for(let i=0;i<360;i++) {if(launchError)throw launchError;try{result=JSON.parse(await fs.readFile(path.join(profile,'verification.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,250));}
  if(!result)throw new Error('Timed out waiting for isolated Zen verification: '+profile);
  console.log(JSON.stringify(result,null,2));
  assert.deepEqual(result.errors,[]);assert.ok(result.checks.every(check=>check.pass),'A runtime check failed');
 } finally {
  // Only the process created by this test is stopped; never target the user's Zen.
  await new Promise(resolve=>{if(child.exitCode!==null)resolve();else {child.once('exit',resolve);setTimeout(resolve,3000);}});
  if(child.exitCode===null)child.kill();
  await fs.writeFile(cfg,installedCfg);
 }
 // Remove the disposable verification file before checking the install receipt.
 await fs.unlink(path.join(profile,'chrome','zen-arc','content','verify.uc.js'));
 await engine.remove(app,profile,{checkClosed:async()=>{}});
 assert.equal(await fs.readFile(path.join(profile,'user.js'),'utf8'),user);
 console.log('PASS: real Zen runtime and clean removal in isolated app/profile. Artifacts: '+profile);
})().catch(error=>{console.error(error);process.exitCode=1;});
