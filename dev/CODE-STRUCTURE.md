# Browser UI code

Paths below are relative to `payload/content/`. Start at `payload/arc.uc.js`. It loads the stylesheet, installs the features in order,
connects their callbacks, and preserves the `window.ZenArc` API used by commands,
debug mode, and browser tests. Keep UI implementations out of that file.

## Where to make a change

| Change | JavaScript | Styles |
| --- | --- | --- |
| Sidebar starting width and splitter double-click | `features/sidebar/width.js` | `shared/palette.css` |
| Docking, hover rearming, and transition snapshots | `features/sidebar/compact-mode.js` | `features/sidebar/*.css` |
| Parked address text and native search popup | `features/address-bar/address-label.js` | `features/address-bar/*.css` |
| Back, forward, reload, and sidebar toggle | `features/navigation/controls.js` | `features/navigation/*.css` |
| Create menu and native popup shadow roots | `features/menus/create-menu.js` | `features/menus/menus.css`, `menu-popup.css` |
| Recent files, hover, download services, and arrival motion | `features/downloads/downloads.js` | `features/downloads/*.css` |
| Download row icons, labels, and action buttons | `features/downloads/rows.js` | `features/downloads/popup.css` |
| Library trigger, opening position, and footer | `features/library/library.js` | `features/library/*.css` |
| Idle-tab archiving and native history integration | `features/archive/auto-archive.js`, `archive.js` | Native library styles |
| GitHub live-folder setup | `features/github/live-folders.js`, `github.js` | `features/menus/provider-actions.css` |
| Provider-owned context-menu restrictions | `native-actions.js` | `features/menus/provider-actions.css` |
| Modifier-click to detach split tabs | `split-actions.js` | `features/tabs/tabs.css` |
| Command results | `commands.sys.mjs` | `features/commands/commands.css` |
| Debug fixtures | `debug.sys.mjs`, `debug-data.mjs` | `features/debug/controls.css` |
| First-run demo opening | `features/onboarding/demo.js` | The demo page owns `home.css` |
| Shared controls, icons, and motion | `shared/ui.js`, `shared/motion.js` | `shared/*.css` |

The existing command, debug, archive, provider, and split-action modules retain
their file paths so current imports and tests continue to work.

## Feature ownership

A feature exports a named object with `install(window, dependencies)`. Browser
objects come from that window; other dependencies are explicit arguments. Return
only the operations another feature needs, plus `destroy()` for cleanup.
`rows.js` is a stateless renderer and has no cleanup to perform.

Each script loads into a separate subscript scope. The scope must not store
browser windows globally. Timers and animation handles belong to a motion
instance created for their owner. `destroy()` cancels that owner's work and
prevents a late promise continuation from scheduling it again.

The library owns the gift button and its native library animation. Downloads
receives the button and an `isLibraryOpen` callback. The library receives a
`hideDownloads` callback. Neither feature reads the other's internal state.
Navigation receives callbacks to refresh the address label and toggle docking.
The compact sidebar asks navigation to refresh after its transition finishes.

Native methods are wrapped only where required. Save the original method beside
the wrapper and restore it during cleanup. Persistent preferences such as the
initialized sidebar width intentionally survive window closure. Teardown is for
window unload; it is not a promise of live theme uninstallation or hot reload.

## CSS order

`../arc.css` is the import list. Its order preserves the original cascade. Several
features have more than one stylesheet because their later overrides originally
followed other features. Keep that ordering unless the behavior change calls for
changing it. Each imported file preserves its original document scope, including
the deliberately unscoped font faces and command-result rules.

The native popup stylesheet remains at `menu-popup.css`: menus inject that file
into lazy popup shadow roots, which the main stylesheet cannot style directly.

## Editing and verification

Use descriptive function names, separate statements, and comments that explain
native browser constraints or timing requirements. For example, keep the reason
for measuring the URL input's anonymous editor beside that measurement. Avoid
comments that merely restate the next assignment.

Run `npm test` for the filesystem and behavior tests. For actual browser chrome,
follow the disposable application/profile workflow in the repository's
`AGENTS.md`. `tests/runtime.cjs` checks native integration;
`tests/interactive.py` exercises trusted pointer input, sidebar hover, and library
behavior. `tests/feature-windows.py` checks ordinary/private window isolation
and cleanup. Use the same view and state for before/after screenshots. Never start a
development server or enable Marionette in a personal profile.
