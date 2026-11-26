'use strict';
// Finds every Zen internal the payload relies on and checks it against an
// extracted Zen build. Used by the static test suite and by CI per version.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const versions = require('../installer/versions.cjs');

const PAYLOAD = path.join(__dirname, '..', 'payload');
// DOM ids, classes, attributes, commands and CSS custom properties.
const { NAME_PATTERN: NAME } = require('../payload/content/shared/zen-data.js');
// Zen globals and module exports used directly from JavaScript.
const GLOBAL = /(?<![\w$])g?Zen[A-Z]\w*/g;
const MEMBER = /(?<![\w$])(g?Zen[A-Z]\w*)\.([A-Za-z_$][\w$]*)/g;
// Preference names are always quoted, unlike the zen.* helpers.
const PREF = /(?<=["'`])zen\.[a-z][\w.-]*\w(?=["'`])/g;
const URL = /\b(?:chrome|resource|moz-src):\/\/\/?[^\s"'`)<>]+/g;
// Zennia's own names that happen to match the patterns above.
const OWN = new Set(['zen-versions', 'zenData', 'zenHelpers']);
// Helpers that apply a version's renames to the literal they receive.
const HELPER = /\bzen\.(?:name|pref|url|import|stylesheet|member)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const isZenUrl = url => /(?:^|[/_-])zen(?:[-/_.]|$)|\/Zen[A-Z]/.test(url) && !/zennia/i.test(url);

function stripComments(text, kind) {
  if (kind === 'xhtml') return text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  return kind === 'css' ? text : text.replace(/(^|[\s;{}(),])(\/\/[^\n]*)/g, (_, before, comment) => before + ' '.repeat(comment.length));
}
function payloadFiles(folder = PAYLOAD) {
  const out = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'zen-versions') out.push(...payloadFiles(file)); }
    else if (entry.name === 'zen-data.js') continue;
    else if (/\.(?:js|mjs|css|xhtml|cfg)$/.test(entry.name)) out.push(file);
  }
  return out;
}
const add = (map, key, where) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(where); };

// Returns everything the payload uses, plus literals that bypass the helpers.
function collectPayload() {
  const surface = { names: new Map(), globals: new Map(), members: new Map(), prefs: new Map(), urls: new Map() };
  const unwrapped = [];
  for (const file of payloadFiles()) {
    const relative = path.relative(PAYLOAD, file).replaceAll('\\', '/');
    const kind = file.endsWith('.css') ? 'css' : file.endsWith('.xhtml') ? 'xhtml' : 'js';
    const raw = fs.readFileSync(file, 'utf8');
    let text = stripComments(raw, kind);
    const wrapped = [];
    if (kind === 'js') for (const match of text.matchAll(HELPER)) wrapped.push([match.index, match.index + match[0].length]);
    // A line marked with this comment holds Zen names that zen.name() renames where they are used.
    for (const match of raw.matchAll(/^.*\/\/ zen\.name\(\) at use\r?$/gm)) wrapped.push([match.index, match.index + match[0].length]);
    const inHelper = index => wrapped.some(([start, end]) => index >= start && index < end);
    for (const match of text.matchAll(URL)) {
      if (!isZenUrl(match[0])) continue;
      add(surface.urls, match[0], relative);
      if (kind === 'js' && !inHelper(match.index)) unwrapped.push(`${relative}: ${match[0]}`);
    }
    text = text.replace(URL, url => ' '.repeat(url.length));
    for (const match of text.matchAll(PREF)) {
      add(surface.prefs, match[0], relative);
      if (kind === 'js' && !inHelper(match.index)) unwrapped.push(`${relative}: ${match[0]}`);
    }
    text = text.replace(PREF, pref => ' '.repeat(pref.length));
    if (kind === 'js') {
      for (const match of text.matchAll(MEMBER)) add(surface.members, `${match[1]}.${match[2]}`, relative);
      for (const match of text.matchAll(GLOBAL)) add(surface.globals, match[0], relative);
      text = text.replace(GLOBAL, name => ' '.repeat(name.length));
    }
    for (const match of text.matchAll(NAME)) {
      if (OWN.has(match[0])) continue;
      add(surface.names, match[0], relative);
      if (kind === 'js' && !inHelper(match.index)) unwrapped.push(`${relative}: ${match[0]}`);
    }
  }
  for (const [key, members] of Object.entries(versions.base().apis))
    for (const member of members) add(surface.members, `${key}.${member}`, 'zen-versions/base.json');
  return { surface, unwrapped };
}

