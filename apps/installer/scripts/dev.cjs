// Development loop for the reusable development Zen in zen-instances/dev-zen/<version>/.
// Run from the repository root as `pnpm dev <command>`.
//
//   status                  instance, process, Marionette, and whether the installed theme matches the source
//   reload [--force]        close the dev Zen, reinstall the theme if the payload changed, relaunch in the background
//   start | stop            launch in the background (with Marionette) | quit gracefully
//   eval <js | file.js>     run chrome-context JavaScript in the dev Zen and print the result as JSON
//   shot <name> [--size 1200x860] [--setup <js | file.js>] [--wait 400] [--native]
//                           screenshot to artifacts/shots/<name>.png; --native (Windows) also captures open menus
//   errors                  console errors from Zennia files since the dev Zen started
//
// --version <folder> picks an instance when there is more than one.
// Only apps under zen-instances/dev-zen/ are ever closed, changed, or launched. Your
// personal Zen may stay open. Every installer receipt and edited-file check still runs.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const engine = require('../installer/engine.cjs');
const versions = require('../installer/versions.cjs');
const font = require('../installer/custom-font.cjs');
const devZen = require('./dev-zen.cjs');
const { Marionette } = require('./marionette.cjs');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PAYLOAD = path.join(__dirname, '..', 'payload');
const SHOTS = path.join(REPO, 'artifacts', 'shots');
const WINDOW_HELPER = path.join(__dirname, 'dev-window.py');
const PYTHON = process.env.PYTHON || 'python';
const win = process.platform === 'win32';
const same = (a, b) => win ? a.toLowerCase() === b.toLowerCase() : a === b;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rel = file => path.relative(REPO, file) || '.';

function pick(version) {
  const all = devZen.instances();
  if (!all.length) throw new Error(`No development instance under ${rel(devZen.ROOT)}. See AGENTS.md.`);
  const found = version ? all.filter(i => i.folder === version) : all;
  if (found.length !== 1)
    throw new Error(version ? `No development instance named ${version}. Found: ${all.map(i => i.folder).join(', ')}`
      : `Several development instances exist; pass --version (${all.map(i => i.folder).join(', ')}).`);
  const instance = found[0];
  const session = path.join(devZen.ROOT, instance.folder, 'session.json');
  const port = fs.existsSync(session) ? JSON.parse(fs.readFileSync(session, 'utf8')).port || 2828 : 2828;
  return { ...instance, exe: engine.layout(instance.app).exe, session, port };
}

