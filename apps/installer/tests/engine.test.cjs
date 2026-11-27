const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const engine=require('../installer/engine.cjs');
const {fixture}=require('./engine-fixture.cjs');
test('discovery finds running portable Zen and its unregistered profile without duplicates',async t=>{
 const f=await fixture(t,'linux');
 const result=await engine.discover({platform:'linux',home:path.join(f.root,'home'),env:{},appDirectories:[f.root],instances:[{app:f.app,profile:f.profile,pid:123}]});
 assert.deepEqual(result.apps,[await fs.realpath(f.app)]);
 assert.equal(result.profiles[0].path,await fs.realpath(f.profile));
 assert.equal(result.instances[0].profile,result.profiles[0].path);
 assert.equal(result.instances[0].pid,123);
});
test('discovery scans renamed macOS applications and ignores non-browser folders',async t=>{
 const f=await fixture(t,'darwin');
 const directory=path.join(f.root,'Applications'),app=path.join(directory,'My Zen.app');
 await fs.mkdir(directory);await fs.rename(f.app,app);
 await fs.mkdir(path.join(directory,'Other.app'));
 const result=await engine.discover({platform:'darwin',home:path.join(f.root,'home'),env:{},instances:[],appDirectories:[directory]});
 assert.deepEqual(result.apps.filter(p=>p.startsWith(f.root+path.sep)),[await fs.realpath(app)]);
});
test('discovery follows registered profile compatibility records to a custom application',async t=>{
 const f=await fixture(t,'linux'),home=path.join(f.root,'home'),root=path.join(home,'.zen');
 await fs.mkdir(root,{recursive:true});
 await fs.writeFile(path.join(root,'profiles.ini'),`[Profile0]\nName=Personal\nIsRelative=0\nPath=${f.profile}\n`);
 await fs.writeFile(path.join(f.profile,'compatibility.ini'),`[Compatibility]\nLastPlatformDir=${f.app}\n`);
 const result=await engine.discover({platform:'linux',home,env:{},instances:[],appDirectories:[]});
 assert.deepEqual(result.apps,[await fs.realpath(f.app)]);
});
test('running process discovery accepts profile paths with spaces and trailing URLs',async t=>{
 const f=await fixture(t,'linux'),profile=path.join(f.root,'Profile with spaces');
 await fs.rename(f.profile,profile);
 const {runningInstances,profileFromCommand}=require('../installer/discovery.cjs');
 assert.equal(await profileFromCommand(`zen -profile "${profile}" -purgecaches`),profile);
 const result=await runningInstances('linux',async(command,args)=>({stdout:args.includes('-axo')?`123 ${f.app}/zen\n`:`${f.app}/zen -profile ${profile} about:blank\n`}));
 assert.equal(result[0].profile,profile);
 assert.equal(result[0].app,f.app);
 assert.deepEqual(await runningInstances('linux',async()=>{throw new Error('denied');}),[]);
});
test('discovery validates indexed macOS apps and ignores stale index entries',async t=>{
 const f=await fixture(t,'darwin');
 const result=await engine.discover({platform:'darwin',home:path.join(f.root,'home'),env:{},instances:[],appDirectories:[],indexedApps:[f.app,path.join(f.root,'Missing.app'),f.app]});
 assert.deepEqual(result.apps.filter(p=>p.startsWith(f.root+path.sep)),[await fs.realpath(f.app)]);
 const {indexedApplications}=require('../installer/discovery.cjs');
 assert.deepEqual(await indexedApplications('darwin',async()=>({stdout:'/Applications/Custom Zen.app\n/invalid\n'})),['/Applications/Custom Zen.app']);
 assert.deepEqual(await indexedApplications('darwin',async()=>{throw new Error('unavailable');}),[]);
});
test('loader and installer enforce the same exact versions',async()=>{
 // The startup script loads Zennia only when this Zen version's data file was installed;
 // any other version gets recovery, which changes nothing in Zen's interface.
 const start=await fs.readFile(path.join(__dirname,'../payload/zennia-start.js'),'utf8');
 assert.match(start,/\["chrome", "zennia", "zen-versions", version \+ "\.json"\]/);
 assert.match(start,/supported \? "chrome:\/\/zennia-runtime\/content\/zennia\.uc\.js" : "chrome:\/\/zennia\/content\/features\/updates\/recovery\.js"/);
 // The loader in the Zen folder only hands each window to that script.
 const cfg=await fs.readFile(path.join(__dirname,'../payload/zennia.cfg'),'utf8');
 assert.match(cfg,/loadSubScript\("chrome:\/\/zennia-runtime\/content\/zennia-start\.js", win/);
 assert.doesNotMatch(cfg,/zennia\.uc\.js/);
 // In Zen's background update task it finds Zennia's profile and runs only the update guard.
 assert.match(cfg,/task !== "backgroundupdate"\) return;/);
 assert.match(cfg,/importESModule\("chrome:\/\/zennia-runtime\/content\/zennia-background\.sys\.mjs"\)\.start\(profile\)/);
 const files=(await fs.readdir(path.join(__dirname,'../payload/zen-versions'))).filter(name=>name!=='base.json').map(name=>name.replace(/\.json$/,''));
 assert.deepEqual(files.sort(),[...engine.SUPPORTED_VERSIONS].sort());
});
test('inspect reports a paused install after Zen updates or is reinstalled',async t=>{
 const f=await fixture(t);await engine.install(f.app,f.profile,f.options);
 const info=await engine.inspect(f.app,f.profile);
 assert.equal(info.zenVersion,'1.23.4b');assert.equal(info.installerSupportsZen,true);assert.equal(info.paused,undefined);
 // Zen updated to a version this install has no data for.
 await fs.writeFile(path.join(f.resources,'application.ini'),'[App]\nVersion=9.9b\n');
 assert.deepEqual(await engine.inspect(f.app,f.profile).then(i=>[i.paused,i.zenVersion,i.installerSupportsZen]),['unsupported-zen','9.9b',false]);
 // Zen updated to a version the installer supports but the installed theme predates.
 const supported=engine.SUPPORTED_VERSIONS.at(-1),data=path.join(f.profile,'chrome','zennia','zen-versions',supported+'.json');
 await fs.writeFile(path.join(f.resources,'application.ini'),`[App]\nVersion=${supported}\n`);await fs.rename(data,data+'.old');
 assert.deepEqual(await engine.inspect(f.app,f.profile).then(i=>[i.paused,i.installerSupportsZen]),['unsupported-zen',true]);
 await fs.rename(data+'.old',data);
 // Zen was replaced, taking the startup files with it; a reinstall repairs it.
 await fs.rm(path.join(f.resources,'zennia.cfg'));
 assert.equal((await engine.inspect(f.app,f.profile)).paused,'startup-files-missing');
 // Replaced by an unsupported version too: that is the reason a reinstall cannot fix.
 const ini=path.join(f.resources,'application.ini'),supportedIni=await fs.readFile(ini);
 await fs.writeFile(ini,'[App]\nVersion=9.9b\n');
 assert.equal((await engine.inspect(f.app,f.profile)).paused,'unsupported-zen');
 await fs.writeFile(ini,supportedIni);
 await engine.install(f.app,f.profile,f.options);
 assert.equal((await engine.inspect(f.app,f.profile)).paused,undefined);
 // An installer without support for the new Zen version changes nothing; removal still works.
 await fs.writeFile(path.join(f.resources,'application.ini'),'[App]\nVersion=9.9b\n');
 await assert.rejects(engine.install(f.app,f.profile,f.options),/supports Zen/);
 await engine.remove(f.app,f.profile,f.options);
 assert.equal((await engine.inspect(f.app,f.profile)).paused,undefined);
});
test('rejects unsupported versions before modifying',async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.resources,'application.ini'),'[App]\nVersion=99\n');await assert.rejects(engine.install(f.app,f.profile,f.options),/supports Zen/);await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('refuses existing startup loaders',async t=>{const f=await fixture(t);const dir=path.join(f.resources,'defaults','pref');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'other.js'),'pref("general.config.filename", "other.cfg");');await assert.rejects(engine.install(f.app,f.profile,f.options),/Another AutoConfig/);await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('refuses running Zen without killing it',async t=>{const f=await fixture(t);await assert.rejects(engine.install(f.app,f.profile,{checkClosed:async()=>{throw new Error('running');}}),/running/);await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('preserves edits added to user.js after installation',async t=>{const f=await fixture(t),file=path.join(f.profile,'user.js');await engine.install(f.app,f.profile,f.options);await fs.appendFile(file,'user_pref("later", "preserve");\n');await engine.remove(f.app,f.profile,f.options);assert.match(await fs.readFile(file,'utf8'),/later/);assert.doesNotMatch(await fs.readFile(file,'utf8'),/BEGIN Zennia/);});
test('restores persisted settings but preserves later user changes',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const receipt=JSON.parse(await fs.readFile(engine.receiptFile(f.profile)));const lines=Object.entries(receipt.settings).map(([k,v])=>`user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`);await fs.writeFile(path.join(f.profile,'prefs.js'),lines.join('\n')+'\nuser_pref("unrelated", "keep");\n');await engine.remove(f.app,f.profile,f.options);const text=await fs.readFile(path.join(f.profile,'prefs.js'),'utf8');assert.match(text,/replace-newtab", false/);assert.match(text,/unrelated/);assert.doesNotMatch(text,/download-animation/);});
test('does not remove edited patch files',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const file=path.join(f.profile,'chrome','zennia','zennia.css');await fs.appendFile(file,'/* edited */');await assert.rejects(engine.remove(f.app,f.profile,f.options),/edited after/);assert.ok(await fs.stat(engine.receiptFile(f.profile)));});
test('rejects tampered receipt paths',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const file=engine.receiptFile(f.profile),r=JSON.parse(await fs.readFile(file));r.files[0].path=path.join(f.root,'unrelated');await fs.writeFile(file,JSON.stringify(r));await assert.rejects(engine.remove(f.app,f.profile,f.options),/Invalid path/);});
test('reinstalling over an existing install upgrades in place',async t=>{const f=await fixture(t),user=path.join(f.profile,'user.js');await engine.install(f.app,f.profile,f.options);await fs.appendFile(user,'user_pref("later", "preserve");\n');const result=await engine.install(f.app,f.profile,f.options);assert.match(result.message,/Installed/);assert.match(await fs.readFile(user,'utf8'),/later/);assert.match(await fs.readFile(user,'utf8'),/BEGIN Zennia/);const receipt=JSON.parse(await fs.readFile(engine.receiptFile(f.profile),'utf8'));assert.equal(receipt.version,engine.VERSION);});
test('refuses duplicate installations from another installation',async t=>{const f=await fixture(t);await engine.install(f.app,f.profile,f.options);const other=path.join(f.root,'Zen Copy');const layout=engine.layout(other);await fs.mkdir(layout.resources,{recursive:true});await fs.mkdir(path.dirname(layout.exe),{recursive:true});await fs.writeFile(layout.exe,'fixture');await fs.writeFile(path.join(layout.resources,'application.ini'),'[App]\nVersion=1.23.4b\n');await assert.rejects(engine.install(other,f.profile,f.options),/already installed/);});
test('cannot overwrite unrelated owned-path files',async t=>{const f=await fixture(t);const file=path.join(f.profile,'chrome','zennia','zennia.css');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'user theme');await assert.rejects(engine.install(f.app,f.profile,f.options),/would be overwritten/);assert.equal(await fs.readFile(file,'utf8'),'user theme');await assert.rejects(fs.access(engine.receiptFile(f.profile)));});
test('profile discovery respects absolute and relative paths',async t=>{const f=await fixture(t);const home=path.join(f.root,'home'),root=path.join(home,'.zen');await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'profiles.ini'),`[Profile0]\nName=Personal\nIsRelative=0\nPath=${f.profile}\n`);const result=await engine.discover({platform:'linux',home,env:{}});assert.equal(result.profiles[0].path,f.profile);assert.equal(result.profiles[0].name,'Personal');});