// Reads the files of a Zen omni.ja in memory; nothing is extracted to disk.
function readJar(jar) {
  const buffer = fs.readFileSync(jar);
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`Not a zip archive: ${jar}`);
  const files = new Map();
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = buffer.readUInt16LE(end + 10); i > 0; i--) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Corrupt central directory: ${jar}`);
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    files.set(name, () => {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    });
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}
// Token index of a Zen build: names, preferences, words from Zen's own files, and the file list.
function indexBuild(core) {
  const index = { names: new Set(), words: new Set(), prefs: new Set(), files: [] };
  for (const [jar, prefix] of [[path.join(core, 'omni.ja'), 'gre/'], [path.join(core, 'browser', 'omni.ja'), 'browser/']]) {
    for (const [name, read] of readJar(jar)) {
      const relative = prefix + name;
      index.files.push(relative);
      // Code, markup and styles only: localization metadata lists file names, not DOM names.
      if (!/\.(?:m?js|css|x?html|inc|svg)$/.test(name)) continue;
      const text = read().toString('utf8');
      for (const match of text.matchAll(NAME)) index.names.add(match[0]);
      for (const match of text.matchAll(PREF)) index.prefs.add(match[0]);
      if (/zen/i.test(relative)) for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) index.words.add(match[0]);
    }
  }
  return index;
}
function urlExists(url, files) {
  let suffix;
  if (url.startsWith('chrome://browser/content/')) suffix = '/content/browser/' + url.slice(25);
  else if (url.startsWith('chrome://browser/skin/')) suffix = '/skin/classic/browser/' + url.slice(22);
  else if (url.startsWith('resource:///modules/')) suffix = 'browser/modules/' + url.slice(20);
  else if (url.startsWith('moz-src:///')) suffix = '/moz-src/' + url.slice(11);
  else return false;
  return files.some(file => file.endsWith(suffix));
}

// Lists surface entries missing from the build. Renamed entries are checked
// under their new name; entries the version declares unavailable must be absent.
function checkBuild(version, core) {
  const entry = versions.resolve(version);
  const { surface } = collectPayload();
  const index = indexBuild(core);
  const problems = [];
  const unavailable = require('../payload/content/shared/zen-data.js').unavailableNames(entry);
  const check = (kind, key, present) => {
    if (unavailable.has(key)) { if (present) problems.push(`${kind} ${key} is listed as unavailable but exists in Zen ${version}`); }
    else if (!present) problems.push(`${kind} ${key} is missing from Zen ${version} (used by ${[...surface[kind].get(key) || []].join(', ')})`);
  };
  for (const name of surface.names.keys()) check('names', name, index.names.has(entry.renames.names[name] || name));
  for (const name of surface.globals.keys()) check('globals', name, index.words.has(entry.renames.globals[name] || name));
  for (const key of surface.members.keys()) {
    const [owner, member] = key.split('.');
    if (unavailable.has(owner)) continue;
    check('members', key, index.words.has(entry.renames.members[key] || member));
  }
  for (const pref of surface.prefs.keys()) check('prefs', pref, index.prefs.has(entry.renames.prefs[pref] || pref));
  for (const pref of Object.keys(entry.prefs).filter(pref => pref.startsWith('zen.'))) if (!surface.prefs.has(pref)) {
    surface.prefs.set(pref, new Set(['managed prefs']));
    check('prefs', pref, index.prefs.has(pref));
  }
  for (const url of surface.urls.keys()) check('urls', url, urlExists(entry.renames.urls[url] || url, index.files));
  for (const key of unavailable) if (!Object.values(surface).some(map => map.has(key)) && !versions.base().apis[key])
    problems.push(`unavailable entry ${key} is not used by the payload`);
  return problems;
}

module.exports = { collectPayload, checkBuild, indexBuild, readJar, NAME, PREF, isZenUrl };

if (require.main === module) {
  const [version, core = path.join(__dirname, '..', 'artifacts', 'zen-builds', version || '', 'core')] = process.argv.slice(2).filter(arg => arg !== '--');
  if (!version) { console.error('Usage: node scripts/zen-surface.cjs <version> [extracted core folder]'); process.exit(1); }
  const problems = checkBuild(version, core);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
  else console.log(`Zen ${version} provides every internal Zennia uses.`);
}
