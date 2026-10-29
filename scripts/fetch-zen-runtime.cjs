const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
const { SUPPORTED_VERSIONS, parseIni } = require('../installer/engine.cjs');
const builds = require('./zen-runtime-builds.json');

function validateManifest(entries = builds) {
  if (!Array.isArray(entries) || entries.length !== SUPPORTED_VERSIONS.length ||
      new Set(entries.map(entry => entry.version)).size !== entries.length ||
      SUPPORTED_VERSIONS.some(version => !entries.some(entry => entry.version === version))) {
    throw new Error('Runtime manifest must match engine.SUPPORTED_VERSIONS exactly.');
  }
  for (const entry of entries) {
    if (entry.url !== `https://github.com/zen-browser/desktop/releases/download/${entry.version}/zen.installer.exe` ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid pinned runtime: ${entry.version}`);
  }
  return entries;
}
function selectBuild(version, entries = builds) {
  validateManifest(entries);
  const entry = entries.find(entry => entry.version === version);
  if (!entry) throw new Error(`Unsupported Zen version: ${version}`);
  return entry;
}
async function verifyChecksum(file, expected) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error(`SHA256 mismatch: ${file}`);
}
async function validateApplication(core, version) {
  const ini = parseIni(await fs.readFile(path.join(core, 'application.ini'), 'utf8'));
  if (ini.App?.Version !== version) throw new Error(`Zen version mismatch: requested ${version}, found ${ini.App?.Version}`);
  await fs.access(path.join(core, 'zen.exe'));
}
async function assertNoLinks(folder) {
  for (let current = path.resolve(folder);; current = path.dirname(current)) {
    const stat = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat?.isSymbolicLink()) throw new Error(`Refusing linked runtime directory: ${current}`);
    if (path.dirname(current) === current) break;
  }
}
async function download(entry, destination) {
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }));
  await verifyChecksum(destination, entry.sha256);
}
async function fetchRuntime(version) {
  const entry = selectBuild(version);
  if (process.platform !== 'win32') throw new Error('Runtime extraction requires Windows and 7z.');
  const folder = path.resolve(__dirname, '..', 'artifacts', 'zen-builds', version);
  await assertNoLinks(folder);
  await fs.mkdir(folder, { recursive: true });
  const installer = path.join(folder, 'zen.installer.exe');
  try { await verifyChecksum(installer, entry.sha256); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = path.join(folder, `.download-${crypto.randomUUID()}`);
    try { await download(entry, temporary); await fs.rename(temporary, installer); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  const core = path.join(folder, 'core');
  // Never replace a previous extraction: it may be in use or locally modified.
  try { await fs.lstat(core); throw new Error(`Runtime destination already exists; refusing to overwrite: ${core}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await fs.mkdtemp(path.join(folder, '.extract-'));
  try {
    await run('7z', ['x', installer, `-o${temporary}`, '-y'], { timeout: 180000, windowsHide: true });
    await validateApplication(path.join(temporary, 'core'), version);
    await fs.rename(path.join(temporary, 'core'), core);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return core;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  if (args.length !== 1) {
    console.error('Usage: node scripts/fetch-zen-runtime.cjs <version> | --matrix');
    process.exitCode = 1;
  } else if (args[0] === '--matrix') {
    try { console.log(JSON.stringify({ version: validateManifest().map(entry => entry.version) })); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  } else fetchRuntime(args[0]).then(core => console.log(core)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validateManifest, selectBuild, verifyChecksum, validateApplication };
