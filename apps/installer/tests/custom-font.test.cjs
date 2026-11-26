const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const font = require('../installer/custom-font.cjs');

// A WOFF2 file with only its header and table directory. The importer reads just the directory.
function woff2(entries) {
  const directory = Buffer.concat(entries);
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 'latin1');
  header.write('OTTO', 4, 'latin1');
  header.writeUInt32BE(48 + directory.length, 8);
  header.writeUInt16BE(entries.length, 12);
  return Buffer.concat([header, directory]);
}

test('WOFF2 fonts are variable when their table directory lists fvar', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zennia-woff2-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const read = async (name, entries) => {
    const file = path.join(root, name);
    await fs.writeFile(file, woff2(entries));
    return (await font.readFont(file)).variable;
  };
  // Flag index 47 is fvar. glyf (index 10) is transformed at version 0 and hmtx (index 3) at version 1,
  // so both carry a transformLength that the parser must skip to reach the entries after them.
  const glyf = Buffer.from([0x0a, 0x04, 0x02]);
  const hmtx = Buffer.from([0x43, 0x04, 0x02]);
  const fvarIndex = Buffer.from([0x2f, 0x04]);
  const fvarExplicit = Buffer.from([0x3f, ...Buffer.from('fvar', 'latin1'), 0x04]);
  const gvarExplicit = Buffer.from([0x3f, ...Buffer.from('gvar', 'latin1'), 0x04]);
  const head = Buffer.from([0x01, 0x36]);
  assert.equal(await read('variable-index.woff2', [glyf, hmtx, fvarIndex]), true);
  assert.equal(await read('variable-explicit.woff2', [glyf, hmtx, fvarExplicit]), true);
  assert.equal(await read('static.woff2', [head, glyf, gvarExplicit]), false);
  assert.equal(await read('static-known.woff2', [head, glyf]), false);
});
