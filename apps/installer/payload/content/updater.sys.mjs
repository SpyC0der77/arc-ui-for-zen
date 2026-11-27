import { applyThemeUpdate, recoverThemeUpdate } from './update-apply.mjs';
import { Downloads } from 'resource://gre/modules/Downloads.sys.mjs';
import { REPO, selectRelease, trustedAsset, releaseTrack, installerAsset } from './update-data.mjs';
import { setTimeout, clearTimeout } from 'resource://gre/modules/Timer.sys.mjs';

async function request(url, format) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return await response[format]();
  } finally { clearTimeout(timer); }
}

const hex = digest => Array.from(digest, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
async function sha256(bytes) {
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(hash.SHA256); hash.update(bytes, bytes.length);
  return hex(hash.finish(false));
}
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/**
 * Downloads a release file into a new temporary folder and checks it against the release's
 * SHA256SUMS.txt. Returns the folder and the file; the folder is removed if anything fails.
 */
async function fetchVerified({ asset, checksum }, onProgress) {
  if (!trustedAsset(asset.browser_download_url) || !trustedAsset(checksum.browser_download_url)) throw new Error('Unexpected release download address.');
  const sums = await request(checksum.browser_download_url, 'text');
  const expected = sums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).find(line => line?.[2] === asset.name)?.[1];
  if (!expected) throw new Error(`The release has no checksum for ${asset.name}.`);
  const directory = await IOUtils.createUniqueDirectory(PathUtils.tempDir, 'zennia-download');
  try {
    const target = PathUtils.join(directory, asset.name);
    const download = await Downloads.createDownload({ source: { url: asset.browser_download_url }, target });
    download.onchange = () => onProgress(download.hasProgress ? download.progress : null);
    await download.start();
    const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
    const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(target);
    const stream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
    stream.init(file, 1, 0, 0);
    let actual;
    try { hash.init(hash.SHA256); hash.updateFromStream(stream, 0xffffffff); actual = hex(hash.finish(false)); }
    finally { stream.close(); }
    if (actual !== expected) throw new Error(`${asset.name} did not match its checksum. Try again.`);
    return { directory, target };
  } catch (error) {
    await IOUtils.remove(directory, { recursive: true }).catch(() => {});
    throw error;
  }
}

/**
 * Opens a downloaded installer on this Zen installation and profile. A macOS disk image can
 * only be opened, so its installer finds them itself. If it cannot start, the file is shown.
 */
async function openInstaller(path, { resources, profile }) {
  const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(path);
  try {
    if (Services.appinfo.OS === 'Darwin') { file.launch(); return; }
    if (Services.appinfo.OS !== 'WINNT') await IOUtils.setPermissions(path, 0o700);
    const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess); process.init(file);
    const args = ['--installation', resources, '--profile', profile];
    process.runwAsync(args, args.length);
  } catch (error) {
    console.error('[Zennia updates] Could not open the installer', error);
    file.reveal();
  }
}

/** Puts back the preferences Zennia set, where they still hold Zennia's value (engine.cjs remove). */
function restorePrefs({ settings, originalPrefs }) {
  const { prefs } = Services;
  const read = key => {
    switch (prefs.getPrefType(key)) {
      case prefs.PREF_BOOL: return prefs.getBoolPref(key);
      case prefs.PREF_INT: return prefs.getIntPref(key);
      case prefs.PREF_STRING: return prefs.getStringPref(key);
      default: return undefined;
    }
  };
  for (const [key, installed] of Object.entries(settings)) {
    if (read(key) !== installed) continue;
    // The receipt keeps each original as its prefs.js line, or '' when the user had not set it.
    const original = originalPrefs[key]?.match(/^user_pref\("[^"]+",\s*(.*)\);$/)?.[1];
    if (original === undefined) { prefs.clearUserPref(key); continue; }
    const value = JSON.parse(original);
    if (typeof value === 'boolean') prefs.setBoolPref(key, value);
    else if (typeof value === 'number') prefs.setIntPref(key, value);
    else prefs.setStringPref(key, value);
  }
  prefs.savePrefFile(null);
}

export function updateContext() {
  return {
    io: {
      exists: path => IOUtils.exists(path),
      readJSON: path => IOUtils.readJSON(path),
      read: path => IOUtils.read(path),
      remove: path => IOUtils.remove(path, {ignoreAbsent:true}),
      write: async (path, bytes) => {
        await IOUtils.makeDirectory(PathUtils.parent(path), {ignoreExisting:true, createAncestors:true});
        await IOUtils.write(path, bytes, {tmpPath:path + '.zennia-update-writing'});
      },
      assertPath: async path => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path); file.normalize();
        if (file.path !== path) throw new Error('Noncanonical update path: ' + path);
        for (let current = file; current; current = current.parent)
          if (current.exists() && current.isSymlink()) throw new Error('Update path contains a symbolic link: ' + current.path);
      },
    },
    paths: {
      profile:PathUtils.profileDir,
      resources:Services.dirsvc.get('GreD',Ci.nsIFile).path,
      join:PathUtils.join,
      separator:Services.appinfo.OS === 'WINNT' ? '\\' : '/',
    },
    encode:text => new TextEncoder().encode(text),
  };
}

