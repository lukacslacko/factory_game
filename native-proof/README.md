# Plant 01 — native visual proof

An interactive Godot 4.7.2 scene for reviewing the original concept C aesthetic before migrating the playable factory game. This is a visual study: equipment, workers, and stock are arranged examples, not a connected factory simulation. The web game and its saves are independent.

## Open it on this Mac

Double-click **Open visual proof.command** in Finder. It uses the standard Godot application already installed in `/Applications`, imports the small texture set, and opens the native scene directly. The Terminal window shows startup information. Escape or the window close button quits the preview.

Alternatively, import `project.godot` from Godot's Project Manager, open the project, and press **F6** with `main.tscn` selected, or **F5** to run the project. The constructed scene appears at runtime; the editor scene contains its scripted root.

No browser, Node, .NET, Blender, or export templates are needed for this proof. Standalone application packaging belongs to the migration checkpoint after visual review.

## Controls

| Control | Action |
| --- | --- |
| Left-drag the ground | Pan, anchored to the ground under the cursor |
| W/A/S/D | Move relative to the current view |
| Scroll | Zoom |
| Right-drag | Orbit and adjust elevation |
| Q/E | Rotate |
| Yard / Equipment / Trackside | Smooth camera presets |
| Daylight / Dusk, or 1 / 2 | Switch lighting |
| Grid, or G | Show the 1 m terrain grid |
| H | Hide/show the interface |
| Screenshot, or F12 | Save the native viewport into `captures/` |
| Home | Return to the yard view |
| Escape or the window close button | Quit |

Foreground drawing is capped at 60 FPS; unfocused interactive processing is capped at 15 FPS. The proof contains no simulation to progress while unfocused. Background game progression will be tested with the separate simulation integration.

## Visual contents

True-perspective camera, direct sunlight and sky fill, soft sun shadows, ambient occlusion, screen-space indirect light, reflected sky lighting, controlled color/exposure, and glowing dusk lamps. The preview includes shaped excavator and forklift models, hydraulic rods and hoses, detailed wheels and tread links, grounded workers, a parked truck, corrugated containers, an actual standard-gauge turnout, a four-axle flatcar, stacks, a bounded rubble bin, and fuel equipment.

The machinery is parked parallel to grid axes. Concrete slabs are individually aligned 1 m squares; rail heads leave exactly **1.435 m between their inside faces**. Dense vegetation uses shared instanced meshes with deterministic seeded placement. Soil blends photographic diffuse and normal maps with broad variations, and distant texture detail uses mipmaps.

Code and procedural models are MIT licensed under the repository license. The four external terrain maps are CC0; their authors, verified hashes, and download sources are in [assets/CREDITS.md](assets/CREDITS.md). The current visuals are an initial proof, not a claim of exact equivalence to generated concept art.

## Actual screenshots

These are captured from this Godot project, with no image generation or paint-over:

![Daylight yard](screenshots/daylight.png)

![Dusk yard](screenshots/dusk.png)

[Equipment close view](screenshots/equipment.png) · [Trackside view](screenshots/trackside.png) · [Daylight without interface](screenshots/daylight-clean.png)

## Native verification

From this directory:

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --editor --path . --import
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . -- --self-test
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script tests/ground_normals.gd
python3 tests/run_native_check.py --timeout 55 --name final-proof -- --rendering-driver vulkan --resolution 1440x900 -- --capture-suite
```

The capture suite writes five actual Godot screenshots and per-view frame-time/resource reports. It explicitly draws covered windows so it can complete without bringing a browser or the Godot window into focus. The Python watchdog runs one process, limits native resident memory to 2 GB, and terminates it on timeout. Captures, generated caches, and diagnostic logs are excluded from source control. Approved reference screenshots can be copied to `screenshots/` for review.

Vulkan through macOS's Metal translation is the verified project default. Early automated runs that appeared stuck were waiting for drawing of a fully occluded native window. The final capture method explicitly draws instead of waiting for a suppressed `frame_post_draw` signal. Metal is also supported by the installed engine, but this proof defaults to the backend verified end to end.

## Verified outcome — October 5, 2026

Godot 4.7.2 on macOS 14.5 / Apple M2 Pro, Forward+ with Vulkan, 4× MSAA. The final bounded capture run completed in 23.89 seconds without engine errors or watchdog intervention. At 1440×900 output, four 121-frame samples held the 60 FPS cap. Median wall frame times were 16.66 ms; 95th-percentile times ranged from 16.95 to 17.38 ms. This is a short, static-scene check, not a large-factory benchmark.

The final run's sampled peak resident memory was 386.6 MB; repeated full-scene checks were approximately 387–529 MB. Godot reported 435.1 MB of graphics allocations. The M2 uses unified memory, so these measurements must not be added as independent physical allocations. The watchdog stops any automated native run above 2 GB or its time limit; tests run sequentially. The interactive preview also reduces its unfocused processing rate.

Headless checks verified 32,020 custom mesh triangles and all 22 herb triangles without normal/winding failures; they exercise actual viewport input dispatch for lighting buttons, grid, ground dragging, release over the toolbar, and rotated-camera W movement. Native UI review additionally clicked the lighting and equipment buttons, dragged the floor, toggled the grid, and restored the default view. The macOS launcher imported the assets and opened the scene successfully. Machine-readable results are in [tests/verified-results.json](tests/verified-results.json).

During review, incorrect custom-mesh face orientation, washed-out vertex colors, texture mipmaps, a lamp holder occluding its own light, and grazing-angle shadow acne were corrected. The ground, foliage and equipment remain a first art pass: soil breakup, vegetation silhouettes and individual machinery/building finishes still differ visibly from the original generated concept. Review that remaining gap before extending these assets across the game.

The scene does not yet contain gameplay, moving equipment, save import, file-backed saves, or the independently ticking simulation. Those are the next native migration checkpoint under [issue #19](https://github.com/lukacslacko/factory_game/issues/19), after visual feedback.
