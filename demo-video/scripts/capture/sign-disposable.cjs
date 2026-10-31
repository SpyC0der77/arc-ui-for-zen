#!/usr/bin/env node
'use strict';
// Local development signing for a STOPPED disposable capture copy only.
// Never changes a personal installation or any system Gatekeeper setting.
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {load} = require('./prepare-comparison.cjs');
const run = promisify(execFile);

async function sign(file, role='themed') {
  if (process.platform !== 'darwin') throw new Error('Local capture signing is macOS-only.');
  const {data, session} = await load(file, role);
  const exe = path.join(session.app, 'Contents/MacOS/zen');
  const {stdout} = await run('ps', ['-axo', 'comm=']);
  if (stdout.split('\n').some(line=>line.trim()===exe))
    throw new Error('Disposable app is running; close it before local signing.');
  if (session.pid) {
    try { process.kill(session.pid, 0); throw new Error('Manifest PID is still alive; signing refused.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  // Keep browser runtime capabilities. Restricted identity/passkey entitlements
  // require the publisher's certificate and do not belong in a local ad hoc build.
  const capabilities = ['cs.allow-jit', 'cs.disable-library-validation',
    'device.audio-input', 'device.camera', 'device.usb',
    'personal-information.location', 'smartcard'];
  const entitlements = path.join(data.root, `${role}-local-entitlements.plist`);
  await fs.writeFile(entitlements, '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
    '<plist version="1.0"><dict>'+capabilities.map(key=>
      `<key>com.apple.security.${key}</key><true/>`).join('')+'</dict></plist>\n');
  await run('codesign', ['--force', '--sign', '-', '--options', 'runtime',
    '--entitlements', entitlements, session.app]);
  await run('codesign', ['--verify', '--deep', '--strict', session.app]);
  return {app:session.app, verified:true, signing:'local ad hoc', personalInstallationChanged:false};
}
if (require.main === module) sign(process.argv[2], process.argv[3]).then(
  result=>console.log(JSON.stringify(result,null,2)), error=>{console.error(error.message);process.exitCode=1;});
module.exports={sign};
