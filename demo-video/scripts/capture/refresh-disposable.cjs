#!/usr/bin/env node
'use strict';
// The repository's remove/install/Open Zen workflow, scoped to a stopped,
// verified disposable capture copy. Receipt and edited-file checks stay enabled.
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {load} = require('./prepare-comparison.cjs');
const {sign} = require('./sign-disposable.cjs');
const engine = require('../../../installer/engine.cjs');
const {launch} = require('../../../installer/launch.cjs');
const run = promisify(execFile);

async function refresh(file) {
  const {file:manifest, data, session} = await load(file, 'themed');
  const exe = engine.layout(session.app).exe;
  async function checkStopped() {
    if (session.pid) {
      try { process.kill(session.pid,0); throw new Error(`Disposable PID ${session.pid} is still alive; wait for graceful exit.`); }
      catch(error) { if(error.code!=='ESRCH')throw error; }
    }
    const {stdout}=await run('ps',['-axo','comm=']);
    if(stdout.split('\n').some(line=>line.trim()===exe))
      throw new Error('The disposable application is running; refresh refused.');
  }
  await checkStopped();
  // Only unrelated applications are exempt. The exact disposable target was
  // checked above and is checked again before each installer mutation.
  const options={checkClosed:checkStopped};
  const removed=await engine.remove(session.app, session.profile, options);
  const installed=await engine.install(session.app, session.profile, options);
  if(process.platform==='darwin')await sign(manifest,'themed');
  // Use the installer's actual Open Zen action, including -purgecaches.
  await launch(session.app, session.profile);
  session.pid=null;
  for(let attempt=0;attempt<20;attempt++) {
    const {stdout}=await run('ps',['-axo','pid=,comm=']);
    const matches=stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(.+)$/))
      .filter(match=>match&&match[2]===exe);
    if(matches.length===1){session.pid=Number(matches[0][1]);break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await fs.writeFile(manifest,JSON.stringify(data,null,2));
  return {removed:removed.message,installed:installed.message,
    reopenedWithInstaller:true,pid:session.pid,app:session.app,profile:session.profile};
}
if(require.main===module)refresh(process.argv[2]).then(result=>console.log(JSON.stringify(result,null,2)),
  error=>{console.error(error.message);process.exitCode=1;});
module.exports={refresh};
