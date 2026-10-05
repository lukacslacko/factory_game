import assert from 'node:assert/strict';

export async function checkDeliveryRecoveryUI(page, base) {
  const fixture = await page.evaluate(async () => {
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const { Sim: S, state: s } = plant01;
    S.addZone(s, { x: 24, z: 26, w: 24, d: 20 });
    const machine = seedHandlingResources(s, 'forklift');
    const [orderId] = S.purchase(s, 'slab', 6, 'road');
    const order = s.orders.find((o) => o.id === orderId);
    for (let n = 0; n < 9000 && order.unload?.phase !== 'lift'; n++) S.tick(s, 0.1);
    if (order.unload?.phase !== 'lift')
      throw new Error('Expected an actual delivery lifting phase');
    s.paused = true;
    plant01.action('entity:' + machine.id);
    plant01.step(0);
    return { machine: machine.id, order: orderId };
  });
  assert(
    await page.locator(`[data-action="delivery-pause:${fixture.machine}"]`).isDisabled(),
    'Direct control cannot interrupt a physical lift',
  );
  const loaded = await page.evaluate(async (fixture) => {
    const { Sim: S, state: s } = plant01;
    const order = s.orders.find((o) => o.id === fixture.order);
    const machine = s.equipment.find((e) => e.id === fixture.machine);
    s.paused = false;
    for (let n = 0; n < 9000 && order.unload?.phase !== 'carry'; n++) S.tick(s, 0.1);
    if (order.unload?.phase !== 'carry' || !machine.cargo || !machine.path.length)
      throw new Error('Expected a loaded forklift following its storage route');
    const { deliveryBlockageNotice } = await import('/src/delivery-control.ts');
    deliveryBlockageNotice(s, order, 'Recovery UI fixture: storage approach blocked', 0);
    // Legacy records without a severity continue to appear under Info.
    S.event(s, 'Planning', machine.id, 'Legacy information record for the recovery fixture');
    s.paused = true;
    plant01.step(0);
    return {
      cargo: structuredClone(machine.cargo),
      destination: structuredClone(order.unload.destination),
      operator: order.unload.operatorId,
      moveTo: machine.path[Math.min(4, machine.path.length - 1)],
      position: { x: machine.x, z: machine.z },
    };
  }, fixture);
  assert(await page.locator(`[data-action="delivery-pause:${fixture.machine}"]`).isEnabled());
  await page.locator(`[data-action="delivery-pause:${fixture.machine}"]`).click();
  assert.match(await page.locator('#mode-hint').innerText(), /Unloading .* is paused/);
  assert(await page.locator(`[data-action="delivery-resume:${fixture.machine}"]`).count());
  assert.deepEqual(
    await page.evaluate((fixture) => {
      const s = plant01.state,
        o = s.orders.find((o) => o.id === fixture.order),
        e = s.equipment.find((e) => e.id === fixture.machine);
      return {
        paused: o.unloadPaused,
        cargo: e.cargo,
        destination: o.unload.destination,
        operator: e.operator,
        duty: s.workers.find((w) => w.id === e.operator).duty,
      };
    }, fixture),
    {
      paused: true,
      cargo: loaded.cargo,
      destination: loaded.destination,
      operator: loaded.operator,
      duty: 'manual',
    },
  );
  await page.locator('#tabs [data-action="tab:activity"]').click();
  await page.locator('[data-action="activity-severity:warning"]').click();
  assert.equal(
    await page.locator('[data-action="activity-severity:warning"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator('#records tbody tr').count(), 1);
  assert.match(await page.locator('#records tbody').innerText(), /storage approach blocked/);
  assert.doesNotMatch(await page.locator('#records').innerText(), /Material movements/);
  assert(
    await page.locator(`#records [data-action="entity:${fixture.machine}"]`).count(),
    'A warning links its equipment as well as the delivery',
  );
  await page.evaluate((fixture) => {
    plant01.Sim.event(
      plant01.state,
      'Work',
      fixture.machine,
      'More ordinary activity while warning filter is selected',
    );
    plant01.step(0);
  }, fixture);
  assert.equal(
    await page.locator('#records tbody tr').count(),
    1,
    'Live informational events do not reset the warning filter',
  );
  await page.locator('[data-action="activity-severity:info"]').click();
  assert.match(await page.locator('#records').innerText(), /Legacy information record/);
  assert.doesNotMatch(
    await page.locator('#records tbody').first().innerText(),
    /storage approach blocked/,
  );
  await page.locator('[data-action="activity-severity:all"]').click();
  assert.match(await page.locator('#records').innerText(), /storage approach blocked/);
  await page.locator('[data-action="activity-severity:warning"]').click();
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/activity-warnings-preview.png' });
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  await page.locator('#tabs [data-action="tab:activity"]').click();
  assert.equal(
    await page.locator('[data-action="activity-severity:warning"]').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator('#records tbody tr').count(), 1);
  await page.locator(`#records [data-action="entity:${fixture.machine}"]`).first().click();
  assert(
    await page.locator(`#inspector [data-action="delivery-resume:${fixture.machine}"]`).isEnabled(),
  );
  assert.equal(
    await page.evaluate(
      (fixture) => plant01.state.orders.find((o) => o.id === fixture.order).unloadPaused,
      fixture,
    ),
    true,
  );
  await page.locator(`[data-action="delivery-take-control:${fixture.machine}"]`).click();
  // Drive by the actual floor input, preserving all retained cargo and reservations.
  await page.evaluate((fixture) => {
    const e = plant01.state.equipment.find((e) => e.id === fixture.machine);
    const world = plant01.world;
    world.controls.enableDamping = false;
    world.controls.target.set(e.x, 0, e.z);
    world.camera.position.set(e.x + 18, 28, e.z + 34);
    world.controls.update();
    plant01.step(0);
  }, fixture);
  const point = await page.evaluate((p) => plant01.world.project(p), loaded.moveTo);
  const bounds = await page.locator('#world').boundingBox();
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
  const moved = await page.evaluate((fixture) => {
    const s = plant01.state;
    s.paused = false;
    plant01.step(2);
    s.paused = true;
    const e = s.equipment.find((e) => e.id === fixture.machine),
      o = s.orders.find((o) => o.id === fixture.order);
    return {
      x: e.x,
      z: e.z,
      paused: o.unloadPaused,
      cargo: e.cargo,
      order: e.deliveryOrder,
      operatorOrder: s.workers.find((w) => w.id === e.operator).deliveryOrder,
    };
  }, fixture);
  assert(
    Math.hypot(moved.x - loaded.position.x, moved.z - loaded.position.z) > 0.1,
    'The retained delivery operator can physically drive after the pause',
  );
  assert.equal(moved.paused, true);
  assert.deepEqual(moved.cargo, loaded.cargo);
  assert.equal(moved.order, fixture.order);
  assert.equal(moved.operatorOrder, fixture.order);
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/delivery-recovery-preview.png' });
  await page.locator(`#inspector [data-action="delivery-resume:${fixture.machine}"]`).click();
  const completed = await page.evaluate((fixture) => {
    const { Sim: S, state: s } = plant01;
    const o = s.orders.find((o) => o.id === fixture.order);
    s.paused = false;
    for (let n = 0; n < 18000 && o.status !== 'done'; n++) S.tick(s, 0.1);
    s.paused = true;
    plant01.step(0);
    return {
      status: o.status,
      paused: o.unloadPaused,
      slabs: s.stacks.filter((t) => t.item === 'slab').reduce((n, t) => n + t.qty, 0),
      receipts: s.costs.filter((c) => c.entity === o.id).length,
    };
  }, fixture);
  assert.deepEqual(completed, { status: 'done', paused: undefined, slabs: 6, receipts: 1 });
  return {
    passed: true,
    ...fixture,
    loaded,
    moved,
    completed,
    transferPauseRejected: true,
    manualFloorDriving: true,
    savedPauseRetained: true,
    warningsLinked: true,
    legacyInfoVisible: true,
    severityFilterLive: true,
    severityFilterSaved: true,
  };
}
