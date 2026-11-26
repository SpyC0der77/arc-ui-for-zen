import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Everything here is read from the rest of the monorepo at build time, so the
// site always describes the installer that ships from the same commit.
const repo = path.join(process.cwd(), '..', '..');
const installer = path.join(repo, 'apps', 'installer');

export const GITHUB = 'https://github.com/SpyC0der77/zennia';
export const DOWNLOAD = `${GITHUB}/releases`;

export type ZenVersion = {
  version: string;
  library: 'native' | 'menu';
};

function compareVersions(a: string, b: string) {
  const parts = (v: string) => v.replace(/b$/, '').split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function zenVersions(): ZenVersion[] {
  const folder = path.join(installer, 'payload', 'zen-versions');
  return readdirSync(folder)
    .filter(name => name.endsWith('.json') && name !== 'base.json')
    .map(name => {
      const data = JSON.parse(readFileSync(path.join(folder, name), 'utf8'));
      const features = data.features ?? {};
      return {
        version: data.version,
        library: features.library === 'menu' ? 'menu' : 'native',
      } satisfies ZenVersion;
    })
    .sort((a, b) => compareVersions(a.version, b.version));
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

