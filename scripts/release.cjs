'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
const { VERSION, SUPPORTED } = require('../installer/engine.cjs');

function validate(env = process.env) {
  if (env.GITHUB_REF_TYPE !== 'tag') throw new Error('Run Create release against an existing version tag, not a branch.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Expected a semantic installer version.');
  if (env.GITHUB_REF_NAME !== `v${version}`) throw new Error(`Release tag must be v${version}, matching package.json.`);
  if (VERSION !== version) throw new Error('installer/engine.cjs VERSION must match package.json.');
}

function releaseChanges(repo, tag, request = args => JSON.parse(execFileSync('gh', args, {encoding:'utf8'}))) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Expected GH_REPO as owner/repository.');
  const generated = request(['api', `repos/${repo}/releases/generate-notes`, '-f', `tag_name=${tag}`]);
  const body = generated.body || '';
  const comparison = body.match(/\/compare\/([^\s]+)\.\.\.([^\s]+)/);
  const endpoint = comparison
    ? `repos/${repo}/compare/${comparison[1]}...${encodeURIComponent(tag)}`
    : `repos/${repo}/commits?sha=${encodeURIComponent(tag)}`;
  const commits = [];
  for (let page = 1; ; page++) {
    const data = request(['api', `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`]);
    const batch = comparison ? data.commits : data;
    if (!Array.isArray(batch)) throw new Error('GitHub returned no commit list.');
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  const bullets = commits.map(commit => {
    const subject = commit.commit.message.split(/\r?\n/, 1)[0].replace(/[\\`*_[\]<>]/g, '\\$&');
    return `- ${subject} ([${commit.sha.slice(0, 7)}](https://github.com/${repo}/commit/${commit.sha}))`;
  });
  return `### Commits\n\n${bullets.join('\n') || 'No new commits.'}\n\n${body}`;
}

function prepare(directory = 'release', notesFile = 'release-notes.md', changes = '') {
  const names = fs.readdirSync(directory).filter(name => /\.(exe|dmg|zip|AppImage)$/.test(name)).sort();
  for (const platform of ['Windows.exe', 'macOS-.*\\.dmg', 'macOS-.*\\.zip', 'Linux-.*\\.AppImage']) {
    if (!names.some(name => new RegExp(`^Arc-UI-Zen-${version.replaceAll('.', '\\.')}\-${platform}$`).test(name))) {
      throw new Error(`Missing release asset for ${platform}`);
    }
  }
  const payload = path.join(__dirname, '..', 'payload');
  const files = {};
  function collect(folder, prefix = '') {
    for (const entry of fs.readdirSync(folder, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Update payload contains a symbolic link.');
      const relative = prefix + entry.name;
      if (entry.isDirectory()) collect(path.join(folder, entry.name), relative + '/');
      else files[relative] = fs.readFileSync(path.join(folder, entry.name)).toString('base64');
    }
  }
  collect(payload);
  const updateName = `Arc-UI-Zen-${version}-Update.json`;
  fs.writeFileSync(path.join(directory, updateName), JSON.stringify({format:1, version, supported:require('../installer/engine.cjs').SUPPORTED_VERSIONS, files}));
  names.push(updateName); names.sort();
  const checksums = names.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')}  ${name}\n`).join('');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums);
  fs.writeFileSync(notesFile, `## Supported versions

- Zen Browser **${SUPPORTED}** only. Other versions are rejected by the installer.
- Installer **${version}**.
- Windows portable executable, macOS DMG/ZIP, and Linux AppImage are attached below. Architecture is included in macOS/Linux filenames.
- macOS bundles are ad-hoc signed and signature-verified, but are not Developer ID signed or notarized. Windows and Linux builds are unsigned.
- macOS may require approval in System Settings → Privacy & Security → Open Anyway after the first launch attempt. Do not disable Gatekeeper globally.
- macOS and Linux installation paths have automated filesystem coverage; full hosted browser runtime coverage remains Windows-only.

## Installation and updates

Download the file for your operating system. Zen must already be installed in a user-writable application folder. Immutable Flatpak/Snap/AppImage browser installations are not supported directly.

Existing themes with the in-place updater can download the Update.json bundle from the sidebar and restart Zen to apply it, without opening an installer.

Close Zen before using an installer. To update an older theme, install this version into the same application and profile; the installer removes the previous version and installs the new one automatically. Use **Open Zen** in the installer afterward to refresh startup caches. Keep your profile and browser data.

## Checksums

SHA256SUMS.txt contains SHA-256 hashes for all attached installers and archives. On Linux, run \`sha256sum -c SHA256SUMS.txt\` with the downloaded files in the same folder. On Windows, compare \`Get-FileHash <file> -Algorithm SHA256\`; on macOS, use \`shasum -a 256 <file>\`.

## Changes since the previous release

${changes}
`);
}

if (require.main === module) {
  try {
    validate();
    if (process.argv[2] === 'prepare') prepare('release', 'release-notes.md', releaseChanges(process.env.GH_REPO, process.env.GITHUB_REF_NAME));
    else if (process.argv[2] !== 'validate') throw new Error('Usage: node scripts/release.cjs <validate|prepare>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validate, prepare, releaseChanges };
