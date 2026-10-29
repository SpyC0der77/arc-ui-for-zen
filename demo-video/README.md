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
