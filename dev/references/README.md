# Arc design references

These images document the visual evidence used for this theme. They are development context, not application assets. `electron-builder` includes only `installer/`, `payload/`, and the package manifest, and explicitly excludes `dev/`. CI opens the built ASAR to check that references remain excluded and runtime files match the source.

The screenshots belong to their original publishers. They are historical examples, mostly from 2023–2024, and do not establish Arc's current behavior. Author-added arrows and highlights are part of the sources. Crops and enlarged details preserve the original pixels; they are not UI reconstructions. Production icons and fonts live separately in `payload/`, with their applicable license files.

## Sources and usage

| Folder | Reference | Source and context |
| --- | --- | --- |
| `arc/sidebar/` | `arc-pinned-sidebar.png` | [All Things How: pinned tabs](https://allthings.how/how-do-pinned-tabs-work-in-arc-browser/), October 2023. Primary reference for sidebar spacing, Essentials, folder hierarchy, and dividers. |
| `arc/sidebar/` | Other sidebar captures | Retained from the earlier comparison. Exact source URLs were not recorded for these files, so use them as secondary visual context rather than attributed measurements. |
| `arc/parts/` | Command bar | [TidBITS: Arc browser review](https://tidbits.com/2023/05/01/arc-will-change-the-way-you-work-on-the-web/), May 2023; [Appsntips review](https://www.appsntips.com/home/arc-browser-review-top-features/), March 2023. |
| `arc/parts/` | Downloads hover list | [Luke Kelly: six-month Arc review](https://bylukekelly.com/6-month-review-arc-browser), June 2023, updated January 2024. Source for the list appearing directly above the library button, thumbnails, and relative timestamps. |
| `arc/parts/` | Site controls | [All Things How: screenshots in Arc](https://allthings.how/how-to-take-a-screenshot-in-arc-browser/), November 2023. |
| `arc/new-menu/` | Original New menu | [Hulry: Arc Max review](https://hulry.com/arc-max-ai-review/), November 2023. Source for the white menu, row proportions, grouping, and icon forms. |
| `arc/new-menu/` | New Split reference and enlarged details | [All Things How: using Arc](https://allthings.how/how-to-use-the-arc-browser/), November 2023. Source for the open-right-edge Split icon and the brush, sparkle, and handle details of Boost. |
| `arc/main-menu/` | Windows and macOS main menus | [All Things How: Arc Sync](https://allthings.how/how-to-sync-your-arc-browser-between-mac-and-windows/), March 2024. Context only; the user chose not to reproduce these menus. |

`manifest.json` lists the local files, original artifact locations, dimensions, hashes, and source URLs where recorded. Originals and crops are both kept so later reviews can distinguish the published image from the exact view used during implementation.
