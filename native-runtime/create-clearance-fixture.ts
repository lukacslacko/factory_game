/** Public synthetic blocker checkpoint, never reads a player's yard. */
import fs from 'node:fs';
import * as S from '../src/sim';
import { seedHandlingResources, tickUntil } from '../tests/support/yard';
import { setEquipmentParking } from '../src/workforce';
const s = S.createState();
s.creative = true;
S.plan(s, 'shed', 36, 35);
s.creative = false;
const e = seedHandlingResources(s, 'excavator'),
  w = s.workers[1];
setEquipmentParking(s, e.id, 40, 38, 0);
w.x = 40;
w.z = 38;
w.duty = 'manual';
tickUntil(
  s,
  () =>
    s.events.some((v) => v.entity === e.id && v.severity === 'warning' && v.text.includes(w.id)),
  180,
);
s.paused = true;
S.load(S.save(s));
fs.writeFileSync('native/tests/fixtures/action-clearance-system.json', S.save(s) + '\n');
console.log(
  JSON.stringify({
    equipment: e.id,
    worker: w.id,
    elapsed: s.elapsed,
    clearances: s.actionClearances?.length,
  }),
);
