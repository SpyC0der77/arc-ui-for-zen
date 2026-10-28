# Arc UI for Zen

An Arc-style interface for Zen **1.23.4b**, with a lavender sidebar, centered address bar, library, auto-archive and animated downloads. It brings Arc's visual design to Zen's native tabs and browser features through local CSS and JavaScript patches, installed with an Electron app. It does not replace the browser engine or fork Zen.

## Install

Open the installer, select your Zen application and profile, close Zen, then click **Install**. Use **Open Zen** afterward. On first launch after Zen onboarding, a local preview page opens. Its Download button plays the file animation without downloading anything.

**Open Zen** passes `-purgecaches` so updated browser UI scripts and styles are reloaded after installation. Reopening through a normal shortcut immediately after an update can leave the previous UI cached. This clears startup code caches, not history, cookies or saved tabs.

The Windows executable is built into `release/Arc-UI-Zen-0.1.0-Windows.exe`. The Electron app also has macOS DMG/ZIP and Linux AppImage build targets. Build those on their respective operating systems with the included CI workflow. macOS and Linux installation paths are covered by automated filesystem tests; their browser runtime and distribution signing have not been validated here.

Select your actual profile explicitly when there is more than one. Zen's `about:profiles` page lists its root directory. This installer never closes your existing browser automatically, imports private data, or changes your default browser.

## Features

"Theme" means added styling, controls or animations. "Patch" means changes to Zen's existing UI behavior or settings. Some features use both. All patches load at startup; they do not modify Zen's packaged source files.

| Feature | Behavior in Zen | Implementation |
| --- | --- | --- |
| Lavender shell, typography, tabs, page corners | Arc-style colors and layout around native Zen tabs | Theme: CSS and bundled Geist fonts style the browser chrome. |
| Sidebar width and resizing | Starts at 264px; drag to resize; double-click keeps the current width | Patch: sets the initial width once and blocks Zen's double-click width reset on the sidebar splitter. Drag resizing and persistence remain native. |
| GitHub issues and pull requests | Sidebar Live Folders list your open authored and assigned items, plus PR review requests | Patch: creates missing native GitHub folders once in the first synced window's active workspace. Uses that workspace's GitHub session; no separate token. Existing folders and filters stay unchanged. |
| Auto-Archive | Background tabs idle for 12 hours close into the library sidebar's Archive tab, where they restore with history | Patch: closes eligible tabs on a timer so Zen records them as closed tabs, and selects the library's Archive view. Pinned, essential, grouped, folder, split-view, playing-audio and the selected tab are never archived. |
| Dock/undock | Toggle or Ctrl+B/Cmd+B; 220ms to dock, 180ms to hide, without scaling page text | Theme + patch: adds the toggle and shortcut, wraps Zen's compact-mode update, and animates a captured sidebar when hiding or the live sidebar when docking alongside the page width. |
| Hover peek | Reveals the hidden sidebar at the edge; 160ms close delay | Theme + patch: styles Zen's compact sidebar as a rounded overlay, sets its close-delay preference, and blocks native hover expansion after undocking until the pointer leaves the old sidebar bounds. |
| Back, forward, reload/stop | Navigation controls in the top row | Theme: adds buttons wired to Zen's native browser commands and hides the original buttons. |
| Application menu | Zen's menu in the top row | Theme: moves the existing native menu button into the added control row and restyles it. |
| Press feedback | Icons nudge when pressed | Theme: pointer handlers animate the added SVG icons through the Web Animations API. |
| Address command menu and new tab | Centered address bar with native suggestions, 16px corners and a 180ms entrance | Theme + patch: restyles Zen's floating URL bar, enables its floating and new-tab replacement settings, and adds a matching address label behind the field while it is open. |
| Command bar actions | Type Archive, Downloads, Split View, Split Horizontal, Unsplit or Toggle Sidebar; select the command with the arrow keys and Enter, or click it | Patch: a local native URL-bar provider adds matching commands alongside normal search results. Split commands use Zen's native behavior, pairing selected tabs or the current tab with the next visible tab. Unsplit appears only in a split; creating a split requires at least two visible tabs. |
| Library | Gift-shaped button opens Zen's library over the main sidebar | Theme + patch: adds a button that calls Zen's library animation and wraps that animation to keep its first frame offscreen. Native library contents remain intact. |
| Downloads hover menu | Separate public and private-window download lists | Theme + patch: builds a manual HTML popover from Mozilla's native download lists, hides Zen's download controls and hover stack, and redirects native download-panel requests to the popover. |
| Download actions | Open, reveal in folder, pause/resume, cancel | Theme: added menu buttons call the native download object's launch, reveal, cancel, start and partial-data removal methods. |
| Download animation | File curves toward the library button and shrinks over 1.6 seconds | Theme + patch: observes native download additions and animates an added file icon; disables Zen's own download animation through a preference. |
| Download arrival | Gift feedback and menu peek; closes after three seconds unless hovered or focused | Theme: animates the button and schedules the popover to close. Menu opening is suppressed while the library is open. |
| Hidden sidebar during download | Temporary gift target at the bottom-left | Theme: draws a temporary gift icon when the actual library button is outside the window. |
| Demo Download button | Plays the animation without a network request or downloaded file | Theme: a bundled local preview page calls the same file-animation function directly. |
| Reduced motion | Skips file flight, icon movement and gift highlight; retains the menu and accessibility announcement | Theme: checks the reduced-motion media query before running JavaScript animations; CSS also disables the address-bar entrance. |

