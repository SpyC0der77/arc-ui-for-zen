// Run with Electron: electron tests/onboarding-motion.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const engine=require('../installer/engine.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
process.env.ARC_INSTALLER_SMOKE='1';
engine.discover=async()=>({platform:'win32',version:engine.VERSION,supportedZen:engine.SUPPORTED,apps:['C:/Zen'],profiles:[{name:'Sample profile',path:'C:/Profile'}]});
app.whenReady().then(async()=>{
 require('../installer/main.cjs');
 let window;
 for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&!window.webContents.isLoading()&&await window.webContents.executeJavaScript('document.getElementById("status")?.textContent.includes("Zen found")'))break;await delay(50);}
 const run=script=>window.webContents.executeJavaScript(script);
 await run('document.getElementById("begin").click()');
 assert.equal(await run('document.getElementById("page-track").getAnimations()[0].effect.getTiming().duration'),520);
 const samples=[];
 for(const time of [0,130,260,390,519]){
  await run(`for(const animation of document.getAnimations()){animation.pause();animation.currentTime=${time};}`);await delay(35);
  const sample=await run(`(()=>{const screens=[...document.querySelectorAll('.screen')],a=screens[0].getBoundingClientRect(),b=screens[1].getBoundingClientRect();return {x:a.x,gap:b.left-a.right,width:a.width,height:a.height,viewport:innerHeight,scroll:document.querySelector('main').scrollLeft};})()`);
  assert.ok(Math.abs(sample.gap)<.1,'Pages stay joined throughout the slide');
  assert.equal(sample.scroll,0,'Focus does not scroll the viewport');assert.equal(sample.height,sample.viewport,'Page height stays fixed');
  if(samples.length)assert.ok(sample.x<=samples.at(-1).x,'Forward movement stays monotonic');samples.push(sample);
 }
 const artifacts=path.resolve(__dirname,'../artifacts');
 await run('document.getElementById("page-track").getAnimations()[0].currentTime=260');await delay(80);
 await fs.writeFile(path.join(artifacts,'track-after.png'),(await window.webContents.capturePage()).toPNG());
 await run('document.getElementById("page-track").getAnimations()[0].finish()');await delay(40);
 assert.ok(await run('Math.abs(document.getElementById("page-track").getBoundingClientRect().x+innerWidth)<.1'),'Final position matches the animated endpoint');
 assert.equal(await run('document.getAnimations().length'),0);
 await run('document.querySelector("[data-back=welcome]").click();const a=document.getElementById("page-track").getAnimations()[0];a.pause();a.currentTime=200;');await delay(35);
 const before=await run('document.getElementById("page-track").getBoundingClientRect().x');
 await run('document.getElementById("begin").click();document.getElementById("page-track").getAnimations()[0].pause()');
 const after=await run('document.getElementById("page-track").getBoundingClientRect().x');assert.ok(Math.abs(after-before)<.5,'Reversing mid-slide preserves the current position');
 window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(40);
 await run('document.getElementById("browser-next").click()');assert.equal(await run('document.getAnimations().length'),0);
 assert.equal(await run('document.querySelectorAll(".screen:not([inert])").length'),1);
 console.log('PASS: 520ms joined-page track, fixed geometry, clean endpoint, smooth reversal, reduced motion');
 window.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>app.exit(1),15000);
