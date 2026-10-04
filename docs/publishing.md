# Publication

Version 0.6.0 is published privately at https://plant-01-starter-yard.lukacslacko.chatgpt.site.

The editable game lives in this starter-yard directory. The Site repository is a separate, build-only checkout at `../../work/plant01-publish` relative to this directory, with its own `.openai/hosting.json` and Git metadata. It contains only `dist/` and the hosting manifest. Do not upload the full game project or the private design documents when updating that Site.

The Site identity is `appgprj_6ac1ff4c01388191b1d9d0dba709095e`. Reuse it; do not create a replacement. The successful build-only source commit for version 0.6.0 is `a526e9d2bd8bc68dddb462a86189faacd11876bd`.

For an update, follow the Sites hosting skill to open the existing build-only checkout, build and test the editable game, replace the checkout's `dist/` with that build, inspect its file list, and publish through the same private Site workflow. Keep credentials in process memory/stdin only. The game requires no server secrets, cloud database, or external connectors.

Browser state is local to each browser and origin. Publishing an update keeps saves on the same Site origin. A local-server save must be exported and imported to transfer to the hosted origin.

The initial full-project publication request was rejected by automatic approval review because the upload included source and private design documents beyond the requested playable artifact. A verified nine-file build-only payload was subsequently approved and published. No design notes or saved games were included in that payload.

## Version 0.3 deployment

The final version 0.3.0 deployment succeeded on October 4, 2026 at 08:46 UTC, preserving the existing private Site and origin. The published payload contains only the built game, local SQL runtime, illustrated guide, and preview images. Source, design notes, saved yards, and development captures were excluded.

The release replaces automatic carrier unloading with purchased site equipment and hired workers, and corrects motion, train geometry, ground contact, and storage. Fifty regression tests, integrated browser checks, and the production build check passed before the final upload. Existing saves migrate on this same origin.

## Version 0.4 deployment

Version 0.4.0 deployed successfully on October 4, 2026 at 11:30 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac238b89c648191a46a827032718c8d`. The verified ten-file archive contains only nine built game/guide assets and the hosting manifest. Private source, design notes, examples, and test captures remain in the downloadable local package.

This release adds right-hand lanes, coordinated carrier departures, worker and machinery clearance, routes with fewer turns, and physical panel/buffer handling. Eighty-six regressions, browser interaction checks, and the final production check passed. A newly generated example completed 145 construction jobs and all 19 deliveries with balanced inventory. Version 3 imports include a physical handoff for forklift rail jobs that need an excavator under the new workflow.

## Version 0.5 deployment

Version 0.5.0 deployed successfully on October 4, 2026 at 13:44 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac258196fc481918f15eb4e62e6a379`. The payload contains the nine built game/guide assets and hosting manifest. Source, private design notes, saved yards, and development captures remain in the local package.

This release adds per-machine work roles in the Equipment register and inspector, with safe completion of current work before switching. Slab paving now uses aligned pickup, continuous load poses, supported setdown, tool withdrawal, and worker finishing. Freight reach changes continuously before lowering. Active handling lanes reserve future loads and keep conflicting deliveries clear. Existing version 4 saves keep their material records and default to All work.

All 109 regressions, the integrated browser suite, strict TypeScript validation, and production checks passed. The regenerated example contains 145 completed construction jobs, two physical refueling jobs, and 19 completed deliveries, with balanced material and fuel records.

## Version 0.6 deployment and public source

Version 0.6.0 deployed successfully on October 4, 2026 at 15:11 UTC on the same private Site and origin. Deployment ID: `appgdep_6ac26ca29b7c8191aca4f5186280853d`. The verified payload contains the nine built game/guide assets and hosting manifest. The deployed build is the same production build tested locally.

The complete editable project is published separately at [lukacslacko/factory_game](https://github.com/lukacslacko/factory_game), publicly under the MIT license, as explicitly requested. It includes source, tests, documentation, design grounding, accepted visual references, guide, previews, and the completed example. Builds, local saves, diagnostic captures, workstation configuration, and credentials are excluded from Git. GitHub CI runs simulation tests, TypeScript, and the production build.

Before publication, all 141 regressions, the final integrated browser suite, strict TypeScript validation, and the production check passed. The fresh example completed 145 construction tasks, two physical refueling jobs, all 18 work groups, and all 19 deliveries, with material and fuel records balanced. This release adds diagnostic exports, sortable/filterable linked registers, hierarchical/manual work assignment, equipment parking, worker shifts and bus commutes, more complete obstacles, rail recovery, stable traffic yielding, and smooth work-arm animation.