const UNSUPPORTED = 'zennia.updates.unsupported';
const unsupportedKey = release => `${Services.appinfo.version} ${release.tag_name}`;

// One coordinator per browser process, including when several windows are open.
export const ZenniaUpdater = {
  state: 'idle', release: null, progress: null, error: '', listeners: new Set(),
  // The newest release found not to support the running Zen version, if any.
  unsupported: null,
  revision: 0,
  emit() { for (const listener of this.listeners) listener(); },
  async getTrack() {
    const value = Services.prefs.getStringPref('zennia.updates.track', '');
    if (['stable', 'beta'].includes(value)) return value;
    const receipt = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'zennia.install.json'));
    return releaseTrack(Services.prefs.getStringPref('zennia.updates.track', ''), receipt.version);
  },
  setTrack(track, { check = true } = {}) {
    if (!['stable', 'beta'].includes(track)) throw new Error('Choose Beta or Stable.');
    if (['downloading', 'applying', 'ready', 'restarting', 'removing'].includes(this.state)) throw new Error('Wait for the current update operation to finish.');
    Services.prefs.setStringPref('zennia.updates.track', track);
    this.checkAfterTrackChange = check;
    this.revision++;
    const directory = this.stagedDirectory;
    this.stagedDirectory = null;
    if (directory) void IOUtils.remove(directory, { recursive: true }).catch(error => console.warn('[Zennia updates]', error));
    this.release = null; this.target = null; this.state = 'idle'; this.error = ''; this.progress = null;
    this.emit();
    if (check) void this.check({ force: true });
  },
  async check({ force = false } = {}) {
    if (this.checking || ['downloading', 'applying', 'ready', 'restarting', 'removing'].includes(this.state)) return;
    this.checking = true;
    const revision = this.revision;
    try {
      await recoverThemeUpdate(updateContext());
      const receipt = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'zennia.install.json'));
      const track = releaseTrack(Services.prefs.getStringPref('zennia.updates.track', ''), receipt.version);
      const key = 'zennia.updates.last-check.' + track;
      const last = Number(Services.prefs.getStringPref(key, '0'));
      if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return;
      Services.prefs.setStringPref(key, String(Date.now()));
      const releases = await request(`https://api.github.com/repos/${REPO}/releases?per_page=30`, 'json');
      if (!Array.isArray(releases)) throw new Error('Invalid release list');
      if (revision !== this.revision) return;
      if (['downloading', 'applying', 'ready', 'restarting', 'removing'].includes(this.state)) return;
      let release = selectRelease(releases, receipt.version, Services.appinfo.OS, Services.appinfo.XPCOMABI, track);
      // A release already found not to support this Zen version is not offered again.
      if (release && Services.prefs.getStringPref(UNSUPPORTED, '') === unsupportedKey(release)) { this.unsupported = release.tag_name; release = null; }
      this.release = release || null; this.state = release ? 'available' : 'idle'; this.error = ''; this.emit();
    } catch (error) { console.warn('[Zennia updates]', error); }
    finally {
      this.checking = false;
      if (revision !== this.revision && this.checkAfterTrackChange) void this.check({ force: true });
    }
  },
  async download() {
    if (!['available', 'error'].includes(this.state) || !this.release) return;
    this.state = 'downloading'; this.error = ''; this.progress = null; this.emit();
    let directory;
    try {
      let target;
      ({ directory, target } = await fetchVerified(this.release, progress => { this.progress = progress; this.emit(); }));
      if ((await IOUtils.stat(target)).size > 32 * 1024 * 1024) throw new Error('Update bundle exceeds the size limit.');
      const bundle = await IOUtils.readJSON(target);
      this.state = 'applying'; this.emit();
      const zenData = {};
      Services.scriptloader.loadSubScript('chrome://zennia/content/shared/zen-data.js', zenData, 'UTF-8');
      await applyThemeUpdate(bundle, {
        ...updateContext(), zenData: zenData.ZenniaZenData,
        hash:sha256, decode:fromBase64,
        browserVersion:Services.appinfo.version, platform:Services.appinfo.OS, version:this.release.tag_name.replace(/^v/,'')
      });
      this.state = 'ready'; this.progress = 100;
      await IOUtils.remove(directory, {recursive:true}).catch(() => {});
    } catch (error) {
      if (directory) await IOUtils.remove(directory, { recursive: true }).catch(() => {});
      if (error.code === 'unsupported-zen') {
        Services.prefs.setStringPref(UNSUPPORTED, unsupportedKey(this.release));
        this.unsupported = this.release.tag_name; this.release = null; this.state = 'idle'; this.error = ''; this.progress = null;
      } else { this.state = 'error'; this.error = error.message; }
    }
    this.emit();
  },
  /** Removes Zennia from this installation and profile, then restarts Zen without it. */
  uninstall() {
    return this.remove(async () => null);
  },
  /**
   * Downloads the installed version's installer, removes Zennia, opens the installer on this
   * installation and profile, and closes Zen so the installer can put Zennia back.
   */
  reinstall() {
    return this.remove(async receipt => {
      const release = await request(`https://api.github.com/repos/${REPO}/releases/tags/v${receipt.version}`, 'json');
      const files = installerAsset(release, Services.appinfo.OS, Services.appinfo.XPCOMABI);
      if (!files) throw new Error(`Zennia ${receipt.version} has no installer for this system.`);
      return (await fetchVerified(files, progress => { this.progress = progress; this.emit(); })).target;
    });
  },
  /**
   * Removes Zennia once `prepare` (given the installation receipt) is done; it returns the
   * installer it fetched, or null. Zen then opens that installer and quits, or restarts without
   * Zennia. Nothing is removed if `prepare` fails or something asks Zen to stay open.
   */
  async remove(prepare) {
    if (['downloading', 'applying', 'restarting', 'removing'].includes(this.state)) throw new Error('Wait for the current update to finish.');
    const previous = this.state;
    this.state = 'removing'; this.progress = null; this.emit();
    let receipt, installer = null;
    try {
      installer = await prepare(await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'zennia.install.json')));
      // Anything that would stop Zen closing (a page asking to stay open) gets its say first.
      const cancel = Cc['@mozilla.org/supports-PRBool;1'].createInstance(Ci.nsISupportsPRBool);
      Services.obs.notifyObservers(cancel, 'quit-application-requested', installer ? null : 'restart');
      if (!cancel.data) {
        const { uninstallTheme } = ChromeUtils.importESModule('chrome://zennia/content/uninstall.mjs');
        receipt = await uninstallTheme({ ...updateContext(), hash: sha256, decode: fromBase64 });
      }
    } finally {
      if (!receipt) {
        this.state = previous; this.progress = null; this.emit();
        if (installer) await IOUtils.remove(PathUtils.parent(installer), { recursive: true }).catch(() => {});
      }
    }
    if (!receipt) return;
    // The files are gone: leave even if a preference could not be put back.
    try {
      restorePrefs(receipt);
      if (installer) await openInstaller(installer, receipt);
    } finally {
      Services.appinfo.invalidateCachesOnRestart();
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | (installer ? 0 : Ci.nsIAppStartup.eRestart));
    }
  },
  async restart() {
    if (this.state !== 'ready') return;
    this.state = 'restarting'; this.emit();
    try {
      const cancel = Cc['@mozilla.org/supports-PRBool;1'].createInstance(Ci.nsISupportsPRBool);
      Services.obs.notifyObservers(cancel, 'quit-application-requested', 'restart');
      if (!cancel.data) {
        Services.appinfo.invalidateCachesOnRestart();
        Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
      }
    } catch (error) { this.error = `Could not restart Zen: ${error.message}`; }
    this.state = 'ready'; this.emit();
  },
};
