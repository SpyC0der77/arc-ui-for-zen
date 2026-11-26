'use strict';
// Finds Zen releases newer than every supported version and prepares an issue
// for each. Used by .github/workflows/zen-releases.yml.
//
//   node scripts/zen-release-watch.cjs find              Writes the releases that need an issue to GITHUB_OUTPUT.
//   node scripts/zen-release-watch.cjs draft <release>   Writes payload/zen-versions/<version>.json from release JSON.
//   node scripts/zen-release-watch.cjs body <release>    Prints the issue body from the check results.
const fs = require('node:fs');
const path = require('node:path');
const versions = require('../installer/versions.cjs');
const { VERSION_PATTERN } = require('../payload/content/shared/zen-data.js');

const ZEN = 'zen-browser/desktop';
const INSTALLER = 'zen.installer.exe';
const title = version => `Support Zen ${version}`;

// Published, stable Zen releases newer than the newest supported version.
function newReleases(releases, supported = versions.SUPPORTED_VERSIONS) {
  const newest = supported.at(-1);
  return releases
    .filter(release => !release.draft && !release.prerelease && VERSION_PATTERN.test(release.tag_name))
    .filter(release => versions.compare(release.tag_name, newest) > 0)
    .map(release => {
      const asset = release.assets?.find(item => item.name === INSTALLER);
      const sha256 = /^sha256:([a-f0-9]{64})$/.exec(asset?.digest || '')?.[1] || '';
      return { version: release.tag_name, page: release.html_url, published: release.published_at, url: asset?.browser_download_url || '', sha256 };
    })
    .sort((a, b) => versions.compare(a.version, b.version));
}

// A starting version file: the newest supported version's file with this
// release's download. Only the parts the surface check cannot judge differ.
function draft(release, payload = path.join(__dirname, '..', 'payload')) {
  const newest = versions.list(payload).filter(version => versions.compare(version, release.version) < 0).at(-1);
  const previous = JSON.parse(fs.readFileSync(path.join(payload, 'zen-versions', newest + '.json'), 'utf8'));
  const { version, notes, runtime, ...rest } = previous;
  return {
    version: release.version,
    notes: `Draft based on ${newest}. Replace with what is different about ${release.version}.`,
    ...rest,
    runtime: { 'windows-x64': { url: release.url, sha256: release.sha256 } },
  };
}

// Did the release work with the draft file alone? 'unchanged' only when the
// surface check and the full browser suite both passed.
function verdict(results) {
  const { check, runtime } = results;
  if (check?.status === undefined || check.status === '') return 'unchecked';
  return check.status === '0' && runtime?.status === '0' ? 'unchanged' : 'changes';
}

