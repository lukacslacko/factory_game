import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT, MATERIALS, PURCHASE_GROUPS, ROLES, SERVICES } from '../src/catalog';
import { packPurchase } from '../src/procurement';

test('purchase catalog puts workers first and includes every available item once in its theme', () => {
  const groups = PURCHASE_GROUPS;
  assert.equal(groups[0].id, 'workers');
  assert.deepEqual(new Set(groups[0].items), new Set(Object.keys(ROLES)));
  const items = groups.flatMap((group) => group.items);
  const available = [
    ...Object.keys(ROLES),
    ...Object.keys(EQUIPMENT),
    ...Object.keys(MATERIALS),
    ...Object.entries(SERVICES)
      .filter(([, service]) => !('purchasable' in service) || service.purchasable !== false)
      .map(([key]) => key),
  ];
  assert.equal(
    new Set(groups.map((group) => group.id)).size,
    groups.length,
    'Group identities must remain distinct',
  );
  assert.ok(groups.every((group) => group.name && group.items.length));
  assert.equal(
    new Set(items).size,
    items.length,
    'A catalog entry must have only one purchase row',
  );
  assert.deepEqual(
    [...items].sort(),
    available.sort(),
    'Available entries must never disappear from either store',
  );
  assert.equal(items.includes('power'), false);
  for (const [theme, entries] of [
    ['equipment', Object.keys(EQUIPMENT)],
    [
      'railway',
      ['rail', 'railCurve', 'railPoints', 'railFrog', 'railClosure', 'railExit', 'bufferStop'],
    ],
    [
      'process',
      [
        'processTank',
        'transferPump',
        'processPipe',
        'pipeElbow',
        'pipeTee',
        'processValve',
        'processGauge',
      ],
    ],
    ['electrical', ['lamp', 'electricalJunction', 'cableReel']],
    ['fuel', ['diesel']],
    ['services', ['water']],
  ] as const)
    assert.deepEqual(new Set(groups.find((group) => group.id === theme)!.items), new Set(entries));
  for (const item of items)
    assert.ok(packPurchase([{ item, qty: 1 }], 'road').length, `${item} must remain purchasable`);
});
