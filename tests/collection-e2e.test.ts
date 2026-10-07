import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { seedHandlingResources, stateSummary } from './support/yard';
import { collectionValidationProblem } from '../src/collection-validation';
import { renderState } from '../native-runtime/render';
function yard() {
  const s = S.createState();
  const machine = seedHandlingResources(s);
  const stack = {
    id: S.id(s, 'stack'),
    item: 'slab' as const,
    x: 30,
    z: 32,
    w: 1,
    d: 1,
    qty: 12,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(stack);
  return { s, machine, stack };
}
test('real collection loads stored slabs onto a truck and physically removes them with conserved history', () => {
  let { s, machine, stack } = yard();
  const result = S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] });
  assert.equal(result.error, undefined);
  let phases = new Set<string>();
  for (let i = 0; i < 24000; i++) {
    S.tick(s, 0.1);
    const c = s.collections![0];
    phases.add(c.task?.phase || c.status);
    if (i % 100 === 0) {
      assert.equal(collectionValidationProblem(s), undefined);
      s = S.load(S.save(s));
    }
    const n = S.totals(s, 'slab');
    assert.equal(n.stored + n.cargo + n.outbound + n.collected, 12);
    renderState(s);
    if (c.status === 'done') break;
  }
  assert.equal(
    s.collections![0].status,
    'done',
    JSON.stringify(s.collections) + ' ' + stateSummary(s),
  );
  assert.equal(S.totals(s, 'slab').collected, 12);
  assert.equal(s.stacks.length, 0);
  assert.ok(phases.has('carry'));
  assert.ok(phases.has('secure'));
  assert.equal(s.costs.filter((c) => c.category === 'Collection').length, 2);
  assert.equal(S.totals(s, 'slab').delivered, 0);
  assert.ok(s.notices.some(n => n.title === 'Collection truck approaching' && n.entity === s.collections![0].id));
  assert.equal(s.notices.some(n => n.title === 'Road delivery approaching'), false);
});
test('real collection brings a lowloader, boards an operator, loads machine and preserves its tank in archive', () => {
  let { s, machine } = yard();
  s.stacks = [];
  const originalFuel = machine.fuel;
  const result = S.requestCollection(s, { equipmentId: machine.id });
  assert.equal(result.error, undefined);
  let phases = new Set<string>();
  for (let i = 0; i < 18000; i++) {
    S.tick(s, 0.1);
    const c = s.collections![0];
    phases.add(c.task?.phase || c.status);
    if (i % 100 === 0) {
      assert.equal(collectionValidationProblem(s), undefined);
      s = S.load(S.save(s));
    }
    if (c.status === 'done') break;
  }
  assert.equal(
    s.collections![0].status,
    'done',
    JSON.stringify(s.collections) + ' ' + stateSummary(s),
  );
  assert.equal(s.equipment.length, 0);
  assert.equal(s.retiredEquipment!.length, 1);
  assert.ok(phases.has('equipment-ramp'));
  assert.ok(phases.has('equipment-exit'));
  const e = s.retiredEquipment![0];
  assert.ok(Math.abs(e.fuel + e.used - originalFuel) < 1e-6);
  S.load(S.save(s));
});
function advance(s: ReturnType<typeof S.createState>, p: () => boolean, seconds = 1800) {
  for (let n = 0; n < seconds * 10; n++) {
    if (p()) return;
    S.tick(s, 0.1);
  }
  assert.fail(JSON.stringify(s.collections) + ' ' + stateSummary(s));
}
for (const phase of ['carry', 'clear-deck'] as const)
  test(`cancellation at ${phase} safely returns suspended cargo or finishes withdrawal, with exact physical fees`, () => {
    const { s, stack } = yard();
    S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] });
    advance(s, () => s.collections![0].task?.phase === phase);
    const c = s.collections![0];
    assert.equal(S.cancelCollection(s, c.id), undefined);
    S.load(S.save(s));
    advance(s, () => ['done', 'canceled'].includes(c.status));
    const n = S.totals(s, 'slab');
    assert.equal(n.stored + n.collected, 12);
    assert.equal(n.cargo + n.outbound + n.reserved, 0);
    const actual = 90 + Math.ceil(n.collected * 280 * 0.04);
    assert.equal(c.fees.charged, actual);
    assert.equal(
      s.costs.filter((k) => k.category === 'Collection').reduce((n, k) => n + k.amount, 0),
      actual,
    );
    assert.equal(n.collected, phase === 'carry' ? 0 : 8);
    S.load(S.save(s));
  });
