import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Everything here is read from the rest of the monorepo at build time, so the
// site always describes the installer that ships from the same commit.
const repo = path.join(process.cwd(), '..', '..');
const installer = path.join(repo, 'apps', 'installer');

// The installer's own reader for payload/zen-versions, so the site sorts and resolves versions the same way.
const installerRequire = createRequire(path.join(installer, 'package.json'));
const versions = installerRequire(path.join(installer, 'installer', 'versions.cjs')) as {
  list(): string[];
  resolve(version: string): { features: { library: string } };
};

export const GITHUB = 'https://github.com/SpyC0der77/zennia';
export const DOWNLOAD = `${GITHUB}/releases`;

export type ZenVersion = {
  version: string;
  library: 'native' | 'menu';
};

/** Supported Zen versions, oldest first, with the library each one uses (resolved on top of base.json). */
export function zenVersions(): ZenVersion[] {
  return versions.list().map(version => ({
    version,
    library: versions.resolve(version).features.library === 'menu' ? 'menu' : 'native',
  }));
}

export function installerVersion(): string {
  return JSON.parse(readFileSync(path.join(installer, 'package.json'), 'utf8')).version;
}

export type Change = { release: string; text: string };

/** Changelog bullets from CHANGES.md, newest release first, markdown removed. */
export function changes(): Change[] {
  const source = readFileSync(path.join(repo, 'CHANGES.md'), 'utf8');
  const result: Change[] = [];
  let release = '';
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) release = heading[1].trim();
    const bullet = line.match(/^-\s+(.+)/);
    if (bullet && release) result.push({ release, text: bullet[1].replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1') });
  }
  return result;
}

