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
  const window={document,ChromeUtils:{importESModule:()=>({ArcUpdater:updater})},MutationObserver:class {observe() {} disconnect() {}},setTimeout,clearTimeout,setInterval,clearInterval};
  const scope={};
  require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../payload/content/features/updates/updates.js'),'utf8'),scope);
  const feature=scope.ArcUpdates.install(window,{el:node,icon:node,PrivateBrowsingUtils:{isWindowPrivate:()=>false}});
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
  const pending = scope.ArcUpdates.install(window,{el:node,icon:node,PrivateBrowsingUtils:{isWindowPrivate:()=>false}});
  t.mock.timers.tick(30000);assert.equal(requests.length,3);
  pending.destroy();finish();await new Promise(setImmediate);
  t.mock.timers.tick(sixHours);await new Promise(setImmediate);assert.equal(requests.length,3);
  const privateFeature=scope.ArcUpdates.install({}, {PrivateBrowsingUtils:{isWindowPrivate:()=>true},el:()=>assert.fail('Private controls must not be created')});
  privateFeature.destroy();
});
test('installer isolates its instance lock by version for manual and updater launches', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const entry = path.resolve(__dirname, '../installer/main.cjs');
  const realRequire = require('node:module').createRequire(entry);
  for (const argv of [[], ['--arc-update']]) {
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
  assert.equal(assetName('v1.0.0', 'Darwin', 'aarch64-gcc3'), 'Arc-UI-Zen-1.0.0-Update.json');
  assert.equal(assetName('v1.0.0', 'Linux', 'x86_64-gcc3'), 'Arc-UI-Zen-1.0.0-Update.json');
  const linux = [{tag_name: 'v1.0.0', assets: [{name:'Arc-UI-Zen-1.0.0-Linux-x64.AppImage'}, {name:'SHA256SUMS.txt'}]}];
  assert.equal(selectRelease(linux, '0.1.8', 'Linux', 'x86_64-gcc3'), undefined);
  assert.equal(trustedAsset('https://github.com/SpyC0der77/arc-ui-for-zen/releases/download/v1/a.exe'), true);
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
  vm.runInNewContext(fs.readFileSync(require.resolve('../payload/content/updater.sys.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function updateContext','function updateContext').replace('export const ArcUpdater =','globalThis.updater ='),scope);
  const u = scope.updater;
  const first = u.check({force:true});
  await new Promise(setImmediate);
  u.release = releases[0]; u.target = '/tmp/beta-installer';u.stagedDirectory='/tmp/staged-beta';
  u.setTrack('stable');
  assert.equal(prefs.get('arc-ui.updates.track'),'stable');
  assert.equal(u.release,null); assert.equal(u.target,null);
  assert.deepEqual(removed,['/tmp/staged-beta']);
  const refreshed = new Promise(resolve=>u.listeners.add(()=>{if(u.release)resolve();}));
  completeOld(); await first; await refreshed;
  assert.equal(u.release.tag_name,'v0.1.9'); assert.equal(calls,2);
  u.state='downloading'; assert.throws(()=>u.setTrack('beta'),/Wait/);
  u.state='idle';u.setTrack('beta',{check:false});
  await new Promise(setImmediate);assert.equal(calls,2);
  prefs.delete('arc-ui.updates.track');
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

test('in-place update preserves preferences, records hashes, rolls back and rejects unsafe changes', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
  const {applyThemeUpdate,recoverThemeUpdate} = await import('../payload/content/update-apply.mjs');
  const engine = require('../installer/engine.cjs');
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'arc-inplace-')));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const app=path.join(folder,'Zen'), profile=path.join(folder,'profile');
  await fs.mkdir(path.join(app,'defaults','pref'),{recursive:true});await fs.mkdir(profile);
  await fs.writeFile(path.join(app,process.platform==='win32'?'zen.exe':'zen'),'');
  await fs.writeFile(path.join(app,'application.ini'),'[App]\nVersion=1.24b\n');
  await fs.writeFile(path.join(profile,'prefs.js'),'// personal prefs\n');
  await fs.writeFile(path.join(profile,'user.js'),'// personal settings\n');
  await engine.install(app,profile,{checkClosed:async()=>{}});
  const files={};
  async function collect(dir,prefix=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.isDirectory())await collect(path.join(dir,item.name),prefix+item.name+'/');else files[prefix+item.name]=(await fs.readFile(path.join(dir,item.name))).toString('base64');}}
  await collect(path.join(__dirname,'../payload'));
  const bundle={format:1,version:'9.0.0',supported:['1.24b'],files};
  const context={paths:{profile,resources:app,join:path.join,separator:path.sep},version:'9.0.0',browserVersion:'1.24b',platform:process.platform==='win32'?'WINNT':'Linux',decode:s=>Buffer.from(s,'base64'),encode:s=>Buffer.from(s),hash:async b=>crypto.createHash('sha256').update(b).digest('hex'),io:{exists:p=>fs.access(p).then(()=>true,()=>false),readJSON:async p=>JSON.parse(await fs.readFile(p,'utf8')),read:p=>fs.readFile(p),write:async(p,b)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,b);},remove:p=>fs.rm(p,{force:true}),assertPath:async p=>{assert.equal(path.resolve(p),p);}}};
  const managed=path.join(profile,'chrome','arc-ui','arc.uc.js'), original=await fs.readFile(managed);
  const receiptPath=engine.receiptFile(profile), receiptBefore=await fs.readFile(receiptPath);
  const userBefore=await fs.readFile(path.join(profile,'user.js'));
  files['arc.uc.js']=Buffer.from('// updated\n'+original).toString('base64');
  const write=context.io.write;let fail=true;
  context.io.write=async(p,b)=>{if(p===managed&&fail){fail=false;throw Error('disk write failed');}return write(p,b);};
  await assert.rejects(applyThemeUpdate(bundle,context),/rolled back/);
  assert.deepEqual(await fs.readFile(managed),original);assert.deepEqual(await fs.readFile(receiptPath),receiptBefore);
  context.io.write=write;
  files['../outside']='eA==';await assert.rejects(applyThemeUpdate(bundle,context),/payload path/);delete files['../outside'];
  await fs.appendFile(managed,'edited');await assert.rejects(applyThemeUpdate(bundle,context),/edited/);await fs.writeFile(managed,original);
  await applyThemeUpdate(bundle,context);
  assert.equal((await context.io.readJSON(receiptPath)).version,'9.0.0');
  assert.deepEqual(await fs.readFile(path.join(profile,'user.js')),userBefore);
  const journal=path.join(profile,'chrome','arc-ui-update-journal.json');
  await fs.writeFile(journal,JSON.stringify({files:[{path:managed,bytes:Array.from(original)}]}));
  await recoverThemeUpdate(context);assert.deepEqual(await fs.readFile(managed),original);
  // Restore the committed update before verifying normal installer removal.
  await fs.writeFile(managed,Buffer.from(files['arc.uc.js'],'base64'));
  await engine.remove(app,profile,{checkClosed:async()=>{}});
  assert.equal(await fs.readFile(path.join(profile,'user.js'),'utf8'),'// personal settings\n');
});
