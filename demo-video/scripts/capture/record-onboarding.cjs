const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('fs/promises'),path=require('path'),{spawn}=require('child_process');const root=path.resolve(__dirname,'../../..'),demo=path.join(root,'demo-video'),out=path.join(demo,'recordings'),engine=require(path.join(root,'installer/engine.cjs'));
app.disableHardwareAcceleration();app.setPath('userData',path.join(demo,'runtime','electron-'+Date.now()));app.commandLine.appendSwitch('force-device-scale-factor','1');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
if(!process.env.ARC_DEMO_ZEN_SOURCE)throw new Error('Set ARC_DEMO_ZEN_SOURCE to an unpatched Zen application folder.');
const session=await fs.mkdtemp(path.join(demo,'runtime','onboarding-'));const installation=path.join(session,'Zen'),profile=path.join(session,'Default');await fs.cp(process.env.ARC_DEMO_ZEN_SOURCE,installation,{recursive:true});await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'prefs.js'),'// Disposable demo profile\n');
ipcMain.handle('arc:discover',()=>({ok:true,value:{platform:'win32',version:'0.1.0',supportedZen:'1.23.4b',apps:[installation],profiles:[{name:'Default',path:profile}]}}));
ipcMain.handle('arc:apply',async(e,action,choice)=>{try{return {ok:true,value:await engine[action](choice.installation,choice.profile,{checkClosed:async()=>{}})}}catch(e){return {ok:false,error:e.message}}});
const w=new BrowserWindow({width:1080,height:740,show:false,webPreferences:{preload:path.join(root,'installer/preload.cjs'),contextIsolation:true,sandbox:true}});w.setContentSize(1080,740);await w.loadFile(path.join(root,'installer/ui/index.html'));await wait(500);
const ff=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','30','-vcodec','png','-i','-','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p',path.join(out,'onboarding-window.mp4')]);ff.stderr.on('data',d=>process.stderr.write(d));
const actions=[[3,'begin'],[6.6,'browser-next'],[10.2,'profile-next'],[14,'install']];let action=0;const start=performance.now();
for(let frame=0;frame<570;frame++){const t=frame/30;if(action<actions.length&&t>=actions[action][0]){await w.webContents.executeJavaScript(`document.getElementById('${actions[action++][1]}').click()`)}const img=(await w.webContents.capturePage()).toPNG();if(!ff.stdin.write(img))await new Promise(r=>ff.stdin.once('drain',r));const delay=start+(frame+1)*1000/30-performance.now();if(delay>0)await wait(delay)}ff.stdin.end();await new Promise(r=>ff.on('exit',r));console.log('Onboarding recorded with actual disposable install.');w.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});