// Process ids of this development app only; any other Zen is ignored.
async function pids(instance) {
  if (win) {
    const exe = instance.exe.replace(/'/g, "''");
    const { stdout } = await run('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='zen.exe'" | Where-Object { $_.ExecutablePath -eq '${exe}' } | ForEach-Object { $_.ProcessId }`],
      { windowsHide: true });
    return stdout.split(/\s+/).filter(Boolean).map(Number);
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,command=']);
  return stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter(m => m && m[2].startsWith(instance.exe)).map(m => Number(m[1]));
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Connects and confirms Marionette belongs to this instance's profile, not another Zen.
async function connect(instance, timeout = 30000) {
  const client = await Marionette.connect(instance.port, { timeout });
  const profile = await client.execute("return Services.dirsvc.get('ProfD', Ci.nsIFile).path");
  if (!same(path.resolve(profile), path.resolve(instance.profile))) {
    await client.close();
    throw new Error(`Marionette port ${instance.port} belongs to another Zen (profile ${profile}). Close that session first.`);
  }
  return client;
}

// Compares the installed theme with the source payload, file by file.
async function drift(instance, payload = PAYLOAD) {
  const receiptFile = engine.receiptFile(instance.profile);
  if (!fs.existsSync(receiptFile)) return { installed: null, current: false, changed: [], reason: 'not installed' };
  const receipt = JSON.parse(await fsp.readFile(receiptFile, 'utf8'));
  const { resources } = engine.layout(instance.app);
  const root = path.join(instance.profile, 'chrome', engine.NAMES.root);
  const key = file => win ? path.resolve(file).toLowerCase() : path.resolve(file);
  const installed = new Map(receipt.files.map(file => [key(file.path), file.installedHash]));
  const expected = new Set();
  const changed = [];
  const walk = async (folder, prefix = '') => {
    for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) { await walk(path.join(folder, entry.name), name + '/'); continue; }
      const target = name === 'zennia.cfg' ? path.join(resources, name)
        : name === 'zennia-autoconfig.js' ? path.join(resources, 'defaults', 'pref', name) : path.join(root, name);
      expected.add(key(target));
      if (installed.get(key(target)) !== engine.digest(await fsp.readFile(path.join(folder, entry.name)))) changed.push(name);
    }
  };
  await walk(payload);
  const fontFiles = [font.STYLES, font.FACE, font.FAMILY].map(file => key(path.join(root, file)));
  const ownsFont = file => fontFiles.some(f => file === f || file.startsWith(f + path.sep));
  const removed = [...installed.keys()].filter(file => file.startsWith(key(root) + path.sep) && !expected.has(file) && !ownsFont(file));
  const settingsChanged = JSON.stringify(receipt.settings) !== JSON.stringify(versions.settings(instance.version, process.platform, payload));
  const versionChanged = receipt.version !== engine.VERSION;
  const current = !changed.length && !removed.length && !settingsChanged && !versionChanged;
  const reason = [changed.length && `${changed.length} changed`, removed.length && `${removed.length} removed`,
    settingsChanged && 'managed prefs changed', versionChanged && `installer ${receipt.version} → ${engine.VERSION}`].filter(Boolean).join(', ');
  return { installed: receipt.version, current, changed, removed: removed.length, reason };
}

async function stop(instance) {
  const running = await pids(instance);
  if (!running.length) return false;
  let asked = false;
  try {
    const client = await connect(instance, 2000);
    // Quit on the next tick so the reply arrives before the connection drops.
    await client.execute('setTimeout(() => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit), 0); return true');
    await client.close();
    asked = true;
  } catch (error) {
    console.log(`  Marionette quit unavailable (${error.message.split('\n')[0]}); closing the window instead.`);
  }
  const exited = async ms => { for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (!running.some(alive)) return true; return false; };
  if (asked && await exited(30000)) return true;
  if (win) {
    // Graceful fallback, limited to this app's processes. Never force-kill Zen.
    await run('powershell', ['-NoProfile', '-Command',
      `Get-Process -Id ${running.join(',')} -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | ForEach-Object { $_.CloseMainWindow() } | Out-Null`], { windowsHide: true }).catch(() => {});
    if (await exited(30000)) return true;
  }
  throw new Error(`Dev Zen (pid ${running.join(', ')}) did not exit. It was not force-killed; close it and retry.`);
}

async function zenniaErrors(client) {
  const errors = await client.execute(`
    const quiet = Ci.nsIScriptError.warningFlag | Ci.nsIScriptError.infoFlag;
    return Services.console.getMessageArray()
      .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & quiet) && /zennia/i.test(m.sourceName + ' ' + m.errorMessage))
      .map(m => ({ message: m.errorMessage, source: m.sourceName.replace(/^.*\\/chrome\\/zennia\\//, ''), line: m.lineNumber }));`);
  // The same failure often repeats once per window or page; report it once with a count.
  const grouped = new Map();
  for (const error of errors) {
    const key = `${error.message}\n${error.source}:${error.line}`;
    grouped.set(key, { ...error, count: (grouped.get(key)?.count || 0) + 1 });
  }
  return [...grouped.values()];
}

async function start(instance) {
  if ((await pids(instance)).length) {
    const client = await connect(instance, 5000).catch(error => {
      throw new Error(`Dev Zen is running without a usable Marionette (${error.message}). Run pnpm dev stop, then retry.`);
    });
    return { client, launched: false };
  }
  // Something else may already hold the port, such as a disposable chrome-session.
  const other = await Marionette.connect(instance.port, { timeout: 300 }).catch(() => null);
  if (other) {
    const profile = await other.execute("return Services.dirsvc.get('ProfD', Ci.nsIFile).path").catch(() => '?');
    await other.close();
    throw new Error(`Marionette port ${instance.port} is held by another Zen (profile ${profile}). Close it first.`);
  }
  devZen.disableUpdates(instance.app);
  if (win) {
    // Starts minimized and hands focus back; it keeps watching focus for a few seconds on its own.
    spawn(PYTHON, [WINDOW_HELPER, 'launch', instance.exe, instance.profile], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    spawn(instance.exe, ['-no-remote', '-purgecaches', '--marionette', '-profile', instance.profile, 'about:blank'], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', MOZ_DISABLE_AUTO_SAFE_MODE: '1' },
    }).unref();
  }
  const client = await connect(instance, 60000);
  await fsp.writeFile(instance.session, JSON.stringify({ app: instance.app, profile: instance.profile, port: instance.port }, null, 2) + '\n');
  return { client, launched: true };
}

// Waits for the browser window and Zennia to finish starting, then reports problems.
async function ready(client, instance, launched) {
  let state;
  for (const end = Date.now() + 20000; Date.now() < end; await sleep(250)) {
    state = await client.execute("return { loaded: document.readyState === 'complete', zennia: !!window.Zennia, pid: Services.appinfo.processID }").catch(() => null);
    if (state?.loaded && state.zennia) break;
  }
  if (launched && win && state?.pid) await run(PYTHON, [WINDOW_HELPER, 'settle', String(state.pid)], { windowsHide: true }).catch(() => {});
  const errors = await zenniaErrors(client).catch(() => []);
  console.log(`  Zen ${instance.version}, pid ${state?.pid ?? '?'}, Marionette :${instance.port}, Zennia ${state?.zennia ? 'loaded' : 'NOT LOADED'}`);
  for (const e of errors.slice(0, 10)) console.log(`  error${e.count > 1 ? ` ×${e.count}` : ''}: ${e.message}${e.source ? ` (${e.source}:${e.line})` : ''}`);
  if (errors.length > 10) console.log(`  ...${errors.length - 10} more; run pnpm dev errors`);
  if (!state?.zennia) process.exitCode = 1;
}

async function reload(instance, { force }) {
  const t0 = Date.now();
  const step = label => console.log(`${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const state = await drift(instance);
  const running = (await pids(instance)).length > 0;
  if (state.current && !force && running) {
    console.log(`Dev Zen ${instance.folder} already runs the current payload. Use --force to reinstall anyway.`);
    const client = await connect(instance);
    await ready(client, instance, false);
    return client.close();
  }
  if (running) { await stop(instance); step('Closed dev Zen'); }
  if (force || !state.current) {
    // Same app and profile: the installer removes the previous theme with every
    // receipt and edited-file check, keeps the chosen font, then installs.
    const checkClosed = async () => { if ((await pids(instance)).length) throw new Error('Dev Zen is still running.'); };
    await engine.install(instance.app, instance.profile, { checkClosed });
    devZen.disableUpdates(instance.app);
    step(`Reinstalled Zennia ${engine.VERSION}${state.reason ? ` (${state.reason})` : ''}`);
  }
  const { client, launched } = await start(instance);
  await ready(client, instance, launched);
  await client.close();
  step('Relaunched in the background');
}

const readScript = value => {
  if (!value) throw new Error('Pass JavaScript or a .js file.');
  const file = path.resolve(process.env.INIT_CWD || process.cwd(), value);
  return /\.m?js$/i.test(value) && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : value;
};

async function shot(instance, name, { size, setup, wait = '400', native }) {
  if (!name) throw new Error('Pass a name for the screenshot.');
  const out = /[\\/]|\.png$/i.test(name) ? path.resolve(process.env.INIT_CWD || process.cwd(), name.endsWith('.png') ? name : name + '.png')
    : path.join(SHOTS, name + '.png');
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const { client, launched } = await start(instance);
  if (launched) await ready(client, instance, true);
  const pid = await client.execute('return Services.appinfo.processID');
  let guard;
  try {
    if (win) {
      // Menus are topmost Gecko windows; keep them, and any focus they take, behind your windows.
      guard = spawn(PYTHON, [WINDOW_HELPER, 'guard', String(pid)], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
      await new Promise((resolve, reject) => { guard.stdout.once('data', resolve); guard.once('error', reject); guard.once('exit', resolve); });
    }
    if (size) {
      const [w, h] = size.split('x').map(Number);
      await client.execute(`window.resizeTo(${w}, ${h})`);
      await sleep(500);
    }
    if (setup) await client.execute(readScript(setup));
    // Let animations settle and the compositor paint before capturing.
    await sleep(Number(wait));
    if (native) {
      if (!win) throw new Error('--native capture is Windows-only; omit it to use Marionette.');
      await run(PYTHON, [WINDOW_HELPER, 'capture', String(pid), out], { windowsHide: true });
    } else {
      await fsp.writeFile(out, await client.screenshot());
    }
    console.log(rel(out));
  } finally {
    guard?.stdin.end();
    await client.close();
  }
}

async function status(instance) {
  const running = await pids(instance);
  const state = await drift(instance);
  console.log(`Dev Zen ${instance.folder} (Zen ${instance.version}) at ${rel(path.dirname(instance.app))}`);
  if (instance.folder !== instance.version) console.log(`  WARNING: folder ${instance.folder} holds Zen ${instance.version}; see AGENTS.md.`);
  if (running.length) {
    const client = await connect(instance, 2000).catch(error => { console.log(`  running (pid ${running[0]}), Marionette unavailable: ${error.message}`); return null; });
    if (client) { await ready(client, instance, false); await client.close(); }
  } else console.log('  not running');
  if (!state.installed) console.log('  Zennia is not installed in this profile.');
  else if (state.current) console.log(`  Zennia ${state.installed} installed and matches the source payload.`);
  else {
    console.log(`  Zennia ${state.installed} installed; source differs: ${state.reason}. Run pnpm dev reload.`);
    for (const file of state.changed.slice(0, 8)) console.log(`    ${file}`);
    if (state.changed.length > 8) console.log(`    ...${state.changed.length - 8} more`);
  }
  const leftovers = fs.existsSync(path.dirname(devZen.ROOT)) ? fs.readdirSync(path.dirname(devZen.ROOT)).filter(name => /^(chrome-session|runtime|toggle-profile|landing-profile)-/.test(name)) : [];
  if (leftovers.length) console.log(`  ${leftovers.length} disposable test folders remain in zen-instances/ (chrome-session-*, runtime-*, ...).`);
}

function parse(argv) {
  const args = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=');
      const flag = ['force', 'native'].includes(name);
      options[name] = flag ? true : inline ?? argv[++i];
    } else args.push(arg);
  }
  return { command: args[0], args: args.slice(1), options };
}

async function main() {
  const { command, args, options } = parse(process.argv.slice(2));
  if (!command || command === 'help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n'));
    return;
  }
  const instance = pick(options.version);
  if (command === 'status') return status(instance);
  if (command === 'reload') return reload(instance, options);
  if (command === 'stop') return console.log(await stop(instance) ? 'Dev Zen closed.' : 'Dev Zen is not running.');
  if (command === 'start') { const { client, launched } = await start(instance); await ready(client, instance, launched); return client.close(); }
  if (command === 'shot') return shot(instance, args[0], options);
  if (command === 'eval' || command === 'errors') {
    const { client, launched } = await start(instance);
    if (launched) await ready(client, instance, true);
    try {
      const result = command === 'errors' ? await zenniaErrors(client) : await client.execute(readScript(args.join(' ')));
      console.log(JSON.stringify(result, null, 2) ?? 'undefined');
    } finally { await client.close(); }
    return;
  }
  throw new Error(`Unknown command ${command}. Run pnpm dev help.`);
}

module.exports = { drift, parse, pick };

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
