import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { dist } from '../src/path';
import { equipmentSweepBlocked, equipmentTravelSpeed, workerMoveBlocked } from '../src/traffic';
import { seedHandlingResources } from './support/yard';
import type { EquipmentKind, State } from '../src/types';

// Compact geometry from the native EQ-0019 capture: a safe idle pedestrian
// stands between the boom, chassis, and a dense slab row. The equipment's
// first turn cannot proceed, and the worker has no ordinary 0.5 m escape edge.
function encounter(kind: EquipmentKind = 'excavator') {
  const s = S.createState();
  const e = seedHandlingResources(s, 'excavator');
  const operator = s.workers.find((w) => w.role === 'operator')!;
  const worker = s.workers.find((w) => w.role === 'builder')!;
  Object.assign(e, {
    id: 'EQ-0019',
    kind,
    x: 43.5,
    z: 29.5,
    y: 0,
    yaw: 34.06251918948772,
    heading: 2,
    reach: 2.7,
    lift: 0.12,
    reverse: false,
    operator: 'WRK-0014',
    blockedBy: 'WRK-0011',
    fuel: kind === 'forklift' ? 45 : 80,
    tank: kind === 'forklift' ? 45 : 80,
    path: [
      { x: 44.5, z: 29.95 },
      { x: 44.5, z: 34.5 },
      { x: 30.146875, z: 34.428125 },
      { x: 29, z: 30.5 },
    ],
  });
  Object.assign(operator, { id: 'WRK-0014', vehicle: e.id, x: e.x, z: e.z });
  Object.assign(worker, {
    id: 'WRK-0011',
    x: kind === 'forklift' ? 41.8 : 41.6,
    z: 31.5,
    yaw: Math.PI * 2,
    heading: 1,
    duty: 'auto',
    status: 'Available',
  });
  const slabQuantities = [0, 0, 3, 12, 12, 12, 12, 12, 4];
  for (const [i, qty] of slabQuantities.entries())
    s.stacks.push({
      id: `OPENING-SLAB-${i}`,
      item: 'slab',
      x: 34 + i,
      z: 32,
      w: 1,
      d: 1,
      qty,
      reserved: 0,
      source: 'opening',
      yaw: Math.PI,
    });
  for (const [id, item, x, z, qty] of [
    ['STK-0529', 'railCurve', 43, 30, 0],
    ['STK-0555', 'railCurve', 34, 29, 4],
    ['STK-0590', 'railCurve', 34, 26, 2],
    ['STK-0613', 'railPoints', 34, 23, 1],
  ] as const)
    s.stacks.push({
      id,
      item,
      x,
      z,
      w: 6,
      d: 3,
      qty,
      reserved: 0,
      source: 'opening',
      yaw: Math.PI,
    });
  return { s, equipmentId: e.id, workerId: worker.id, goal: { x: 29, z: 30.5 } };
}

const inventory = (s: State) =>
  s.stacks.map(({ id, item, qty, reserved }) => ({ id, item, qty, reserved }));

function safeTick(s: State, equipmentId: string, workerId: string) {
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  const w = s.workers.find((w) => w.id === workerId)!;
  const oldEquipment = { ...e, path: e.path.slice() };
  const oldWorker = { ...w, path: w.path.slice() };
  S.tick(s, 0.1);
  assert.ok(
    dist(oldEquipment, e) <= equipmentTravelSpeed(s, oldEquipment) * 0.1 + 1e-6,
    'Equipment recovery must use continuous normal-speed movement',
  );
  assert.ok(dist(oldWorker, w) <= 1.7 * 0.1 + 1e-6, 'The pedestrian must actually walk clear');
  assert.equal(
    equipmentSweepBlocked(s, oldEquipment, e),
    '',
    'Every executed equipment sweep remains safe',
  );
  assert.equal(
    workerMoveBlocked(s, oldWorker, w),
    '',
    'The pedestrian never walks through equipment or stock',
  );
  return { e, w };
}

