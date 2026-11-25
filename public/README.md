# Public demo videos

| File | Platform | Length | Format |
| --- | --- | --- | --- |
| [arc-ui-for-zen-comparison-windows.mp4](arc-ui-for-zen-comparison-windows.mp4) | Windows 11 (Arc lane from macOS) | 48.7 s | 1920×1080, 60 fps, H.264 |
| [arc-ui-for-zen-comparison-macos.mp4](arc-ui-for-zen-comparison-macos.mp4) | macOS | 49.1 s | 1920×1080, 60 fps, H.264 |

Each video shows Arc, Arc UI for Zen and vanilla Zen side by side across six features: Essentials, Spaces and folders; switching Spaces; the hidden sidebar with hover peek; the centered command bar; split view; and the Spaces overview. A closing board shows more features. All browser footage is real 60 fps window capture of disposable browser copies with public demo tabs only. The cursor is composited from the logged pointer positions.

## How they were made

The code lives in [`demo-video/`](../demo-video/); [`demo-video/README.md`](../demo-video/README.md) has the full instructions ("Real-time recordings" for macOS, "Windows export" for Windows).

- **Capture:**
  - macOS: [`window-recorder.swift`](../demo-video/scripts/capture/window-recorder.swift) (ScreenCaptureKit).
  - Windows: [`window-recorder-win/`](../demo-video/scripts/capture/window-recorder-win/) (Windows.Graphics.Capture) and [`win_native.py`](../demo-video/scripts/capture/win_native.py).
- **Browser choreography:**
  - Zen lanes: [`live_zen.py`](../demo-video/scripts/capture/live_zen.py), driven through [`marionette-host.py`](../demo-video/scripts/capture/marionette-host.py) in disposable copies made by [`prepare-comparison.cjs`](../demo-video/scripts/capture/prepare-comparison.cjs).
  - Windows driver: [`live_windows.py`](../demo-video/scripts/capture/live_windows.py).
  - Arc lane: [`live_arc.py`](../demo-video/scripts/capture/live_arc.py).
- **Timeline:** [`live_manifest.py`](../demo-video/scripts/live_manifest.py) lines the three lanes up on shared events and writes [`timeline/live.json`](../demo-video/timeline/live.json) (macOS) and [`timeline/live-windows.json`](../demo-video/timeline/live-windows.json) (Windows).
- **Render:** [`polished.py`](../demo-video/scripts/polished.py), with the highlight cut in [`timeline/highlights.json`](../demo-video/timeline/highlights.json).
- **Text:** [`text-render.swift`](../demo-video/scripts/text-render.swift) on macOS (Core Text); [`text-render-win/`](../demo-video/scripts/text-render-win/) on Windows (DirectWrite).
- **Bento board:** [`timeline/bento.json`](../demo-video/timeline/bento.json) and [`timeline/bento-windows.json`](../demo-video/timeline/bento-windows.json). The Windows images come from [`bento_zen.py`](../demo-video/scripts/capture/bento_zen.py).

The Windows video was rendered with:

```powershell
python demo-video/scripts/live_manifest.py --live demo-video/recordings/windows --output demo-video/timeline/live-windows.json
python demo-video/scripts/polished.py demo-video/timeline/live-windows.json --bento demo-video/timeline/bento-windows.json `
  --label "arc=Arc (macOS)" --subtitle "On Windows 11, side by side with Arc and vanilla Zen" `
  --output demo-video/exports/arc-zen-comparison-windows.mp4
```
