const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateManifest, selectBuild, verifyChecksum, validateApplication } = require('../scripts/fetch-zen-runtime.cjs');
const builds = require('../scripts/zen-runtime-builds.json');
const { SUPPORTED_VERSIONS } = require('../installer/engine.cjs');

test('pinned Windows builds match the supported engine allowlist', () => {
  assert.deepEqual(validateManifest().map(entry => entry.version), [...SUPPORTED_VERSIONS]);
  for (const version of SUPPORTED_VERSIONS) assert.equal(selectBuild(version).version, version);
  for (const version of ['latest', '../1.24b', '1.23b', undefined]) {
    assert.throws(() => selectBuild(version), /Unsupported Zen version/);
  }
});
test('manifest rejects missing, duplicate, unexpected and unpinned builds', () => {
  assert.throws(() => validateManifest(builds.slice(1)), /match/);
  assert.throws(() => validateManifest([builds[0], builds[0], ...builds.slice(2)]), /match/);
  assert.throws(() => validateManifest(builds.map((entry, index) => index ? entry : { ...entry, version: 'latest' })), /match/);
  for (const change of [{ url: 'https://example.com/zen.installer.exe' }, { sha256: '' }]) {
    assert.throws(() => validateManifest(builds.map((entry, index) => index ? entry : { ...entry, ...change })), /Invalid pinned/);
  }
});
test('CLI produces the CI matrix and supports the pnpm argument separator', () => {
  const script = path.join(__dirname, '..', 'scripts', 'fetch-zen-runtime.cjs');
  const matrix = spawnSync(process.execPath, [script, '--matrix'], { encoding: 'utf8' });
  assert.equal(matrix.status, 0, matrix.stderr);
  assert.deepEqual(JSON.parse(matrix.stdout), { version: [...SUPPORTED_VERSIONS] });
  const invalid = spawnSync(process.execPath, [script, '--', '../invalid'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unsupported Zen version: ..\/invalid/);
});
test('checksum verification rejects changed installer bytes', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zen-checksum-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'installer');
  const bytes = Buffer.from('offline installer fixture');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(file, bytes);
  await verifyChecksum(file, hash);
  await fs.appendFile(file, 'tampered');
  await assert.rejects(verifyChecksum(file, hash), /SHA256 mismatch/);
});
test('extracted application must contain the requested App version and executable', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zen-version-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await fs.writeFile(path.join(folder, 'application.ini'), '[App]\r\nVersion=1.24b\r\n');
  await fs.writeFile(path.join(folder, 'zen.exe'), 'fixture');
  await validateApplication(folder, '1.24b');
  await assert.rejects(validateApplication(folder, '1.23.4b'), /version mismatch/);
  await fs.writeFile(path.join(folder, 'application.ini'), '[Other]\nVersion=1.24b\n');
  await assert.rejects(validateApplication(folder, '1.24b'), /version mismatch/);
  await fs.writeFile(path.join(folder, 'application.ini'), '[App]\nVersion=1.24b\n');
  await fs.unlink(path.join(folder, 'zen.exe'));
  await assert.rejects(validateApplication(folder, '1.24b'), /ENOENT/);
});
