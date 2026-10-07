import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { electricalConsumerPower, electricalNetwork } from '../src/electrical-network';
import { electricalPreview } from '../src/electrical-geometry';
import { electricalRecoveryConflict } from '../src/electrical';
import { MATERIALS, BUILDINGS } from '../src/catalog';
import type { State, Building } from '../src/types';
function building(s: State, kind: Building['kind'], x: number, z: number, name = kind as string) {
  const b = {
    id: S.id(s, 'building'),
    kind,
    x,
    z,
    w: 1,
    d: 1,
    rotation: 0,
    name,
    connected: kind === 'power',
  };
  s.buildings.push(b);
  return b;
}
function wire(s: State, source: Building, target: Building, cells: { x: number; z: number }[]) {
  s.creative = true;
  const planned = S.planElectrical(s, { sourceId: source.id, targetId: target.id, cells });
  s.creative = false;
  assert.equal(planned.error, undefined);
  return s.electrical!.runs.find((r) => r.id === planned.runId)!;
}
test('unwired cabinets are zero-demand targets and never invent an incoming supply', () => {
  const s = S.createState(),
    incoming = building(s, 'power', 20, 20, 'Incoming west'),
    junction = building(s, 'electricalJunction', 20, 23, 'Distribution A'),
    lamp = building(s, 'lamp', 20, 26, 'Yard light');
  s.utilities.power = true;
  const candidate = {
    sourceId: junction.id,
    targetId: lamp.id,
    cells: [
      { x: 20, z: 24 },
      { x: 20, z: 25 },
    ],
  };
  assert.match(electricalPreview(s, candidate).error!, /commissioned incoming/);
  const before = electricalNetwork(s);
  assert.equal(before.junctions.length, 1);
  assert.equal(before.junctions[0].connected, false);
  assert.equal(before.junctions[0].name, 'Distribution A');
  assert.equal(before.junctions[0].kind, 'electricalJunction');
  assert.equal(before.junctions[0].loadKw, 0);
  assert.equal(before.junctions[0].ratedKw, 0);
  assert.equal(before.junctions[0].availableKw, 0);
  wire(s, incoming, junction, [
    { x: 20, z: 21 },
    { x: 20, z: 22 },
  ]);
  assert.equal(electricalPreview(s, candidate).valid, true);
  wire(s, junction, lamp, candidate.cells);
  const after = electricalNetwork(s);
  assert.equal(after.sources.length, 1);
  assert.equal(after.sources[0].name, 'Incoming west');
  assert.equal(after.sources[0].kind, 'power');
  assert.equal(after.sources[0].capacityKw, 16);
  assert.equal(after.sources[0].demandKw, 0.1);
  assert.equal(electricalConsumerPower(s, junction.id).rootSourceId, incoming.id);
  assert.equal(electricalConsumerPower(s, lamp.id).powered, true);
  assert.equal(electricalConsumerPower(s, lamp.id).name, 'Yard light');
  assert.equal(S.removeBuilding(s, junction.id).includes('Recover electrical circuit'), true);
  assert.match(electricalRecoveryConflict(s, s.electrical!.runs[0].id)!, /downstream circuit/);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
test('cabinet chains share the root budget and cycles or disconnected upstream cabinets stay off', () => {
  const s = S.createState(),
    incoming = building(s, 'power', 20, 20),
    a = building(s, 'electricalJunction', 20, 23),
    b = building(s, 'electricalJunction', 20, 26),
    lamp = building(s, 'lamp', 20, 29);
  s.utilities.power = true;
  const first = wire(s, incoming, a, [
    { x: 20, z: 21 },
    { x: 20, z: 22 },
  ]);
  wire(s, a, b, [
    { x: 20, z: 24 },
    { x: 20, z: 25 },
  ]);
  wire(s, b, lamp, [
    { x: 20, z: 27 },
    { x: 20, z: 28 },
  ]);
  assert.equal(electricalNetwork(s).sources[0].demandKw, 0.1);
  assert.equal(
    electricalNetwork(s).junctions.filter((j) => j.kind === 'electricalJunction').length,
    2,
  );
  s.utilities.power = false;
  assert.equal(electricalConsumerPower(s, lamp.id).connected, true);
  assert.equal(electricalConsumerPower(s, lamp.id).powered, false);
  s.utilities.power = true;
  first.sourceId = b.id;
  assert.equal(electricalConsumerPower(s, lamp.id).powered, false);
  assert.match(electricalConsumerPower(s, a.id).reason, /cycle/);
});
test('a circuit cannot be attached to an endpoint already scheduled for physical recovery', () => {
  const s = S.createState(),
    incoming = building(s, 'power', 20, 20),
    junction = building(s, 'electricalJunction', 20, 23);
  assert.equal(S.removeBuilding(s, junction.id), '');
  assert.match(
    electricalPreview(s, {
      sourceId: incoming.id,
      targetId: junction.id,
      cells: [
        { x: 20, z: 21 },
        { x: 20, z: 22 },
      ],
    }).error!,
    /scheduled for physical recovery/,
  );
});
test('both L bend directions keep spoil outside a continuous crew corridor', () => {
  for (const hand of [1, -1]) {
    const s = S.createState(),
      source = building(s, 'power', 30, 20),
      target = building(s, 'electricalJunction', 30 + hand * 6, 24);
    const cells = [
      ...Array.from({ length: 4 }, (_, i) => ({ x: 30, z: 21 + i })),
      ...Array.from({ length: 5 }, (_, i) => ({ x: 30 + hand * (i + 1), z: 24 })),
    ];
    const preview = electricalPreview(s, { sourceId: source.id, targetId: target.id, cells });
    assert.equal(preview.valid, true, preview.error || 'Valid outside-spoil L route');
    for (const c of preview.cells.slice(0, 4))
      assert.equal(
        c.spoilRect.x,
        hand === 1 ? 28 : 31,
        'Vertical spoil remains on the outside of the bend',
      );
    for (const c of preview.cells.slice(4))
      assert.equal(
        c.spoilRect.z,
        25,
        'Horizontal spoil stays on one side instead of alternating into the crew corridor',
      );
  }
});
test('an empty yard procures and mechanically builds a junction, then physically wires its lamp branch', () => {
  let s = S.createState();
  assert.equal(S.addZone(s, { x: 24, z: 26, w: 27, d: 24 }), '');
  S.purchaseBatch(s, [
    { item: 'operator', qty: 1 },
    { item: 'builder', qty: 1 },
    { item: 'engineer', qty: 1 },
  ]);
  S.purchase(s, 'excavator', 1);
  S.purchaseBatch(s, [
    { item: 'cableReel', qty: 1 },
    { item: 'electricalJunction', qty: 1 },
    { item: 'lamp', qty: 1 },
    { item: 'slab', qty: 2 },
    { item: 'diesel', qty: 1 },
  ]);
  S.purchase(s, 'power', 1);
  assert.equal(S.plan(s, 'electricalJunction', 10, 22).error, '');
  assert.equal(S.plan(s, 'lamp', 10, 26).error, '');
  function until(done: () => boolean, seconds = 5000) {
    for (let n = 0; n < seconds * 10 && !done(); n++) S.tick(s, 0.1);
    assert.ok(
      done(),
      JSON.stringify({
        jobs: s.jobs.filter((j) => j.status !== 'done'),
        orders: s.orders.filter((o) => o.status !== 'done'),
        electrical: s.electrical,
      }),
    );
  }
  until(
    () =>
      s.orders.every((o) => o.status === 'done') &&
      s.buildings.some((b) => b.kind === 'electricalJunction') &&
      s.buildings.some((b) => b.kind === 'lamp'),
  );
  const source = s.buildings.find((b) => b.kind === 'power')!,
    junction = s.buildings.find((b) => b.kind === 'electricalJunction')!,
    lamp = s.buildings.find((b) => b.kind === 'lamp')!;
  assert.equal(junction.connected, false);
  assert.ok(s.paving['10,22']);
  assert.equal(S.totals(s, 'electricalJunction').delivered, 1);
  assert.equal(S.totals(s, 'electricalJunction').installed, 1);
  assert.equal(BUILDINGS.electricalJunction.w, 1);
  assert.equal(MATERIALS.electricalJunction.max, 1);
  assert.equal(
    S.planElectrical(s, {
      sourceId: source.id,
      targetId: junction.id,
      cells: [
        ...Array.from({ length: 7 }, (_, i) => ({ x: 3, z: 16 + i })),
        ...Array.from({ length: 6 }, (_, i) => ({ x: 4 + i, z: 22 })),
      ],
    }).error,
    undefined,
  );
  s = S.load(S.save(s));
  until(() => s.electrical!.runs[0].status === 'commissioned');
  assert.equal(electricalConsumerPower(s, junction.id).powered, true);
  assert.equal(
    S.planElectrical(s, {
      sourceId: junction.id,
      targetId: lamp.id,
      cells: [
        { x: 10, z: 23 },
        { x: 10, z: 24 },
        { x: 10, z: 25 },
      ],
    }).error,
    undefined,
  );
  s = S.load(S.save(s));
  until(() => s.electrical!.runs[1].status === 'commissioned');
  assert.equal(electricalConsumerPower(s, lamp.id).powered, true);
  assert.equal(
    s.stacks.filter((t) => t.item === 'cableReel').reduce((n, t) => n + (t.cableMeters || 0), 0),
    34,
  );
  assert.equal(
    s.electrical!.runs.reduce((n, r) => n + r.cells.filter((c) => c.cableInstalled).length, 0),
    16,
  );
  assert.equal(electricalNetwork(s).sources[0].demandKw, 0.1);
  assert.doesNotThrow(() => S.load(S.save(s)));
});
test('passive junction cabinets do not multiply capacity or spend any of the16kW root budget', () => {
  const s = S.createState();
  s.process = { tanks: [], pumps: [], movements: [], spills: [], batches: [], recipes: [] } as any;
  s.utilities.power = true;
  let source = building(s, 'power', 20, 20);
  for (let i = 0; i < 8; i++) {
    const cabinet = building(s, 'electricalJunction', 20, 23 + i * 3);
    wire(s, source, cabinet, [
      { x: 20, z: 21 + i * 3 },
      { x: 20, z: 22 + i * 3 },
    ]);
    const pump = building(s, 'transferPump', 23, cabinet.z);
    wire(s, cabinet, pump, [
      { x: 21, z: cabinet.z },
      { x: 22, z: cabinet.z },
    ]);
    s.process!.pumps.push({ id: pump.id, enabled: true, hose: 'connected' } as any);
    source = cabinet;
  }
  const extra = building(s, 'transferPump', 20, 47);
  wire(s, source, extra, [
    { x: 20, z: 45 },
    { x: 20, z: 46 },
  ]);
  s.process!.pumps.push({ id: extra.id, enabled: true, hose: 'connected' } as any);
  const n = electricalNetwork(s);
  assert.equal(n.sources.length, 1);
  assert.equal(n.sources[0].demandKw, 18);
  assert.equal(n.sources[0].availableKw, 0);
  assert.equal(n.junctions.filter((j) => j.kind === 'electricalJunction').length, 8);
  assert.ok(n.junctions.every((j) => j.loadKw === 0 && j.ratedKw === 0));
  assert.equal(n.consumers.filter((c) => c.kind === 'transferPump' && c.powered).length, 8);
  assert.equal(electricalConsumerPower(s, extra.id).powered, false);
});
