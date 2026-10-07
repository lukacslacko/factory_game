import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { electricalConsumerPower, electricalNetwork } from '../src/electrical-network';
import {
  electricalPreview,
  electricalObstacles,
  electricalPlannedRects,
} from '../src/electrical-geometry';
import { electricalRemovalConflict, electricalRecoveryConflict } from '../src/electrical';
import { electricalValidationProblem } from '../src/electrical-validation';
import type { State, Building } from '../src/types';
function building(s: State, kind: Building['kind'], x: number, z: number) {
  const b = {
    id: S.id(s, 'building'),
    kind,
    x,
    z,
    w: 1,
    d: 1,
    rotation: 0,
    connected: kind === 'power',
    name: kind,
  };
  s.buildings.push(b);
  return b;
}
function wire(s: State, from: Building, to: Building, cells: { x: number; z: number }[]) {
  s.creative = true;
  const p = S.planElectrical(s, { sourceId: from.id, targetId: to.id, cells });
  s.creative = false;
  assert.equal(p.error, undefined);
  return s.electrical!.runs.find((r) => r.id === p.runId)!;
}
test('physical lamp junction branches share a rooted16kW capacity with stable allocation', () => {
  const s = S.createState();
  s.process = { tanks: [], pumps: [], movements: [], spills: [], batches: [], recipes: [] } as any;
  s.utilities.power = true;
  let source = building(s, 'power', 20, 20);
  const pumps: Building[] = [];
  for (let i = 0; i < 8; i++) {
    const lamp = building(s, 'lamp', 20, 23 + i * 3);
    wire(s, source, lamp, [
      { x: 20, z: 21 + i * 3 },
      { x: 20, z: 22 + i * 3 },
    ]);
    const pump = building(s, 'transferPump', 23, lamp.z);
    wire(s, lamp, pump, [
      { x: 21, z: lamp.z },
      { x: 22, z: lamp.z },
    ]);
    pumps.push(pump);
    s.process!.pumps.push({
      id: pump.id,
      enabled: true,
      hose: 'connected',
      sourceId: 'source',
      targetId: 'target',
      transferredLiters: 0,
      flowLitersPerSecond: 0,
    } as any);
    source = lamp;
  }
  const n = electricalNetwork(s);
  assert.equal(n.sources.length, 1);
  assert.equal(n.junctions.length, 8);
  assert.ok(Math.abs(n.sources[0].demandKw - 16.8) < 1e-8);
  assert.equal(n.consumers.filter((c) => c.kind === 'transferPump' && c.powered).length, 7);
  assert.equal(electricalConsumerPower(s, pumps[7].id).powered, false);
  assert.ok(electricalConsumerPower(s, pumps[6].id).runIds.length > 2);
  s.process!.pumps[0].enabled = false;
  const after = electricalNetwork(s);
  assert.equal(electricalConsumerPower(s, pumps[7].id).powered, true);
  assert.equal(electricalConsumerPower(s, pumps[0].id).loadKw, 0);
  assert.equal(electricalConsumerPower(s, pumps[0].id).ratedKw, 2);
  assert.equal(
    after.consumers.every((c) => c.powered),
    true,
  );
  assert.equal(electricalValidationProblem(s), undefined);
});
test('junction cycles, disconnected source and uncommissioned service never provide free electricity', () => {
  const s = S.createState();
  s.utilities.power = true;
  const source = building(s, 'power', 20, 20),
    a = building(s, 'lamp', 20, 23),
    b = building(s, 'lamp', 20, 26);
  const first = wire(s, source, a, [
    { x: 20, z: 21 },
    { x: 20, z: 22 },
  ]);
  wire(s, a, b, [
    { x: 20, z: 24 },
    { x: 20, z: 25 },
  ]);
  assert.equal(electricalConsumerPower(s, b.id).powered, true);
  s.utilities.power = false;
  assert.equal(electricalConsumerPower(s, b.id).connected, true);
  assert.equal(electricalConsumerPower(s, b.id).powered, false);
  s.utilities.power = true;
  first.sourceId = b.id;
  assert.equal(electricalConsumerPower(s, a.id).powered, false);
  assert.match(electricalConsumerPower(s, b.id).reason, /cycle/);
  const c = building(s, 'lamp', 23, 23);
  assert.match(
    electricalPreview(s, {
      sourceId: a.id,
      targetId: c.id,
      cells: [
        { x: 21, z: 23 },
        { x: 22, z: 23 },
      ],
    }).error!,
    /commissioned incoming/,
  );
});
test('route preview enforces terminals, contiguous cells, real underground exclusivity and neighboring spoil', () => {
  const s = S.createState();
  const source = building(s, 'power', 20, 20),
    lamp = building(s, 'lamp', 20, 23);
  const request = {
    sourceId: source.id,
    targetId: lamp.id,
    cells: [
      { x: 20, z: 21 },
      { x: 20, z: 22 },
    ],
  };
  assert.equal(electricalPreview(s, request).valid, true);
  assert.match(
    electricalPreview(s, {
      ...request,
      cells: [
        { x: 20, z: 21 },
        { x: 21, z: 22 },
      ],
    }).error!,
    /share an edge/,
  );
  assert.match(
    electricalPreview(s, { ...request, cells: [{ x: 20, z: 22 }] }).error!,
    /boundaries/,
  );
  const r = wire(s, source, lamp, request.cells);
  assert.equal(electricalObstacles(s).length, 0);
  assert.equal(electricalPlannedRects(s).length, 0);
  assert.match(electricalRemovalConflict(s, lamp.id)!, /Recover electrical circuit/);
  const next = building(s, 'lamp', 23, 23);
  const branch = wire(s, lamp, next, [
    { x: 21, z: 23 },
    { x: 22, z: 23 },
  ]);
  assert.match(electricalRecoveryConflict(s, r.id)!, new RegExp(branch.id));
  assert.equal(electricalRecoveryConflict(s, branch.id), undefined);
  const other = building(s, 'lamp', 22, 21);
  assert.match(
    electricalPreview(s, {
      sourceId: source.id,
      targetId: other.id,
      cells: [
        { x: 20, z: 21 },
        { x: 21, z: 21 },
      ],
    }).error!,
    /another direct circuit/,
  );
});
test('explicit opening commissioned circuits can omit old work jobs, but malformed opening ownership is rejected', () => {
  const s = S.createState(),
    source = building(s, 'power', 20, 20),
    lamp = building(s, 'lamp', 20, 23);
  const r = wire(s, source, lamp, [
    { x: 20, z: 21 },
    { x: 20, z: 22 },
  ]);
  s.jobs = s.jobs.filter((j) => j.id !== r.jobId);
  r.opening = true;
  r.jobId = 'opening';
  assert.equal(electricalValidationProblem(s), undefined);
  r.creative = false;
  assert.match(electricalValidationProblem(s)!, /opening/);
});
