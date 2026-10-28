const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

function filesIn(root) {
  return fs.readdirSync(root, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function verifyPackage(archive, sourceRoot = path.resolve(__dirname, '..')) {
  const entries = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  const forbidden = entries.filter(file => /^(dev|artifacts|tests|scripts|\.github|\.git|\.reference)(\/|$)/.test(file));
  assert.deepEqual(forbidden, [], 'Development references, tests, and tooling must stay out of the installer');
  const expected = ['package.json', ...['payload', 'installer'].flatMap(dir =>
    filesIn(path.join(sourceRoot, dir)).map(file => path.relative(sourceRoot, file).replaceAll('\\', '/')))];
  for (const file of expected) {
    assert(entries.includes(file), `Missing packaged runtime file: ${file}`);
    if (file === 'package.json') {
      const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, file), 'utf8'));
      const packaged = JSON.parse(asar.extractFile(archive, file).toString('utf8'));
      // electron-builder strips development metadata, but must retain runtime identity.
      for (const field of ['name', 'version', 'main']) {
        assert.equal(packaged[field], source[field], `Packaged manifest differs: ${field}`);
      }
      continue;
    }
    const digest = data => crypto.createHash('sha256').update(data).digest('hex');
    assert.equal(digest(asar.extractFile(archive, path.normalize(file))), digest(fs.readFileSync(path.join(sourceRoot, file))),
      `Packaged file differs from the source: ${file}`);
  }
  const allowed = new Set(expected);
  for (const file of expected) {
    const parts = file.split('/');
    for (let length = 1; length < parts.length; length++) allowed.add(parts.slice(0, length).join('/'));
  }
  assert.deepEqual(entries.filter(file => !allowed.has(file)), [], 'Unexpected packaged files or directories');
  return expected.length;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(process.argv[2] || path.join(root, 'release'));
  const archives = fs.existsSync(output) ? filesIn(output).filter(file => path.basename(file) === 'app.asar') : [];
  assert(archives.length, 'No built app.asar found. Build the installer first.');
  for (const archive of archives) {
    console.log(`Verified ${verifyPackage(archive, root)} runtime files in ${path.relative(root, archive)}; development files excluded.`);
  }
}

module.exports = {verifyPackage};
