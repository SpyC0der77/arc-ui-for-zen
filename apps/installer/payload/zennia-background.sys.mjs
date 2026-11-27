// Runs in Zen's background update task, which Windows starts while Zen is closed.
// It leaves everything else alone: it only keeps that task from downloading a Zen
// version Zennia does not support, which would otherwise install on the next start
// before Zennia loads. `profile` is Zennia's profile, not the task's temporary one.
import { ZenniaBrowserUpdates } from 'chrome://zennia/content/browser-updates.sys.mjs';

export function start(profile) {
  ZenniaBrowserUpdates.startWhileClosed(profile);
}
