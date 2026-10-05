import assert from 'node:assert/strict';

export async function checkEquipmentIntent(page, base) {
  const fixture = await page.evaluate(async () => {
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const { Sim: S, state: s } = plant01;
    S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
    const e = seedHandlingResources(s, 'excavator');
    const [id] = S.purchase(s, 'railCurve', 8, 'rail');
    const o = s.orders.find((o) => o.id === id);
    for (let t = 0; t < 9000; t++) {
      S.tick(s, 0.1);
      if (o.unload?.phase === 'clear' && o.unload.mergeId && !e.path.length) break;
    }
    if (o.arrived !== 4 || o.unload?.qty !== 1)
      throw new Error('Missing actual three-plus-one top-up');
    const drop = o.unload.drop;
    // A clearly identified opening obstacle tests blocked-route visualization.
    const blocker = S.id(s, 'building');
    s.buildings.push({
      id: blocker,
      kind: 'office',
      x: drop.x - 2,
      z: drop.z - 1.5,
      w: 4,
      d: 3,
      rotation: 0,
      connected: false,
      name: 'Dock obstruction fixture',
      source: 'opening',
    });
    s.revision++;
    for (let t = 0; t < 30 && e.blockedBy !== blocker; t++) S.tick(s, 0.1);
    if (e.blockedBy !== blocker) throw new Error('Dock blocker was not reported');
    s.paused = true;
    plant01.action(`entity:${e.id}`);
    plant01.step(0);
    plant01.world.controls.enableDamping = false;
    plant01.world.controls.target.set(32, 0, 32);
    plant01.world.camera.position.set(58, 38, 68);
    plant01.world.controls.update();
    return { machine: e.id, order: id, stock: o.unload.mergeId, blocker, drop, note: o.note };
  });
  await page.evaluate(() => plant01.step(0));
  const inspector = await page.locator('#inspector').textContent();
  assert(inspector.includes(fixture.note));
  for (const id of [fixture.order, fixture.stock, fixture.blocker])
    assert(await page.locator(`#inspector [data-action="entity:${id}"]`).count());
  const blocked = await page.evaluate(() => {
    const g = plant01.world.equipmentIntentOverlay;
    return {
      dashed: !!g.getObjectByName('equipment-target-intent'),
      solid: !!g.getObjectByName('equipment-planned-route'),
      label: !!g.getObjectByName('equipment-destination-label'),
      children: g.children.length,
    };
  });
  assert(blocked.dashed && !blocked.solid && blocked.label);
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/equipment-blocked-preview.png' });
  const traveling = await page.evaluate((fixture) => {
    const { Sim: S, state: s } = plant01;
    s.buildings = s.buildings.filter((b) => b.id !== fixture.blocker);
    s.revision++;
    s.paused = false;
    const e = s.equipment.find((e) => e.id === fixture.machine);
    for (let t = 0; t < 30 && !e.path.length; t++) S.tick(s, 0.1);
    s.paused = true;
    plant01.step(0);
    plant01.step(0);
    const g = plant01.world.equipmentIntentOverlay;
    const line = g.getObjectByName('equipment-planned-route');
    const positions = line?.geometry.getAttribute('position');
    return {
      phase: s.orders.find((o) => o.id === fixture.order).unload.phase,
      note: s.orders.find((o) => o.id === fixture.order).note,
      path: e.path.length,
      solid: !!line,
      dashed: !!g.getObjectByName('equipment-target-intent'),
      end: positions && [positions.getX(positions.count - 1), positions.getZ(positions.count - 1)],
    };
  }, fixture);
  assert(traveling.solid && !traveling.dashed && traveling.path > 0);
  assert.equal(traveling.phase, 'carry');
  assert.doesNotMatch(traveling.note, /No clear loaded route/);
  assert.deepEqual(traveling.end, [fixture.drop.x, fixture.drop.z]);
  await page.screenshot({ path: base + '/equipment-route-preview.png' });
  const completed = await page.evaluate((fixture) => {
    const { Sim: S, state: s } = plant01;
    const o = s.orders.find((o) => o.id === fixture.order);
    s.paused = false;
    for (let t = 0; t < 9000 && o.status !== 'done'; t++) S.tick(s, 0.1);
    s.paused = true;
    plant01.step(0);
    plant01.action('deselect');
    plant01.step(0);
    return {
      status: o.status,
      arrived: o.arrived,
      stacks: s.stacks.filter((t) => t.item === 'railCurve').map((t) => t.qty),
      overlayChildren: plant01.world.equipmentIntentOverlay.children.reduce(
        (n, g) => n + g.children.length,
        0,
      ),
    };
  }, fixture);
  assert.equal(completed.status, 'done');
  assert.equal(completed.arrived, 8);
  assert.deepEqual(completed.stacks, [4, 4]);
  assert.equal(completed.overlayChildren, 0);
  return { passed: true, fixture, blocked, traveling, completed };
}