The gift-shaped button combines the library and downloads controls, following Arc's sidebar design. Hover over it to reveal recent files rising from the gift, directly on the sidebar surface. Completed images show thumbnails and relative timestamps; other files use the system's file-type icons. Click the gift to open Zen's library, or use the Downloads command to open its Downloads section. The list replaces Zen's native download popup and hover stack, retaining native file actions and separate public and private lists.

Auto-Archive closes ordinary background tabs the user has not returned to for 12 hours. It runs 90 seconds after a window opens and every five minutes after that. Closed tabs are recorded by Zen itself, so they appear in the library sidebar's **Archive** tab with their history and reopen on click. Pinned tabs, Essentials, split views, tab groups, folder tabs, tabs playing audio and the selected tab are left alone, as are private windows and browser-internal pages. Set `arc-ui.archive.hours` to another number of hours, or to `0` to turn auto-archive off. On first run the theme selects the library's Archive view, and a later switch back to History is remembered. It also raises Zen's closed-tab history to 100 entries per window so an archive pass is not evicted immediately; browsing history remains available through the library's filter. The archive survives restarts through Zen's session data and is not sent anywhere.

Zen continues to manage library sections, workspaces, pinned tabs, folders, permissions, extensions, navigation and session restore. This theme recreates parts of Arc's interface using those native features; it does not reproduce every Arc feature or exactly match its macOS behavior.

