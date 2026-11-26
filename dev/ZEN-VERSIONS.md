# Zen versions

Everything that differs between supported Zen releases lives in
`payload/zen-versions/`. Feature code never checks a Zen version number.

```
payload/zen-versions/
  base.json      what every supported version shares
  1.22.3b.json   only what is different in 1.22.3b
  1.23.3b.json
  1.23.4b.json
  1.24b.json
  1.24.1b.json
```

A Zen version is supported exactly when it has a file here. The installer, the
startup loader (`zennia.cfg`), in-place updates, `fetch:zen`, the CI matrix and
release notes all read this folder.

## Reading a version file

A version file is merged over `base.json`: objects merge key by key, and lists
and values replace the base value. Keys appear in this order:

| Key | Meaning |
| --- | --- |
| `version` | Zen's `App.Version`; must match the file name. |
| `notes` | A sentence or two on what is special about this version. |
| `features` | Switches feature code reads through `zen.features`. |
| `prefs`, `platformPrefs` | Preferences the installer manages in `user.js`; `platformPrefs.windows` adds Windows-only tuning. |
| `renames` | Zen internals that have a different name in this version (see below). |
| `unavailable` | Zen internals this version does not have, grouped by area. The rules that use them simply match nothing. |
| `runtime` | The official Windows installer and its SHA-256, used by `fetch:zen` and CI. |

For example, `1.22.3b.json` turns off the native library, auto-archive and debug
mode and lists the library names it lacks. `1.24b.json` contains only its
download because it matches `base.json` exactly.

### Features

| Feature | Values | Effect |
| --- | --- | --- |
| `library` | `"native"` or `"menu"` | Native library rail, or a menu with Downloads, Bookmarks, History and closed tabs. |
| `archive` | boolean | Auto-archive idle tabs into the native Archive. |
| `debugMode` | boolean | Debug Mode mock data in the native library. |
| `liveFolders` | boolean | GitHub provider for native live folders. |
| `boosts` | boolean | **New Boost** in the create menu. |

## Writing feature code

Write Zen names as `base.json` and the newest supported Zen use them, and let
the helpers translate:

| Zen internal | Write | Example |
| --- | --- | --- |
| DOM id, class, attribute, command, CSS custom property | `zen.name("…")` around any string containing it | `document.getElementById(zen.name("zen-sidebar-foot-buttons"))` |
| Preference | `zen.pref("…")` | `Services.prefs.getBoolPref(zen.pref("zen.welcome-screen.seen"))` |
| `chrome://browser/…`, `resource:///modules/zen/…` URL | `zen.url("…")` | `link.href = zen.url("chrome://browser/content/zen-styles/zen-boosts.css")` |
| Module export | `zen.import(url, name)` | `zen.import("resource:///modules/zen/ZenLiveFoldersManager.sys.mjs", "ZenLiveFoldersManager")` |
| Global such as `gZenWorkspaces`, and its members | Use directly | `window.gZenWorkspaces.moveTabToWorkspace(tab, id)` |
| Property replaced with `Object.defineProperty` | `zen.member(owner, name)` | `zen.member("zen-library", "openProgress")` |
| Stylesheet | Load through `zen.stylesheet(url)` | `zennia.css` and everything it imports |

Feature scripts receive `zen` in their dependencies. ES modules import it from
`chrome://zennia/content/zen.sys.mjs` (`commands.sys.mjs` imports it on use so
node tests can load its action list). A list of Zen names that is translated
where it is used carries the line comment `// zen.name() at use`.

`npm test` fails when a Zen name in JavaScript bypasses these helpers.

## When Zen changes something

**A name changes.** Add it to `renames` in that version's file:

```json
"renames": {
  "names":   { "zen-library-footer": "zen-library-bottom" },
  "globals": { "gZenFolders": "gZenFolderManager" },
  "members": { "gZenFolders.createFolder": "addFolder", "zen-library.openProgress": "progress" },
  "prefs":   { "zen.welcome-screen.seen": "zen.welcome.seen" },
  "urls":    { "resource:///modules/zen/ZenLiveFoldersManager.sys.mjs": "resource:///modules/zen/LiveFolders.sys.mjs" }
}
```

`names` covers stylesheets too: with any name renamed, `zennia.css` and its
imports are combined and rewritten when the window opens. Renamed globals and
members are aliased under their base names, so code that reads, calls or
replaces `gZenFolders.createFolder` reaches the new member. Members of custom
elements are keyed by tag, for example `zen-library.openProgress`.

**Something is removed.** List it under `unavailable` with the area it belongs
to. If a whole feature depends on it, also switch the feature off in `features`.

**Behavior changes.** When the same name now works differently, the data can
only choose between implementations. Add a value to the relevant `features`
switch, implement it beside the existing one, and select it in the version file.
For example, the `library: "menu"` value selects `installLegacy` in
`features/library/library.js`.

`base.json` also lists, under `apis`, the members feature code uses on Zen
objects through local variables. The checker cannot see those uses.

## Adding a Zen version

The **Watch Zen releases** workflow (`.github/workflows/zen-releases.yml`) runs
daily. For each stable Zen release newer than every supported version, it
drafts a version file from the newest one, downloads the release on Windows,
and runs both the surface check and the full browser test suite
(`tests/runtime.cjs --pointer`) with only that draft file. It then opens a
`Support Zen <version>` issue that starts with the verdict:

- **Works without changes** (label `zen-works-unchanged`): both checks pass, so
  adding the draft file and updating the README range is all that is needed.
- **Needs changes** (label `zen-needs-changes`): the issue lists the missing Zen
  internals and the failed browser checks.
- **Not checked** (label `zen-unchecked`): the release has no installer with a
  SHA-256 digest to pin.

Logs and browser diagnostics, including screenshots, are attached to the
workflow run. Each version gets one issue, open or closed. Run it by hand from
the Actions tab with **Run workflow**.

1. Add `payload/zen-versions/<version>.json` with `version`, `notes` and the
   `runtime` download and SHA-256.
2. On Windows: `pnpm fetch:zen -- <version>` then `pnpm check:zen -- <version>`.
   The checker reads the build's `omni.ja` archives in memory and lists every
   name, global, member, preference and URL Zennia uses that the build lacks.
3. Record each difference as a rename, an unavailable name or a feature switch,
   and run the check again until it passes.
4. Run `pnpm test` and `pnpm test:runtime -- artifacts/zen-builds/<version>/core --pointer`.
5. Add the version to the README's list of supported versions. A test checks the
   list.

CI runs the same check for every version before its runtime tests.

## Shipping version support as a theme update

The loader accepts any version whose file is installed, so a theme update can
add Zen versions without a reinstall, provided the new version uses the same
managed preferences. In-place updates refuse to change managed preferences; a
version that needs different `prefs` requires running the installer. The
installer writes the preferences for the Zen version present at install time.
