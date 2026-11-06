// Pure release selection, shared with the updater's regression tests.
export const REPO = 'SpyC0der77/arc-ui-for-zen';
export function newer(a, b) {
  const parse = v => /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] > +y[i];
  if (!x[4] || !y[4]) return !x[4] && !!y[4];
  const left = x[4].split('.'), right = y[4].split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    if (left[i] === undefined || right[i] === undefined) return right[i] === undefined;
    const xn = /^\d+$/.test(left[i]), yn = /^\d+$/.test(right[i]);
    if (xn !== yn) return !xn;
    return xn ? +left[i] > +right[i] : left[i] > right[i];
  }
  return false;
}
export function assetName(version, os, arch) {
  return `Arc-UI-Zen-${version.replace(/^v/, '')}-Update.json`;
}

export function releaseTrack(value, current) {
  return ['stable', 'beta'].includes(value) ? value : current.includes('-') ? 'beta' : 'stable';
}
export function selectRelease(releases, current, os, arch, track = releaseTrack('', current)) {
  return releases.filter(r => !r.draft && (track === 'beta' || (!r.prerelease && !r.tag_name?.includes('-'))) && newer(r.tag_name, current))
    .sort((a, b) => newer(a.tag_name, b.tag_name) ? -1 : newer(b.tag_name, a.tag_name) ? 1 : 0)
    .map(r => ({ ...r, asset: r.assets?.find(a => a.name === assetName(r.tag_name)), checksum: r.assets?.find(a => a.name === 'SHA256SUMS.txt') }))
    .find(r => r.asset && r.checksum);
}
export function trustedAsset(url) {
  return typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/releases/download/`);
}
