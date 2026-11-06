## v0.1.8-beta.4

- Fix single-line truncation for sidebar addresses and download names.
- Add accessible installer step headings and improve secondary text contrast.
- Prevent installer footer overlap at high zoom and keep product previews fully visible.
- Show installation errors beside the review controls with a recovery prompt.

## v0.1.8-beta.3

- Wait for the downloads dismissal animation before opening a file or showing it in its folder.
- Restore the default light-window opacity on Zen versions using the legacy Library fallback.
- Include the settings redesign and visual preset gallery prepared for beta.2, whose publication was blocked by runtime checks.

## v0.1.8-beta.2

- Reshape the Arc UI settings window around a side navigation rail with a scrolling content pane, like Arc's settings.
- Smooth the settings window with a shared entrance easing, layered shadow, calmer keyboard focus, 120ms hover transitions, and a thin scrollbar.
- Group the settings rows into logical sections with spacing and section headings.
- Keep the settings window a fixed height across sections so switching Appearance, Colors and Presets does not resize it.
- Slide the settings window's theme-mode highlight between Light, Dark and System, and fade the window out when it closes.
- Fade the downloads menu out on dismissal and after opening or revealing a file, alongside its hover close.
- Add Light, Dark, and System appearance modes, separate background gradients and opacity controls, and configurable page corners.
- Save named appearance presets and select them from a gallery of proportional browser previews using each preset's colors.
- Keep preset selection separate from Apply, and support saving, deleting, and resetting theme settings without losing saved presets.

## v0.1.8-beta.1

- Match New Tab hover to tab hover and soften both backgrounds to 50% opacity.
- Respect app and operating system reduced-motion settings for the New Tab hover fade.

## v0.1.7

- Increase active tab contrast and make hovered tabs visible on translucent dark windows.
- Add Active tab and Hover tab colors to Appearance, with separate light and dark palettes, live updates, and reset support.

## v0.1.4

- Discover running, portable, renamed, and custom Zen installations and their profiles; add an installation picker and Search again action.
- Improve the empty downloads popup's placement and blur over overflowing tabs.
- Give library space cards a distinct lavender background and subtle border, and refine macOS library tinting.
- Sign and verify disposable macOS development bundles outside cloud-managed folders.

## Theme features

- Apply an Arc-style lavender browser frame, rounded tabs and page corners, and consistent typography.
- Hide native background textures and duplicate navigation, sidebar, library and download controls.
- Add a top control row with navigation, the application menu and a sidebar toggle.
- Replace sidebar docking animations with coordinated sidebar movement and live page resizing.
- Make the hidden sidebar peek over page content and prevent immediate reopening after hiding it.
- Give the floating sidebar a shadow on all sides against the page inset, without a border.
- Remove contrast filtering from folder SVGs and their wrappers so the compositor keeps custom icons intact after floating-sidebar closing animations.
- Polish sidebar favorites, folder-label weight, iconless Space alignment, Search corners and the pinned-section divider.
- Disable the sidebar rail's double-click width reset while keeping native drag resizing.
- Restyle the floating address bar and keep a matching address label visible in the sidebar.
- Add native command-bar results for Archive, Downloads, Split View, horizontal split, Unsplit and Toggle Sidebar.
- Add command-bar Debug Mode with local mock data across the main views, reset, ownership-based cleanup and interrupted-session recovery.
- Add a gift-shaped library button and correct the enabled Boosts toggle's thumb alignment.
- Replace the downloads popup with an Arc-style hover menu backed by native downloads and file actions.
- Use local Lucide icons for download actions and compact lavender styling for the native main menu.
- Match Arc's white New menu with dedicated icons, grouped actions, a New Tab shortcut hint, and Zen's native Boost creation.
- Show recent downloads directly on the sidebar, with rising rows, image previews and relative timestamps instead of a separate card.
- Add a curved file-arrival animation, temporary target for a hidden sidebar, and arrival feedback.
- Respect reduced motion and add keyboard-focus states and accessibility announcements.
- Archive background tabs left idle for 12 hours into the library sidebar's Archive tab.
- Keep pinned, essential, split-view, grouped, folder and audible tabs, the selected tab and private windows out of auto-archive.
- Select the library's Archive view on first run and keep 100 closed tabs per window so archived tabs restore with their history.
- Add a local download-animation preview page.
- Apply browser layout preferences and a Windows-only text-rendering preset.
- Install local startup patches with conflict checks, backups and safe removal.
- Reopen Zen with startup-cache purging through the installer.

See [the full change list](CHANGES-FULL.md) for details.
