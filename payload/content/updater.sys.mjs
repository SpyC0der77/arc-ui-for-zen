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
    if (['downloading', 'opening'].includes(this.state)) throw new Error('Wait for the current update operation to finish.');
    Services.prefs.setStringPref('arc-ui.updates.track', track);
    this.checkAfterTrackChange = check;
    this.revision++;
    const directory = this.stagedDirectory;
    this.stagedDirectory = null;
    // A launched installer or mounted disk image may still be using its file.
    if (directory && !this.installerOpened)
      void IOUtils.remove(directory, { recursive: true }).catch(error => console.warn('[Arc UI updates]', error));
    this.installerOpened = false;
    this.release = null; this.target = null; this.state = 'idle'; this.error = ''; this.progress = null;
    this.emit();
    if (check) void this.check({ force: true });
  },
  async check({ force = false } = {}) {
    if (this.checking || ['downloading', 'ready', 'opening'].includes(this.state)) return;
    this.checking = true;
    const revision = this.revision;
    try {
      const receipt = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'arc-ui.install.json'));
      const track = releaseTrack(Services.prefs.getStringPref('arc-ui.updates.track', ''), receipt.version);
      const key = 'arc-ui.updates.last-check.' + track;
      const last = Number(Services.prefs.getStringPref(key, '0'));
      if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return;
      Services.prefs.setStringPref(key, String(Date.now()));
      const releases = await request(`https://api.github.com/repos/${REPO}/releases?per_page=30`, 'json');
      if (!Array.isArray(releases)) throw new Error('Invalid release list');
      if (revision !== this.revision) return;
      if (['downloading', 'ready', 'opening'].includes(this.state)) return;
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
      if (!expected) throw new Error('The release has no checksum for this installer.');
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
      if (actual !== expected) throw new Error('Installer checksum did not match. Download again.');
      this.target = target; this.stagedDirectory = directory; this.installerOpened = false;
      this.state = 'ready'; this.progress = 100;
    } catch (error) {
      if (directory) await IOUtils.remove(directory, { recursive: true }).catch(() => {});
      this.state = 'error'; this.error = error.message;
    }
    this.emit();
  },
  async install() {
    if (this.state !== 'ready') return;
    this.state = 'opening'; this.emit();
    try {
      const receipt = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, 'chrome', 'arc-ui.install.json'));
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(this.target);
      if (Services.appinfo.OS === 'Darwin') file.launch();
      else {
        if (Services.appinfo.OS !== 'WINNT') await IOUtils.setPermissions(this.target, 0o700);
        const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess); process.init(file);
        const args = ['--arc-update', '--installation', receipt.resources, '--profile', receipt.profile];
        process.runwAsync(args, args.length);
      }
      this.installerOpened = true;
      this.error = Services.appinfo.OS === 'Darwin' ? 'Open the installer in the disk image, then close Zen to update.' : 'Installer opened. Close Zen, then install the update there.';
    } catch (error) { this.error = `Could not open installer: ${error.message}`; }
    this.state = 'ready'; this.emit();
  },
};
