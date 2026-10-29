'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { version } = require('../package.json');
const { VERSION, SUPPORTED } = require('../installer/engine.cjs');

function validate(env = process.env) {
  if (env.GITHUB_REF_TYPE !== 'tag') throw new Error('Run Create release against an existing version tag, not a branch.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Expected a semantic installer version.');
  if (env.GITHUB_REF_NAME !== `v${version}`) throw new Error(`Release tag must be v${version}, matching package.json.`);
  if (VERSION !== version) throw new Error('installer/engine.cjs VERSION must match package.json.');
}

function prepare(directory = 'release', notesFile = 'release-notes.md') {
  const names = fs.readdirSync(directory).filter(name => /\.(exe|dmg|zip|AppImage)$/.test(name)).sort();
  for (const platform of ['Windows.exe', 'macOS-.*\\.dmg', 'macOS-.*\\.zip', 'Linux-.*\\.AppImage']) {
    if (!names.some(name => new RegExp(`^Arc-UI-Zen-${version.replaceAll('.', '\\.')}\-${platform}$`).test(name))) {
      throw new Error(`Missing release asset for ${platform}`);
    }
  }
  const checksums = names.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')}  ${name}\n`).join('');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checksums);
  fs.writeFileSync(notesFile, `## Supported versions

- Zen Browser **${SUPPORTED}** only. Other versions are rejected by the installer.
- Installer **${version}**.
- Windows portable executable, macOS DMG/ZIP, and Linux AppImage are attached below. Architecture is included in macOS/Linux filenames.
- Builds are unsigned. macOS and Linux installation paths have automated filesystem coverage; browser runtime and distribution signing have not been validated on those platforms.

## Installation and updates

Download the file for your operating system. Zen must already be installed in a user-writable application folder. Immutable Flatpak/Snap/AppImage browser installations are not supported directly.

Close Zen before installing. To update an existing theme, remove it with the installer first, then install this version into the same application and profile. Use **Open Zen** in the installer afterward to refresh startup caches. Keep your profile and browser data.

## Checksums

SHA256SUMS.txt contains SHA-256 hashes for all attached installers and archives. On Linux, run \`sha256sum -c SHA256SUMS.txt\` with the downloaded files in the same folder. On Windows, compare \`Get-FileHash <file> -Algorithm SHA256\`; on macOS, use \`shasum -a 256 <file>\`.

## Changes since the previous release

`);
}

if (require.main === module) {
  try {
    validate();
    if (process.argv[2] === 'prepare') prepare();
    else if (process.argv[2] !== 'validate') throw new Error('Usage: node scripts/release.cjs <validate|prepare>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validate, prepare };
