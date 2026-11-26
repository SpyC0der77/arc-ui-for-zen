const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const engine=require('../installer/engine.cjs');
const options={checkClosed:async()=>{}};
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
async function fixture(t,platform=process.platform) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'zennia-test-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'Zen App'),profile=path.join(root,'Profile ü');
 const layout=engine.layout(app,platform);await fs.mkdir(path.dirname(layout.exe),{recursive:true});await fs.mkdir(layout.resources,{recursive:true});await fs.mkdir(profile,{recursive:true});
 await fs.writeFile(layout.exe,'fixture');await fs.writeFile(path.join(layout.resources,'application.ini'),'[App]\nVersion=1.23.4b\n');await fs.writeFile(path.join(profile,'prefs.js'),'user_pref("unrelated", "keep me");\nuser_pref("zen.urlbar.replace-newtab", false);\n');
 return {root,app,profile,resources:layout.resources,options:{...options,platform}};
}
test('a local browser font is owned, preserved on reinstall, and cleared on request',async t=>{
 const f=await fixture(t),source=path.join(f.root,'My User Font.woff2');
 const {FACE,STYLES}=require('../installer/custom-font.cjs');
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 await fs.copyFile(path.join(__dirname,'../payload/content/geist-400.woff2'),source);
 await engine.install(f.app,f.profile,{...f.options,customFont:source});
 const bytes=await fs.readFile(installed(FACE));
 assert.deepEqual(bytes,await fs.readFile(source));
 assert.match(await fs.readFile(installed(STYLES),'utf8'),/format\("woff2"\)/);
 assert.equal((await engine.inspect(f.app,f.profile)).customFont,'My User Font.woff2');
 await fs.writeFile(source,'bad font');
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,customFont:source}),/not a valid/);
 assert.deepEqual(await fs.readFile(installed(FACE)),bytes);
 await engine.install(f.app,f.profile,f.options);
 assert.deepEqual(await fs.readFile(installed(FACE)),bytes);
 await engine.install(f.app,f.profile,{...f.options,customFont:null});
 await assert.rejects(fs.access(installed(FACE)),{code:'ENOENT'});
 await assert.rejects(fs.access(installed(STYLES)),{code:'ENOENT'});
 assert.equal((await engine.inspect(f.app,f.profile)).customFont,undefined);
 assert.equal(await fs.readFile(source,'utf8'),'bad font');
});
test('browser font presets use bundled Geist or preserve the imported SF Pro file',async t=>{
 const f=await fixture(t);
 const {FACE,STYLES}=require('../installer/custom-font.cjs');
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 const source=path.join(f.root,'Example.woff2');
 const bundled=path.join(__dirname,'../payload/content/geist-400.woff2');
 await fs.copyFile(bundled,source);
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,fontPreset:'sf-pro'}),/Choose a font file/);
 await engine.install(f.app,f.profile,{...f.options,customFont:'geist'});
 const css=await fs.readFile(installed(STYLES),'utf8');
 for(const weight of [400,500,600])assert.ok(css.includes(`url("../geist-${weight}.woff2")`));
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,'geist');
 await assert.rejects(fs.access(installed(FACE)),{code:'ENOENT'});
 await engine.install(f.app,f.profile,f.options);
 assert.equal(await fs.readFile(installed(STYLES),'utf8'),css);
 await engine.install(f.app,f.profile,{...f.options,customFont:source,fontPreset:'sf-pro'});
 await engine.install(f.app,f.profile,f.options);
 const info=await engine.inspect(f.app,f.profile);
 assert.equal(info.fontPreset,'sf-pro');
 assert.equal(info.customFont,'Example.woff2');
 assert.deepEqual(await fs.readFile(installed(FACE)),await fs.readFile(source));
 await engine.install(f.app,f.profile,{...f.options,customFont:null});
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,undefined);
 await assert.rejects(fs.access(installed(FACE)),{code:'ENOENT'});
});
// A minimal OpenType file that passes the importer's checks: the OTTO signature and one table inside it.
function otf(tag){
 const bytes=Buffer.alloc(64);bytes.write('OTTO',0,'latin1');bytes.writeUInt16BE(1,4);
 bytes.write('CFF ',12,'latin1');bytes.writeUInt32BE(28,20);bytes.writeUInt32BE(4,24);bytes.write(tag,40,'latin1');
 return bytes;
}
test('the SF Pro family imports every Text and Display face and uses heavier cuts off macOS',async t=>{
 const f=await fixture(t);
 const {FAMILY,STYLES}=require('../installer/custom-font.cjs');
 const installed=relative=>path.join(f.profile,'chrome','zennia',relative);
 const folder=path.join(f.root,'San-Francisco-Pro-Fonts-master');
 await fs.mkdir(folder);
 const files=['SF-Pro-Text-Regular.otf','SF-Pro-Text-Medium.otf','SF-Pro-Text-Semibold.otf','SF-Pro-Text-Bold.otf','SF-Pro-Text-RegularItalic.otf','SF-Pro-Display-Regular.otf','SF-Pro-Display-Bold.otf'];
 for(const file of files)await fs.writeFile(path.join(folder,file),otf(file));
 await fs.writeFile(path.join(folder,'README.md'),'not a font');
 await fs.writeFile(path.join(folder,'SF-Pro-Rounded-Regular.otf'),otf('rounded'));
 await engine.install(f.app,f.profile,{...f.options,customFont:folder,fontPreset:'sf-pro-family'});
 for(const file of files)assert.deepEqual(await fs.readFile(installed(path.join(FAMILY,file))),otf(file));
 await assert.rejects(fs.access(installed(path.join(FAMILY,'SF-Pro-Rounded-Regular.otf'))),{code:'ENOENT'});
 const css=await fs.readFile(installed(STYLES),'utf8');
 // The file each @font-face uses for a family, weight and style.
 const face=(family,weight,style='normal')=>{
  const rule=`@font-face { font-family: "${family}"; src: url("sf-pro/`;
  const tail=`") format("opentype"); font-weight: ${weight}; font-style: ${style}; }`;
  return css.split('\n').map(line=>line.trim()).find(line=>line.startsWith(rule)&&line.endsWith(tail))?.slice(rule.length,-tail.length);
 };
 // Off macOS, regular text is drawn with the Medium cut; semibold and bold keep their own.
 assert.equal(face('Zennia Custom',400),'SF-Pro-Text-Medium.otf');
 assert.equal(face('Zennia Custom',500),'SF-Pro-Text-Semibold.otf');
 assert.equal(face('Zennia Custom',700),'SF-Pro-Text-Bold.otf');
 assert.equal(face('Zennia Custom',400,'italic'),'SF-Pro-Text-RegularItalic.otf');
 assert.equal(face('Zennia Custom Display',400),'SF-Pro-Display-Regular.otf');
 assert.equal(face('Zennia Custom Display',700),'SF-Pro-Display-Bold.otf');
 assert.match(css,/:is\(h1, h2\):not\(\.titlebar-button\) \{\s*font-family: "Zennia Custom Display"/);
 const info=await engine.inspect(f.app,f.profile);
 assert.deepEqual([info.fontPreset,info.customFont],['sf-pro-family','San-Francisco-Pro-Fonts-master']);
 // A plain reinstall keeps the imported family; choosing the default removes it.
 await engine.install(f.app,f.profile,f.options);
 assert.equal(await fs.readFile(installed(STYLES),'utf8'),css);
 assert.equal((await engine.inspect(f.app,f.profile)).fontPreset,'sf-pro-family');
 await engine.install(f.app,f.profile,{...f.options,customFont:null});
 await assert.rejects(fs.access(installed(path.join(FAMILY,files[0]))),{code:'ENOENT'});
 // On macOS each weight uses its own cut.
 const mac=require('../installer/custom-font.cjs').stylesheet(await require('../installer/custom-font.cjs').readFamily(folder),'darwin').toString();
 assert.match(mac,/sf-pro\/SF-Pro-Text-Regular\.otf"\) format\("opentype"\); font-weight: 400; font-style: normal;/);
 // A folder without SF Pro Text Regular is refused before anything changes.
 await fs.rm(path.join(folder,'SF-Pro-Text-Regular.otf'));
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,customFont:folder,fontPreset:'sf-pro-family'}),/SF-Pro-Text-Regular\.otf/);
 await assert.rejects(engine.install(f.app,f.profile,{...f.options,fontPreset:'sf-pro-family'}),/Choose the folder/);
});
for(const platform of ['win32','darwin','linux'])test('install/remove preserves original files on '+platform,async t=>{
 const f=await fixture(t,platform),user=path.join(f.profile,'user.js');
 const original=Buffer.from('// original\r\nuser_pref("custom", true);\r\n');await fs.writeFile(user,original);
 await engine.install(f.app,f.profile,f.options);
 assert.ok(await fs.stat(path.join(f.resources,'zennia.cfg')));assert.ok(await fs.stat(path.join(f.profile,'chrome','zennia','zennia.uc.js')));
 assert.match(await fs.readFile(user,'utf8'),/BEGIN Zennia/);
 const installed=JSON.parse(await fs.readFile(engine.receiptFile(f.profile),'utf8'));
 assert.equal(installed.settings['gfx.font_rendering.cleartype_params.rendering_mode'],platform==='win32'?5:undefined);
 assert.equal(installed.settings['gfx.font_rendering.cleartype_params.cleartype_level'],platform==='win32'?0:undefined);
 await engine.remove(f.app,f.profile,f.options);
 assert.deepEqual(await fs.readFile(user),original);assert.equal(await fs.readFile(path.join(f.profile,'prefs.js'),'utf8'),'user_pref("unrelated", "keep me");\nuser_pref("zen.urlbar.replace-newtab", false);\n');
 await assert.rejects(fs.access(path.join(f.resources,'zennia.cfg')));
});
for(const version of engine.SUPPORTED_VERSIONS)test('installs and removes supported Zen '+version,async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.resources,'application.ini'),`[App]\nVersion=${version}\n`);
 await engine.install(f.app,f.profile,f.options);await engine.remove(f.app,f.profile,f.options);
 await assert.rejects(fs.access(engine.receiptFile(f.profile)));
});
test('loader and installer enforce the same exact versions',async()=>{
 // The loader accepts a Zen version only when its data file was installed.
 const cfg=await fs.readFile(path.join(__dirname,'../payload/zennia.cfg'),'utf8');
 assert.match(cfg,/data\.append\("zen-versions"\); data\.append\(version \+ "\.json"\);/);
 assert.match(cfg,/!data\.exists\(\)\) return;/);
 const files=(await fs.readdir(path.join(__dirname,'../payload/zen-versions'))).filter(name=>name!=='base.json').map(name=>name.replace(/\.json$/,''));
 assert.deepEqual(files.sort(),[...engine.SUPPORTED_VERSIONS].sort());
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
