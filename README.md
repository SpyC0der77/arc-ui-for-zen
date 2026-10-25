# Arc UI for Zen

An Electron installer plus local CSS and JavaScript patches for Zen **1.23.4b**. It ports the existing `arc-ui-skeleton` interface onto Zen's native browser features. It does not replace the browser engine or fork Zen.

## Install

Open the installer, select your Zen application and profile, close Zen, then click **Install**. Use **Open Zen** afterward. On first launch after Zen onboarding, a local preview page opens. Its Download button plays the file animation without downloading anything.

**Open Zen** passes `-purgecaches` so updated browser UI scripts and styles are reloaded after installation. Reopening through a normal shortcut immediately after an update can leave the previous UI cached. This clears startup code caches, not history, cookies or saved tabs.

The Windows executable is built into `release/Arc-UI-Zen-0.1.0-Windows.exe`. The Electron app also has macOS DMG/ZIP and Linux AppImage build targets. Build those on their respective operating systems with the included CI workflow. macOS and Linux installation paths are covered by automated filesystem tests; their browser runtime and distribution signing have not been validated here.

Select your actual profile explicitly when there is more than one. Zen's `about:profiles` page lists its root directory. This installer never closes your existing browser automatically, imports private data, or changes your default browser.

## Feature mapping

| Arc UI feature | Zen implementation |
| --- | --- |
| Lavender shell, typography, tabs, page corners | Bundled CSS and Geist fonts, keeping native Zen tabs |
| Sidebar width and resizing | Initial 264px width; native Zen splitter and persistence |
| Dock/undock | Single toggle or Ctrl+B/Cmd+B; shared 240ms sidebar slide and live page resize, without scaling page text |
| Hover peek | Zen compact mode, tuned reveal and 160ms close behavior |
| Back, forward, reload/stop | Native browser commands in the Arc UI control row |
| Press feedback | Local Web Animations API icon nudges |
| Address command menu and new tab | Click or keyboard opens Zen's native centered URL bar; 16px corners, 180ms entrance, native suggestions and new-tab replacement |
| Secondary library | Gift click opens Zen's functional library overlay, covering the main sidebar |
| Downloads hover menu | Real public or private-window download list, separately scoped |
| Download actions | Open, reveal in folder, pause/resume, cancel |
| Download flight | Same 65-point ballistic arc, 1.6-second flight and shrinking file |
| Download arrival | Gift feedback and three-second menu peek |
| Hidden sidebar during download | Temporary gift target at the bottom-left |
| Demo Download button | Local chrome page, no network request and no downloaded file |
| Reduced motion | File flight and icon movement skipped; arrival feedback remains |

The gift is the single library/downloads button. Hover shows the custom menu backed by native public/private downloads; click opens Zen's existing library overlay. Show all downloads opens the library's real Downloads section. Native library/download toolbar buttons are hidden, and native download panel requests open the custom menu. Zen retains its own library sections, workspaces, pinning, folders, permissions, extensions, navigation and session restore. The base interface's placeholder selectors are superseded by the functional native library. This is a first port, not a claim of identical Arc/macOS behavior or the Electron prototype's captured-page transition implementation.

Undocking hides the sidebar even on Zen's empty new-tab page. After clicking Undock, edge hover stays blocked until the pointer leaves the sidebar's former width. Returning to the edge then reveals it normally. During the closing animation the entire live sidebar tree is hidden behind the captured layer, including native children that set their own visibility. While undocked, Zen's peek panel is the only sidebar surface: the toolbox and titlebar stop painting, the panel keeps its 12px corners and shadow over the control row, and the page keeps 10px corners across the whole window. The sidebar therefore floats over the content rather than occupying a full-height band.

## How it works

### Typography

Native tab labels, the address field, menus and added controls share one UI font stack. macOS uses its system face; Windows and Linux use the bundled Geist regular and medium faces. Tab labels and added controls use medium weight for legibility. Website font families and page zoom remain unchanged.

