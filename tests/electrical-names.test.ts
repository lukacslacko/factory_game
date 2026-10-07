import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, save, load, plan } from '../src/sim';
import { renameElectricalAsset } from '../src/electrical-names';
import { electricalNetwork } from '../src/electrical-network';

test('electrical labels retain stable wiring IDs and survive reload for all supported assets', () => {
  const s = createState();
  const kinds = ['power', 'electricalJunction', 'lamp', 'transferPump'] as const;
  s.creative = true;
  s.buildings.push({
    id: 'BLD-0100',
    kind: 'power',
    x: 30,
    z: 30,
    w: 1,
    d: 1,
    rotation: 0,
    connected: true,
    name: 'Station',
    source: 'opening',
  });
  for (const [i, kind] of kinds.entries())
    if (kind !== 'power') assert.equal(plan(s, kind, 30 + i * 4, 30).error, '');
  s.utilities.power = true;
  const ids = s.buildings.map((b) => b.id);
  for (const [i, b] of s.buildings.entries()) {
    assert.equal(renameElectricalAsset(s, b.id, `  North bay ${i}  `), undefined);
    assert.equal(b.id, ids[i]);
    assert.equal(b.name, `North bay ${i}`);
  }
  const restored = load(save(s));
  assert.deepEqual(
    restored.buildings.map(({ id, name, kind }) => ({ id, name, kind })),
    s.buildings.map(({ id, name, kind }) => ({ id, name, kind })),
  );
  const network = electricalNetwork(restored);
  assert.equal(network.sources[0].name, 'North bay 0');
  assert.equal(network.junctions.find((j) => j.kind === 'electricalJunction')?.name, 'North bay 1');
  assert.equal(network.consumers.find((j) => j.kind === 'lamp')?.name, 'North bay 2');
  assert.equal(network.consumers.find((j) => j.kind === 'transferPump')?.name, 'North bay 3');
});

test('invalid electrical renames are nonmutating and duplicate labels remain identifiable by ID', () => {
  const s = createState();
  s.buildings = ['lamp', 'lamp', 'office'].map((kind, i) => ({
    id: `BLD-${100 + i}`,
    kind: kind as 'lamp' | 'office',
    x: 30 + i * 4,
    z: 30,
    w: 1,
    d: 1,
    rotation: 0,
    connected: false,
    source: 'opening',
    name: 'Original',
  }));
  const before = save(s);
  for (const name of ['', '  ', 'a'.repeat(81), 'bad\nname', 'bad\u0000name', 42, null])
    assert.ok(renameElectricalAsset(s, 'BLD-100', name));
  assert.ok(renameElectricalAsset(s, 'BLD-missing', 'New'));
  assert.ok(renameElectricalAsset(s, 'BLD-102', 'New'));
  assert.equal(save(s), before);
  assert.equal(renameElectricalAsset(s, 'BLD-100', 'Yard light'), undefined);
  assert.equal(renameElectricalAsset(s, 'BLD-101', 'Yard light'), undefined);
  assert.notEqual(s.buildings[0].id, s.buildings[1].id);
  const revision = s.revision;
  assert.equal(renameElectricalAsset(s, 'BLD-100', 'Yard light'), undefined);
  assert.equal(s.revision, revision);
});
