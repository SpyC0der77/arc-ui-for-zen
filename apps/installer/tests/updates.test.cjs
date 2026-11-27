const { test } = require('node:test');
const assert = require('node:assert/strict');
test('release polling repeats six hours after the first check and stops on teardown', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:0});
  const sixHours = 6 * 60 * 60 * 1000, requests = [];
  let last = -sixHours;
  const updater = {listeners:new Set(),release:null,async check() {
    if(Date.now()-last<sixHours)return;
    last=Date.now();requests.push(last);
  }};
  const node = () => ({append() {},addEventListener() {},remove() {},hidePopover() {},setAttribute() {}});
  const footer=node(),toolbox=node();
  const document={body:node(),getElementById:id=>id==='navigator-toolbox'?toolbox:footer};
  const window={document,ChromeUtils:{importESModule:()=>({ZenniaUpdater:updater})},MutationObserver:class {observe() {} disconnect() {}},setTimeout,clearTimeout,setInterval,clearInterval};
  const scope={};
  require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../payload/content/features/updates/updates.js'),'utf8'),scope);
  const feature=scope.ZenniaUpdates.install(window,{el:node,icon:node,zen:require('./zen.cjs').zenFor(),PrivateBrowsingUtils:{isWindowPrivate:()=>false}});
  t.mock.timers.tick(30000);await new Promise(setImmediate);
  assert.deepEqual(requests,[30000]);
  t.mock.timers.tick(sixHours-30000);await new Promise(setImmediate);
  assert.deepEqual(requests,[30000]);
  t.mock.timers.tick(30000);await new Promise(setImmediate);
  assert.deepEqual(requests,[30000,30000+sixHours]);
  feature.destroy();t.mock.timers.tick(sixHours);await new Promise(setImmediate);
  assert.equal(requests.length,2);
  let finish;
  updater.check = () => { requests.push(Date.now()); return new Promise(resolve=>{finish=resolve;}); };
  const pending = scope.ZenniaUpdates.install(window,{el:node,icon:node,zen:require('./zen.cjs').zenFor(),PrivateBrowsingUtils:{isWindowPrivate:()=>false}});
  t.mock.timers.tick(30000);assert.equal(requests.length,3);
  pending.destroy();finish();await new Promise(setImmediate);
  t.mock.timers.tick(sixHours);await new Promise(setImmediate);assert.equal(requests.length,3);
  const privateFeature=scope.ZenniaUpdates.install({}, {PrivateBrowsingUtils:{isWindowPrivate:()=>true},el:()=>assert.fail('Private controls must not be created')});
  privateFeature.destroy();
});
test('installer isolates its instance lock by version for manual and updater launches', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const entry = path.resolve(__dirname, '../installer/main.cjs');
  const realRequire = require('node:module').createRequire(entry);
  for (const argv of [[], ['--zennia-update']]) {
    const calls = [];
    const app = {
      getPath: () => path.resolve('test-installer-data'), getVersion: () => '1.2.3',
      setPath: (key, value) => calls.push({key, value}),
      requestSingleInstanceLock: data => { calls.push({lock:data.launchArgs}); return true; },
      on() {}, whenReady: () => ({then: () => ({catch() {}})}),
    };
    vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
      require: name => name === 'electron' ? {app} : name === 'node:fs' ? {mkdirSync() {}} : realRequire(name),
      __dirname: path.dirname(entry), process: {argv},
    });
    assert.deepEqual(calls, [{key:'userData', value:path.resolve('test-installer-data', 'versions', '1.2.3')}, {lock:argv}]);
  }
});
test('semantic release ordering includes numeric prereleases and stable promotion', async () => {
  const { newer } = await import('../payload/content/update-data.mjs');
  assert.equal(newer('v0.1.8-beta.10', '0.1.8-beta.4'), true);
  assert.equal(newer('0.1.8', '0.1.8-beta.10'), true);
  assert.equal(newer('0.1.8-beta.4', '0.1.8'), false);
  assert.equal(newer('0.1.8-beta.4', '0.1.8-beta.4'), false);
  assert.equal(newer('garbage', '0.1.8'), false);
});
test('release selection respects channel, architecture and required checksums', async () => {
  const { selectRelease, assetName, trustedAsset } = await import('../payload/content/update-data.mjs');
  const release = (tag, pre = false) => ({ tag_name: tag, prerelease: pre, assets: [{name: assetName(tag, 'WINNT', 'x86_64')}, {name: 'SHA256SUMS.txt'}] });
  const releases = [release('v0.2.0-beta.1', true), release('v0.1.9')];
  assert.equal(selectRelease(releases, '0.1.8', 'WINNT', 'x86_64').tag_name, 'v0.1.9');
  assert.equal(selectRelease(releases, '0.1.8-beta.4', 'WINNT', 'x86_64').tag_name, 'v0.2.0-beta.1');
  releases[0].draft = true;
  assert.equal(selectRelease(releases, '0.1.8-beta.4', 'WINNT', 'x86_64').tag_name, 'v0.1.9');
  assert.equal(selectRelease(releases, '0.1.8', 'Darwin', 'aarch64').tag_name, 'v0.1.9');
  assert.equal(assetName('v1.0.0', 'Darwin', 'aarch64-gcc3'), 'Zennia-1.0.0-Update.json');
  assert.equal(assetName('v1.0.0', 'Linux', 'x86_64-gcc3'), 'Zennia-1.0.0-Update.json');
  const linux = [{tag_name: 'v1.0.0', assets: [{name:'Zennia-1.0.0-Linux-x64.AppImage'}, {name:'SHA256SUMS.txt'}]}];
  assert.equal(selectRelease(linux, '0.1.8', 'Linux', 'x86_64-gcc3'), undefined);
  assert.equal(trustedAsset('https://github.com/SpyC0der77/zennia/releases/download/v1/a.exe'), true);
  assert.equal(trustedAsset('https://evil.example/a.exe'), false);
});
test('explicit track overrides the installed channel without downgrading', async () => {
  const { selectRelease, releaseTrack, assetName } = await import('../payload/content/update-data.mjs');
  const release = tag => ({tag_name:tag, prerelease:tag.includes('-'), assets:[{name:assetName(tag,'WINNT','x86_64')},{name:'SHA256SUMS.txt'}]});
  const releases = [release('v0.2.0-beta.1'), release('v0.1.9'), release('v0.1.7')];
  assert.equal(selectRelease(releases,'0.1.8-beta.4','WINNT','x86_64','stable').tag_name,'v0.1.9');
  assert.equal(selectRelease(releases,'0.1.8','WINNT','x86_64','beta').tag_name,'v0.2.0-beta.1');
  assert.equal(selectRelease(releases,'0.2.0-beta.1','WINNT','x86_64','stable'),undefined);
  assert.equal(releaseTrack('garbage','0.1.8-beta.4'),'beta');
  assert.equal(releaseTrack('stable','0.1.8-beta.4'),'stable');
  assert.equal(releaseTrack('','0.1.8'),'stable');
});
test('track change invalidates staged updates and ignores an in-flight response for the old track', async () => {
  const helpers = await import('../payload/content/update-data.mjs');
  const fs = require('node:fs'), vm = require('node:vm');
  const prefs = new Map(), removed = [];
  let completeOld, calls = 0;
  const release = tag => ({tag_name:tag,prerelease:tag.includes('-'),assets:[{name:helpers.assetName(tag,'WINNT','x86_64')},{name:'SHA256SUMS.txt'}]});
  const releases = [release('v0.2.0-beta.1'),release('v0.1.9')];
  const scope = {
    ...helpers, Ci:{nsIFile:{}}, recoverThemeUpdate:async()=>{}, setTimeout, clearTimeout, AbortController, console,
    Services:{dirsvc:{get:()=>({path:'/app'})},prefs:{getStringPref:(key,fallback)=>prefs.get(key)??fallback,setStringPref:(key,value)=>prefs.set(key,value)},appinfo:{OS:'WINNT',XPCOMABI:'x86_64'}},
    IOUtils:{readJSON:async()=>({version:'0.1.8-beta.4'}),remove:async path=>removed.push(path)},PathUtils:{profileDir:'/profile',join:(...parts)=>parts.join('/')},
    fetch:async()=>{ calls++; if(calls===1) await new Promise(resolve=>{completeOld=resolve;}); return {ok:true,json:async()=>releases}; },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../payload/content/updater.sys.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function updateContext','function updateContext').replace('export const ZenniaUpdater =','globalThis.updater ='),scope);
  const u = scope.updater;
  const first = u.check({force:true});
  await new Promise(setImmediate);
  u.release = releases[0]; u.target = '/tmp/beta-installer';u.stagedDirectory='/tmp/staged-beta';
  u.setTrack('stable');
  assert.equal(prefs.get('zennia.updates.track'),'stable');
  assert.equal(u.release,null); assert.equal(u.target,null);
  assert.deepEqual(removed,['/tmp/staged-beta']);
  const refreshed = new Promise(resolve=>u.listeners.add(()=>{if(u.release)resolve();}));
  completeOld(); await first; await refreshed;
  assert.equal(u.release.tag_name,'v0.1.9'); assert.equal(calls,2);
  u.state='downloading'; assert.throws(()=>u.setTrack('beta'),/Wait/);
  u.state='idle';u.setTrack('beta',{check:false});
  await new Promise(setImmediate);assert.equal(calls,2);
  prefs.delete('zennia.updates.track');
  let readDone;
  scope.IOUtils.readJSON=()=>new Promise(resolve=>{readDone=resolve;});
  const reading=u.getTrack();
  u.setTrack('stable',{check:false});readDone({version:'0.1.8-beta.4'});
  assert.equal(await reading,'stable','Pending inference must use the latest saved track');
  u.stagedDirectory='/tmp/installer-in-use';u.installerOpened=true;
  u.setTrack('beta',{check:false});assert.deepEqual(removed,['/tmp/staged-beta','/tmp/installer-in-use']);
  scope.IOUtils.readJSON=async()=>({version:'0.1.8-beta.4'});
  let finishSilent;
  scope.fetch=async()=>{calls++;await new Promise(resolve=>{finishSilent=resolve;});return {ok:true,json:async()=>releases};};
  const normalCheck=u.check({force:true});await new Promise(setImmediate);
  u.setTrack('stable',{check:false});finishSilent();await normalCheck;await new Promise(setImmediate);
  assert.equal(calls,3,'A private track change must not force a retry of an in-flight normal check');
  assert.equal(u.release,null);
});

for (const platform of ['win32','darwin','linux']) test(`in-place update preserves preferences, records hashes, rolls back and rejects unsafe changes (${platform})`, async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const {applyThemeUpdate,recoverThemeUpdate} = await import('../payload/content/update-apply.mjs');
  const engine = require('../installer/engine.cjs');
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zennia-inplace-')));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const app=path.join(folder,'Zen'), profile=path.join(folder,'profile');
  const target=engine.layout(app,platform);
  await fs.mkdir(path.join(target.resources,'defaults','pref'),{recursive:true});await fs.mkdir(profile);
  await fs.mkdir(path.dirname(target.exe),{recursive:true});
  await fs.writeFile(target.exe,'');
  await fs.writeFile(path.join(target.resources,'application.ini'),'[App]\nVersion=1.24b\n');
  await fs.writeFile(path.join(profile,'prefs.js'),'// personal prefs\n');
  await fs.writeFile(path.join(profile,'user.js'),'// personal settings\n');
  const font=path.join(__dirname,'../payload/content/geist-400.woff2');
  await engine.install(app,profile,{platform,checkClosed:async()=>{},customFont:font});
  const files={};
  async function collect(dir,prefix=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.isDirectory())await collect(path.join(dir,item.name),prefix+item.name+'/');else files[prefix+item.name]=(await fs.readFile(path.join(dir,item.name))).toString('base64');}}
  await collect(path.join(__dirname,'../payload'));
  const bundle={format:1,version:'9.0.0',supported:['1.24b'],files};
  const context={paths:{profile,resources:target.resources,join:path.join,separator:path.sep},zenData:require('../payload/content/shared/zen-data.js'),version:'9.0.0',browserVersion:'1.24b',platform:platform==='win32'?'WINNT':platform==='darwin'?'Darwin':'Linux',decode:s=>Buffer.from(s,'base64'),encode:s=>Buffer.from(s),hash:async b=>crypto.createHash('sha256').update(b).digest('hex'),io:{exists:p=>fs.access(p).then(()=>true,()=>false),readJSON:async p=>JSON.parse(await fs.readFile(p,'utf8')),read:p=>fs.readFile(p),write:async(p,b)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,b);},remove:p=>fs.rm(p,{force:true}),assertPath:async p=>{assert.equal(path.resolve(p),p);}}};
  const managed=path.join(profile,'chrome','zennia','zennia.uc.js'), original=await fs.readFile(managed);
  const receiptPath=engine.receiptFile(profile), receiptBefore=await fs.readFile(receiptPath);
  const userBefore=await fs.readFile(path.join(profile,'user.js'));
  files['zennia.uc.js']=Buffer.from('// updated\n'+original).toString('base64');
  const write=context.io.write;let fail=true;
  context.io.write=async(p,b)=>{if(p===managed&&fail){fail=false;throw Error('disk write failed');}return write(p,b);};
  await assert.rejects(applyThemeUpdate(bundle,context),/rolled back/);
  assert.deepEqual(await fs.readFile(managed),original);assert.deepEqual(await fs.readFile(receiptPath),receiptBefore);
  context.io.write=write;
  files['../outside']='eA==';await assert.rejects(applyThemeUpdate(bundle,context),/payload path/);delete files['../outside'];
  const {FACE,STYLES}=require('../installer/custom-font.cjs');
  files[FACE]='eA==';await assert.rejects(applyThemeUpdate(bundle,context),/payload path/);delete files[FACE];
  // Managed preferences come from the bundle's data for the running Zen version.
  const versionFile=files['zen-versions/1.24b.json'];
  files['zen-versions/1.24b.json']=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(versionFile,'base64')),prefs:{'zen.urlbar.behavior':'normal'}})).toString('base64');
  await assert.rejects(applyThemeUpdate(bundle,context),/managed preferences/);
  delete files['zen-versions/1.24b.json'];await assert.rejects(applyThemeUpdate(bundle,context),error=>error.code==='unsupported-zen'&&/no data for this Zen version/.test(error.message));
  files['zen-versions/1.24b.json']=versionFile;
  // A bundle missing shared data is broken, not unsupported, so it stays on offer.
  const base=files['zen-versions/base.json'];delete files['zen-versions/base.json'];
  await assert.rejects(applyThemeUpdate(bundle,context),error=>error.code!=='unsupported-zen'&&/Incomplete update bundle/.test(error.message));
  files['zen-versions/base.json']=base;
  await fs.appendFile(managed,'edited');await assert.rejects(applyThemeUpdate(bundle,context),/edited/);await fs.writeFile(managed,original);
  await applyThemeUpdate(bundle,context);
  assert.equal((await context.io.readJSON(receiptPath)).version,'9.0.0');
  assert.deepEqual(await fs.readFile(path.join(profile,'user.js')),userBefore);
  const fontFile=path.join(profile,'chrome','zennia',FACE);
  assert.deepEqual(await fs.readFile(fontFile),await fs.readFile(font));
  assert.ok(await fs.stat(path.join(profile,'chrome','zennia',STYLES)));
  const journal=path.join(profile,'chrome','zennia-update-journal.json');
  await fs.writeFile(journal,JSON.stringify({files:[{path:managed,bytes:Array.from(original)}]}));
  await recoverThemeUpdate(context);assert.deepEqual(await fs.readFile(managed),original);
  // Restore the committed update before verifying normal installer removal.
  await fs.writeFile(managed,Buffer.from(files['zennia.uc.js'],'base64'));
  await engine.remove(app,profile,{platform,checkClosed:async()=>{}});
  await assert.rejects(fs.access(fontFile),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(profile,'user.js'),'utf8'),'// personal settings\n');
});
test('in-place updates keep an installed SF Pro family and its receipt entries',async t=>{
 const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
 const {applyThemeUpdate} = await import('../payload/content/update-apply.mjs');
 const engine = require('../installer/engine.cjs');
 const {FAMILY,STYLES} = require('../installer/custom-font.cjs');
 const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zennia-family-update-')));
 t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const app=path.join(folder,'Zen'), profile=path.join(folder,'profile');
 const target=engine.layout(app,'linux');
 await fs.mkdir(path.join(target.resources,'defaults','pref'),{recursive:true});await fs.mkdir(profile);
 await fs.mkdir(path.dirname(target.exe),{recursive:true});await fs.writeFile(target.exe,'');
 await fs.writeFile(path.join(target.resources,'application.ini'),'[App]\nVersion=1.24b\n');
 await fs.writeFile(path.join(profile,'prefs.js'),'// personal prefs\n');
 await fs.writeFile(path.join(profile,'user.js'),'// personal settings\n');
 // Minimal OpenType files that pass the importer's checks.
 const otf=tag=>{const bytes=Buffer.alloc(64);bytes.write('OTTO',0,'latin1');bytes.writeUInt16BE(1,4);bytes.write('CFF ',12,'latin1');bytes.writeUInt32BE(28,20);bytes.writeUInt32BE(4,24);bytes.write(tag,40,'latin1');return bytes;};
 const sf=path.join(folder,'SF Pro');await fs.mkdir(sf);
 const faces=['SF-Pro-Text-Regular.otf','SF-Pro-Text-Medium.otf'];
 for(const file of faces)await fs.writeFile(path.join(sf,file),otf(file));
 await engine.install(app,profile,{platform:'linux',checkClosed:async()=>{},customFont:sf,fontPreset:'sf-pro-family'});
 const familyFiles=faces.map(file=>path.join(profile,'chrome','zennia',FAMILY,file));
 const stylesheet=path.join(profile,'chrome','zennia',STYLES);
 const css=await fs.readFile(stylesheet);
 const files={};
 async function collect(dir,prefix=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.isDirectory())await collect(path.join(dir,item.name),prefix+item.name+'/');else files[prefix+item.name]=(await fs.readFile(path.join(dir,item.name))).toString('base64');}}
 await collect(path.join(__dirname,'../payload'));
 const bundle={format:1,version:'9.0.0',supported:['1.24b'],files};
 const context={paths:{profile,resources:target.resources,join:path.join,separator:path.sep},zenData:require('../payload/content/shared/zen-data.js'),version:'9.0.0',browserVersion:'1.24b',platform:'Linux',decode:s=>Buffer.from(s,'base64'),encode:s=>Buffer.from(s),hash:async b=>crypto.createHash('sha256').update(b).digest('hex'),io:{exists:p=>fs.access(p).then(()=>true,()=>false),readJSON:async p=>JSON.parse(await fs.readFile(p,'utf8')),read:p=>fs.readFile(p),write:async(p,b)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,b);},remove:p=>fs.rm(p,{force:true}),assertPath:async p=>{assert.equal(path.resolve(p),p);}}};
 const receiptPath=engine.receiptFile(profile);
 // A bundle may not replace an imported face: the whole update is refused before anything is written.
 const hostile={...bundle,files:{...files,[FAMILY+'/'+path.basename(familyFiles[0])]:Buffer.from('replaced').toString('base64')}};
 await assert.rejects(applyThemeUpdate(hostile,context),/Invalid update payload path/);
 assert.deepEqual(await fs.readFile(familyFiles[0]),otf(path.basename(familyFiles[0])));
 await applyThemeUpdate(bundle,context);
 const receipt=await context.io.readJSON(receiptPath);
 assert.equal(receipt.version,'9.0.0');
 assert.equal(receipt.fontPreset,'sf-pro-family');
 for(const file of familyFiles){
  assert.deepEqual(await fs.readFile(file),otf(path.basename(file)));
  assert.ok(receipt.files.some(entry=>entry.path===file),'receipt keeps '+path.basename(file));
 }
 assert.deepEqual(await fs.readFile(stylesheet),css);
 await engine.remove(app,profile,{platform:'linux',checkClosed:async()=>{}});
 await assert.rejects(fs.access(familyFiles[0]),{code:'ENOENT'});
});

