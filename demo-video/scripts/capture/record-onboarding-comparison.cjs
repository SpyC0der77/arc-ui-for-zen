// Run the original installer recorder with isolated outputs and evidence.
// Launch with Electron, not Node. No dev server or computer-use tools.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {app,ipcMain}=require('electron');
const root=path.resolve(__dirname,'../../..');
const demo=path.join(root,'demo-video');
const output=path.join(demo,'recordings/comparison');
const original=path.join(__dirname,'record-onboarding.cjs');
const source=fs.readFileSync(original,'utf8');
const sha=crypto.createHash('sha256').update(source).digest('hex');
fs.mkdirSync(output,{recursive:true});
for(const name of ['onboarding-window.mp4','onboarding-window.json'])
  if(fs.existsSync(path.join(output,name)))throw new Error(`Refusing to overwrite ${name}`);

// Changes concern capture paths and truthful discovery metadata only. The
// original buttons, interaction timings, installer and rendered UI are reused.
function replaceOnce(text,from,to){
  if(text.split(from).length!==2)throw new Error(`Original recorder changed; adapter needs review: ${from}`);
  return text.replace(from,to);
}
let adapted=replaceOnce(source,"out=path.join(demo,'recordings')","out=path.join(demo,'recordings/comparison')");
adapted=replaceOnce(adapted,"platform:'win32'","platform:process.platform");
adapted=replaceOnce(adapted,"supportedZen:'1.23.4b'","supportedZen:engine.SUPPORTED");
let frames=0,successAt=null,installation=null,profile=null;
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>register(channel,async(...args)=>{
  const result=await handler(...args);
  if(channel==='arc:apply'&&args[1]==='install'&&result?.ok){
    installation=args[2].installation;profile=args[2].profile;
  }
  return result;
});
app.on('browser-window-created',(event,window)=>{
  const capture=window.webContents.capturePage.bind(window.webContents);
  window.webContents.capturePage=async(...args)=>{
    const image=await capture(...args);frames++;
    if(installation&&successAt===null){
      const visible=await window.webContents.executeJavaScript(`
        document.getElementById('complete').closest('.screen').getAttribute('aria-hidden')==='false'
        && !document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime))`);
      if(visible)successAt=frames/30;
    }
    return image;
  };
});
process.on('exit',code=>{
  const unchanged=crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex')===sha;
  const receipt=profile&&path.join(profile,'chrome/arc-ui.install.json');
  const complete=code===0&&frames===570&&successAt!==null&&receipt&&fs.existsSync(receipt)&&unchanged;
  fs.writeFileSync(path.join(output,complete?'onboarding-window.json':'onboarding-window.partial.json'),JSON.stringify({
    completed:Boolean(complete),source_script:path.relative(root,original),source_sha256:sha,
    frames,fps:30,installation,profile,success_visible_at:successAt,
    shots:complete?[{name:'Onboarding',id:'onboarding',source:path.join(output,'onboarding-window.mp4'),
      start:0,end:19,ready:19,notes:'Original installer actions, real successful disposable installation; complete19-second original take retained.'}]:[]
  },null,2)+'\n');
});
const recorder=new Module(original,module);
recorder.filename=original;recorder.paths=Module._nodeModulePaths(path.dirname(original));
recorder._compile(adapted,original);
