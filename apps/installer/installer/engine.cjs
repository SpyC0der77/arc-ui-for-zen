const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const font = require('./custom-font.cjs');
const VERSION = '0.1.8-beta.10';
// Supported Zen versions are the data files in payload/zen-versions.
const versions = require('./versions.cjs');
const SUPPORTED_VERSIONS = versions.SUPPORTED_VERSIONS;
const SUPPORTED = SUPPORTED_VERSIONS.join(', ');
const BEGIN = '// BEGIN Zennia';
const END = '// END Zennia';
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = file => fs.access(file).then(() => true, () => false);
const eq = (a,b,platform=process.platform) => platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// File names written by an installation. Installs made before the project was
// renamed from Arc UI to Zennia use LEGACY; they stay removable and upgradable.
const NAMES = Object.freeze({receipt:'zennia.install.json',owner:'zennia-owner.json',cfg:'zennia.cfg',autoconfig:'zennia-autoconfig.js',root:'zennia',begin:BEGIN,end:END});
const LEGACY = Object.freeze({receipt:'arc-ui.install.json',owner:'arc-ui-owner.json',cfg:'arc-ui.cfg',autoconfig:'arc-ui-autoconfig.js',root:'arc-ui',begin:'// BEGIN Arc UI for Zen',end:'// END Arc UI for Zen'});
const LAYOUTS = Object.freeze([NAMES,LEGACY]);
const receiptFile = (profile,names=NAMES) => path.join(profile,'chrome',names.receipt);
async function findReceipt(profile) {
  for(const names of LAYOUTS){const file=receiptFile(profile,names);if(await exists(file))return {file,names};}
  return null;
}
function parseIni(text) {
  const sections = {}; let current = null;
  for(const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\[([^\]]+)\]$/);
    if(heading) current = sections[heading[1]] = {};
    else if(current && line.includes('=') && !line.startsWith(';')) {const at=line.indexOf('=');current[line.slice(0,at).trim()]=line.slice(at+1).trim();}
  }
  return sections;
}
async function assertRealPath(file) {
  for(let current=path.resolve(file);;current=path.dirname(current)) {
    const stat=await fs.lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(stat?.isSymbolicLink()) throw new Error(`Select the real folder instead of a symbolic link or junction: ${current}`);
    if(path.dirname(current)===current)break;
  }
}
async function atomicWrite(file,bytes) {
  await assertRealPath(file);await fs.mkdir(path.dirname(file),{recursive:true});
  const temp=file+'.zennia-writing-'+crypto.randomUUID();
  try {await fs.writeFile(temp,bytes,{mode:0o600,flag:'wx'});await fs.rename(temp,file);}
  catch(error){throw writeError(error,file);}
  finally {await fs.rm(temp,{force:true}).catch(error=>{if(!['EACCES','EPERM'].includes(error.code))throw error;});}
}
function layout(installation,platform=process.platform) {
  const app=path.resolve(installation);
  if(platform==='darwin')return {app,resources:path.join(app,'Contents','Resources'),exe:path.join(app,'Contents','MacOS','zen')};
  return {app,resources:app,exe:path.join(app,platform==='win32'?'zen.exe':'zen')};
}
async function assertClosed(exe,platform=process.platform) {
  // Refuse to modify a running app. Never terminate the user's browser.
  if(platform==='win32') {
    const {stdout}=await run('tasklist.exe',['/FI','IMAGENAME eq zen.exe','/FO','CSV','/NH'],{windowsHide:true});
    if(/"zen\.exe"/i.test(stdout))throw new Error('Close all Zen windows completely before installing or removing. Your browser will not be closed automatically.');
  } else {
    const {stdout}=await run('ps',['-axo','comm=']);
    if(stdout.split('\n').some(line=>/^(zen|zen-bin)$/i.test(path.basename(line.trim()))))throw new Error('Close all Zen windows completely before installing or removing.');
  }
}
async function validate(installation,profile,{platform=process.platform,checkClosed=assertClosed,requireVersion=true}={}) {
  const target=layout(installation,platform);const selected=path.resolve(profile);
  await assertRealPath(target.app);await assertRealPath(selected);
  if(!await exists(target.exe))throw new Error('Choose the Zen installation folder'+(platform==='darwin'?' ending in .app.':'.'));
  if(!await exists(path.join(selected,'prefs.js')))throw new Error('Choose a Zen profile containing prefs.js. Finish Zen onboarding first.');
  const within=path.relative(target.app,selected);
  if(within===''||(!within.startsWith('..'+path.sep)&&within!=='..'&&!path.isAbsolute(within)))throw new Error('The Zen application and profile must be separate folders.');
  let ini;
  for(const file of [path.join(target.resources,'application.ini'),path.join(target.resources,'browser','application.ini')])if(await exists(file)){ini=parseIni(await fs.readFile(file,'utf8'));break;}
  const version=ini?.App?.Version;
  if(!version)throw new Error('Could not read the Zen version from application.ini.');
  if(requireVersion&&!SUPPORTED_VERSIONS.includes(version))throw new Error(`This patch supports Zen ${SUPPORTED}; found ${version}. No files were changed.`);
  await checkClosed(target.exe,platform);
  return {...target,profile:selected,version};
}
async function walk(folder,prefix='') {
  const out=[];
  for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('Payload contains a symbolic link.');
    const relative=prefix+entry.name;
    if(entry.isDirectory())out.push(...await walk(path.join(folder,entry.name),relative+'/'));
    else out.push(relative);
  }
  return out;
}
function prefLine(text,key) {return text.match(new RegExp('^user_pref\\("'+escape(key)+'",.*\\);\\r?$','m'))?.[0].replace(/\r$/,'')||'';}
function writeError(error,file) {
  if(!['EACCES','EPERM'].includes(error.code))return error;
  const result=new Error(`Permission denied while writing to ${path.dirname(file)}. Zennia must write startup files into the Zen application folder. On Windows, close this installer and use Run as administrator, then select the same Zen installation and your original profile, or use a user-writable Zen installation. If access is still denied, check folder permissions and security software.`,{cause:error});
  result.code=error.code;
  return result;
}
async function writable(folder) {
  // Windows access(W_OK) does not reliably test directory creation permissions.
  let existing=folder;
  while(true) {
    try {await fs.stat(existing);break;}
    catch(error){if(error.code!=='ENOENT')throw writeError(error,path.join(existing,'probe'));const parent=path.dirname(existing);if(parent===existing)throw error;existing=parent;}
  }
  const probe=path.join(existing,'.zennia-write-probe-'+crypto.randomUUID());
  let created=false;
  try {await fs.writeFile(probe,'',{flag:'wx',mode:0o600});created=true;}
  catch(error){throw writeError(error,probe);}
  finally {if(created)await fs.rm(probe);}
}
async function inspect(installation,profile) {
  const target=await validate(installation,profile,{requireVersion:false,checkClosed:async()=>{}});
  const found=await findReceipt(target.profile);
  const receipt=found?JSON.parse(await fs.readFile(found.file,'utf8')):null;
  if(receipt&&(!eq(receipt.profile,target.profile)||!eq(receipt.resources,target.resources)))throw new Error('The receipt belongs to a different installation or profile.');
  return {installedVersion:receipt?receipt.version||'Unknown':null,targetVersion:VERSION,
    zenVersion:target.version,installerSupportsZen:SUPPORTED_VERSIONS.includes(target.version),
    ...(receipt&&found.names===NAMES?await pausedReason(target):{}),
    ...(receipt?.customFont?{customFont:receipt.customFont}:{}),
    ...(font.PRESETS.has(receipt?.fontPreset)?{fontPreset:receipt.fontPreset}:{})};
}
// Why an installed Zennia is not loading, usually after Zen updated or was reinstalled.
// An unsupported version is reported first: a reinstall cannot repair that.
async function pausedReason(target) {
  const data=path.join(target.profile,'chrome',NAMES.root,'zen-versions',target.version+'.json');
  if(!versions.VERSION_PATTERN.test(target.version)||!await exists(data))return {paused:'unsupported-zen'};
  const startup=[path.join(target.resources,'defaults','pref',NAMES.autoconfig),path.join(target.resources,NAMES.cfg)];
  if(!(await Promise.all(startup.map(exists))).every(Boolean))return {paused:'startup-files-missing'};
  return {};
}
function missingFont(){return new Error('The browser font from the previous install is missing. Choose the font again before reinstalling, or choose Default to remove it.');}
async function install(installation,profile,{payload=path.join(__dirname,'..','payload'),customFont,fontPreset,...options}={}) {
  const target=await validate(installation,profile,options);
  const root=path.join(target.profile,'chrome','zennia');
  let picked;
  const imported=typeof customFont==='string'&&customFont!=='geist';
  if(fontPreset==='sf-pro-family') {
    if(!imported)throw new Error('Choose the folder with the SF Pro fonts.');
    try{picked=await font.readFamily(customFont);}
    catch(error){throw new Error(`Could not import the SF Pro fonts. ${error.message}`,{cause:error});}
  }
  else if(fontPreset!==undefined&&(fontPreset!=='sf-pro'||!imported))throw new Error('Choose a font file for SF Pro.');
  else if(customFont==='geist') picked={preset:'geist'};
  else if(customFont) {
    try{picked=await font.readFont(customFont);}
    catch(error){throw new Error(`Could not import the selected font. ${error.message}`,{cause:error});}
    picked.preset=fontPreset;
  }
  // Check protected folders before an upgrade removes the existing theme.
  for(const folder of [target.resources,path.join(target.resources,'defaults','pref'),target.profile])await writable(folder);
  const manifest=receiptFile(target.profile);
  for(let found;(found=await findReceipt(target.profile));) {
    // Same installation and profile: treat the install as an upgrade and remove the previous version first.
    const previous=JSON.parse(await fs.readFile(found.file,'utf8'));
    const same=eq(previous.profile,target.profile)&&eq(previous.resources,target.resources);
    if(!same)throw new Error('Zennia is already installed in this profile. Remove it before reinstalling.');
    const face=path.join(root,font.FACE);
    const family=path.join(root,font.FAMILY);
    if(customFont===undefined) {
      if(previous.fontPreset==='geist') picked={preset:'geist'};
      else if(previous.fontPreset==='sf-pro-family') {
        // Keep the imported family: read the owned faces back before the old theme is removed.
        const owned=previous.files.filter(file=>path.dirname(file.path)===family);
        for(const file of owned)await assertRealPath(file.path);
        if(!owned.length||!await exists(family))throw missingFont();
        picked=await font.readFamily(family,previous.customFont);
      }
      else if(typeof previous.customFont==='string') {
        // Keep the imported file. Without it, the reinstall would silently fall back to Default.
        if(!previous.files.some(file=>file.path===face)||!await exists(face))throw missingFont();
        await assertRealPath(face);
        picked=await font.readFont(face,previous.customFont);
        if(previous.fontPreset==='sf-pro')picked.preset='sf-pro';
      }
    }
    await remove(target.app,target.profile,options);
  }
  const prefDir=path.join(target.resources,'defaults','pref');
  for(const file of await fs.readdir(prefDir).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    if(!file.endsWith('.js'))continue;
    if(/(?:pref|defaultPref|lockPref)\s*\(\s*["']general\.config\.filename/.test(await fs.readFile(path.join(prefDir,file),'utf8')))
      throw new Error('Another AutoConfig loader is installed. It will not be overwritten: '+file);
  }
  for(const names of LAYOUTS)if(await exists(path.join(target.resources,names.owner)))throw new Error('This Zen installation is attached to another Zennia profile.');
  const userPath=path.join(target.profile,'user.js');
  const userBytes=await fs.readFile(userPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const user=userBytes?utf8(userBytes):'';
  if(LAYOUTS.some(names=>user.includes(names.begin)||user.includes(names.end)))throw new Error('An existing Zennia settings block has no installation receipt. Restore that installation before continuing.');
  // Managed preferences come from this Zen version's data, plus platform-only tuning.
  const settings=versions.settings(target.version,options.platform||process.platform,payload);
  const block=BEGIN+'\n'+Object.entries(settings).map(([k,v])=>`user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')+'\n'+END;
  const writes=new Map();
  writes.set(path.join(prefDir,'zennia-autoconfig.js'),await fs.readFile(path.join(payload,'zennia-autoconfig.js')));
  writes.set(path.join(target.resources,'zennia.cfg'),await fs.readFile(path.join(payload,'zennia.cfg')));
  writes.set(path.join(target.resources,'zennia-owner.json'),Buffer.from(JSON.stringify({profile:target.profile,version:VERSION})));
  for(const relative of await walk(payload)) {
    if(['zennia.cfg','zennia-autoconfig.js'].includes(relative))continue;
    writes.set(path.join(root,relative),await fs.readFile(path.join(payload,relative)));
  }
  if(picked) {
    if(picked.bytes)writes.set(path.join(root,font.FACE),picked.bytes);
    for(const face of picked.faces??[])writes.set(path.join(root,font.FAMILY,face.file),face.bytes);
    writes.set(path.join(root,font.STYLES),font.stylesheet(picked,options.platform||process.platform));
  }
  writes.set(userPath,Buffer.from(user+(user&&!user.endsWith('\n')?'\n':'')+block+'\n'));
  const prefs=await fs.readFile(path.join(target.profile,'prefs.js'),'utf8');
  const receipt={version:VERSION,resources:target.resources,installation:target.app,profile:target.profile,settings,originalPrefs:Object.fromEntries(Object.keys(settings).map(key=>[key,prefLine(prefs,key)])),files:[]};
  if(picked?.name)receipt.customFont=picked.name;
  if(picked?.preset)receipt.fontPreset=picked.preset;
  for(const [file,bytes] of writes) {
    await assertRealPath(file);await writable(path.dirname(file));
    if(await exists(file)&&file!==userPath)throw new Error('An existing file would be overwritten: '+file);
    receipt.files.push({path:file,before:file===userPath&&userBytes?userBytes.toString('base64'):null,installedHash:digest(bytes)});
  }
  await atomicWrite(manifest,Buffer.from(JSON.stringify(receipt,null,2)));
  const changed=[];
  try {for(const [file,bytes] of writes){await atomicWrite(file,bytes);changed.push(file);}}
  catch(error) {
    const failures=[];
    for(const file of changed.reverse())try{await restore(receipt.files.find(f=>f.path===file));}catch(e){failures.push(e.message);}
    if(!failures.length)await fs.rm(manifest,{force:true});
    const failure=new Error(error.message+(failures.length?' Rollback needs attention; keep the installation receipt. '+failures.join('; '):' Changes were rolled back.'),{cause:error});
    if(!failures.length)failure.code=error.code;
    throw failure;
  }
  return {message:'Installed. Open Zen to load Zennia.',version:VERSION,profile:target.profile};
}
async function restore(file) {if(file.before===null)await fs.rm(file.path,{force:true});else await atomicWrite(file.path,Buffer.from(file.before,'base64'));}
async function remove(installation,profile,options={}) {
  const target=await validate(installation,profile,{...options,requireVersion:false});
  for(const folder of [target.resources,path.join(target.resources,'defaults','pref'),target.profile])await writable(folder);
  const found=await findReceipt(target.profile);
  if(!found)throw new Error('Zennia is not installed in this profile.');
  const {file:manifest,names}=found;
  const receipt=JSON.parse(await fs.readFile(manifest,'utf8'));
  if(receipt.profile!==target.profile||receipt.resources!==target.resources)throw new Error('The receipt belongs to a different installation or profile.');
  const ownRoot=path.join(target.profile,'chrome',names.root);
  const userPath=path.join(target.profile,'user.js');
  const appFiles=[path.join(target.resources,'defaults','pref',names.autoconfig),path.join(target.resources,names.cfg),path.join(target.resources,names.owner)];
  const valid=file=>appFiles.includes(file)||file===userPath||(file.startsWith(ownRoot+path.sep)&&!path.relative(ownRoot,file).startsWith('..'));
  const originals=new Map();
  for(const file of receipt.files) {
    if(!valid(file.path)||path.resolve(file.path)!==file.path)throw new Error('Invalid path in the installation receipt.');
    await assertRealPath(file.path);
    const current=await fs.readFile(file.path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});originals.set(file.path,current);
    if(current&&file.path!==userPath&&digest(current)!==file.installedHash)throw new Error('A patch file was edited after installation. Back it up and restore its installed version before removing: '+file.path);
  }
  const userFile=receipt.files.find(file=>file.path===userPath);
  if(!userFile)throw new Error('The installation receipt is incomplete.');
  let mergedUser;
  const currentUser=originals.get(userPath);
  if(currentUser&&digest(currentUser)!==userFile.installedHash) {
    const user=utf8(currentUser),pattern=new RegExp(escape(names.begin)+'\\r?\\n[\\s\\S]*?'+escape(names.end)+'(?:\\r?\\n)?','g');
    if([...user.matchAll(pattern)].length!==1)throw new Error('The managed user.js settings block was edited. Restore its BEGIN/END markers before removing.');
    mergedUser=Buffer.from(user.replace(pattern,''));
  }
  const prefsPath=path.join(target.profile,'prefs.js'),prefsBytes=await fs.readFile(prefsPath);originals.set(prefsPath,prefsBytes);
  let prefs=utf8(prefsBytes);
  for(const [key,value] of Object.entries(receipt.settings)) {
    const current=prefLine(prefs,key),raw=current.match(/^user_pref\("[^"]+",\s*(.*)\);$/)?.[1];
    if(raw?.trim()===JSON.stringify(value))prefs=prefs.replace(new RegExp('^'+escape(current)+'\\r?\\n?','m'),()=>receipt.originalPrefs[key]?receipt.originalPrefs[key]+'\n':'');
  }
  try {
    await atomicWrite(prefsPath,Buffer.from(prefs));
    for(const file of [...receipt.files].reverse())if(file.path===userPath&&mergedUser)await atomicWrite(userPath,mergedUser);else await restore(file);
    await fs.rm(manifest);
  } catch(error) {
    const failures=[];
    for(const [file,bytes] of originals)try{if(bytes===null)await fs.rm(file,{force:true});else await atomicWrite(file,bytes);}catch(e){failures.push(e.message);}
    throw new Error(error.message+(failures.length?' Removal rollback needs attention. '+failures.join('; '):' Removal was rolled back.'));
  }
  return {message:'Removed. Original settings were restored where unchanged.',profile:target.profile};
}
function candidates(platform=process.platform,home=os.homedir(),env=process.env) {
  if(platform==='win32')return {
    apps:[path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Zen Browser'),path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Programs','Zen Browser'),path.join(env.ProgramFiles||'C:\\Program Files','Zen Browser')],
    profileRoots:[path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'zen')]
  };
  if(platform==='darwin')return {apps:[path.join(home,'Applications','Zen.app'),'/Applications/Zen.app'],profileRoots:[path.join(home,'Library','Application Support','zen')]};
  return {apps:[path.join(home,'.local','opt','zen'),'/opt/zen','/opt/zen-browser','/usr/lib/zen','/usr/lib/zen-browser'],profileRoots:[path.join(home,'.zen'),path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'zen')]};
}
async function discover(options={}) {
  const platform=options.platform||process.platform;
  const home=options.home||os.homedir(),env=options.env||process.env;
  const places=candidates(platform,home,env);const apps=[],profiles=[],instances=[];
  const discovery=require('./discovery.cjs');
  const running=options.instances??(options.home?[]:await discovery.runningInstances(platform,options.runCommand));
  const scanned=await discovery.scanApplications(options.appDirectories??discovery.applicationDirectories(platform,home,env),platform);
  const indexed=options.indexedApps??(options.home?[]:await discovery.indexedApplications(platform,options.runCommand));
  const addApp=async app=>{
    if(typeof app!=='string'||!app||!await exists(layout(app,platform).exe))return null;
    const real=await fs.realpath(app);
    if(!apps.some(p=>eq(p,real,platform)))apps.push(real);
    return real;
  };
  const addProfile=async(profile,name)=>{
    if(typeof profile!=='string'||!profile||!await exists(path.join(profile,'prefs.js')))return null;
    const real=await fs.realpath(profile);
    if(!profiles.some(p=>eq(p.path,real,platform)))profiles.push({name:name||path.basename(real),path:real,installed:!!await findReceipt(real)});
    return real;
  };
  for(const instance of running){
    const app=await addApp(instance.app),profile=await addProfile(instance.profile);
    if(app)instances.push({app,profile,pid:instance.pid});
  }
  for(const app of [...places.apps,...scanned,...indexed])await addApp(app);
  for(const root of places.profileRoots) {
    let sections;try{sections=parseIni(await fs.readFile(path.join(root,'profiles.ini'),'utf8'));}catch(e){if(['ENOENT','EACCES','EPERM'].includes(e.code))continue;throw e;}
    for(const [key,entry] of Object.entries(sections))if(/^Profile\d+$/.test(key)&&entry.Path) {
      const profile=entry.IsRelative==='0'?path.resolve(entry.Path):path.resolve(root,entry.Path);
      await addProfile(profile,entry.Name||key);
    }
  }
  for(const profile of profiles){
    const found=await findReceipt(profile.path);
    const receipt=found&&await fs.readFile(found.file,'utf8').then(text=>{try{return JSON.parse(text);}catch{return null;}},()=>null);
    if(receipt?.installation)await addApp(receipt.installation);
    const compatibility=await fs.readFile(path.join(profile.path,'compatibility.ini'),'utf8').then(parseIni,()=>({}));
    for(const directory of [compatibility.Compatibility?.LastPlatformDir,compatibility.Compatibility?.LastAppDir].filter(Boolean)){
      if(platform==='darwin')await addApp(directory.split('/Contents/')[0]);
      else {await addApp(directory);await addApp(path.dirname(directory));}
    }
  }
  // App ownership receipts connect an installed theme to its exact profile.
  for(const app of apps)for(const names of LAYOUTS){
    const owner=await fs.readFile(path.join(layout(app,platform).resources,names.owner),'utf8').then(text=>{try{return JSON.parse(text);}catch{return null;}},()=>null);
    if(owner?.profile){
      const profile=await addProfile(owner.profile);
      if(profile&&!instances.some(i=>eq(i.app,app,platform)&&i.profile&&eq(i.profile,profile,platform))){
        const unmatched=instances.find(i=>eq(i.app,app,platform)&&!i.profile);
        if(unmatched)unmatched.profile=profile;else instances.push({app,profile});
      }
    }
  }
  return {platform,version:VERSION,supportedZen:SUPPORTED,apps,profiles,instances};
}
module.exports={inspect,VERSION,SUPPORTED,SUPPORTED_VERSIONS,BEGIN,END,NAMES,LEGACY,parseIni,layout,candidates,discover,install,remove,validate,receiptFile,digest,assertRealPath};