test('canceling a partly loaded machine ramp physically reverses to ground and keeps the asset and tank', () => {
  const { s, machine } = yard();
  s.stacks = [];
  const fuel = machine.fuel;
  S.requestCollection(s, { equipmentId: machine.id });
  const c = s.collections![0];
  advance(s, () => c.task?.phase === 'equipment-ramp' && c.task.clock > 7);
  const start = { x: machine.x, z: machine.z };
  assert.equal(S.cancelCollection(s, c.id), undefined);
  S.tick(s, 0.1);
  assert.ok(Math.hypot(machine.x - start.x, machine.z - start.z) < 0.1);
  S.load(S.save(s));
  advance(s, () => c.status === 'canceled');
  assert.equal(s.equipment[0].id, machine.id);
  assert.equal(s.retiredEquipment?.length || 0, 0);
  assert.equal(machine.y, 0);
  assert.equal(machine.transportOrder, undefined);
  assert.ok(Math.abs(machine.fuel + machine.used - fuel) < 1e-6);
  assert.equal(c.fees.charged, 180);
  S.load(S.save(s));
});
test('pause and reload retain physical cargo and resume without duplicate movement or invoice', () => {
  let { s, stack } = yard();
  S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] });
  advance(s, () => s.collections![0].task?.phase === 'lift');
  let c = s.collections![0];
  assert.equal(S.pauseCollection(s, c.id), undefined);
  const before = S.save(s);
  S.tick(s, 10);
  assert.equal(s.collections![0].task!.clock, JSON.parse(before).collections[0].task.clock);
  s = S.load(S.save(s));
  c = s.collections![0];
  assert.equal(S.resumeCollection(s, c.id), undefined);
  advance(s, () => c.status === 'done');
  assert.equal(S.totals(s, 'slab').collected, 12);
  assert.equal(
    s.movements.filter((m) => m.reason === 'Collection pickup').reduce((n, m) => n + m.qty, 0),
    12,
  );
  assert.equal(c.fees.charged, c.fees.total);
});
test('mixed materials retain separate real truck slots and never count as incoming procurement', () => {
  const { s, stack } = yard();
  const second = { ...stack, id: S.id(s, 'stack'), x: 36, item: 'processPipe' as const, qty: 7 };
  s.stacks.push(second);
  S.requestCollection(s, {
    lines: [
      { stackId: stack.id, qty: 12 },
      { stackId: second.id, qty: 7 },
    ],
  });
  assert.equal(s.collections!.length, 1);
  const c = s.collections![0];
  advance(s, () => c.status === 'done');
  assert.equal(S.totals(s, 'slab').collected, 12);
  assert.equal(S.totals(s, 'processPipe').collected, 7);
  assert.equal(S.totals(s, 'processPipe').incoming, 0);
  assert.equal(c.lines.length, 2);
  assert.equal(c.fees.charged, c.fees.total);
  S.load(S.save(s));
});
test('an empty fuel drum is physically collected while all other diesel remains conserved', () => {
  const { s, stack } = yard();
  Object.assign(stack, { item: 'diesel', qty: 1, liters: 0 });
  const before = s.equipment.reduce((n, e) => n + e.fuel + e.used, 0);
  S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 1 }] });
  advance(s, () => s.collections![0].status === 'done');
  assert.equal(S.totals(s, 'diesel').collected, 1);
  assert.ok(Math.abs(s.equipment.reduce((n, e) => n + e.fuel + e.used, 0) - before) < 1e-6);
  S.load(S.save(s));
});
test('recovered rail identities survive excavator collection and historical stack removal', () => {
  const s = S.createState(),
    machine = seedHandlingResources(s, 'excavator');
  const stack = {
    id: S.id(s, 'stack'),
    item: 'rail' as const,
    x: 30,
    z: 32,
    w: 5,
    d: 3,
    qty: 2,
    reserved: 0,
    source: 'opening',
    railAssetIds: ['TEST-RAIL-1', 'TEST-RAIL-2'],
  };
  s.stacks.push(stack);
  S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 2 }] });
  advance(s, () => s.collections![0].status === 'done');
  assert.deepEqual(s.collections![0].lines[0].assetIds, ['TEST-RAIL-1', 'TEST-RAIL-2']);
  assert.equal(s.stacks.length, 0);
  assert.equal(s.collections![0].lines[0].sourceSnapshot!.id, stack.id);
  assert.equal(machine.cargo, undefined);
  S.load(S.save(s));
});
test('a late worker stops physical lowering until the load envelope is clear', () => {
  const { s, stack, machine } = yard();
  S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] });
  const c = s.collections![0];
  advance(s, () => c.task?.phase === 'lower');
  const task = c.task!,
    before = { ...task.cargo! },
    clock = task.clock;
  const worker = {
    ...s.workers[0],
    id: S.id(s, 'worker'),
    name: 'Worker #2',
    role: 'builder' as const,
    x: task.deck.x,
    z: task.deck.z,
    path: [],
    vehicle: undefined,
    deliveryOrder: undefined,
    job: undefined,
    transition: undefined,
  };
  s.workers.push(worker);
  S.tick(s, 0.1);
  assert.equal(task.clock, clock);
  assert.deepEqual(task.cargo, before);
  assert.ok(c.note.includes(worker.id));
  worker.path = [];
  worker.x = 60;
  worker.z = 60;
  advance(s, () => c.status === 'done');
  assert.equal(S.totals(s, 'slab').collected, 12);
  assert.equal(machine.cargo, undefined);
});
test('real securing requires the operator outside the cab at the tie-down point before withdrawal', () => {
  const { s, stack, machine } = yard();
  S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] });
  const c = s.collections![0];
  advance(s, () => c.task?.phase === 'secure');
  const t = c.task!,
    w = s.workers.find((w) => w.id === t.operatorId)!;
  assert.equal(w.vehicle, undefined);
  assert.ok(Math.hypot(w.x - t.securingPoint!.x, w.z - t.securingPoint!.z) < 0.05);
  const actor = renderState(s).actors.find((a) => a.id === w.id)!;
  assert.equal(actor.visible, true);
  assert.equal(actor.workPhase, 'rail-fastening');
  advance(s, () => c.task?.phase === 'clear-deck');
  assert.equal(w.vehicle, machine.id);
  machine.path = [];
  machine.trafficGoal = undefined;
  S.tick(s, 0.1);
  assert.equal(c.task?.phase, 'clear-deck');
  assert.ok(
    machine.path.length,
    'An interrupted withdrawal must be retried rather than releasing the carrier',
  );
  advance(s, () => c.status === 'done');
});
test('saved collection ownership, ramp numeric fields and transport ledger reject corrupt imports', () => {
  const { s, machine } = yard();
  s.stacks = [];
  S.requestCollection(s, { equipmentId: machine.id });
  advance(s, () => s.collections![0].task?.phase === 'equipment-ramp');
  const json = S.save(s);
  for (const mutate of [
    (v: any) => (v.collections[0].task.returnQty = 2),
    (v: any) => (v.collections[0].task.operatorRampOrigin = { x: 1, z: 2, y: null }),
    (v: any) => (v.collections[0].task.lifted = 'yes'),
    (v: any) => (v.collections[0].task.phase = 'carry'),
    (v: any) => (v.equipment[0].deliveryOrder = undefined),
    (v: any) => (v.workers[0].deliveryOrder = undefined),
    (v: any) => (v.orders[0].collectionId = 'COL-missing'),
    (v: any) => (v.collections[0].fees.charged = 9999),
  ]) {
    const v = JSON.parse(json);
    mutate(v);
    assert.throws(() => S.load(JSON.stringify(v)), /Invalid save/);
  }
});
test('collection equipment intent exposes current sources, carriers, actors and blocked ramp operation', async () => {
  const { equipmentIntent } = await import('../src/equipment-intent');
  const { s, machine } = yard();
  s.stacks = [];
  S.requestCollection(s, { equipmentId: machine.id });
  const c = s.collections![0];
  advance(s, () => c.task?.phase === 'equipment-ramp');
  machine.blockedBy = 'WRK-0001';
  const intent = equipmentIntent(s, machine);
  assert.match(intent.phase, /Collection.*equipment-ramp/);
  assert.deepEqual(intent.target, { x: c.task!.deck.x, z: c.task!.deck.z });
  assert.ok(intent.references.includes(c.id));
  assert.ok(intent.references.includes(c.carrierOrderId));
  assert.ok(intent.references.includes(c.task!.operatorId));
  assert.ok(intent.detail.includes(machine.blockedBy));
});
test('collection excavator tool yaw stays normalized after accumulated chassis revolutions', () => {
  const s = S.createState();
  const machine = seedHandlingResources(s, 'excavator');
  const stack = {
    id: S.id(s, 'stack'),
    item: 'slab' as const,
    x: 30,
    z: 32,
    w: 1,
    d: 1,
    qty: 12,
    reserved: 0,
    source: 'opening',
  };
  s.stacks.push(stack);
  S.requestCollection(s, { lines: [{ stackId: stack.id, qty: 12 }] });
  advance(s, () => s.collections![0].task?.phase === 'carry');
  machine.yaw = 58;
  const actor = renderState(s).actors.find((e) => e.id === machine.id)!;
  assert.ok('upperYaw' in actor && 'toolLift' in actor);
  assert.ok(Math.abs(actor.upperYaw) <= Math.PI);
  assert.ok(Number.isFinite(actor.toolLift));
});
test('completed work-order machine assignments retain archived IDs after physical collection',()=>{
 const {s,machine}=yard();s.stacks=[];S.pave(s,{x:60,z:60,w:1,d:1});const j=s.jobs[0],group=s.jobGroups![0];j.status='canceled';j.preferredEquipment=machine.id;group.preferredEquipment=machine.id;S.load(S.save(s));assert.equal(S.requestCollection(s,{equipmentId:machine.id}).error,undefined);advance(s,()=>s.collections![0].status==='done');const reloaded=S.load(S.save(s));assert.equal(reloaded.jobGroups![0].preferredEquipment,machine.id);assert.equal(reloaded.jobs[0].preferredEquipment,machine.id);const invalid=JSON.parse(S.save(s));invalid.jobs[0].status='todo';assert.throws(()=>S.load(JSON.stringify(invalid)),/Invalid save/);
});