test('a release found not to support the running Zen version is not offered again', async () => {
  const helpers = await import('../payload/content/update-data.mjs');
  const fs = require('node:fs'), vm = require('node:vm');
  const prefs = new Map();
  const release = tag => ({tag_name:tag,prerelease:false,assets:[{name:helpers.assetName(tag)},{name:'SHA256SUMS.txt'}]});
  let releases = [release('v0.1.9')];
  const scope = {
    ...helpers, Ci:{nsIFile:{}}, recoverThemeUpdate:async()=>{}, setTimeout, clearTimeout, AbortController, console,
    Services:{dirsvc:{get:()=>({path:'/app'})},prefs:{getStringPref:(key,fallback)=>prefs.get(key)??fallback,setStringPref:(key,value)=>prefs.set(key,value)},appinfo:{OS:'WINNT',XPCOMABI:'x86_64',version:'1.25b'}},
    IOUtils:{readJSON:async()=>({version:'0.1.8'})},PathUtils:{profileDir:'/profile',join:(...parts)=>parts.join('/')},
    fetch:async()=>({ok:true,json:async()=>releases}),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../payload/content/updater.sys.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function updateContext','function updateContext').replace('export const ZenniaUpdater =','globalThis.updater ='),scope);
  const u = scope.updater;
  await u.check({force:true});
  assert.equal(u.release.tag_name,'v0.1.9');
  prefs.set('zennia.updates.unsupported','1.25b v0.1.9');
  await u.check({force:true});
  assert.equal(u.release,null);assert.equal(u.state,'idle');assert.equal(u.unsupported,'v0.1.9');
  // A newer release is offered, and so is the same release on another Zen version.
  releases = [release('v0.1.10'),release('v0.1.9')];
  await u.check({force:true});assert.equal(u.release.tag_name,'v0.1.10');
  releases = [release('v0.1.9')];scope.Services.appinfo.version='1.25.1b';
  await u.check({force:true});assert.equal(u.release.tag_name,'v0.1.9');
});

function toastMock() {
  const box = {shown: [], current: null,
    show(window, options) { box.current = options; box.shown.push(`${options.title}. ${options.description}`); },
    close() { box.current = null; }};
  return box;
}
const prefStore = () => {
  const prefs = new Map();
  return {prefs, api: {getStringPref: (k, f) => prefs.get(k) ?? f, setStringPref: (k, v) => prefs.set(k, v), getBoolPref: (k, f) => prefs.get(k) ?? f,
    setBoolPref: (k, v) => prefs.set(k, v), clearUserPref: k => prefs.delete(k)}};
};

test('recovery installs a supporting release by itself and offers a restart', async t => {
  t.mock.timers.enable({apis:['setInterval']});
  const fs = require('node:fs'), vm = require('node:vm');
  const {prefs, api} = prefStore(), box = toastMock(), listeners = {};
  const updater = {state:'idle',release:null,error:'',listeners:new Set(),checks:0,downloads:0,restarts:0,
    check() { this.checks++; return Promise.resolve(); }, download() { this.downloads++; this.state = 'downloading'; }, restart() { this.restarts++; },
    emit() { for (const listener of this.listeners) listener(); }};
  const guard = {released: 0, release() { this.released++; return Promise.resolve(); }};
  const makeWindow = ({isPrivate = false} = {}) => {
    const window = {gBrowser: {}, closed: false, setInterval, clearInterval, addEventListener: (type, fn) => { listeners[type] = fn; }, console,
      ChromeUtils: {importESModule: url => url.includes('PrivateBrowsing') ? {PrivateBrowsingUtils: {isWindowPrivate: () => isPrivate}} : url.includes('browser-updates') ? {ZenniaBrowserUpdates: guard} : {ZenniaUpdater: updater}},
      Services: {appinfo: {version: '1.25b'}, prefs: api, scriptloader: {loadSubScript: (url, scope) => { scope.ZenniaToast = box; }}}};
    window.window = window;
    return window;
  };
  const source = fs.readFileSync(require.resolve('../payload/content/features/updates/recovery.js'), 'utf8');
  const run = window => vm.runInNewContext(source, window);
  const settle = () => new Promise(setImmediate);
  run(makeWindow({isPrivate: true}));await settle();
  assert.equal(box.shown.length, 0);assert.equal(updater.checks, 0, 'Private windows stay untouched');
  prefs.set('zennia.browserUpdates.held', '1.25b');
  run(makeWindow());await settle();
  assert.equal(guard.released, 1, 'Zen automatic updates are no longer held while Zennia is paused');
  assert.equal(updater.checks, 1, 'Each start checks for a supporting release at once');
  assert.match(box.shown.at(-1), /Zennia is paused\. It updates itself once it supports Zen 1\.25b, then asks for a restart/);
  // A release is installed without asking; only the restart is offered.
  updater.state = 'available';updater.release = {tag_name: 'v0.1.9'};updater.emit();await settle();
  assert.equal(updater.downloads, 1);
  updater.state = 'ready';updater.emit();await settle();
  assert.match(box.shown.at(-1), /Zennia supports Zen 1\.25b\. Restart Zen to turn it back on/);
  box.current.action.run();assert.equal(updater.restarts, 1);
  updater.state = 'error';updater.error = 'offline';updater.emit();await settle();
  assert.match(box.shown.at(-1), /couldn't update\. offline/);assert.equal(box.current.kind, 'error');
  box.current.action.run();assert.equal(updater.downloads, 2);
  t.mock.timers.tick(60 * 60 * 1000);assert.equal(updater.checks, 2, 'Later checks run hourly and the updater limits them');
  listeners.unload();assert.equal(updater.listeners.size, 0);
  // On the next start, with nothing new, the waiting message is not repeated.
  updater.state = 'idle';delete updater.recoveryCheck;box.shown.length = 0;run(makeWindow());await settle();
  assert.equal(box.shown.length, 0);
});

function loadGuard({supported = ['1.24.1b', '1.24.3b'], auto = true, locked = false, pending = {}} = {}) {
  const fs = require('node:fs'), vm = require('node:vm');
  const {prefs, api} = prefStore(), calls = [], observers = {};
  const state = {auto, supported: new Set(supported)};
  // Like the real nsIUpdateManager: async getters only, no synchronous properties.
  const manager = {pending: {downloading: pending.downloading ?? null, ready: pending.ready ?? null},
    getDownloadingUpdate: async () => manager.pending.downloading, getReadyUpdate: async () => manager.pending.ready,
    async cleanupDownloadingUpdate() { calls.push('cleanup-downloading'); manager.pending.downloading = null; },
    async cleanupReadyUpdate() { calls.push('cleanup-ready'); manager.pending.ready = null; }};
  const service = {async stopDownload() { calls.push('stop'); }, async downloadUpdate(u) { calls.push('download ' + u.appVersion); }, checkForBackgroundUpdates() { calls.push('check'); }};
  const menu = {notifications: [{id: 'update-available'}], removeNotification(pattern) { calls.push('hide'); menu.notifications = menu.notifications.filter(n => !pattern.test(n.id)); }};
  const file = (parts = []) => ({parts, clone: () => file([...parts]), initWithPath: p => parts.push(p), append: p => parts.push(p),
    exists: () => parts.at(-2) === 'zen-versions' && state.supported.has(parts.at(-1).replace(/\.json$/, ''))});
  state.savedPrefs = '';
  const scope = {console, Ci: {nsIFile: {}, nsIUpdate: {}, nsIApplicationUpdateService: {}, nsIUpdateManager: {}},
    Cu: {readUTF8File: file => { state.readFrom = file.parts.join('/'); return state.savedPrefs; }},
    Cc: {'@mozilla.org/updates/update-service;1': {getService: () => service}, '@mozilla.org/updates/update-manager;1': {getService: () => manager},
      '@mozilla.org/file/local;1': {createInstance: () => file()}},
    Services: {prefs: api, appinfo: {version: '1.24.1b'}, dirsvc: {get: () => file()}, obs: {addObserver: (o, topic) => { observers[topic] = o; }}},
    AppMenuNotifications: menu,
    UpdateUtils: {appUpdateAutoSettingIsLocked: () => locked, getAppUpdateAutoEnabled: async () => state.auto,
      setAppUpdateAutoEnabled: async v => { calls.push('auto ' + v); state.auto = v; }}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../payload/content/browser-updates.sys.mjs'), 'utf8').replace(/^import .*;\r?\n/gm, '')
    .replace('export function supports', 'function supports').replace('export const ZenniaBrowserUpdates =', 'globalThis.guard ='), scope);
  const update = version => ({appVersion: version, QueryInterface() { return this; }});
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  const fire = async (topic, version) => { observers[topic].observe(version && update(version), topic); await settle(); };
  return {guard: scope.guard, prefs, calls, state, manager, menu, fire, update, settle};
}

test('Zen updates to supported versions go ahead untouched', async () => {
  const g = loadGuard();
  g.guard.start();await g.settle();
  await g.fire('update-downloading', '1.24.3b');
  assert.deepEqual(g.calls, []);assert.equal(g.guard.held, null);
});

test('an unsupported Zen update is cancelled and held until the user allows it', async () => {
  const g = loadGuard();
  g.guard.start();
  const notices = [];g.guard.listeners.add(() => notices.push(g.guard.held));
  g.manager.pending.downloading = g.update('1.25b');
  await g.fire('update-downloading', '1.25b');
  assert.deepEqual(g.calls, ['stop', 'cleanup-downloading', 'auto false', 'hide']);
  assert.equal(g.guard.held, '1.25b');assert.equal(g.prefs.get('zennia.browserUpdates.held'), '1.25b');
  assert.equal(g.prefs.get('zennia.browserUpdates.restoreAuto'), true);assert.deepEqual(notices, ['1.25b']);
  // Zen's own update prompt stays hidden while the update is held.
  g.menu.notifications.push({id: 'update-available'});await g.fire('appMenu-notifications');
  assert.equal(g.menu.notifications.length, 0);
  // With automatic updates paused, a new download was started by the user: allow it.
  g.calls.length = 0;
  await g.fire('update-downloading', '1.25b');
  assert.deepEqual(g.calls, ['auto true', 'download 1.25b']);
  assert.equal(g.prefs.get('zennia.browserUpdates.allowed'), '1.25b');assert.equal(g.guard.held, null);assert.equal(g.guard.allowed, '1.25b');
  assert.equal(g.prefs.has('zennia.browserUpdates.held'), false);assert.equal(g.prefs.has('zennia.browserUpdates.restoreAuto'), false);
  // A later hold on another version replaces the message about the allowed one.
  await g.fire('update-available', '1.26b');
  assert.equal(g.guard.held, '1.26b');assert.equal(g.guard.allowed, null);
});

test('a held Zen update goes ahead once Zennia supports its version', async () => {
  const g = loadGuard();
  g.guard.start();await g.fire('update-available', '1.25b');
  assert.equal(g.guard.held, '1.25b');
  g.calls.length = 0;g.state.supported.add('1.25b');
  // Zen offers it again after Zennia updated in place: automatic updates resume and it downloads.
  await g.fire('update-available', '1.25b');
  assert.deepEqual(g.calls, ['auto true', 'download 1.25b']);assert.equal(g.guard.held, null);
  // After a restart, the stored hold is released the same way.
  const h = loadGuard({supported: ['1.24.1b', '1.25b'], auto: false});
  h.prefs.set('zennia.browserUpdates.held', '1.25b');h.prefs.set('zennia.browserUpdates.restoreAuto', true);
  h.guard.start();await h.settle();
  assert.deepEqual(h.calls, ['auto true', 'check'], 'Zen looks for the discarded update again');assert.equal(h.guard.held, null);
});

test('the hold respects locked and manual Zen update settings and cancels pending updates', async () => {
  // Manual updates: Zen only prompts. The prompt is held without changing the setting.
  const manual = loadGuard({auto: false});
  manual.guard.start();await manual.fire('update-available', '1.25b');
  assert.deepEqual(manual.calls, ['hide']);assert.equal(manual.prefs.has('zennia.browserUpdates.restoreAuto'), false);
  // Automatic updates locked on by policy: every download is cancelled, none counts as consent.
  const locked = loadGuard({locked: true});
  locked.guard.start();
  for (let i = 0; i < 2; i++) { locked.manager.pending.downloading = locked.update('1.25b'); await locked.fire('update-downloading', '1.25b'); }
  assert.deepEqual(locked.calls.filter(c => c !== 'hide'), ['stop', 'cleanup-downloading', 'stop', 'cleanup-downloading']);
  assert.equal(locked.prefs.has('zennia.browserUpdates.allowed'), false);
  // An unsupported update downloaded before Zennia started is removed before it installs.
  const pending = loadGuard({pending: {ready: {appVersion: '1.25b'}}});
  pending.guard.start();await pending.settle();
  assert.deepEqual(pending.calls.slice(0, 2), ['cleanup-ready', 'auto false']);assert.equal(pending.guard.held, '1.25b');
  // A supported update does not end the hold on a different, unsupported version.
  const mixed = loadGuard({pending: {downloading: {appVersion: '1.25b'}, ready: {appVersion: '1.24.3b'}}});
  mixed.guard.start();await mixed.settle();
  assert.equal(mixed.guard.held, '1.25b');assert.equal(mixed.state.auto, false);
});

test('while Zen is closed, its background update task cannot download an unsupported version', async () => {
  const g = loadGuard();
  g.state.savedPrefs = 'user_pref("zennia.browserUpdates.allowed", "1.26b");\n';
  g.guard.startWhileClosed('C:\\Zennia profile');
  assert.equal(g.guard.closedGuard.allowed, '1.26b', "the user's Update anyway choice is read from Zennia's prefs.js");
  assert.equal(g.state.readFrom, 'C:\\Zennia profile/prefs.js', "it reads Zennia's profile, not the task's temporary one");
  for (const version of ['1.24.3b', '1.26b']) { g.manager.pending.downloading = g.update(version); await g.fire('update-downloading', version); }
  assert.deepEqual(g.calls, [], 'supported and allowed versions download as usual');
  g.manager.pending.downloading = g.update('1.25b');
  await g.fire('update-downloading', '1.25b');
  g.manager.pending.ready = g.update('1.25b');
  await g.fire('update-downloaded', '1.25b');
  assert.deepEqual(g.calls, ['stop', 'cleanup-downloading', 'cleanup-ready'], 'an unsupported download is discarded before it can install');
  assert.equal(g.prefs.size, 0, "the task's temporary profile is left alone");
  // A paused Zennia, on a version it does not support, does not hold Zen back.
  const paused = loadGuard({supported: ['1.24.3b']});
  paused.guard.startWhileClosed('C:\\Zennia profile');
  assert.equal(paused.guard.closedGuard, undefined);
  // A download an earlier task run left behind is discarded at once.
  const leftover = loadGuard({pending: {ready: {appVersion: '1.25b'}}});
  leftover.guard.startWhileClosed('C:\\Zennia profile');await leftover.settle();
  assert.deepEqual(leftover.calls, ['cleanup-ready']);
});
test('uninstalling from Settings restores an engine install exactly, keeping later user.js additions', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const {uninstallTheme} = await import('../payload/content/uninstall.mjs');
  const engine = require('../installer/engine.cjs');
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'zennia-uninstall-')));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const app = path.join(folder, 'Zen'), profile = path.join(folder, 'profile');
  const target = engine.layout(app, 'linux');
  await fs.mkdir(path.join(target.resources, 'defaults', 'pref'), {recursive: true});
  await fs.mkdir(profile);
  await fs.mkdir(path.dirname(target.exe), {recursive: true});
  await fs.writeFile(target.exe, '');
  await fs.writeFile(path.join(target.resources, 'application.ini'), '[App]\nVersion=1.24b\n');
  await fs.writeFile(path.join(profile, 'prefs.js'), '// personal prefs\n');
  await fs.writeFile(path.join(profile, 'user.js'), '// personal settings\n');
  // Every file under the folder, so a check can tell nothing else changed.
  const files = async (dir = folder, found = {}) => {
    for (const item of await fs.readdir(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await files(file, found);
      else found[path.relative(folder, file)] = (await fs.readFile(file)).toString('base64');
    }
    return found;
  };
  const before = await files();
  await engine.install(app, profile, {platform: 'linux', checkClosed: async () => {}});
  await fs.appendFile(path.join(profile, 'user.js'), 'user_pref("added.later", true);\n');
  const installed = await files();
  const io = {
    exists: file => fs.access(file).then(() => true, () => false),
    readJSON: async file => JSON.parse(await fs.readFile(file, 'utf8')),
    read: file => fs.readFile(file),
    write: async (file, bytes) => { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, bytes); },
    remove: file => fs.rm(file, {force: true}),
    assertPath: async file => assert.equal(path.resolve(file), file),
  };
  const context = {
    io, paths: {profile, resources: target.resources, join: path.join, separator: path.sep},
    hash: async bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
    decode: text => Buffer.from(text, 'base64'), encode: text => Buffer.from(text),
  };

  const theme = path.join(profile, 'chrome', 'zennia', 'zennia.uc.js');
  const theme64 = installed[path.relative(folder, theme)];
  await fs.appendFile(theme, 'edited');
  await assert.rejects(uninstallTheme(context), /edited after installation/);
  await fs.writeFile(theme, Buffer.from(theme64, 'base64'));
  assert.deepEqual(await files(), installed);

  let fail = true;
  const cfg = path.join(target.resources, 'zennia.cfg');
  context.io = {...io, remove: file => { if (file === cfg && fail) { fail = false; throw new Error('Access denied.'); } return io.remove(file); }};
  await assert.rejects(uninstallTheme(context), /Access denied\. Nothing was changed\./);
  assert.deepEqual(await files(), installed);

  context.io = io;
  const receipt = await uninstallTheme(context);
  assert.ok(Object.keys(receipt.settings).length, 'returns the managed preferences for the browser to restore');
  const after = await files(), user = path.join('profile', 'user.js');
  assert.equal(Buffer.from(after[user], 'base64').toString(), '// personal settings\nuser_pref("added.later", true);\n');
  delete after[user];
  delete before[user];
  assert.deepEqual(after, before);
});
test('reinstall finds this system\'s installer in a release, before and after the rename', async () => {
  const { installerAsset } = await import('../payload/content/update-data.mjs');
  const release = (...names) => ({tag_name: 'v1.2.0', assets: [...names, 'SHA256SUMS.txt'].map(name => ({name}))});
  const all = release('Zennia-1.2.0-Windows.exe', 'Zennia-1.2.0-macOS-arm64.dmg', 'Zennia-1.2.0-macOS-x64.dmg', 'Zennia-1.2.0-Linux-x86_64.AppImage', 'Zennia-1.2.0-Update.json');
  assert.equal(installerAsset(all, 'WINNT', 'x86_64-msvc').asset.name, 'Zennia-1.2.0-Windows.exe');
  assert.equal(installerAsset(all, 'Darwin', 'aarch64-gcc3').asset.name, 'Zennia-1.2.0-macOS-arm64.dmg');
  assert.equal(installerAsset(all, 'Darwin', 'x86_64-gcc3').asset.name, 'Zennia-1.2.0-macOS-x64.dmg');
  assert.equal(installerAsset(all, 'Linux', 'x86_64-gcc3').asset.name, 'Zennia-1.2.0-Linux-x86_64.AppImage');
  assert.equal(installerAsset(all, 'WINNT', 'x86_64-msvc').checksum.name, 'SHA256SUMS.txt');
  assert.equal(installerAsset(release('Arc-UI-Zen-1.2.0-Windows.exe'), 'WINNT', 'x86_64-msvc').asset.name, 'Arc-UI-Zen-1.2.0-Windows.exe');
  assert.equal(installerAsset(all, 'Linux', 'aarch64-gcc3'), null, 'no arm64 AppImage');
  assert.equal(installerAsset({tag_name: 'v1.2.0', assets: [{name: 'Zennia-1.2.0-Windows.exe'}]}, 'WINNT', 'x86_64-msvc'), null, 'no checksums');
});
test('reinstall removes Zennia only once its verified installer is downloaded, then opens it and quits', async () => {
  const helpers = await import('../payload/content/update-data.mjs');
  const fs = require('node:fs'), vm = require('node:vm');
  const digest = '\xab'.repeat(32), name = 'Zennia-1.2.0-Windows.exe';
  const url = file => `https://github.com/${helpers.REPO}/releases/download/v1.2.0/${file}`;
  const release = {tag_name: 'v1.2.0', assets: [{name, browser_download_url: url(name)}, {name: 'SHA256SUMS.txt', browser_download_url: url('SHA256SUMS.txt')}]};
  const receipt = {version: '1.2.0', resources: 'C:/Zen', profile: 'C:/profile', settings: {}, originalPrefs: {}};
  const events = [];
  let stayOpen = false, sums = `${'ab'.repeat(32)}  ${name}\n`;
  const instance = {
    '@mozilla.org/supports-PRBool;1': () => ({data: false}),
    '@mozilla.org/file/local;1': () => ({initWithPath(path) { this.path = path; }, reveal() { events.push(['reveal', this.path]); }}),
    '@mozilla.org/network/file-input-stream;1': () => ({init() {}, close() {}}),
    '@mozilla.org/security/hash;1': () => ({SHA256: 4, init() {}, updateFromStream() {}, finish: () => digest}),
    '@mozilla.org/process/util;1': () => ({init(file) { this.file = file; }, runwAsync: args => events.push(['open', ...args])}),
  };
  const scope = {
    ...helpers, console, setTimeout, clearTimeout, AbortController,
    Cc: new Proxy({}, {get: (_, id) => ({createInstance: () => instance[id]()})}),
    Ci: {nsIAppStartup: {eAttemptQuit: 1, eRestart: 16}},
    Services: {
      appinfo: {OS: 'WINNT', XPCOMABI: 'x86_64-msvc', invalidateCachesOnRestart() {}},
      obs: {notifyObservers: (cancel, topic, data) => { events.push([topic, data]); cancel.data = stayOpen; }},
      startup: {quit: flags => events.push(['quit', flags])},
      prefs: {savePrefFile() {}},
      dirsvc: {get: () => ({path: 'C:/Zen'})},
    },
    ChromeUtils: {importESModule: () => ({uninstallTheme: async () => { events.push(['uninstall']); return receipt; }})},
    IOUtils: {
      readJSON: async () => receipt,
      createUniqueDirectory: async () => 'C:/tmp/zennia-download',
      remove: async path => events.push(['delete', path]),
    },
    PathUtils: {profileDir: 'C:/profile', tempDir: 'C:/tmp', join: (...parts) => parts.join('/'), parent: path => path.slice(0, path.lastIndexOf('/'))},
    Downloads: {createDownload: async ({source}) => ({start: async () => events.push(['download', source.url])})},
    fetch: async address => ({ok: true, json: async () => release, text: async () => sums, address}),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../payload/content/updater.sys.mjs'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export function updateContext', 'function updateContext').replace('export const ZenniaUpdater =', 'globalThis.updater ='), scope);
  const updater = scope.updater;

  sums = `${'cd'.repeat(32)}  ${name}\n`;
  await assert.rejects(updater.reinstall(), /did not match its checksum/);
  assert.equal(updater.state, 'idle');
  assert.ok(!events.some(([kind]) => kind === 'uninstall' || kind === 'quit'), 'a bad download removes nothing');
  assert.deepEqual(events.at(-1), ['delete', 'C:/tmp/zennia-download']);

  sums = `${'ab'.repeat(32)}  ${name}\n`;
  events.length = 0; stayOpen = true;
  await updater.reinstall();
  assert.equal(updater.state, 'idle');
  assert.ok(!events.some(([kind]) => kind === 'uninstall' || kind === 'quit'), 'a page that keeps Zen open stops it');
  assert.deepEqual(events.at(-1), ['delete', 'C:/tmp/zennia-download'], 'and the unused installer is deleted');

  events.length = 0; stayOpen = false;
  await updater.reinstall();
  assert.deepEqual(events, [
    ['download', url(name)],
    ['quit-application-requested', null],
    ['uninstall'],
    ['open', '--installation', 'C:/Zen', '--profile', 'C:/profile'],
    ['quit', 1],
  ]);

  events.length = 0; updater.state = 'idle';
  await updater.uninstall();
  assert.deepEqual(events, [['quit-application-requested', 'restart'], ['uninstall'], ['quit', 17]]);
});
