import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Sim from '../src/sim.ts';
import { equipmentAssistant, setEquipmentAssistant, restoreAutomaticSupportWorker } from '../src/work-crews.ts';
import { seedHandlingResources } from './support/yard.ts';
import { tickUntil } from './support/yard.ts';

test('a physically delivered forklift warns until a hired builder reaches the site', () => {
  const s = Sim.createState();
  Sim.purchase(s, 'operator', 1);
  Sim.purchase(s, 'forklift', 1);
  tickUntil(s, () => s.equipment.some((e) => !e.transportOrder), 900);
  const e = s.equipment[0];
  tickUntil(s, () => !!s.notices.find((n) => n.entity === e.id &&
    n.title === 'Support worker needed' && n.state === 'todo'), 5);
  Sim.purchase(s, 'builder', 1);
  tickUntil(s, () => !!equipmentAssistant(s, e.id), 900);
  assert.equal(equipmentAssistant(s, e.id)?.role, 'builder');
  assert.equal(s.notices.find((n) => n.entity === e.id &&
    n.title === 'Support worker needed')?.state, 'done');
});

test('new site equipment gets one available helper and an unresolved shortage stays in the inbox', () => {
  const s = Sim.createState();
  const first = seedHandlingResources(s, 'excavator');
  first.supportAutoPending = true;
  const second = { ...first, id: Sim.id(s, 'equipment'), x: 60, path: [] };
  s.equipment.push(second);
  assert.equal(s.automations?.supportWorkers, true);
  Sim.tick(s, 1);
  assert.equal(equipmentAssistant(s, first.id)?.role, 'builder');
  assert.equal(equipmentAssistant(s, second.id), undefined);
  const warning = s.notices.find((n) => n.entity === second.id && n.title === 'Support worker needed');
  assert.equal(warning?.state, 'todo');
  assert.equal(warning?.severity, 'warning');
  Sim.tick(s, 1);
  assert.equal(s.notices.filter((n) => n.title === 'Support worker needed').length, 1);
  const helper = { ...s.workers[1], id: Sim.id(s, 'worker'), x: 57,
    assistingEquipment: undefined, path: [], status: 'Available' };
  s.workers.push(helper);
  Sim.tick(s, 1);
  assert.equal(equipmentAssistant(s, second.id)?.id, helper.id);
  assert.equal(warning?.state, 'done');
});

test('manual support choices win over automation; setting persists through save and reload', () => {
  let s = Sim.createState();
  const e = seedHandlingResources(s, 'excavator');
  e.supportAutoPending = true;
  assert.equal(Sim.configureConsumableAutomations(s, { supportWorkers: false }), '');
  Sim.tick(s, 1);
  assert.equal(equipmentAssistant(s, e.id), undefined);
  s = Sim.load(Sim.save(s));
  assert.equal(s.automations?.supportWorkers, false);
  assert.equal(Sim.configureConsumableAutomations(s, { supportWorkers: true }), '');
  assert.equal(setEquipmentAssistant(s, e.id), '');
  Sim.tick(s, 1);
  assert.equal(equipmentAssistant(s, e.id), undefined, 'Manual release is not immediately reversed');
  assert.equal(restoreAutomaticSupportWorker(s, e.id), '');
  Sim.tick(s, 1);
  assert.ok(equipmentAssistant(s, e.id));
});
