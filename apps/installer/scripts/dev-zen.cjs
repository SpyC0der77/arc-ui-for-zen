// Development Zen instances under zen-instances/dev-zen/<version>/ must stay on
// the version they are named after. Zen updates itself unless an enterprise
// policy turns that off, so this writes one into each development app.
// Usage: node scripts/dev-zen.cjs            (lock every development instance)
//        node scripts/dev-zen.cjs <app folder>
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../installer/engine.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', 'zen-instances', 'dev-zen');
const POLICIES = { DisableAppUpdate: true, DontCheckDefaultBrowser: true };

// Adds the policies to the app's distribution/policies.json, keeping any others.
function disableUpdates(app) {
  const distribution = path.join(engine.layout(app).resources, 'distribution');
  const file = path.join(distribution, 'policies.json');
  for (const item of [distribution, file]) {
    if (fs.lstatSync(item, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Refusing linked policy path: ${item}`);
  }
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const merged = { ...existing, policies: { ...existing.policies, ...POLICIES } };
  fs.mkdirSync(distribution, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return file;
}

function appVersion(app) {
  const ini = path.join(engine.layout(app).resources, 'application.ini');
  return engine.parseIni(fs.readFileSync(ini, 'utf8')).App?.Version;
}

// Every development app, with the version its folder names and the one it runs.
function instances() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const app = ['Zen', 'Zen.app'].map(name => path.join(ROOT, entry.name, name)).find(fs.existsSync);
    return app ? [{ folder: entry.name, app, profile: path.join(ROOT, entry.name, 'profile'), version: appVersion(app) }] : [];
  });
}

module.exports = { disableUpdates, instances, appVersion, ROOT };

if (require.main === module) {
  const target = process.argv.slice(2).find(arg => arg !== '--');
  const apps = target ? [{ app: path.resolve(target), folder: null, version: appVersion(path.resolve(target)) }] : instances();
  if (!apps.length) console.log(`No development instances under ${ROOT}.`);
  for (const { app, folder, version } of apps) {
    console.log(`Updates disabled for Zen ${version}: ${disableUpdates(app)}`);
    if (folder && folder !== version)
      console.warn(`  Folder ${folder} holds Zen ${version}. Move it to dev-zen/${version} with the installer (see AGENTS.md).`);
  }
}