On Windows the installer also applies a profile-local DirectWrite preset: Natural Symmetric rendering (`rendering_mode=5`), grayscale preference (`cleartype_level=0`), moderate contrast (`enhanced_contrast=50`) and gamma 2.2 (`gamma=2200`). These are supported [Mozilla rendering preferences](https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/all.js). They affect browser and website text where the graphics backend honors them. The result depends on display scaling, GPU and font; it approximates macOS rather than replacing DirectWrite with CoreText. No Windows registry or system-wide ClearType settings are changed. macOS and Linux keep their native rasterization settings.

To update an existing installation, close Zen, use the previous installer to Remove, then Install with the new build. Removal restores previous rendering preferences through the normal receipt backup.

The installer adds two app startup files, `arc-ui.cfg` and `defaults/pref/arc-ui-autoconfig.js`. They register local chrome packages and load `chrome/arc-ui/arc.uc.js` only in the selected profile. Scripts and fonts are bundled; no remote scripts are downloaded or executed.

The loader enables the unsandboxed **AutoConfig script context**, which gives these local scripts browser-level privileges. This does not disable web-content sandboxing, extension signatures, TLS checks or web security. The installer discloses this before installation and refuses to replace an existing AutoConfig loader, including Sine/fx-autoconfig installations.

Supported app layouts:

- Windows: a folder containing `zen.exe`, normally `%LOCALAPPDATA%/Zen Browser`.
- macOS: `Zen.app`; startup files go in `Contents/Resources`.
- Linux: an extracted/install directory containing `zen` and `application.ini`.

A user-writable Zen application folder is required. The installer does not request elevation or work around OS protections. Immutable Flatpak/Snap/AppImage browser installations are not supported directly. macOS bundle changes and code signing still require platform validation before a signed release can be claimed.

The payload checks the exact Zen version again at startup and does not run in Safe Mode. After a Zen upgrade the installer must be updated and the patch retested. It does not pin or disable Zen updates. Removal remains available after an upgrade.

## Remove and recover

Close Zen, open the same installer, select the same folders, and click **Remove**. A receipt at `PROFILE/chrome/arc-ui.install.json` records owned files and the previous settings. Removal restores the original `user.js`, or removes only its managed block when unrelated edits were added. Only persisted preferences that still match the installed value are restored; later user changes are retained. Namespaced `arc-ui.*` state may remain, with no active loader.

Install and removal use atomic file writes and rollback on ordinary write failures. Edited patch files are not silently deleted. The installer reports their path and keeps the receipt. Keep that receipt until removal finishes. A crash or power failure between file writes is not a fully transactional filesystem operation; the receipt is written first for recovery.

## Build and verify

From the project root, with Node.js and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm start
pnpm dist:win
pnpm dist:mac
pnpm dist:linux
```

`start` launches the local Electron app, with no development server. Build only the target for the host OS. The release is currently unsigned.

`node tests/runtime.cjs <Zen application folder>` makes an isolated application copy and profile, installs the patch there, runs native browser checks, captures browser chrome, and verifies removal. It does not modify the real installation or profile. Its temporary copies and screenshots stay under the ignored `artifacts` directory.

`tests/installer-smoke.cjs` runs with Electron and tests the actual install/remove UI and renderer isolation against temporary fixture folders. `pnpm test` covers all platform layouts, conflicts, version checks, preservation and receipt validation.

`tests/interactive.py` adds pointer-input checks through Mozilla's Marionette driver. It exercises library hover/click from docked and peeked sidebars, then records sidebar and child visibility throughout closing. It also moves the pointer along the reveal edge beyond Zen's hover timeout, checks that an intentional exit and return rearms the sidebar, and confirms the peeked panel floats (rounded card with its shadow) over rounded page corners. It attaches only to an explicitly launched test session with `--marionette` and `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`. Install its optional Python client into `artifacts/test-python` as described in the script. Close that session and reopen Zen normally afterward; the installer never enables the driver.

The included Geist fonts retain their license in `payload/content/Geist-LICENSE.txt`.

