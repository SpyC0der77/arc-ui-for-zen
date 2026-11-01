// Disposable browser-chrome session when Windows app capture cannot bind Zen.
// Usage: node scripts/chrome-session.cjs <unpatched Zen application folder>
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const engine = require('../installer/engine.cjs');

(async () => {
  const source = process.argv[2];
  if (!source) throw new Error('Pass an unpatched Zen application folder. Never pass a personal profile.');
  // Fail before copying if another Marionette session already owns this port.
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(2828, '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
  const artifacts = path.resolve(__dirname, '../zen-instances');
  await fs.mkdir(artifacts, {recursive:true});
  const folder = await fs.mkdtemp(path.join(artifacts, 'chrome-session-'));
  // macOS signing can fail in cloud-managed workspaces. Keep the disposable
  // bundle local; diagnostics and its fresh profile remain under zen-instances.
  const appFolder = process.platform === 'darwin'
    ? await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'arc-ui-chrome-session-'))
    : folder;
  const app = path.join(appFolder, process.platform === 'darwin' ? 'Zen.app' : 'Zen');
  const profile = path.join(folder, 'profile');
  await fs.cp(path.resolve(source), app, {recursive:true});
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'prefs.js'), '// Disposable chrome session\n');
  await fs.writeFile(path.join(profile, 'user.js'), [
    'user_pref("zen.welcome-screen.seen", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("arc-ui.demo-seen", true);',
    ''
  ].join('\n'));
  // Only this freshly created application copy is modified. A running personal
  // Zen is unrelated; the installer's normal conflict/receipt checks still run.
  await engine.install(app, profile, {checkClosed:async () => {}});
  if (process.platform === 'darwin') {
    // Installing startup resources invalidates the publisher's bundle seal.
    // Sign only this new disposable copy, retaining local browser capabilities
    // without publisher-only identity/passkey entitlements or Gatekeeper changes.
    const capabilities = ['cs.allow-jit', 'cs.disable-library-validation',
      'device.audio-input', 'device.camera', 'device.usb',
      'personal-information.location', 'smartcard'];
    const entitlements = path.join(folder, 'local-entitlements.plist');
    await fs.writeFile(entitlements, '<?xml version="1.0" encoding="UTF-8"?>\n'+
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
      '<plist version="1.0"><dict>'+capabilities.map(key=>
        `<key>com.apple.security.${key}</key><true/>`).join('')+'</dict></plist>\n');
    await run('codesign', ['--force', '--sign', '-', '--options', 'runtime',
      '--entitlements', entitlements, app]);
    await run('codesign', ['--verify', '--deep', '--strict', app]);
  }
  const child = spawn(engine.layout(app).exe, [
    '-no-remote', '-purgecaches', '--marionette', '-profile', profile, 'about:blank'
  ], {
    detached:true, stdio:'ignore', windowsHide:true,
    env:{...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'}
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  const session = {app, profile, pid:child.pid, port:2828};
  await fs.writeFile(path.join(folder, 'session.json'), JSON.stringify(session, null, 2));
  console.log(JSON.stringify({...session, manifest:path.join(folder, 'session.json')}, null, 2));
})().catch(error => {console.error(error.message); process.exitCode = 1;});