for(const platform of ['win32','darwin','linux'])for(const code of ['EPERM','EACCES'])test(`permission probe catches ${code} before installation writes on ${platform}`,async t=>{
 const f=await fixture(t,platform),original=fs.writeFile;
 const before=(await fs.readdir(f.resources)).sort();
 t.mock.method(fs,'writeFile',async function(file,...args){
  if(String(file).startsWith(f.resources+path.sep)&&path.basename(file).startsWith('.zennia-write-probe-'))throw Object.assign(new Error('raw denied'),{code});
  return original.call(this,file,...args);
 });
 await assert.rejects(engine.install(f.app,f.profile,f.options),error=>{
  assert.equal(error.code,code);assert.match(error.message,/Permission denied/);assert.match(error.message,/Run as administrator/);assert.match(error.message,/original profile/);return true;
 });
 await assert.rejects(fs.access(engine.receiptFile(f.profile)));
 assert.deepEqual((await fs.readdir(f.resources)).sort(),before);
});
test('late permission failure explains recovery and rolls back receipt',async t=>{
 const f=await fixture(t),original=fs.writeFile;
 t.mock.method(fs,'writeFile',async function(file,...args){
  if(String(file).includes('zennia-autoconfig.js.zennia-writing-'))throw Object.assign(new Error('raw denied'),{code:'EPERM'});
  return original.call(this,file,...args);
 });
 await assert.rejects(engine.install(f.app,f.profile,f.options),/Permission denied.*Changes were rolled back/);
 await assert.rejects(fs.access(engine.receiptFile(f.profile)));
 await assert.rejects(fs.access(path.join(f.resources,'zennia-owner.json')));
});

