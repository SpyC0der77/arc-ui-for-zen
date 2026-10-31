#!/usr/bin/env node
'use strict';
// Fresh application copies only. Never enable Marionette in a personal profile.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const engine = require('../../../installer/engine.cjs');
const run = promisify(execFile);
const runtime = path.resolve(__dirname, '../../runtime');
const help = `Usage:
  node demo-video/scripts/capture/prepare-comparison.cjs create <unpatched Zen folder>
  node demo-video/scripts/capture/prepare-comparison.cjs start <manifest> <themed|vanilla>
  node demo-video/scripts/capture/prepare-comparison.cjs close <manifest> <themed|vanilla>
Creates two new disposable apps/profiles; nothing is copied from personal profiles.`;

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
async function create(source) {
  if (!source) throw new Error(help);
  source = await fs.realpath(source);
  const layout = engine.layout(source);
  await fs.access(layout.exe);
  // Validate conflicts before copying hundreds of megabytes.
  if (await fs.access(path.join(layout.resources, 'arc-ui-owner.json')).then(() => true, () => false))
    throw new Error('Source already has Arc UI installed. Choose an unpatched application.');
  for (const name of await fs.readdir(path.join(layout.resources, 'defaults/pref')).catch(e => {
    if (e.code === 'ENOENT') return []; throw e;
  })) {
    if (name.endsWith('.js') && /general\.config\.filename/.test(await fs.readFile(path.join(layout.resources, 'defaults/pref', name), 'utf8')))
      throw new Error(`Source has an AutoConfig loader: ${name}`);
  }
  await fs.mkdir(runtime, {recursive:true});
  const root = await fs.mkdtemp(path.join(runtime, 'comparison-'));
  const manifest = {schema:1, disposable:true, root, sessions:{}};
  for (const [role, port] of [['themed',2828], ['vanilla',2829]]) {
    const folder = path.join(root, role);
    const app = path.join(folder, process.platform === 'darwin' ? 'Zen.app' : 'Zen');
    const profile = path.join(folder, 'profile');
    await fs.mkdir(folder); await fs.cp(source, app, {recursive:true}); await fs.mkdir(profile);
    await fs.writeFile(path.join(profile,'prefs.js'), '// Disposable comparison profile\n');
    const prefs = {
      'marionette.port':port, 'zen.welcome-screen.seen':true,
      'browser.shell.checkDefaultBrowser':false,
      'browser.startup.homepage_override.mstone':'ignore', 'arc-ui.demo-seen':true,
      'browser.aboutwelcome.enabled':false, 'browser.startup.page':0,
      'browser.tabs.warnOnClose':false, 'browser.sessionstore.resume_from_crash':false,
      'zen.updates.show-update-notification':false,
    };
    await fs.writeFile(path.join(profile,'user.js'), Object.entries(prefs).map(([k,v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')+'\n');
    // The running-app exception is scoped to this verified new disposable copy.
    if (role === 'themed') await engine.install(app,profile,{checkClosed:async()=>{}});
    manifest.sessions[role] = {app,profile,port,pid:null};
  }
  const file = path.join(root,'session.json');
  await fs.writeFile(file,JSON.stringify(manifest,null,2));
  return {...manifest,manifest:file};
}
async function load(file,role) {
  file = await fs.realpath(file);
  const data = JSON.parse(await fs.readFile(file,'utf8'));
  const root = await fs.realpath(data.root);
  if (!data.disposable || !path.basename(root).startsWith('comparison-') || path.dirname(root)!==await fs.realpath(runtime) || file!==path.join(root,'session.json'))
    throw new Error('Refusing a manifest outside the generated disposable comparison directory.');
  const session = data.sessions[role];
  if (!session || !['themed','vanilla'].includes(role)) throw new Error('Role must be themed or vanilla.');
  if (path.dirname(session.app)!==path.join(root,role) || session.profile!==path.join(root,role,'profile'))
    throw new Error('Manifest contains unexpected application/profile paths.');
  if (await fs.realpath(session.app)!==session.app || await fs.realpath(session.profile)!==session.profile)
    throw new Error('Disposable application/profile must not redirect through symbolic links.');
  return {file,data,session};
}
async function start(file,role) {
  const {file:target,data,session} = await load(file,role);
  await freePort(session.port);
  if (session.pid) {
    try {process.kill(session.pid,0); throw new Error('Previous disposable process is still running.');}
    catch(e) {if(e.code!=='ESRCH') throw e;}
  }
  const child = spawn(engine.layout(session.app).exe, ['-no-remote','-purgecaches','--marionette','-profile',session.profile,'about:blank'], {
    detached:true,stdio:'ignore',windowsHide:true,
    env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'},
  });
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();session.pid=child.pid;
  await fs.writeFile(target,JSON.stringify(data,null,2));
  return {...session,manifest:target,role};
}
async function close(file,role) {
  const {file:target,data,session} = await load(file,role);
  const python = process.env.ARC_DEMO_PYTHON || (process.platform==='win32'?'python':'python3');
  const {stdout} = await run(python,[path.join(__dirname,'record-vanilla.py'),'--manifest',target,'--role',role,'--close'],{timeout:60000});
  const shutdown = JSON.parse(stdout.trim());
  const deadline=Date.now()+30000;
  while(session.pid) {
    try {process.kill(session.pid,0);}
    catch(e) {if(e.code==='ESRCH')break;throw e;}
    if(Date.now()>deadline)throw new Error(`Zen PID ${session.pid} has not exited; no force quit was attempted. Shutdown response: ${JSON.stringify(shutdown)}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  session.pid=null;await fs.writeFile(target,JSON.stringify(data,null,2));return {closed:true,role,shutdown};
}
if(require.main===module) {
  const [command,a,b]=process.argv.slice(2);
  const action=command==='create'?create(a):command==='start'?start(a,b):command==='close'?close(a,b):Promise.reject(new Error(help));
  action.then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={create,start,close,load};
