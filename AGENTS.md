# Repository instructions

## UI change screenshots

Whenever you make a UI improvement or change, show before and after screenshots in the chat. Capture the affected UI before editing and again after applying the change, using the same view and interaction state so the comparison is clear. Embed both screenshots in the final response.

## Recovering Zen automation on Windows

If app capture reports `window id ... no longer belongs to B08FBE11D35D62A1; current owner is B08FBE11D35D62A1`, the identical IDs do not mean a valid capture. This was reproduced with a fresh window after restarting Zen on 2026-10-28. Restarting alone did not fix it, and both Computer Use tools used the same failing helper. Do not ask the user to restart Zen or repeat the same capture loop.

1. Refresh the app/window inventory and retry once with the returned window object. Never reuse old handles, screenshot IDs, or accessibility indexes.
2. If the same error persists, use the repository's Marionette workflow in a **disposable application copy and profile**. Run `node scripts/chrome-session.cjs <unpatched Zen application folder>`. It creates an ignored `artifacts/chrome-session-*` directory and prints its app, profile, PID, port and manifest. A clean application copy left by a successful `tests/runtime.cjs` run can be used as the source. The launcher refuses loader conflicts; do not force past them or strip loaders from the real installation.
3. Install the optional client if needed with `python -m pip install --target artifacts/test-python marionette_driver`. Follow `tests/interactive.py`: connect to localhost on the printed port, start a session, and set the context to `chrome`. Use native `ActionSequence` pointer input for hover/click verification. `m.screenshot()` returns a base64 PNG of the actual browser chrome. Save it under `artifacts/` and embed the PNGs in the final answer.
4. Fix the window size, page, sidebar state, pointer target and animation time for both captures. Capture before editing. For motion comparisons, pause the actual icon animation at a known time and also verify that it finishes and resets naturally. Account for easing when seeking a keyframe. Allow the compositor to paint after seeking before taking the screenshot; an immediate capture can contain the previous frame. Verify the screenshot actually shows the affected icon. Do not substitute an HTML recreation for browser screenshots.
5. Close the disposable session with `Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)` through Marionette and wait for its PID to exit. To test updated payloads in the same disposable session, close it, use `installer/engine.cjs` to remove and reinstall into the printed app/profile, and reopen with `-purgecaches`. The running-browser check may be overridden **only for that verified disposable app copy** when an unrelated personal Zen is open. All other receipt and edited-file checks remain enabled.

Never enable Marionette or `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS` in the user's regular profile. Set that environment variable only on the disposable child process. Keep personal tabs and data out of screenshots. This fallback bypasses the broken app-identity helper; it does not repair that external helper.

The user authorizes graceful Zen restarts needed for this project's update/recovery workflow. If native app control cannot close Zen, PowerShell's `Get-Process zen | Where-Object MainWindowHandle -ne 0` followed by `CloseMainWindow()` is an authorized fallback. Wait for all Zen processes to exit. Do not force-kill Zen, remove profile locks, or delete browser data. Reopen the personal profile with the installer's **Open Zen** action, then rediscover any native window handles.

## Zen theme updates

After every change to this project, update the installed Zen theme before handing off:

1. If Zen is running, close it and wait until its processes have exited.
2. Use the installer to remove the previous theme from the same Zen installation and profile.
3. Install the updated theme to that same installation and profile.
4. Reopen Zen with the installer's Open Zen action so startup caches are purged.

Never delete Zen's profile or browser data. If removal or installation reports edited files, a mismatched receipt, or another condition that prevents a safe update, stop and report the specific issue instead of forcing the change.
