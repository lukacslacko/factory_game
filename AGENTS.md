# Project instructions for game UI changes

Read [docs/native-ui-guidelines.md](docs/native-ui-guidelines.md) before changing any game screen, inspector, dialog, or tab. Follow its visual and interaction rules in both native and browser interfaces. The player's established preference is dense, text-first, old-school operational screens; keep world graphics separate from these data views. Use US spelling in visible text and documentation.

When adding or editing a native tab, include it in `native/tests/ui_readability_smoke.gd`, check it at 1440×900 and 1280×800 with an open inspector, and inspect a real Godot screenshot. Add focused interaction checks for new controls. A passing logic test without visual review does not establish that a screen is readable. Do not modify the player's save or running game for UI tests; use synthetic fixtures and temporary directories.
