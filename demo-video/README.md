# Demo video

The code and assets for the Arc UI for Zen product demo live here.

The current video is [exports/arc-ui-for-zen-demo-cursor.mp4](exports/arc-ui-for-zen-demo-cursor.mp4): 1920 x 1080, 30 fps, 2:32, silent, with a visible cursor.

## Folder layout

- `scripts/build.py`: rebuilds and verifies the final exports from saved recordings.
- `scripts/add-cursor.py`: generates the cursor motion, timed to the recorded interactions.
- `scripts/capture/`: the original Electron and Marionette recording scripts.
- `scripts/archive/`: setup attempts, probes, and recovery scripts retained for reference.
- `assets/`: wallpaper, Windows arrow cursor, and Lucide SVG Space icons.
- `recordings/`: source video takes, including the installer window before wallpaper composition.
- `timeline/`: edit decisions, shot timings, cursor positions, and original session metadata.
- `exports/`: the finished videos with and without the cursor.
- `review/`: captured screenshots, contact sheets, posters, and failed capture experiments.
- `runtime/`: archived disposable Zen application/profile copies and the Electron capture profile.

Code, small assets, and timeline files can be versioned. Large recordings, exports, review images, and disposable runtime data are ignored by this folder's `.gitignore`.

## Rebuild the video

Requires Python 3 and FFmpeg with `ffprobe` on PATH. No browser, development server, or Python packages are needed to rebuild the saved takes. Run from the repository root:

```powershell
python demo-video/scripts/build.py --check
python demo-video/scripts/build.py
```

To also rebuild the wallpaper composition from the original installer window recording:

```powershell
python demo-video/scripts/build.py --rebuild-onboarding
```

The build reads `timeline/edit.json` and `timeline/edit.ffconcat`, renders the edit, generates the cursor commands, adds the cursor, and verifies duration, resolution, and frame rate. Outputs go to `exports/`.

## Recording new footage

The capture scripts recorded the actual Electron installer and Zen browser chrome, not an HTML recreation. Browser captures were taken at 20 fps and encoded to 30 fps. The installer was captured at 30 fps.

The browser scripts are session-specific recording passes, not a one-command fresh setup. They expect a disposable Marionette session on port 2828 with the native Work, Personal, and Reading Spaces and `window.demoTabs` / `window.demoSpaces` already prepared. See the repository's `scripts/chrome-session.cjs` and `tests/interactive.py` for the supported disposable-session workflow and optional `marionette_driver` dependency. Use `scripts/archive/` to understand the original setup attempts; those historical scripts retain old paths and window handles and should not be rerun as-is.

`record-onboarding.cjs` uses Electron from this repository. Set `ARC_DEMO_ZEN_SOURCE` to an unpatched Zen application folder. Each run installs into a fresh disposable copy under `runtime/`. Do not run it against a personal profile.

The archived runtime copies were moved for organization. Their installer receipts still contain their original absolute paths. Treat them as historical capture data, not reusable installed browser sessions. Create a fresh disposable copy for another recording. Shared tooling such as `artifacts/test-python` remains outside this folder.

## Capture details and limits

The video includes onboarding, an actual disposable installation, Essentials, folders, native Spaces with SVG icons, sidebar docking and peek, resizing, command suggestions, both split directions, Downloads, library Spaces, media opt-in, the download hover menu, both file-flight variants, GitHub Live Folders, Boosts, auto-archive, and restoration.

- Auto-archive uses the installed code against a real JavaScript documentation tab aged 13 hours, with its initial timer shortened.
- The image download is a real native local-file download. File-flight demonstrations use the product's preview API.
- GitHub Live Folders are signed out. No personal accounts or browsing data were used.
- Native application-menu popups are absent from Marionette chrome captures, so those failed shots were excluded.
- Download open/reveal, transfer pause/resume/cancel, private download separation, and reduced-motion mode are not demonstrated.
- Media and Boosts show genuine initial states.
- The visible Windows arrow is composited programmatically. No captions, click rings, title cards, taskbar, or other added graphics are present.

No product source was changed to make the recording. The disposable Zen session was closed gracefully after capture.

## Three-browser comparison

The comparison tools use actual native browser recordings, with Arc on the left,
Arc UI for Zen in the middle, and vanilla Zen on the right. They do not use
Codex computer-use tools or a development server. The existing recording scripts
and original edit remain unchanged. The comparison skips the original onboarding
segment and starts with the browser features.

- `scripts/capture/prepare-comparison.cjs` creates separate disposable Zen apps
  and profiles, with Marionette enabled only on their child processes.
- `scripts/capture/record-themed.py` wraps the **original** four browser recording
  passes, preserves their actions, and records animation-settled checkpoints.
  It redirects new media and metadata into a separate output directory. The old
  auto-archive source lookup follows its current file location.
- `scripts/capture/record-onboarding-comparison.cjs` runs the original Electron
  installer recording with isolated outputs and platform-correct discovery data.
  It verifies all 570 frames, a visible success page, an installation receipt and
  the original script hash. `scripts/prepare-onboarding.py` applies the original
  wallpaper composition and cursor cues, with a camera following the setup column.
- `scripts/capture/record-vanilla.py` records native Zen counterparts. Missing
  download-flight and automatic-archive behavior is explicitly marked unavailable;
  manually closing a tab is described as a native alternative.
- `scripts/capture/mac-native.swift` and `record-arc.py` provide native macOS
  mouse/key input and window-only capture. Arc requires a dedicated demo window
  and feature actions/predicates checked against the real application. The example
  recipe is a skeleton, not a completed Arc demo.
