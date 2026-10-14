# Logistics dependency diagnosis

Open **Work** and select **Diagnose dependencies** to capture the current
waiting relationships. The new table lists the waiting work or actor, the
classification, linked blocker IDs, elapsed wait, any detected cycle, and the
typed edges used for that finding. Select an ID to inspect it. Run the action
again after the yard changes; the capture is deliberately not refreshed every
simulation update. **Blocked work** above it continues to show live unresolved
warnings and the progress of a rail-pickup recovery move, when present.

These classifications help explain a wait. They are not instructions to move a
person or a stack, and they do not certify that a route, destination, or crew
is available. Inspect the linked work and use the existing physical move
controls when a feasible action is shown.

The native service has a read-only `dependency_diagnosis` action. It returns a
bounded `DependencyReport` with `diagnoses`, `inspected`, and `truncated` fields.
Each diagnosis identifies the waiting job or actor, its immediate `blockerIds`,
typed dependency `edges`, wait duration when recorded, and one classification:
`temporary`, `physical-relocation`, `player-action`, `fixed`, `cycle`, or
`unresolved`. A cycle includes its linked entity IDs in traversal order.

The graph uses saved rail-pickup recovery and storage-lift prerequisites,
action-clearance blocker IDs, traffic blocker IDs, and occupied manual
equipment assignments. It does not infer physical dependencies from arbitrary
warning text. `unresolved` means the current saved state does not provide a
checked blocker edge. A `physical-relocation` diagnosis identifies material
that could be moved in principle; it is not a handling plan or a promise that
there is an accessible destination.

Rows enter the report when a job has a typed dependency or an explicit waiting
reason, or when an actor or action clearance reports a blocker. Ordinary
progress descriptions such as travel do not appear. If the output limit is
reached, rows with checked blocker edges take precedence over reason-only rows.

The action runs only when requested, never on each simulation tick or native
snapshot. It inspects up to 512 active jobs, 256 action clearances, 2,048
machines and workers of each kind, and 768 edges; cycle traversal is bounded
to 12 links and 96 visits per diagnosis. `truncated: true` signals that the
result may omit work or a longer dependency chain. Diagnosis does not dispatch
equipment, reserve space, move stock, change notices, or mutate the save.

This is a first structured view for issue #51. A complete deadlock coordinator
will still need consistent maneuver reservations across crews, wider coverage
of delivery and construction waits, and checked physical recovery plans.
