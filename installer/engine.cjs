const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const VERSION = '0.1.0';
const SUPPORTED_VERSIONS = Object.freeze(['1.22.3b', '1.23.3b', '1.23.4b', '1.24b']);
const SUPPORTED = SUPPORTED_VERSIONS.join(', ');
const BEGIN = '// BEGIN Arc UI for Zen';
const END = '// END Arc UI for Zen';
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = file => fs.access(file).then(() => true, () => false);
const eq = (a,b,platform=process.platform) => platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const receiptFile = profile => path.join(profile,'chrome','arc-ui.install.json');
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
  const temp=file+'.arc-writing-'+crypto.randomUUID();
  try {await fs.writeFile(temp,bytes,{mode:0o600,flag:'wx'});await fs.rename(temp,file);}
  finally {await fs.rm(temp,{force:true});}
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
async function writable(folder) {
  if(!await exists(folder))return writable(path.dirname(folder));
  try {await fs.access(folder,require('node:fs').constants.W_OK);}
  catch {throw new Error(`This folder is not writable without administrator access: ${folder}. Install Zen in a user-owned folder first.`);}
}
async function install(installation,profile,{payload=path.join(__dirname,'..','payload'),...options}={}) {
  const target=await validate(installation,profile,options);
  const manifest=receiptFile(target.profile);
  if(await exists(manifest))throw new Error('Arc UI is already installed in this profile. Remove it before reinstalling.');
  const prefDir=path.join(target.resources,'defaults','pref');
  for(const file of await fs.readdir(prefDir).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
    if(!file.endsWith('.js'))continue;
    if(/(?:pref|defaultPref|lockPref)\s*\(\s*["']general\.config\.filename/.test(await fs.readFile(path.join(prefDir,file),'utf8')))
      throw new Error('Another AutoConfig loader is installed. It will not be overwritten: '+file);
  }
  if(await exists(path.join(target.resources,'arc-ui-owner.json')))throw new Error('This Zen installation is attached to another Arc UI profile.');
  const userPath=path.join(target.profile,'user.js');
  const userBytes=await fs.readFile(userPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const user=userBytes?utf8(userBytes):'';
  if(user.includes(BEGIN)||user.includes(END))throw new Error('An existing Arc UI settings block has no installation receipt. Restore that installation before continuing.');
  const settings=JSON.parse(await fs.readFile(path.join(payload,'settings.json'),'utf8'));
  // DirectWrite tuning is Windows-only. Keep CoreText/FreeType native elsewhere.
  if((options.platform||process.platform)==='win32')Object.assign(settings,JSON.parse(await fs.readFile(path.join(payload,'settings.windows.json'),'utf8')));
  const block=BEGIN+'\n'+Object.entries(settings).map(([k,v])=>`user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')+'\n'+END;
  const writes=new Map();
  writes.set(path.join(prefDir,'arc-ui-autoconfig.js'),await fs.readFile(path.join(payload,'arc-ui-autoconfig.js')));
  writes.set(path.join(target.resources,'arc-ui.cfg'),await fs.readFile(path.join(payload,'arc-ui.cfg')));
  writes.set(path.join(target.resources,'arc-ui-owner.json'),Buffer.from(JSON.stringify({profile:target.profile,version:VERSION})));
  for(const relative of await walk(payload)) {
    if(['settings.json','settings.windows.json','arc-ui.cfg','arc-ui-autoconfig.js'].includes(relative))continue;
    writes.set(path.join(target.profile,'chrome','arc-ui',relative),await fs.readFile(path.join(payload,relative)));
  }
  writes.set(userPath,Buffer.from(user+(user&&!user.endsWith('\n')?'\n':'')+block+'\n'));
  const prefs=await fs.readFile(path.join(target.profile,'prefs.js'),'utf8');
  const receipt={version:VERSION,resources:target.resources,installation:target.app,profile:target.profile,settings,originalPrefs:Object.fromEntries(Object.keys(settings).map(key=>[key,prefLine(prefs,key)])),files:[]};
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
    throw new Error(error.message+(failures.length?' Rollback needs attention; keep the installation receipt. '+failures.join('; '):' Changes were rolled back.'));
  }
  return {message:'Installed. Open Zen to load Arc UI.',version:VERSION,profile:target.profile};
}
async function restore(file) {if(file.before===null)await fs.rm(file.path,{force:true});else await atomicWrite(file.path,Buffer.from(file.before,'base64'));}
async function remove(installation,profile,options={}) {
  const target=await validate(installation,profile,{...options,requireVersion:false});
  const manifest=receiptFile(target.profile);
  const receipt=JSON.parse(await fs.readFile(manifest,'utf8').catch(e=>{if(e.code==='ENOENT')throw new Error('Arc UI is not installed in this profile.');throw e;}));
  if(receipt.profile!==target.profile||receipt.resources!==target.resources)throw new Error('The receipt belongs to a different installation or profile.');
  const ownRoot=path.join(target.profile,'chrome','arc-ui');
  const userPath=path.join(target.profile,'user.js');
  const appFiles=[path.join(target.resources,'defaults','pref','arc-ui-autoconfig.js'),path.join(target.resources,'arc-ui.cfg'),path.join(target.resources,'arc-ui-owner.json')];
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
    const user=utf8(currentUser),pattern=new RegExp(escape(BEGIN)+'\\r?\\n[\\s\\S]*?'+escape(END)+'(?:\\r?\\n)?','g');
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
  const places=candidates(platform,options.home,options.env);const apps=[],profiles=[];
  for(const app of places.apps)if(await exists(layout(app,platform).exe))apps.push(app);
  for(const root of places.profileRoots) {
    let sections;try{sections=parseIni(await fs.readFile(path.join(root,'profiles.ini'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    for(const [key,entry] of Object.entries(sections))if(/^Profile\d+$/.test(key)&&entry.Path) {
      const profile=entry.IsRelative==='0'?path.resolve(entry.Path):path.resolve(root,entry.Path);
      if(await exists(path.join(profile,'prefs.js')))profiles.push({name:entry.Name||key,path:profile,installed:await exists(receiptFile(profile))});
    }
  }
  return {platform,version:VERSION,supportedZen:SUPPORTED,apps,profiles};
}
module.exports={VERSION,SUPPORTED,SUPPORTED_VERSIONS,BEGIN,END,parseIni,layout,candidates,discover,install,remove,validate,receiptFile,digest};
