// Shared by the browser updater and filesystem regression tests.
export async function applyThemeUpdate(bundle, {io, paths, hash, decode, encode, zenData, browserVersion, platform, version}) {
  const {profile, resources, join} = paths;
  const root = join(profile, 'chrome', 'zennia');
  const receiptPath = join(profile, 'chrome', 'zennia.install.json');
  const ownerPath = join(resources, 'zennia-owner.json');
  const journalPath = join(profile, 'chrome', 'zennia-update-journal.json');
  const localFont = new Set(['content/custom-font/face', 'content/custom-font/style.css']);
  const localFontPaths = new Set([...localFont].map(file => join(root,...file.split('/'))));
  if (await io.exists(journalPath)) throw new Error('An interrupted update needs recovery before another update.');
  if (bundle.format !== 1 || bundle.version !== version || !bundle.supported?.includes(browserVersion)) throw new Error('This update does not support this Zen version.');
  const receipt = await io.readJSON(receiptPath), owner = await io.readJSON(ownerPath);
  if (receipt.profile !== profile || receipt.resources !== resources || owner.profile !== profile || owner.version !== receipt.version) throw new Error('Update ownership does not match this installation and profile.');
  const files = bundle.files;
  if (!files || typeof files !== 'object' || !files['zennia.uc.js'] || !files['chrome.manifest'] || Object.keys(files).length > 2000) throw new Error('Incomplete update bundle.');
  const data = new Map();
  for (const [relative, value] of Object.entries(files)) {
    if (localFont.has(relative) || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(relative) || relative.split('/').some(s => s === '.' || s === '..') || typeof value !== 'string') throw new Error('Invalid update payload path.');
    data.set(relative, decode(value));
  }
  // This bundle format updates the theme without changing the startup loader or
  // managed preferences. Refuse incompatible setup changes instead of guessing.
  const json = relative => {
    if (!data.has(relative)) throw new Error('This update has no data for this Zen version.');
    return JSON.parse(new TextDecoder().decode(data.get(relative)));
  };
  const versionData = zenData.resolve(json('zen-versions/base.json'), json(`zen-versions/${browserVersion}.json`));
  const settings = zenData.prefsFor(versionData, platform === 'WINNT' ? 'windows' : platform === 'Darwin' ? 'macos' : 'linux');
  if (Object.keys(settings).length !== Object.keys(receipt.settings).length || Object.entries(settings).some(([key,value]) => receipt.settings[key] !== value)) throw new Error('This update changes managed preferences and is incompatible with in-place update format 1.');
  const appFiles = [join(resources,'zennia.cfg'), join(resources,'defaults','pref','zennia-autoconfig.js'), ownerPath];
  const userPath = join(profile,'user.js');
  const underRoot = file => file.startsWith(root + paths.separator);
  const valid = file => appFiles.includes(file) || file === userPath || underRoot(file);
  const seen = new Set();
  for (const file of receipt.files) {
    if (!valid(file.path) || seen.has(file.path)) throw new Error('Invalid installation receipt.');
    seen.add(file.path);
    await io.assertPath(file.path);
    const current = await io.read(file.path);
    if (file.path !== userPath && await hash(current) !== file.installedHash) throw new Error('A patch file was edited after installation: ' + file.path);
  }
  if (!appFiles.every(file => seen.has(file)) || !seen.has(userPath)) throw new Error('Incomplete installation receipt.');
  for (const [relative, target] of [['zennia.cfg',appFiles[0]],['zennia-autoconfig.js',appFiles[1]]]) {
    if (await hash(data.get(relative)) !== await hash(await io.read(target))) throw new Error('This update requires a different startup loader; no files were changed.');
  }
  // settings*.json are only in bundles for updaters that predate zen-versions/.
  const skip = new Set(['zennia.cfg','zennia-autoconfig.js','settings.json','settings.windows.json']);
  const isThemeFile = file => underRoot(file) && !localFontPaths.has(file);
  const writes = new Map(), nextFiles = receipt.files.filter(file => !isThemeFile(file.path));
  for (const [relative, bytes] of data) {
    if (skip.has(relative)) continue;
    const target = join(root,...relative.split('/'));
    await io.assertPath(target);
    if (!seen.has(target) && await io.exists(target)) throw new Error('An existing file would be overwritten: ' + target);
    writes.set(target,bytes);
    nextFiles.push({path:target,before:null,installedHash:await hash(bytes)});
  }
  for (const file of receipt.files) if (isThemeFile(file.path) && !writes.has(file.path)) writes.set(file.path,null);
  const ownerBytes = encode(JSON.stringify({...owner,version}));
  writes.set(ownerPath,ownerBytes);
  nextFiles.find(file => file.path === ownerPath).installedHash = await hash(ownerBytes);
  writes.set(receiptPath,encode(JSON.stringify({...receipt,version,files:nextFiles},null,2)));
  const backups = [];
  for (const [file] of writes) {
    await io.assertPath(file);
    backups.push({path:file,bytes:await io.exists(file) ? Array.from(await io.read(file)) : null});
  }
  await io.write(journalPath,encode(JSON.stringify({files:backups})));
  try {
    for (const [file, bytes] of writes) if (bytes === null) await io.remove(file); else await io.write(file,bytes);
  } catch (error) {
    try {
      for (const backup of backups.reverse()) if (backup.bytes === null) await io.remove(backup.path); else await io.write(backup.path,new Uint8Array(backup.bytes));
      await io.remove(journalPath);
    } catch { throw new Error('Update rollback needs recovery. Keep zennia-update-journal.json. ' + error.message); }
    throw new Error('Update was rolled back. ' + error.message);
  }
  await io.remove(journalPath);
}
export async function recoverThemeUpdate({io, paths, encode}) {
  const {profile, resources, join} = paths;
  const journalPath = join(profile,'chrome','zennia-update-journal.json');
  if (!await io.exists(journalPath)) return;
  const journal = await io.readJSON(journalPath);
  const root = join(profile,'chrome','zennia') + paths.separator;
  const allowed = [join(profile,'chrome','zennia.install.json'),join(resources,'zennia-owner.json')];
  if (!Array.isArray(journal.files) || journal.files.length > 2005) throw new Error('Invalid update recovery journal.');
  for (const file of journal.files) {
    if (typeof file.path !== 'string' || !(file.path.startsWith(root) || allowed.includes(file.path)) || !(file.bytes === null || Array.isArray(file.bytes) && file.bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255))) throw new Error('Invalid update recovery entry.');
    await io.assertPath(file.path);
  }
  for (const file of [...journal.files].reverse()) if (file.bytes === null) await io.remove(file.path); else await io.write(file.path,new Uint8Array(file.bytes));
  await io.remove(journalPath);
}
