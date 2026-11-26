const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const versions = require('../installer/versions.cjs');
const ZenniaZenData = require('../payload/content/shared/zen-data.js');
const { collectPayload } = require('../scripts/zen-surface.cjs');
const { zenFor } = require('./zen.cjs');

test('every supported version resolves from its own file on top of base.json', () => {
  assert.ok(versions.SUPPORTED_VERSIONS.length > 0);
  for (const version of versions.SUPPORTED_VERSIONS) {
    const data = versions.resolve(version);
    assert.equal(data.version, version);
    assert.equal(typeof data.notes, 'string', `${version}.json explains what is different about it`);
    assert.deepEqual(Object.keys(versions.settings(version, 'linux')), Object.keys(versions.base().prefs));
  }
  assert.deepEqual(versions.SUPPORTED_VERSIONS, [...versions.SUPPORTED_VERSIONS].sort(versions.compare));
  assert.deepEqual(['1.24.1b', '1.22.3b', '1.24b', '1.23.4b'].sort(versions.compare), ['1.22.3b', '1.23.4b', '1.24b', '1.24.1b']);
  assert.throws(() => versions.resolve('../base'), /Unsupported Zen version/);
  assert.throws(() => versions.resolve('9.9b'), /Unsupported Zen version/);
});

test('version files merge objects, replace lists and reject malformed data', () => {
  const base = versions.base();
  const entry = { version: '1.24b', runtime: versions.resolve('1.24b').runtime };
  const merged = ZenniaZenData.resolve(base, { ...entry, features: { archive: false }, prefs: { 'zen.urlbar.behavior': 'normal' } });
  assert.equal(merged.features.library, 'native');
  assert.equal(merged.features.archive, false);
  assert.equal(merged.prefs['zen.urlbar.behavior'], 'normal');
  assert.equal(merged.prefs['zen.view.sidebar-expanded'], true);
  for (const [change, message] of [
    [{ version: '1.24' + '/b' }, /version/],
    [{ runtime: { 'windows-x64': { url: 'https://example.com/zen.exe', sha256: 'x' } } }, /runtime/],
    [{ features: { library: 'sidebar' } }, /features.library/],
    [{ renames: { names: { 'zen-library': 'zen-library' } } }, /different value/],
    [{ renames: { members: { animateProgress: 'animate' } } }, /owner.member/],
    [{ unavailable: ['zen-library'] }, /group names by area/],
  ]) assert.throws(() => ZenniaZenData.resolve(base, { ...entry, ...change }), message);
});

test('the payload passes every Zen literal through a version helper', () => {
  const { unwrapped, surface } = collectPayload();
  assert.deepEqual(unwrapped, [], 'Wrap Zen names in zen.name(), zen.pref(), zen.url() or zen.import()');
  // Every name a version lists as unavailable must still be something the payload uses.
  for (const version of versions.SUPPORTED_VERSIONS)
    for (const name of ZenniaZenData.unavailableNames(versions.resolve(version)))
      assert.ok(Object.values(surface).some(map => map.has(name)), `${version}.json lists unused ${name}`);
});

test('renames reach DOM names, preferences, URLs, stylesheets and native members', () => {
  const files = {
    'chrome://zennia-runtime/content/zennia.css': '@import url("chrome://zennia/content/a.css");\n#zen-library-footer { color: red }',
    'chrome://zennia/content/a.css': '[zen-has-hover] .zen-library-footer-x { --zen-border-radius: 1px }',
  };
  const zen = zenFor('1.24b', {
    renames: {
      names: { 'zen-library-footer': 'zen-library-bottom', 'zen-has-hover': 'zen-hovered', '--zen-border-radius': '--zen-radius' },
      globals: { gZenFolders: 'gZenFolderManager' },
      members: { 'gZenFolders.createFolder': 'addFolder', 'zen-library.openProgress': 'progress', 'ZenLiveFoldersManager.getFolder': 'folder' },
      prefs: { 'zen.welcome-screen.seen': 'zen.welcome.seen' },
      urls: { 'resource:///modules/zen/ZenLiveFoldersManager.sys.mjs': 'resource:///modules/zen/LiveFolders.sys.mjs' },
    },
  }, {
    readText: url => files[url],
    importModule: url => ({ ZenLiveFoldersManager: { url, folder: () => 'native' } }),
  });
  assert.equal(zen.name('#zen-library-footer > [zen-has-hover]'), '#zen-library-bottom > [zen-hovered]');
  assert.equal(zen.name('zen-library-footer-extra zen-library'), 'zen-library-footer-extra zen-library');
  assert.equal(zen.pref('zen.welcome-screen.seen'), 'zen.welcome.seen');
  assert.equal(zen.pref('zen.urlbar.behavior'), 'zen.urlbar.behavior');
  assert.equal(zen.member('zen-library', 'openProgress'), 'progress');
  const css = decodeURIComponent(zen.stylesheet('chrome://zennia-runtime/content/zennia.css').replace(/^data:text\/css;charset=utf-8,/, ''));
  assert.equal(css, '[zen-hovered] .zen-library-footer-x { --zen-radius: 1px }\n#zen-library-bottom { color: red }');
  const live = zen.import('resource:///modules/zen/ZenLiveFoldersManager.sys.mjs', 'ZenLiveFoldersManager');
  assert.equal(live.url, 'resource:///modules/zen/LiveFolders.sys.mjs');
  assert.equal(live.getFolder(), 'native');

  const calls = [];
  const window = { gZenFolderManager: { addFolder: (...args) => calls.push(args) }, customElements: { whenDefined: () => new Promise(() => {}) } };
  zen.attach(window);
  window.gZenFolders.createFolder('tabs');
  const original = window.gZenFolders.createFolder;
  window.gZenFolders.createFolder = () => 'patched';
  assert.equal(window.gZenFolderManager.addFolder(), 'patched', 'patches through the base name reach the renamed member');
  window.gZenFolders.createFolder = original;
  assert.deepEqual(calls, [['tabs']]);

  const plain = zenFor('1.24b');
  assert.equal(plain.stylesheet('chrome://zennia-runtime/content/zennia.css'), 'chrome://zennia-runtime/content/zennia.css');
  assert.equal(plain.name('#zen-library-footer'), '#zen-library-footer');
});

test('versions turn off the features their browser cannot support', () => {
  const pick = ({ library, archive, debugMode }) => ({ library, archive, debugMode });
  for (const version of versions.SUPPORTED_VERSIONS) {
    const legacy = /^1\.22(\.\d+)?b$/.test(version) || version === '1.23b';
    const expected = legacy ? { library: 'menu', archive: false, debugMode: false } : { library: 'native', archive: true, debugMode: true };
    assert.deepEqual(pick(versions.resolve(version).features), expected, version);
  }
});

test('the README names the supported range of Zen versions', () => {
  const intro = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8').split('\n').find(line => line.startsWith('Zennia '));
  const [first, last] = intro.match(/\*\*(\S+) to (\S+)\*\*/).slice(1);
  assert.deepEqual([first, last], [versions.SUPPORTED_VERSIONS[0], versions.SUPPORTED_VERSIONS.at(-1)]);
});