for (const kind of ['excavator', 'forklift'] as const)
  test(`${kind} opens room for a boxed pedestrian and completes its original trip without moving stock`, () => {
    const { s, equipmentId, workerId, goal } = encounter(kind);
    const openingInventory = inventory(s);
    const w = s.workers.find((w) => w.id === workerId)!;
    assert.equal(
      workerMoveBlocked(s, { id: w.id, x: -10000, z: -10000 }, w),
      '',
      'The pedestrian starts in a physically clear position',
    );
    let sawRetreat = false;
    for (let t = 0; t < 120; t += 0.1) {
      const { e, w } = safeTick(s, equipmentId, workerId);
      sawRetreat ||= !!e.reverse && dist(e, { x: 43.5, z: 29.5 }) > 0.2;
      if (e.trafficGoal)
        assert.deepEqual(
          e.trafficGoal,
          goal,
          'Physical backoff retains the actual work destination',
        );
      if (!e.path.length && dist(e, goal) < 0.1) break;
    }
    const e = s.equipment.find((e) => e.id === equipmentId)!;
    if (kind === 'excavator')
      assert.ok(sawRetreat, 'The excavator makes physical room before repeating its turn');
    assert.ok(
      !e.path.length && dist(e, goal) < 0.1,
      `Original destination remains unfinished: ${JSON.stringify({ equipment: e, worker: w })}`,
    );
    assert.deepEqual(
      inventory(s),
      openingInventory,
      'Recovery cannot consume, relocate, or invent stock',
    );
    assert.ok(
      s.events.filter(
        (event) => event.entity === equipmentId && event.text.includes('backing straight clear'),
      ).length <= 1,
      'One accepted pedestrian escape must not cause repeated backoff maneuvers',
    );
  });

test('a loaded excavator retreats safely and finishes its trip with the same attached cargo', () => {
  const { s, equipmentId, workerId, goal } = encounter();
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  e.cargo = { item: 'slab', qty: 1 };
  const cargo = { ...e.cargo },
    openingInventory = inventory(s);
  let sawRetreat = false;
  for (let t = 0; t < 120; t += 0.1) {
    safeTick(s, equipmentId, workerId);
    assert.deepEqual(e.cargo, cargo, 'Traffic recovery retains the same physical payload');
    sawRetreat ||= !!e.reverse && dist(e, { x: 43.5, z: 29.5 }) > 0.2;
    if (e.trafficGoal) assert.deepEqual(e.trafficGoal, goal);
    if (!e.path.length && dist(e, goal) < 0.1) break;
  }
  assert.ok(sawRetreat, 'The cargo remains attached throughout the physical backoff');
  assert.ok(
    !e.path.length && dist(e, goal) < 0.1,
    `Loaded trip remains unfinished: ${JSON.stringify(e)}`,
  );
  assert.deepEqual(inventory(s), openingInventory);
  assert.ok(
    s.events.filter(
      (event) => event.entity === equipmentId && event.text.includes('backing straight clear'),
    ).length <= 1,
    'The loaded machine finishes one coordinated recovery instead of repeatedly retreating',
  );
});

test('an actual carried-panel blocker beyond eight meters walks clear of the load', () => {
  const { s, equipmentId, workerId } = encounter();
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  const w = s.workers.find((w) => w.id === workerId)!;
  const goal = { x: 55, z: 34.477634297978966 };
  Object.assign(e, {
    x: 34.168978498193304,
    z: goal.z,
    yaw: 37.69275619160574,
    heading: 0,
    reach: 5.5,
    lift: 0.65,
    cargo: { item: 'railCurve', qty: 3, yaw: Math.PI / 2 },
    path: [goal],
  });
  s.stacks.find((t) => t.id === 'STK-0555')!.qty = 1;
  const cargo = { ...e.cargo! },
    openingInventory = inventory(s);
  assert.ok(dist(e, w) > 8, 'The carried panels reach beyond the old center-distance cutoff');
  assert.equal(workerMoveBlocked(s, { id: w.id, x: -10000, z: -10000 }, w), '');
  for (let t = 0; t < 60; t += 0.1) {
    safeTick(s, equipmentId, workerId);
    assert.deepEqual(e.cargo, cargo);
    if (!e.path.length && dist(e, goal) < 0.1) break;
  }
  assert.ok(
    !e.path.length && dist(e, goal) < 0.1,
    `The distant payload blocker was not cleared: ${JSON.stringify({ equipment: e, worker: w })}`,
  );
  assert.deepEqual(inventory(s), openingInventory);
});

