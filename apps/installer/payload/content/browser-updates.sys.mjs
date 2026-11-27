// Holds back a Zen update to a version Zennia does not support yet.
// Zen keeps updating normally to supported versions. When it starts downloading an
// unsupported one, the download is cancelled and Zen's automatic updates pause until
// Zennia supports that version or the user chooses to update anyway. Zennia then
// pauses itself on the new version and turns back on once a release supports it.
// One instance per browser process; windows only render its state.
import { AppMenuNotifications } from 'resource://gre/modules/AppMenuNotifications.sys.mjs';
import { UpdateUtils } from 'resource://gre/modules/UpdateUtils.sys.mjs';

const HELD = 'zennia.browserUpdates.held';
const ALLOWED = 'zennia.browserUpdates.allowed';
const RESTORE_AUTO = 'zennia.browserUpdates.restoreAuto';
const ZEN_PROMPTS = /^update-(available|downloading|restart)$/;
const VERSION = /^\d+\.\d+(?:\.\d+)?[a-z]?$/;
const TOPICS = ['update-available', 'update-downloading', 'update-downloaded', 'update-staged', 'appMenu-notifications'];

export function supports(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) return false;
  const data = Services.dirsvc.get('ProfD', Ci.nsIFile);
  for (const part of ['chrome', 'zennia', 'zen-versions', version + '.json']) data.append(part);
  return data.exists();
}

const service = () => Cc['@mozilla.org/updates/update-service;1'].getService(Ci.nsIApplicationUpdateService);
const manager = () => Cc['@mozilla.org/updates/update-manager;1'].getService(Ci.nsIUpdateManager);

export const ZenniaBrowserUpdates = {
  // The Zen version on hold, if any, and the update Zen offered for it.
  held: null, update: null, listeners: new Set(), started: false,
  emit() { for (const listener of this.listeners) listener(); },

  start() {
    if (this.started) return;
    this.started = true;
    // An update the user allowed has been installed or is supported now.
    const allowed = Services.prefs.getStringPref(ALLOWED, '');
    if (allowed && (allowed === Services.appinfo.version || supports(allowed))) Services.prefs.clearUserPref(ALLOWED);
    for (const topic of TOPICS) Services.obs.addObserver(this, topic);
    this.held = Services.prefs.getStringPref(HELD, '') || null;
    void this.resume();
  },

  async resume() {
    try {
      // A held version Zennia now supports goes ahead; so do updates that were
      // already downloading or downloaded before this check existed.
      if (this.held && supports(this.held)) await this.release();
      const um = manager();
      for (const update of [um.downloadingUpdate, um.readyUpdate]) if (update) await this.review(update, 'pending');
    } catch (error) { console.warn('[Zennia browser updates]', error); }
  },

  observe(subject, topic) {
    if (topic === 'appMenu-notifications') { if (this.held) this.hidePrompts(); return; }
    const update = subject?.QueryInterface?.(Ci.nsIUpdate);
    if (update) void this.review(update, topic).catch(error => console.warn('[Zennia browser updates]', error));
  },

  async review(update, topic) {
    const version = update.appVersion;
    if (!VERSION.test(version ?? '') || version === Services.appinfo.version) return;
    if (supports(version) || Services.prefs.getStringPref(ALLOWED, '') === version) {
      // Zen offered this update while its automatic updates were paused: download it now.
      if (this.held && await this.release() && topic === 'update-available') await service().downloadUpdate(update);
      return;
    }
    // While a version is held Zen's automatic updates are paused, so a new download
    // of it was started by the user from Zen's own update controls.
    if (this.held === version && !this.holding && topic === 'update-downloading' && !await UpdateUtils.getAppUpdateAutoEnabled()) { await this.allow(); return; }
    this.update = update;
    this.holding = true;
    try { await this.hold(version); } finally { this.holding = false; }
  },

  async hold(version) {
    const um = manager();
    if (um.downloadingUpdate?.appVersion === version) {
      await service().stopDownload();
      await um.cleanupDownloadingUpdate();
    }
    if (um.readyUpdate?.appVersion === version) await um.cleanupReadyUpdate();
    if (!UpdateUtils.appUpdateAutoSettingIsLocked() && await UpdateUtils.getAppUpdateAutoEnabled()) {
      Services.prefs.setBoolPref(RESTORE_AUTO, true);
      await UpdateUtils.setAppUpdateAutoEnabled(false);
    }
    Services.prefs.setStringPref(HELD, version);
    this.held = version;
    this.hidePrompts();
    this.emit();
  },

  // Ends a hold: Zen's own automatic update setting comes back as it was.
  // Returns whether automatic updates were turned back on.
  async release() {
    Services.prefs.clearUserPref(HELD);
    this.held = null; this.update = null;
    let restored = false;
    if (Services.prefs.getBoolPref(RESTORE_AUTO, false)) {
      Services.prefs.clearUserPref(RESTORE_AUTO);
      if (!UpdateUtils.appUpdateAutoSettingIsLocked()) { await UpdateUtils.setAppUpdateAutoEnabled(true); restored = true; }
    }
    this.emit();
    return restored;
  },

  // The user chose to update Zen anyway: Zennia pauses on that version until it supports it.
  async allow() {
    const version = this.held, update = this.update;
    if (!version) return;
    Services.prefs.setStringPref(ALLOWED, version);
    await this.release();
    this.allowed = version; this.emit();
    if (update) await service().downloadUpdate(update);
    else service().checkForBackgroundUpdates();
  },

  hidePrompts() {
    if (AppMenuNotifications.notifications.some(notification => ZEN_PROMPTS.test(notification.id))) AppMenuNotifications.removeNotification(ZEN_PROMPTS);
  },
};
