const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const engine = require('../installer/engine.cjs');
const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(args) {
  const values = args.filter(arg => arg !== '--');
  const pointer = values.includes('--pointer');
  const sources = values.filter(arg => arg !== '--pointer');
  if (sources.length !== 1 || sources[0].startsWith('--'))
    throw new Error('Usage: pnpm test:runtime -- <unpatched Zen application folder> [--pointer]');
  return {source: path.resolve(sources[0]), pointer};
}
function assertResult(result) {
  if (!result || !Array.isArray(result.checks) || !result.checks.length || !Array.isArray(result.errors))
    throw new Error('Browser returned no valid verification checks.');
  const failures = result.checks.filter(check => check.pass !== true).map(check => check.label);
  if (failures.length || result.errors.length) throw new Error([...failures, ...result.errors].join('\n'));
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function testHook(timeoutMs) {
  return `
var arcRuntimeQuitTimer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
arcRuntimeQuitTimer.initWithCallback(() => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit), ${timeoutMs}, Ci.nsITimer.TYPE_ONE_SHOT);
function arcTestLog(text) {
  try {
    const f=Services.dirsvc.get('ProfD',Ci.nsIFile);f.append('runtime-log.txt');
    const out=Cc['@mozilla.org/network/file-output-stream;1'].createInstance(Ci.nsIFileOutputStream);
    out.init(f,0x02|0x08|0x10,384,0);const value=String(text)+'\\n';out.write(value,value.length);out.close();
  } catch(error) {}
}
arcTestLog('AutoConfig started: '+Services.appinfo.version);
Services.console.registerListener({observe(message){arcTestLog(message.message||String(message));}});
Services.obs.addObserver({observe(win) {
  if(win.document.documentElement.getAttribute('windowtype')!=='navigator:browser')return;
  Services.scriptloader.loadSubScript('chrome://arc-ui/content/verify.uc.js',win,'UTF-8');
}},'browser-delayed-startup-finished');
`;
}
async function copyDiagnostics(profile, diagnostics) {
  // Explicit allowlist: never upload prefs, cookies, login stores or profiles.
  for (const [source, target] of [
    ['verification.json', 'verification.json'], ['runtime-log.txt', 'runtime-log.txt'],
    ['verified.png', 'browser.png'], ['pointer-results.json', 'pointer-results.json'], ['pointer.png', 'pointer.png'],
  ]) {
    try { await fs.copyFile(path.join(profile, source), path.join(diagnostics, target)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function verify(source, {pointer = false, timeoutMs = 120000} = {}) {
  const artifacts = path.resolve(__dirname, '../artifacts');
  const sourceApp = await fs.realpath(source);
  const relative = path.relative(sourceApp, artifacts);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
    throw new Error('Source application must not contain the artifacts directory.');
  await fs.mkdir(artifacts, {recursive: true});
  const folder = await fs.mkdtemp(path.join(artifacts, 'runtime-'));
  const diagnostics = path.join(folder, 'diagnostics');
  const app = path.join(folder, process.platform === 'darwin' ? 'Zen.app' : 'Zen');
  const profile = path.join(folder, 'profile');
  await fs.mkdir(diagnostics); await fs.mkdir(profile);
  const summary = {version: null, passed: 0, checks: 0, pointer, removal: false, errors: []};
  console.log('Runtime diagnostics: ' + diagnostics);
  let child, exited = false, launchError, installedCfg, installed = false, originalUser;
  let stdout, stderr, failure, quitDeadline = 0;
  const checkClosed = async exe => {
    if (path.resolve(exe) !== engine.layout(app).exe || (child && !exited))
      throw new Error('Disposable browser is still running or target is unexpected.');
  };
  try {
    await fs.writeFile(path.join(profile, 'prefs.js'), '// isolated verification profile\n');
    const user = ['user_pref("zen.welcome-screen.seen", true);', 'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");', 'user_pref("arc-ui.demo-seen", true);',
      // Windows Server runners report reduced motion by default. Establish
      // normal motion here; verify.uc.js separately tests reduced motion.
      'user_pref("ui.prefersReducedMotion", 0);',
      `user_pref("arc-ui.test.pointer", ${pointer});`, ''].join('\n');
    await fs.writeFile(path.join(profile, 'user.js'), user);
    const target = await engine.validate(sourceApp, profile, {checkClosed: async () => {}});
    summary.version = target.version;
    await fs.cp(sourceApp, app, {recursive: true});
    const resources = engine.layout(app).resources;
    const distribution = path.join(resources, 'distribution');
    for (const file of [distribution, path.join(distribution, 'policies.json')]) {
      const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (stat?.isSymbolicLink()) throw new Error('Disposable update policy path is a symbolic link: ' + file);
    }
    await fs.mkdir(distribution, {recursive: true});
    await fs.writeFile(path.join(distribution, 'policies.json'), JSON.stringify({policies: {DisableAppUpdate: true, DontCheckDefaultBrowser: true}}));
    const port = pointer ? await freePort() : null;
    if (pointer) await fs.appendFile(path.join(profile, 'user.js'), `user_pref("marionette.port", ${port});\n`);
    originalUser = await fs.readFile(path.join(profile, 'user.js'), 'utf8');
    await engine.install(app, profile, {checkClosed});
    installed = true;
    const cfg = path.join(resources, 'arc-ui.cfg');
    installedCfg = await fs.readFile(cfg);
    await fs.copyFile(path.join(__dirname, 'verify.uc.js'), path.join(profile, 'chrome/arc-ui/content/verify.uc.js'));
    await fs.appendFile(cfg, testHook(timeoutMs + 30000));
    stdout = await fs.open(path.join(diagnostics, 'stdout.log'), 'w');
    stderr = await fs.open(path.join(diagnostics, 'stderr.log'), 'w');
    const args = ['-headless', '-no-remote', '-purgecaches', ...(pointer ? ['--marionette'] : []), '-profile', profile, 'about:blank'];
    const env = {...process.env, MOZ_HEADLESS_WIDTH: '1200', MOZ_HEADLESS_HEIGHT: '800'};
    // Never allow a caller's remote-access environment into the ordinary run.
    delete env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS;
    if (pointer) env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = '1';
    quitDeadline = Date.now() + timeoutMs + 45000;
    child = spawn(engine.layout(app).exe, args, {stdio: ['ignore', stdout.fd, stderr.fd], windowsHide: true, env});
    child.once('exit', () => { exited = true; });
    child.once('error', error => { launchError = error; exited = true; });
    let result;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      try { result = JSON.parse(await fs.readFile(path.join(profile, 'verification.json'), 'utf8')); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exited) throw new Error('Zen exited before writing verification results.');
      await delay(250);
    }
    if (!result) throw new Error('Timed out waiting for browser verification.');
    summary.checks = result.checks?.length || 0;
    summary.passed = result.checks?.filter(check => check.pass === true).length || 0;
    assertResult(result);
    if (pointer) {
      const {stdout: output} = await run(process.env.PYTHON || 'python', [path.join(__dirname, 'runtime-pointer.py'), String(port), profile], {timeout: 30000, windowsHide: true});
      await fs.writeFile(path.join(diagnostics, 'pointer-stdout.log'), output);
      const pointerResult = JSON.parse(await fs.readFile(path.join(profile, 'pointer-results.json'), 'utf8'));
      assertResult(pointerResult); summary.pointerChecks = pointerResult.checks.length;
    }
    while (!exited && Date.now() < quitDeadline) await delay(250);
    if (!exited) throw new Error('Disposable Zen did not quit gracefully; left untouched.');
    if (child.exitCode !== 0) throw new Error('Zen exited with code ' + child.exitCode);
  } catch (error) { failure = error; summary.errors.push(error.stack || String(error)); }
  finally {
    // The browser-side watchdog handles failures. Never force-kill Zen or
    // restore/remove files while our browser is still running.
    while (child && !exited && Date.now() < quitDeadline) await delay(250);
    try {
      if (installed && (!child || exited)) {
        if (installedCfg) await fs.writeFile(path.join(engine.layout(app).resources, 'arc-ui.cfg'), installedCfg);
        await fs.unlink(path.join(profile, 'chrome/arc-ui/content/verify.uc.js')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await engine.remove(app, profile, {checkClosed}); summary.removal = true;
        summary.userRestored = await fs.readFile(path.join(profile, 'user.js'), 'utf8') === originalUser;
        if (!summary.userRestored) throw new Error('Removal did not restore user.js exactly.');
      } else if (installed) throw new Error('Browser is still running. No cleanup attempted.');
    } catch (error) { summary.errors.push(error.stack || String(error)); failure ||= error; }
    await stdout?.close(); await stderr?.close();
    await copyDiagnostics(profile, diagnostics);
    await fs.writeFile(path.join(diagnostics, 'summary.json'), JSON.stringify(summary, null, 2));
  }
  if (failure) throw new Error(failure.message + '\nDiagnostics: ' + diagnostics);
  console.log(`PASS Zen ${summary.version}: ${summary.passed}/${summary.checks} checks${pointer ? `, ${summary.pointerChecks} pointer checks` : ''}, clean removal. Diagnostics: ${diagnostics}`);
  return summary;
}
async function main(args) { const {source, ...options} = parseArgs(args); return verify(source, options); }
module.exports = {parseArgs, assertResult, testHook, copyDiagnostics, verify, main};