Download actions use bundled [Lucide](https://lucide.dev/) SVGs. Their license is included in `payload/content/lucide/LICENSE`. Files retain their native icons and image previews.

### Debug mode

Open the command bar with **Ctrl+T** or **Ctrl+L**, type **Debug**, and select **Enable Debug Mode**. Select **Disable Debug Mode** the same way to turn it off. **Reset Debug Data** restores the original fixtures while the mode is active. The sample Spaces are named Debug Work and Debug Personal.

Debug mode fills the main views with local sample data: two native Spaces, favorites, open and collapsed folders, short and long tab titles, completed and in-progress downloads, paused/failed/cancelled transfers, Archive and History rows, media previews, Boost toggles. The mock download buttons change fixture states or show a local status message; they do not launch programs or fetch files. Library search and download filters work on the fixtures.

The library and downloads fixtures stay in memory. Temporary native tabs and Spaces are tracked separately, and turning the mode off removes only those items. Normal tabs moved into a debug Space, or mock tabs navigated to a normal page, are kept in the original Space. Generated previews live in a UUID-named temporary directory and are removed with the fixtures. If Zen is interrupted, a small ownership record lets the next startup clean up after native session and Workspace restoration. Debug mode is offered in regular windows with Workspaces enabled.

Expand the GitHub Issues and Pull Requests folders in the sidebar to see their lists. Sign in to GitHub in the same workspace if Zen reports that authentication is needed. Right-click a folder for filters, refresh and update intervals. Entries use Zen's native lazy tabs and disappear when they no longer match the folder's filters. Deleting a folder does not cause the theme to recreate it; add it again through the sidebar's native Live Folder menu. These folders remain native browser data after theme removal.

Undocking hides the sidebar even on Zen's empty new-tab page. After clicking Undock, edge hover stays blocked until the pointer leaves the sidebar's former width. Returning to the edge then reveals it normally. During the closing animation the entire live sidebar tree is hidden behind the captured layer, including native children that set their own visibility. While undocked, Zen's peek panel is the only sidebar surface: the toolbox and titlebar stop painting, the panel keeps its 12px corners and shadow over the control row, and the page keeps 10px corners across the whole window. The sidebar therefore floats over the content rather than occupying a full-height band.

## How it works

### Typography

Native tab labels, the address field, menus and added controls share one UI font stack. macOS uses its system face; Windows and Linux use the bundled Geist regular, medium and semibold faces. Tab labels and added controls use medium weight for legibility; folder names use semibold. Website font families and page zoom remain unchanged.

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

Historical Arc screenshots and their source notes live in [`dev/references/`](dev/references/README.md). They are excluded from installer packages. Pull requests run unit tests and build installers on Windows, macOS, and Linux; `pnpm verify:package` checks the resulting ASAR files for complete runtime contents and excluded development files. Pass an output directory to verify a separate build, for example `pnpm verify:package artifacts/pr-build`.

`node tests/runtime.cjs <unpatched Zen application folder>` requires a Zen application folder without an installed Arc UI theme or another AutoConfig loader. It makes an isolated application copy and profile, installs the patch there, runs native browser checks, captures browser chrome, and verifies removal. It does not modify the real installation or profile. Its temporary copies and screenshots stay under the ignored `artifacts` directory.

`tests/installer-smoke.cjs` runs with Electron and tests the actual install/remove UI and renderer isolation against temporary fixture folders. `pnpm test` covers all platform layouts, conflicts, version checks, preservation and receipt validation.

`tests/interactive.py` adds pointer-input checks through Mozilla's Marionette driver. It exercises library hover/click from docked and peeked sidebars, then records sidebar and child visibility throughout closing. It also moves the pointer along the reveal edge beyond Zen's hover timeout, checks that an intentional exit and return rearms the sidebar, and confirms the peeked panel floats (rounded card with its shadow) over rounded page corners. It attaches only to an explicitly launched test session with `--marionette` and `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`. Install its optional Python client into `artifacts/test-python` as described in the script. Close that session and reopen Zen normally afterward; the installer never enables the driver.

`python tests/debug-lifecycle.py [port]` uses the same disposable Marionette session to verify restoration of open and closed library views through debug reset/disable, and teardown while activation is paused after creating its first Space. The teardown check destroys that window's debug controller, so restart the test browser afterward.

`tests/sidebar-motion.py` uses the same Marionette session to pause docking at five points, save chrome screenshots, and verify the actual sidebar corner hit targets, transparent native layers, and control bounds. Docking uses one animated background and a matching clip on the entire sidebar tree so native square backgrounds cannot fill the rounded corners.

The UI implementation is adapted from [`arc-ui-skeleton`](https://github.com/SpyC0der77/arc-ui-skeleton), a standalone recreation of Arc's interface.

The included Geist fonts retain their license in `payload/content/Geist-LICENSE.txt`.

