const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {verifyPackage} = require('../scripts/verify-package.cjs');

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-package-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const source = path.join(temporary, 'source');
  const archive = path.join(temporary, 'app.asar');
  for (const [file, content] of Object.entries({
    'package.json': '{"name":"fixture"}',
    'installer/main.cjs': 'module.exports = {};',
    'payload/arc.css': ':root { color: black; }',
    'payload/content/debug.sys.mjs': 'export const enabled = false;'
  })) {
    await fs.mkdir(path.dirname(path.join(source, file)), {recursive: true});
    await fs.writeFile(path.join(source, file), content);
  }
  return {source, archive};
}

test('package verification accepts a complete runtime archive', async t => {
  const {source, archive} = await fixture(t);
  await asar.createPackage(source, archive);
  assert.equal(verifyPackage(archive, source), 4);
});

test('package verification rejects development reference images', async t => {
  const {source, archive} = await fixture(t);
  await fs.mkdir(path.join(source, 'dev/references'), {recursive: true});
  await fs.writeFile(path.join(source, 'dev/references/arc.png'), 'reference fixture');
  await asar.createPackage(source, archive);
  assert.throws(() => verifyPackage(archive, source), /Development references/);
});

test('package verification rejects missing runtime modules', async t => {
  const {source, archive} = await fixture(t);
  await asar.createPackage(source, archive);
  await fs.writeFile(path.join(source, 'payload/content/new.sys.mjs'), 'export {};');
  assert.throws(() => verifyPackage(archive, source), /Missing packaged runtime file/);
});

test('package verification rejects stale packaged payloads', async t => {
  const {source, archive} = await fixture(t);
  await asar.createPackage(source, archive);
  await fs.writeFile(path.join(source, 'payload/arc.css'), ':root { color: purple; }');
  assert.throws(() => verifyPackage(archive, source), /Packaged file differs/);
});
