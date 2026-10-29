const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {parseArgs, assertResult, copyDiagnostics, testHook} = require('./runtime-runner.cjs');

test('runtime command accepts package-manager separator and opt-in pointer tests', () => {
  assert.deepEqual(parseArgs(['--', 'Zen App', '--pointer']), {source: path.resolve('Zen App'), pointer: true});
  assert.equal(parseArgs(['Zen App']).pointer, false);
  for (const args of [[], ['--unknown'], ['Zen', 'Profile'], ['--pointer']])
    assert.throws(() => parseArgs(args), /Usage/);
});
test('browser checks fail closed on empty results, failed assertions and uncaught exceptions', () => {
  assert.doesNotThrow(() => assertResult({checks: [{label: 'startup', pass: true}], errors: []}));
  for (const result of [null, {}, {checks: [], errors: []}, {checks: [{label: 'startup', pass: false}], errors: []},
    {checks: [{label: 'startup', pass: true}], errors: ['native exception']}, {checks: [{label: 'missing status'}], errors: []}])
    assert.throws(() => assertResult(result));
});
test('failure diagnostics copy only known test outputs, never profile databases or preferences', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-diagnostics-'));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const profile = path.join(folder, 'profile'), output = path.join(folder, 'diagnostics');
  await fs.mkdir(profile); await fs.mkdir(output);
  for (const name of ['verification.json', 'verified.png', 'runtime-log.txt', 'pointer-results.json', 'prefs.js', 'cookies.sqlite', 'logins.json'])
    await fs.writeFile(path.join(profile, name), name);
  await copyDiagnostics(profile, output);
  assert.deepEqual((await fs.readdir(output)).sort(), ['browser.png', 'pointer-results.json', 'runtime-log.txt', 'verification.json']);
});
test('watchdog requests graceful shutdown and verification attaches only to browser windows', () => {
  let callback, duration, observer, quit, loaded = 0;
  const timer = {initWithCallback(fn, ms) { callback = fn; duration = ms; }};
  const Services = {
    startup: {quit(flag) { quit = flag; }}, appinfo: {version: '1.24b'},
    dirsvc: {get() { throw Error('logger unavailable in fixture'); }},
    console: {registerListener() {}}, obs: {addObserver(value) { observer = value; }},
    scriptloader: {loadSubScript() { loaded++; }},
  };
  vm.runInNewContext(testHook(150000), {Services, Cc: {'@mozilla.org/timer;1': {createInstance: () => timer}},
    Ci: {nsITimer: {TYPE_ONE_SHOT: 0}, nsIAppStartup: {eAttemptQuit: 1}}});
  assert.equal(duration, 150000); callback(); assert.equal(quit, 1);
  observer.observe({document: {documentElement: {getAttribute: () => 'Places:Organizer'}}});
  assert.equal(loaded, 0);
  observer.observe({document: {documentElement: {getAttribute: () => 'navigator:browser'}}});
  assert.equal(loaded, 1);
});
for (const pointer of [false, true]) test(`failed startup preserves results and a screenshot, pointer=${pointer}`, async () => {
  const writes = new Map(); let quit = false;
  const canvas = {getContext: () => ({drawImage() {}}), toBlob: callback => callback({arrayBuffer: async () => new Uint8Array([1, 2]).buffer})};
  const window = {setTimeout(fn) { fn(); }, browsingContext: {currentWindowGlobal: {drawSnapshot: async () => ({close() {}})}}};
  const script = await fs.readFile(path.join(__dirname, 'verify.uc.js'), 'utf8');
  await vm.runInNewContext(script, {
    window, document: {createElementNS: () => canvas}, innerWidth: 1200, innerHeight: 800,
    DOMRect: class {}, Uint8Array,
    PathUtils: {profileDir: '/disposable/profile', join: path.posix.join},
    IOUtils: {write: async (file, bytes) => writes.set(file, bytes), writeJSON: async (file, value) => writes.set(file, value)},
    Services: {prefs: {getBoolPref: () => pointer}, startup: {quit() { quit = true; }}},
    Ci: {nsIAppStartup: {eAttemptQuit: 1}},
  });
  const result = writes.get('/disposable/profile/verification.json');
  assert.equal(result.checks[0].pass, false);
  assert.match(result.errors[0], /ZenArc did not initialize/);
  assert(writes.has('/disposable/profile/verified.png'));
  assert.equal(quit, !pointer);
});
