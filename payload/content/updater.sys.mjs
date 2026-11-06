import { applyThemeUpdate, recoverThemeUpdate } from './update-apply.mjs';
import { Downloads } from 'resource://gre/modules/Downloads.sys.mjs';
import { REPO, selectRelease, trustedAsset, releaseTrack } from './update-data.mjs';
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


export function updateContext() {
  return {
    io: {
      exists: path => IOUtils.exists(path),
      readJSON: path => IOUtils.readJSON(path),
      read: path => IOUtils.read(path),
      remove: path => IOUtils.remove(path, {ignoreAbsent:true}),
      write: async (path, bytes) => {
        await IOUtils.makeDirectory(PathUtils.parent(path), {ignoreExisting:true, createAncestors:true});
        await IOUtils.write(path, bytes, {tmpPath:path + '.arc-update-writing'});
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

// One coordinator per browser process, including when several windows are open.
export const ArcUpdater = {
  state: 'idle', release: null, progress: null, error: '', listeners: new Set(),
  revision: 0,
  emit() { for (const listener of this.listeners) listener(); },
  async getTrack() {
    const value = Services.prefs.getStringPref('arc-ui.updates.track', '');
    if (['stable', 'beta'].includes(value)) return value;
    const receipt = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'arc-ui.install.json'));
    return releaseTrack(Services.prefs.getStringPref('arc-ui.updates.track', ''), receipt.version);
  },
  setTrack(track, { check = true } = {}) {
    if (!['stable', 'beta'].includes(track)) throw new Error('Choose Beta or Stable.');
    if (['downloading', 'applying', 'ready', 'restarting'].includes(this.state)) throw new Error('Wait for the current update operation to finish.');
    Services.prefs.setStringPref('arc-ui.updates.track', track);
    this.checkAfterTrackChange = check;
    this.revision++;
    const directory = this.stagedDirectory;
    this.stagedDirectory = null;
    if (directory) void IOUtils.remove(directory, { recursive: true }).catch(error => console.warn('[Arc UI updates]', error));
    this.release = null; this.target = null; this.state = 'idle'; this.error = ''; this.progress = null;
    this.emit();
    if (check) void this.check({ force: true });
  },
  async check({ force = false } = {}) {
    if (this.checking || ['downloading', 'applying', 'ready', 'restarting'].includes(this.state)) return;
    this.checking = true;
    const revision = this.revision;
    try {
      await recoverThemeUpdate(updateContext());
      const receipt = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'arc-ui.install.json'));
      const track = releaseTrack(Services.prefs.getStringPref('arc-ui.updates.track', ''), receipt.version);
      const key = 'arc-ui.updates.last-check.' + track;
      const last = Number(Services.prefs.getStringPref(key, '0'));
      if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return;
      Services.prefs.setStringPref(key, String(Date.now()));
      const releases = await request(`https://api.github.com/repos/${REPO}/releases?per_page=30`, 'json');
      if (!Array.isArray(releases)) throw new Error('Invalid release list');
      if (revision !== this.revision) return;
      if (['downloading', 'applying', 'ready', 'restarting'].includes(this.state)) return;
      const release = selectRelease(releases, receipt.version, Services.appinfo.OS, Services.appinfo.XPCOMABI, track);
      this.release = release || null; this.state = release ? 'available' : 'idle'; this.error = ''; this.emit();
    } catch (error) { console.warn('[Arc UI updates]', error); }
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
      const { asset, checksum } = this.release;
      if (!trustedAsset(asset.browser_download_url) || !trustedAsset(checksum.browser_download_url)) throw new Error('Unexpected release download address.');
      const sums = await request(checksum.browser_download_url, 'text');
      const expected = sums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).find(line => line?.[2] === asset.name)?.[1];
      if (!expected) throw new Error('The release has no checksum for this update.');
      directory = await IOUtils.createUniqueDirectory(PathUtils.tempDir, 'arc-ui-update');
      const target = PathUtils.join(directory, asset.name);
      const download = await Downloads.createDownload({ source: { url: asset.browser_download_url }, target });
      download.onchange = () => { this.progress = download.hasProgress ? download.progress : null; this.emit(); };
      await download.start();
      const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(target);
      const stream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
      stream.init(file, 1, 0, 0);
      let actual;
      try { hash.init(hash.SHA256); hash.updateFromStream(stream, 0xffffffff); actual = Array.from(hash.finish(false), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); }
      finally { stream.close(); }
      if (actual !== expected) throw new Error('Update checksum did not match. Download again.');
      if ((await IOUtils.stat(target)).size > 32 * 1024 * 1024) throw new Error('Update bundle exceeds the size limit.');
      const bundle = await IOUtils.readJSON(target);
      this.state = 'applying'; this.emit();
      const hashBytes = async bytes => {
        const value = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
        value.init(value.SHA256); value.update(bytes, bytes.length);
        return Array.from(value.finish(false), c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      };
      await applyThemeUpdate(bundle, {
        ...updateContext(),
        hash:hashBytes, decode: text => Uint8Array.from(atob(text), c => c.charCodeAt(0)), encode:text => new TextEncoder().encode(text),
        browserVersion:Services.appinfo.version, platform:Services.appinfo.OS, version:this.release.tag_name.replace(/^v/,'')
      });
      this.state = 'ready'; this.progress = 100;
      await IOUtils.remove(directory, {recursive:true}).catch(() => {});
    } catch (error) {
      if (directory) await IOUtils.remove(directory, { recursive: true }).catch(() => {});
      this.state = 'error'; this.error = error.message;
    }
    this.emit();
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