// Installs made before the rename to Zennia used the Arc UI file names. Build one
// by moving a fresh install to those names, exactly as the old installer laid it out.
async function legacyInstall(f) {
 await engine.install(f.app,f.profile,f.options);
 const {NAMES,LEGACY}=engine,receiptPath=engine.receiptFile(f.profile),receipt=JSON.parse(await fs.readFile(receiptPath,'utf8'));
 const user=path.join(f.profile,'user.js');
 const map=[[path.join(f.resources,'defaults','pref',NAMES.autoconfig),path.join(f.resources,'defaults','pref',LEGACY.autoconfig)],[path.join(f.resources,NAMES.cfg),path.join(f.resources,LEGACY.cfg)],[path.join(f.resources,NAMES.owner),path.join(f.resources,LEGACY.owner)],[path.join(f.profile,'chrome',NAMES.root),path.join(f.profile,'chrome',LEGACY.root)]];
 const rename=file=>{for(const [from,to] of map)if(file===from||file.startsWith(from+path.sep))return to+file.slice(from.length);return file;};
 for(const [from,to] of map)await fs.rename(from,to);
 const text=(await fs.readFile(user,'utf8')).replace(NAMES.begin,LEGACY.begin).replace(NAMES.end,LEGACY.end);await fs.writeFile(user,text);
 for(const file of receipt.files){file.path=rename(file.path);if(file.path===user)file.installedHash=engine.digest(Buffer.from(text));}
 await fs.rm(receiptPath);await fs.writeFile(engine.receiptFile(f.profile,LEGACY),JSON.stringify(receipt,null,2));
}
// Removal leaves emptied folders behind, as it always has; no file may remain.
const gone=async file=>{
 const stat=await fs.stat(file).catch(()=>null);
 if(!stat?.isDirectory())return assert.equal(stat,null,file);
 const entries=await fs.readdir(file,{recursive:true,withFileTypes:true});
 assert.deepEqual(entries.filter(entry=>entry.isFile()).map(entry=>entry.name),[],file);
};
test('legacy Arc UI installs are discovered, inspected and removed cleanly',async t=>{
 const f=await fixture(t),user=path.join(f.profile,'user.js'),original='user_pref("custom", true);\n';
 await fs.writeFile(user,original);await legacyInstall(f);
 const result=await engine.discover({platform:process.platform,home:path.join(f.root,'home'),env:{},appDirectories:[],instances:[{app:f.app,pid:1}]});
 assert.equal(result.profiles[0].installed,true);assert.equal(result.instances[0].profile,result.profiles[0].path);
 assert.equal((await engine.inspect(f.app,f.profile)).installedVersion,engine.VERSION);
 await engine.remove(f.app,f.profile,f.options);
 assert.equal(await fs.readFile(user,'utf8'),original);
 for(const file of [path.join(f.resources,engine.LEGACY.cfg),path.join(f.resources,engine.LEGACY.owner),path.join(f.profile,'chrome',engine.LEGACY.root),engine.receiptFile(f.profile,engine.LEGACY)])await gone(file);
});
test('installing over a legacy Arc UI install upgrades it to the Zennia layout',async t=>{
 const f=await fixture(t,'linux'),user=path.join(f.profile,'user.js'),original='user_pref("custom", true);\n';
 await fs.writeFile(user,original);await legacyInstall(f);await fs.appendFile(user,'user_pref("later", "preserve");\n');
 await engine.install(f.app,f.profile,f.options);
 for(const file of [path.join(f.resources,engine.LEGACY.cfg),path.join(f.resources,'defaults','pref',engine.LEGACY.autoconfig),path.join(f.resources,engine.LEGACY.owner),path.join(f.profile,'chrome',engine.LEGACY.root),engine.receiptFile(f.profile,engine.LEGACY)])await gone(file);
 assert.ok(await fs.stat(path.join(f.profile,'chrome','zennia','zennia.uc.js')));
 const text=await fs.readFile(user,'utf8');
 assert.doesNotMatch(text,/Arc UI/);assert.equal(text.match(/BEGIN Zennia/g).length,1);assert.match(text,/later/);
 await engine.remove(f.app,f.profile,f.options);
 assert.equal(await fs.readFile(user,'utf8'),original+'user_pref("later", "preserve");\n');
});
test('a legacy owner file still blocks attaching the installation to another profile',async t=>{
 const f=await fixture(t,'linux');await fs.writeFile(path.join(f.resources,engine.LEGACY.owner),'{}');
 await assert.rejects(engine.install(f.app,f.profile,f.options),/attached to another Zennia profile/);
});
