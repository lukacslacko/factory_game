# Game interface guidelines

The native data screens use the compact paper-and-ink visual system established by the readability pass. The [Equipment register](../native/screenshots/readable-registers.png) and [Automations tab](../native/screenshots/automations-register.png) are visual references; `native/scripts/ui_theme.gd`, `game_ui.gd`'s `_section` helper, and `ui_table.gd` are the implementation reference. This applies to newly added tabs as well as edits to existing screens. The 3D yard has its own visual rules; do not put decorative world renders into the dense registers.

## Layout and content

- Group related information in bordered sections with a green heading band. Use aligned rows and columns, visible separators where adjacent actions could blur together, and consistent compact spacing. Avoid loose headings followed by unbounded text and full-width actions.
- Put the thing a player needs to decide or inspect first. Keep labels short and specific; explain a policy in one concise line, with longer detail in a tooltip or help page. Show the current state next to the control that changes it.
- Keep operational data dense and text-first. Use tables for records, with sortable headings, filtering where applicable, clickable IDs, and a useful active/default view. Avoid illustrations that displace status, quantities, assignments, or warnings.
- Align related controls. Keep numeric inputs a readable, consistent width and place a clearly labeled Apply action beside or beneath the group it saves. A switch must display its actual On/Off state. Distinguish saved settings, live status, warnings, and pending edits.
- Match the shared light theme for text, borders, hover, pressed, focus, selection, disabled states, scrollbars, and dialogs. Use US spelling throughout.

## Verification for every UI change

Run the focused UI check and `native/tests/ui_readability_smoke.gd`. Include every new tab in its required-tab list; do not rely on a broad test that silently skips the new screen. Check 1440×900 and 1280×800 with an open inspector. Confirm no text or controls overlap, that the last section can be reached, and that the main action remains obvious. Render and inspect actual Godot screenshots at both sizes; visual quality cannot be inferred from widget counts or contrast numbers alone. Use only synthetic fixtures or temporary yards, never the player's live save.
