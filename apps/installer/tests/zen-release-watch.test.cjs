const { test } = require('node:test');
const assert = require('node:assert/strict');
const versions = require('../installer/versions.cjs');
const ZenniaZenData = require('../payload/content/shared/zen-data.js');
const { newReleases, draft, body, verdict, title } = require('../scripts/zen-release-watch.cjs');

const sha = 'a'.repeat(64);
const release = (tag, extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/zen-browser/desktop/releases/tag/${tag}`,
  published_at: '2026-11-25T10:00:00Z',
  assets: [{ name: 'zen.installer.exe', digest: `sha256:${sha}`, browser_download_url: `https://github.com/zen-browser/desktop/releases/download/${tag}/zen.installer.exe` }],
  ...extra,
});

test('only stable releases newer than every supported version need an issue', () => {
  const supported = ['1.24b', '1.24.1b'];
  const found = newReleases([
    release('1.25b'), release('1.24.2b'), release('1.24.1b'), release('1.24b'), release('1.23.4b'),
    release('twilight'), release('1.26b', { prerelease: true }), release('1.27b', { draft: true }),
    release('1.24.3b', { assets: [] }),
  ], supported);
  assert.deepEqual(found.map(item => item.version), ['1.24.2b', '1.24.3b', '1.25b']);
  assert.equal(found[0].sha256, sha);
  assert.equal(found[1].sha256, '', 'a release without the installer is still reported, unpinned');
  assert.equal(title('1.25b'), 'Support Zen 1.25b');
});

test('the draft version file is valid and copies the newest supported version', () => {
  const [next] = newReleases([release('99.0b')]);
  const file = draft(next);
  const newest = versions.SUPPORTED_VERSIONS.at(-1);
  assert.equal(file.version, '99.0b');
  assert.match(file.notes, new RegExp(`based on ${newest.replaceAll('.', '\\.')}`));
  assert.deepEqual(file.runtime['windows-x64'], { url: next.url, sha256: sha });
  const resolved = ZenniaZenData.resolve(versions.base(), file);
  assert.deepEqual(resolved.features, versions.resolve(newest).features);
});

test('the issue says whether the release works without changes', () => {
  const [next] = newReleases([release('99.0b')]);
  const pass = '0', fail = '1';
  const unchanged = { check: { status: pass }, runtime: { status: pass, log: 'Runtime diagnostics: x\nPASS Zen 99.0b: 113/113 checks, clean removal.' }, runUrl: 'https://example/run' };
  assert.equal(verdict(unchanged), 'unchanged');
  const text = body(next, unchanged);
  assert.match(text, /\*\*Works without changes\.\*\*/);
  assert.match(text, /Passed: PASS Zen 99\.0b: 113\/113 checks/);
  assert.match(text, /\[workflow run\]\(https:\/\/example\/run\)/);
  assert.match(text, /"version": "99.0b"/);
  assert.doesNotMatch(text, /pnpm fetch:zen/, 'a working release needs only the file');

  const browserFails = { check: { status: pass }, runtime: { status: fail, log: '\x1b[31mFAIL\x1b[0m\nlibrary rail opens' } };
  assert.equal(verdict(browserFails), 'changes');
  assert.match(body(next, browserFails), /\*\*Needs changes\.\*\*[\s\S]*Failed checks and errors:\n\n```\nFAIL\nlibrary rail opens\n```/);

  const surfaceFails = { check: { status: fail, log: 'names zen-library-footer is missing from Zen 99.0b' }, runtime: { status: pass } };
  assert.equal(verdict(surfaceFails), 'changes');
  assert.match(body(next, surfaceFails), /feature switch:[\s\S]*zen-library-footer is missing/);

  assert.equal(verdict({}), 'unchecked');
  assert.match(body({ ...next, sha256: '' }), /\*\*Not checked\.\*\*/);
});