- `scripts/capture/sign-disposable.cjs` locally signs a stopped disposable Mac
  copy after the installer adds its resources. It preserves browser runtime
  capabilities, omits certificate-bound identity/passkey entitlements, and checks
  the resulting signature. It never signs a running or personal installation.
- `scripts/capture/refresh-disposable.cjs` applies the required installer
  remove/install/Open Zen workflow to a verified, stopped disposable copy, keeping
  edited-file and receipt checks enabled.
- `scripts/assemble-comparison.py` matches actual checkpoint metadata to the
  original retained feature order. It refuses missing recordings or checkpoints.
- `scripts/comparison.py` renders 1920×1080 at 30 fps with three labelled
  600×900 feature-focused panels. Camera moves preserve aspect ratio. Per-feature
  camera keyframes and pre-camera cursor tracks are supported.

For each feature the editor plays each panel through its measured completion
checkpoint at its original speed. An early panel holds its last frame until the
slowest panel completes. All panels then hold for **90 more frames (three
seconds)** before the next feature begins. Availability captions remain visible.
Feature cameras keep a constant zoom rather than restarting a push-in after
each pause. Explicit camera pans remain available for following native controls.
The original19-second installer segment is retained. Arc and stock Zen wait at
their own actual baseline browser views while the middle lane installs the theme;
the common three-second pause then starts after the installer finishes. These
baseline holds are labelled as native interfaces, not as theme installations.

Use a Python environment with `marionette_driver` and `Pillow`, plus FFmpeg and
ffprobe on PATH. For example, create a virtual environment under `artifacts/` and
install those two packages there. No global Python changes are needed.

```sh
node demo-video/scripts/capture/prepare-comparison.cjs create /path/to/unpatched/Zen.app
# Use the session.json path printed above as SESSION below.
# macOS only, after installation and before the first launch:
node demo-video/scripts/capture/sign-disposable.cjs "$SESSION" themed
node demo-video/scripts/capture/prepare-comparison.cjs start "$SESSION" themed
python demo-video/scripts/capture/record-themed.py --manifest "$SESSION" --setup --output artifacts/comparison-themed
node demo-video/scripts/capture/prepare-comparison.cjs close "$SESSION" themed

node demo-video/scripts/capture/prepare-comparison.cjs start "$SESSION" vanilla
python demo-video/scripts/capture/record-vanilla.py --manifest "$SESSION" --setup-and-record
node demo-video/scripts/capture/prepare-comparison.cjs close "$SESSION" vanilla
```

Set `ARC_DEMO_PYTHON` to that environment's Python executable when invoking the
launcher's close command. Keep setup and recording in the same Marionette session:
this Mac's Zen build failed to create a second session after standalone setup.
The launcher refuses a restart while the previous process is still exiting and
never force-quits a browser.

Once all three actual browser takes and metadata are available:

```sh
python demo-video/scripts/assemble-comparison.py --themed artifacts/comparison-themed --arc /path/to/arc.json --zen demo-video/recordings/comparison/vanilla.json --output demo-video/timeline/comparison.json
python demo-video/scripts/comparison.py demo-video/timeline/comparison.json --check
python demo-video/scripts/comparison.py demo-video/timeline/comparison.json --output demo-video/exports/arc-zen-comparison.mp4
python -m unittest discover -s demo-video/tests -v
```

Record the original installer segment separately (requires the pinned Electron
dependency, installed with `pnpm install --frozen-lockfile`; no dev server):

```sh
env -u ELECTRON_RUN_AS_NODE ARC_DEMO_ZEN_SOURCE=/path/to/unpatched/Zen.app node_modules/.bin/electron demo-video/scripts/capture/record-onboarding-comparison.cjs
python demo-video/scripts/prepare-onboarding.py --take demo-video/recordings/comparison/onboarding-window.json --output-root artifacts/comparison-themed-03
```

`--plan` validates editorial timing without footage; `--check` additionally probes
all real videos and camera bounds. Tests include actual H.264 encoding and frame
checks for early arrival, the shared pause, captions and original feature order.

**Current status:** the three-browser comparison has not been exported. The local
native Arc permission probe reports Screen Recording enabled and Accessibility
disabled, so the actual Arc feature recipes/recording remain unfinished.

The vanilla pass in `recordings/comparison/vanilla-03.mp4` completed all 36 feature
checkpoints; its metadata is `vanilla-03.json`. Its split captures use native
compositor readback if Gecko's `drawSnapshot` fails. Restore dispatches Zen's
actual `History:UndoCloseTab` command. Native Space icons use the original local
SVG files: this build interprets a `data:` SVG URL as text because it identifies
SVG icons by a `.svg` suffix.

The four themed takes under `../artifacts/comparison-themed-03/` completed the
retained original edit, using the unchanged original recorder actions. The wrapper
stops after the last retained shot of each take, so excluded trailing actions do
not invalidate the actual edit. Checkpoint logic now observes the last quiet
period, including late chrome mutations/animations; this prevents future delayed
actions from being trimmed by an earlier quiet moment. The existing captures
still require editorial readiness/camera review before final assembly.

The original installer segment has also been captured and composed in that
output root. Its real successful installation reached the visible completion
page at frame444 (14.8 seconds), and all570 original frames were preserved.
Assembly now refuses to silently omit a referenced installer segment. The camera
audit also corrected bottom-anchored Space/download shots and follows the real
file-flight launch area toward the download control.

The first captures are preserved as `.partial.json` metadata; partial takes cannot
be assembled as complete lanes. macOS startup assessment was resolved for fresh
disposable themed copies by local signing. The first unsigned copy is still held
before startup, and graceful browser shutdowns can take several minutes. No
process has been force-killed and no personal profile has been used.
