import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { tickConsumableAutomations } from '../src/consumable-automations';
import { advance, seedHandlingResources } from './support/yard';

test('consumable automations default on but do not order or collect before vehicle fuel demand', () => {
  const s = S.createState();
  assert.deepEqual([s.automations?.vehicleRefueling, s.automations?.fuelOrdering,
    s.automations?.emptyBarrelCollection], [true, true, true]);
  s.stacks.push({ id: S.id(s, 'stack'), item: 'diesel', qty: 1, reserved: 0,
    liters: 0, x: 30, z: 30, w: 1, d: 1, source: 'opening' });
  advance(s, 31);
  assert.equal(s.orders.length, 0);
  assert.equal(s.collections?.length || 0, 0);
  assert.equal(s.automations?.fuelDemandSeen, false);
});

test('low equipment queues real refueling and two physical diesel drums only once', () => {
  let s = S.createState();
  const e = seedHandlingResources(s, 'forklift');
  e.fuel = e.tank * 0.25 + 0.1;
  advance(s, 11);
  assert.equal(s.orders.length, 0);
  assert.equal(s.jobs.filter((j) => j.kind === 'refuel').length, 0);
  e.fuel = e.tank * 0.25;
  advance(s, 10);
  assert.equal(s.automations?.fuelDemandSeen, true);
  assert.equal(s.jobs.filter((j) => j.kind === 'refuel').length, 1);
  const inbound = s.orders.flatMap((o) => o.manifest || [{ item: o.item, qty: o.qty }])
    .filter((line) => line.item === 'diesel').reduce((n, line) => n + line.qty, 0);
  assert.equal(inbound, 2);
  const orderIds = s.orders.map((o) => o.id);
  s = S.load(S.save(s));
  advance(s, 20);
  assert.deepEqual(s.orders.map((o) => o.id), orderIds, 'incoming barrels prevent repeat orders');
  assert.equal(s.jobs.filter((j) => j.kind === 'refuel').length, 1);
});

test('policy switches and thresholds survive reload; disabled actions stay disabled', () => {
  let s = S.createState();
  const e = seedHandlingResources(s, 'forklift');
  assert.equal(S.configureConsumableAutomations(s, { vehicleRefueling: false,
    fuelOrdering: false, emptyBarrelCollection: false, refuelAtPercent: 40,
    fuelReserveLiters: 300, fuelTargetLiters: 800 }), '');
  assert.match(S.configureConsumableAutomations(s, { fuelTargetLiters: 200 }), /higher target/);
  assert.equal(s.automations?.fuelTargetLiters, 800, 'invalid change is atomic');
  s = S.load(S.save(s));
  assert.deepEqual([s.automations?.vehicleRefueling, s.automations?.fuelOrdering,
    s.automations?.emptyBarrelCollection], [false, false, false]);
  s.equipment.find((q) => q.id === e.id)!.fuel = 1;
  s.stacks.push({ id: S.id(s, 'stack'), item: 'diesel', qty: 1, reserved: 0,
    liters: 0, x: 30, z: 30, w: 1, d: 1, source: 'opening' });
  advance(s, 21);
  assert.equal(s.jobs.filter((j) => j.kind === 'refuel').length, 0);
  assert.equal(s.orders.length, 0);
  assert.equal(s.collections?.length || 0, 0);
  assert.equal(s.automations?.fuelDemandSeen, true);
});

test('available stored diesel delays ordering until the configured reserve is crossed', () => {
  const s = S.createState();
  const e = seedHandlingResources(s, 'forklift');
  e.fuel = 1;
  const drum = { id: S.id(s, 'stack'), item: 'diesel' as const, qty: 1, reserved: 0,
    liters: 200, x: 32, z: 30, w: 1, d: 1, source: 'opening' };
  s.stacks.push(drum);
  advance(s, 11);
  assert.equal(s.orders.length, 0);
  drum.liters = 100;
  advance(s, 10);
  const incoming = s.orders.flatMap((o) => o.manifest || [{ item: o.item, qty: o.qty }])
    .filter((line) => line.item === 'diesel').reduce((n, line) => n + line.qty, 0);
  assert.equal(incoming, 2, 'two barrels restore 100 L to at least the 400 L target');
});

test('empty drums use one paid physical collection after fuel demand, without duplicates', () => {
  const s = S.createState();
  const e = seedHandlingResources(s, 'forklift');
  e.fuel = 1;
  assert.equal(S.configureConsumableAutomations(s, { vehicleRefueling: false,
    fuelOrdering: false }), '');
  const first = { id: S.id(s, 'stack'), item: 'diesel' as const, qty: 1, reserved: 0,
    liters: 0, x: 30, z: 30, w: 1, d: 1, source: 'opening' };
  const second = { ...first, id: S.id(s, 'stack'), x: 32 };
  s.stacks.push(first, second);
  advance(s, 11);
  assert.equal(s.collections?.length, 1);
  assert.equal(s.collections?.[0].lines.length, 2);
  assert.equal(first.reserved, 1);
  assert.equal(second.reserved, 1);
  assert.equal(s.collections?.[0].fees.total! > 0, true);
  advance(s, 20);
  assert.equal(s.collections?.length, 1);
});

test('a low shunter keeps a visible service request until a safe parked refuel succeeds', () => {
  let s = S.createState();
  s.shunters = [{ id: 'SHUNTER-9000', name: 'Yard shunter', x: 60, z: 5, yaw: 0,
    fuel: 4, tank: 100, used: 96, status: 'Parked', phase: 'parked', eta: s.time,
    manualControl: true, anchor: { trackId: 'BOOTSTRAP-SIDING', route: 'straight', offset: 35 } }];
  let attempts = 0;
  const api = { refuelEquipment: () => '', refuelShunter: () => {
    attempts++;
    return attempts === 1 ? 'Park within 8 m of an available diesel barrel before refueling.' : undefined;
  }, purchaseDiesel: () => [] as string[], collectBarrels: () => ({ ids: [] as string[] }),
  event: () => {} };
  s.automations!.fuelOrdering = false;
  tickConsumableAutomations(s, api);
  assert.equal(s.shunters[0].autoRefuelRequested, true);
  assert.equal(attempts, 0, 'direct manual control is never overridden');
  s = S.load(S.save(s));
  s.shunters![0].manualControl = false;
  tickConsumableAutomations(s, api);
  assert.equal(attempts, 1);
  assert.match(s.shunters![0].autoRefuelReason!, /Park within 8 m/);
  tickConsumableAutomations(s, api);
  assert.equal(attempts, 2);
  assert.equal(s.shunters![0].autoRefuelRequested, undefined);
});
