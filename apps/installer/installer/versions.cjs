'use strict';
// Reads payload/zen-versions: one file per supported Zen version on top of base.json.
const fs = require('node:fs');
const path = require('node:path');
const data = require('../payload/content/shared/zen-data.js');

const DEFAULT_PAYLOAD = path.join(__dirname, '..', 'payload');
const folder = payload => path.join(payload, 'zen-versions');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const compare = (a, b) => {
  const parts = v => v.match(/\d+|[a-z]+/g).map(part => /\d/.test(part) ? Number(part) : part);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    // A missing patch number sorts before any patch: 1.24b < 1.24.1b.
    if (typeof x[i] !== typeof y[i]) return typeof x[i] === 'string' ? -1 : 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
};

function base(payload = DEFAULT_PAYLOAD) {
  return readJSON(path.join(folder(payload), 'base.json'));
}
function list(payload = DEFAULT_PAYLOAD) {
  return fs.readdirSync(folder(payload))
    .filter(name => name.endsWith('.json') && name !== 'base.json')
    .map(name => name.slice(0, -5))
    .sort(compare);
}
function resolve(version, payload = DEFAULT_PAYLOAD) {
  if (typeof version !== 'string' || !data.VERSION_PATTERN.test(version) || !list(payload).includes(version))
    throw new Error(`Unsupported Zen version: ${version}`);
  const entry = readJSON(path.join(folder(payload), version + '.json'));
  if (entry.version !== version) throw new Error(`zen-versions/${version}.json declares version ${entry.version}`);
  return data.resolve(base(payload), entry);
}
const platformKey = platform => platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
function settings(version, platform = process.platform, payload = DEFAULT_PAYLOAD) {
  return data.prefsFor(resolve(version, payload), platformKey(platform));
}

const SUPPORTED_VERSIONS = Object.freeze(list());
module.exports = { SUPPORTED_VERSIONS, VERSION_PATTERN: data.VERSION_PATTERN, base, list, resolve, settings, compare, platformKey };