// Last lines of a log, without terminal colors, for an issue code block.
function tail(log, lines = 60) {
  const text = (log || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  return text.split(/\r?\n/).slice(-lines).join('\n') || '(no output)';
}

// results: { check: { log, status }, runtime: { log, status }, runUrl }; a status
// is the step's exit code as text, or empty when the step did not run.
function body(release, results = {}) {
  const { check = {}, runtime = {}, runUrl } = results;
  const file = JSON.stringify(draft(release), null, 2);
  const result = verdict(results);
  const lines = [
    `Zen [${release.version}](${release.page}) was released on ${release.published?.slice(0, 10) || 'an unknown date'}. Zennia does not load on it until it has a version file.`,
    '',
  ];
  if (result === 'unchanged') lines.push(`**Works without changes.** With only the draft file below, the surface check and the full browser test suite pass on ${release.version}. Adding the file is enough.`);
  else if (result === 'changes') lines.push(`**Needs changes.** With only the draft file below, ${release.version} fails the checks listed here.`);
  else lines.push(`**Not checked.** The release has no ${INSTALLER} with a SHA-256 digest, so its build was not downloaded. Pin a verified checksum by hand.`);
  if (runUrl) lines.push('', `Logs and browser diagnostics: [workflow run](${runUrl}).`);
  if (result !== 'unchecked') {
    lines.push('', '## Surface check', '');
    if (check.status === '0') lines.push(`Passed: ${release.version} provides every Zen name, global, member, preference and URL Zennia uses.`);
    else lines.push('Record each difference as a rename, an `unavailable` entry or a feature switch:', '', '```', tail(check.log), '```');
    lines.push('', '## Browser test suite', '');
    if (runtime.status === '0') lines.push(`Passed: ${tail(runtime.log, 1).replace(/\s*Diagnostics: .*$/, '')}`);
    else if (runtime.status === undefined || runtime.status === '') lines.push('Not run, because the build could not be downloaded.');
    else lines.push('Failed checks and errors:', '', '```', tail(runtime.log), '```');
  }
  lines.push(
    '',
    `## Draft \`apps/installer/payload/zen-versions/${release.version}.json\``,
    '',
    '```json', file, '```',
    '',
    '## To add support',
    '',
    `1. Add the file above, with notes on what is different about ${release.version}.`,
  );
  if (result !== 'unchanged') lines.push(
    `2. On Windows, in \`apps/installer\`: \`pnpm fetch:zen -- ${release.version}\`, then \`pnpm check:zen -- ${release.version}\` until it passes.`,
    `3. Run \`pnpm test\` and \`pnpm test:runtime -- ../../artifacts/zen-builds/${release.version}/core --pointer\`.`,
    '4. Update the supported range in the README.',
  );
  else lines.push('2. Update the supported range in the README and run `pnpm test`.');
  lines.push('', 'See [apps/installer/dev/ZEN-VERSIONS.md](../blob/main/apps/installer/dev/ZEN-VERSIONS.md). This issue was opened by the daily Zen release check.');
  return lines.join('\n') + '\n';
}

async function github(url, token) {
  const response = await fetch(`https://api.github.com${url}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'zennia-release-watch', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error(`GitHub ${url}: HTTP ${response.status}`);
  return response.json();
}

// Titles of every issue in this repository, open or closed, so a version is reported once.
async function issueTitles(repo, token) {
  const titles = new Set();
  for (let page = 1; page <= 10; page++) {
    const issues = await github(`/repos/${repo}/issues?state=all&per_page=100&page=${page}`, token);
    for (const issue of issues) titles.add(issue.title);
    if (issues.length < 100) break;
  }
  return titles;
}

async function find() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set.');
  const releases = await github(`/repos/${ZEN}/releases?per_page=30`, token);
  const reported = await issueTitles(repo, token);
  const pending = newReleases(releases).filter(release => !reported.has(title(release.version)));
  console.log(pending.length ? `New Zen releases: ${pending.map(release => release.version).join(', ')}` : 'No new Zen releases.');
  const output = `releases=${JSON.stringify(pending)}\ncount=${pending.length}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

module.exports = { newReleases, draft, body, verdict, title };

if (require.main === module) {
  const [command, json] = process.argv.slice(2).filter(arg => arg !== '--');
  const release = json ? JSON.parse(json) : null;
  const run = {
    find,
    draft() {
      if (!VERSION_PATTERN.test(release.version)) throw new Error(`Invalid version: ${release.version}`);
      const file = path.join(__dirname, '..', 'payload', 'zen-versions', release.version + '.json');
      fs.writeFileSync(file, JSON.stringify(draft(release), null, 2) + '\n');
      console.log(file);
    },
    // Step results come from the environment: CHECK_LOG, CHECK_STATUS, RUNTIME_LOG, RUNTIME_STATUS, RUN_URL.
    body() {
      const read = file => file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const env = process.env;
      const results = {
        check: { log: read(env.CHECK_LOG), status: env.CHECK_STATUS },
        runtime: { log: read(env.RUNTIME_LOG), status: env.RUNTIME_STATUS },
        runUrl: env.RUN_URL,
      };
      process.stdout.write(body(release, results));
      if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `verdict=${verdict(results)}\n`);
    },
  }[command];
  if (!run) { console.error('Usage: node scripts/zen-release-watch.cjs find | draft <release json> | body <release json>'); process.exit(1); }
  Promise.resolve(run()).catch(error => { console.error(error.message); process.exitCode = 1; });
}
