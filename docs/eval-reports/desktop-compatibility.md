# Desktop compatibility

Overall result: **INCOMPLETE**

The manifest check is done. The Obsidian round-trip has not been run on any operating system in the confirmed matrix, so none of those rows pass.

## Manifest

`manifest.json` sets `minAppVersion` to `1.7.7` and `isDesktopOnly` to `true`. `tests/unit/desktopCompatibility.test.ts` reads that file. CI runs the test on every pull request.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run build`, and `npm run test:coverage` on `ubuntu-latest`. That job checks the build and the test suite. It does not launch Obsidian, and it is not a Linux desktop result. Linux and mobile stay out of scope.

## Confirmed matrix

| Platform | Result | Evidence |
| --- | --- | --- |
| Windows 10 22H2 64-bit | Not run | No Obsidian session was run on this release. |
| Windows 11 22H2 through 24H2 | Not run | No Obsidian session was run on these releases. |
| macOS 14 Sonoma, Apple Silicon | Not run | No Obsidian session was run on this release. |
| macOS 14 Sonoma, Intel | Not run | No Obsidian session was run on this release. |
| macOS 15 Sequoia, Apple Silicon | Not run | No Obsidian session was run on this release. |
| macOS 15 Sequoia, Intel | Not run | No Obsidian session was run on this release. |
| macOS 16, Apple Silicon | Not run | No Obsidian session was run on this release. |
| macOS 16, Intel | Not run | No Obsidian session was run on this release. |
| Linux | Out of scope | Not a supported Obsidian target for this plugin. |
| Mobile | Out of scope | `isDesktopOnly` is true. |

The machine used to write this report was Microsoft Windows 11 Pro, version 10.0.26200, 64-bit. Obsidian was not opened on it. That host is not recorded as a pass of the Windows 11 22H2–24H2 row.

## Round-trip still to run

On each platform above except Linux and mobile, using Obsidian 1.7.7 or newer and a vault that contains no personal recipes:

1. Run `npm run build` and load the plugin from that vault. Enable it and confirm the ribbon shows **Open Recipe Manager**.
2. Run the command **Open recipe manager**. Create a recipe by hand with at least two ingredients, save it, close it, and open the note again. The note should show `schemaVersion: 2` and the units as typed.
3. Add a second recipe that shares one ingredient in a compatible unit, and a fresh-versus-dried pair of the same ingredient. Generate a shopping list. The compatible lines should be one row. The fresh and dried lines should stay separate.
4. Quit Obsidian, open it again, and confirm both recipes are still listed.

Replace `Not run` with `Pass` or `Fail` only after that session, and name the Obsidian version and the OS build in the evidence cell. A fail is a fail. Linux and mobile stay `Out of scope`.