test('saved pedestrian recovery preserves its destination and traffic fields and rejects malformed fields', () => {
  const { s, equipmentId, workerId, goal } = encounter();
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  e.trafficGoal = { ...goal };
  e.trafficYieldWorker = workerId;
  e.trafficBlockedSince = s.elapsed;
  e.trafficBlockedNotice = true;
  const serialized = S.save(s);
  const restored = S.load(serialized);
  const resumed = restored.equipment.find((e) => e.id === equipmentId)!;
  assert.deepEqual(resumed.trafficGoal, goal);
  assert.equal(resumed.trafficYieldWorker, workerId);
  assert.equal(resumed.trafficBlockedSince, e.trafficBlockedSince);
  assert.equal(resumed.trafficBlockedNotice, true);
  for (const [field, value] of [
    ['trafficYieldWorker', 17],
    ['trafficYieldWorker', {}],
    ['trafficBlockedSince', -1],
    ['trafficBlockedSince', 'yesterday'],
    ['trafficBlockedSince', null],
    ['trafficBlockedNotice', 'true'],
    ['trafficBlockedNotice', 1],
  ] as const) {
    const malformed = JSON.parse(serialized);
    malformed.equipment.find((e: { id: string }) => e.id === equipmentId)[field] = value;
    assert.throws(() => S.load(JSON.stringify(malformed)), `Malformed ${field} must be rejected`);
  }
});

test('a genuine enclosure warns once, then clears the warning and resumes when its walls are removed', () => {
  const { s, equipmentId, workerId, goal } = encounter();
  for (const [i, r] of [
    { x: 39, z: 25.5, w: 0.5, d: 10 },
    { x: 47.5, z: 25.5, w: 0.5, d: 10 },
    { x: 39, z: 25.5, w: 9, d: 0.5 },
    { x: 39, z: 35, w: 9, d: 0.5 },
  ].entries())
    s.buildings.push({
      ...r,
      id: `OPENING-WALL-${i}`,
      kind: 'fence',
      rotation: 0,
      connected: false,
      name: 'Opening enclosure fence',
      source: 'opening',
    });
  const openingInventory = inventory(s);
  for (let t = 0; t < 45; t += 0.1) {
    const { e, w } = safeTick(s, equipmentId, workerId);
    assert.ok(
      e.x > 39.5 && e.x < 47.5 && e.z > 26 && e.z < 35,
      'Equipment remains inside the enclosure',
    );
    assert.ok(
      w.x > 39.5 && w.x < 47.5 && w.z > 26 && w.z < 35,
      'Worker remains inside the enclosure',
    );
  }
  assert.ok(
    dist(
      s.equipment.find((e) => e.id === equipmentId)!,
      goal,
    ) > 1,
  );
  assert.deepEqual(inventory(s), openingInventory);
  assert.equal(
    s.notices.filter((n) => n.entity === equipmentId && n.title === 'Equipment movement blocked')
      .length,
    1,
    `A persistent enclosure produces one warning: ${JSON.stringify({ equipment: s.equipment.find((e) => e.id === equipmentId), notices: s.notices })}`,
  );
  const warning = s.notices.find(
    (n) => n.entity === equipmentId && n.title === 'Equipment movement blocked',
  )!;
  assert.notEqual(warning.state, 'done', 'The unresolved obstruction remains actionable');
  // External fixture change represents removing the enclosing obstacles; the
  // existing actors, cargo, stock, and retained destination remain untouched.
  s.buildings = s.buildings.filter((b) => !b.id.startsWith('OPENING-WALL-'));
  s.revision++;
  for (let t = 0; t < 120; t += 0.1) {
    const { e } = safeTick(s, equipmentId, workerId);
    if (!e.path.length && dist(e, goal) < 0.1) break;
  }
  const e = s.equipment.find((e) => e.id === equipmentId)!;
  assert.ok(
    !e.path.length && dist(e, goal) < 0.1,
    'Opening the enclosure lets the retained trip finish',
  );
  assert.equal(
    warning.state,
    'done',
    'Successful physical movement resolves the obstruction warning',
  );
  assert.equal(
    s.notices.filter((n) => n.entity === equipmentId && n.title === 'Equipment movement blocked')
      .length,
    1,
  );
  assert.deepEqual(inventory(s), openingInventory);
});
