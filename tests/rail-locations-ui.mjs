import assert from 'node:assert/strict';

export async function checkRailLocationsUI(page, base) {
  await page.evaluate(() => {
    plant01.start('empty');
    plant01.action('dismiss-guide');
    plant01.state.paused = true;
    plant01.world.controls.enableDamping = false;
    plant01.world.controls.target.set(75, 0, 5);
    plant01.world.camera.position.set(89, 30, 44);
    plant01.world.controls.update();
    plant01.step(0);
  });
  const pick = async (x, z) => {
    const point = await page.evaluate(({ x, z }) => plant01.world.project({ x, z }), { x, z });
    const canvas = await page.locator('#world').boundingBox();
    await page.mouse.move(canvas.x + point.x, canvas.y + point.y);
    await page.mouse.click(canvas.x + point.x, canvas.y + point.y);
  };
  await page.locator('[data-action="tool:rail-location"]').click();
  await pick(75, 0);
  assert.equal(
    await page.locator('#rail-location-form').count(),
    0,
    'The protected main line cannot be designated',
  );
  await pick(75, 5);
  await page.locator('#rail-location-name').fill('Concrete receiving');
  await page.locator('#rail-location-kind').selectOption('unloading');
  await page.locator('#rail-location-length').fill('20');
  await page.locator('[data-action="rail-location-save:create"]').click();
  const id = await page.evaluate(() => plant01.state.railLocations[0]?.id);
  assert.ok(id);
  assert.equal(await page.evaluate(() => plant01.state.railLocations.length), 1);
  assert.match(await page.locator('#inspector').innerText(), /Concrete receiving|designation/i);
  const marker = await page.evaluate((id) => {
    plant01.step(0);
    const g = plant01.world.staticGroup.getObjectByName('railway-location-' + id);
    return {
      exists: !!g,
      selection: g?.userData.selection,
      label: !!g?.getObjectByName('railway-location-label'),
      length: !!g?.getObjectByName('railway-location-length'),
    };
  }, id);
  assert.deepEqual(marker.selection, { type: 'railLocation', id });
  assert(marker.exists && marker.label && marker.length);
  // A marker is a planning reference: ordering, cargo, jobs and costs stay empty.
  assert.deepEqual(
    await page.evaluate(() => ({
      orders: plant01.state.orders.length,
      jobs: plant01.state.jobs.length,
      costs: plant01.state.costs.length,
    })),
    { orders: 0, jobs: 0, costs: 0 },
  );
  await page.locator('[data-action="tool:rail-location"]').click();
  await pick(75, 5);
  await page.locator('#rail-location-name').fill('concrete RECEIVING');
  await page.locator('[data-action="rail-location-save:create"]').click();
  assert.match(await page.locator('#rail-location-error').innerText(), /unique/i);
  assert.equal(await page.evaluate(() => plant01.state.railLocations.length), 1);
  await page.locator('#rail-location-form [data-action="close-modal"]').first().click();
  await page.keyboard.press('Escape');
  await page.evaluate((id) => {
    plant01.action('entity:' + id);
    plant01.step(0);
  }, id);
  await page.locator('#rail-location-name').fill('Fuel transfer <A> & B');
  await page.locator('#rail-location-kind').selectOption('transfer');
  await page.locator('#rail-location-length').fill('16');
  await page.locator('#rail-location-offset').fill('55');
  await page.locator(`[data-action="rail-location-save:${id}"]`).click();
  assert.deepEqual(
    await page.evaluate(() =>
      plant01.state.railLocations.map(({ id, name, offset, length, kind }) => ({
        id,
        name,
        offset,
        length,
        kind,
      })),
    ),
    [{ id, name: 'Fuel transfer <A> & B', offset: 55, length: 16, kind: 'transfer' }],
  );
  // Invalid edits retain the original record and explain why the interval fails.
  await page.locator('#rail-location-length').fill('200');
  await page.locator(`[data-action="rail-location-save:${id}"]`).click();
  assert.equal(await page.evaluate(() => plant01.state.railLocations[0].length), 16);
  assert.match(await page.locator('#toast').innerText(), /length|span|end|fit|interval/i);
  await page.locator('#rail-location-length').fill('16');
  await page.locator(`[data-action="rail-location-reposition:${id}"]`).click();
  await pick(85, 5);
  await page.locator('[data-action="rail-location-save:create"]').click();
  assert.equal(await page.evaluate(() => plant01.state.railLocations.length), 1);
  const moved = await page.evaluate(() => plant01.state.railLocations[0]);
  assert.equal(moved.id, id);
  assert(Math.abs(moved.offset - 60) < 0.1, 'Reposition uses the actual picked centerline');
  // Pick the actual rendered designation, rather than invoking an entity action.
  await page.evaluate(() => {
    plant01.action('deselect');
    plant01.step(0);
  });
  const markerPoint = await page.evaluate((id) => {
    const world = plant01.world,
      g = world.staticGroup.getObjectByName('railway-location-' + id);
    const label = g.getObjectByName('railway-location-label');
    const p = label.position.clone();
    label.localToWorld(p.set(0, 0, 0));
    p.project(world.camera);
    return {
      x: ((p.x + 1) / 2) * world.canvas.clientWidth,
      y: ((1 - p.y) / 2) * world.canvas.clientHeight,
    };
  }, id);
  const bounds = await page.locator('#world').boundingBox();
  await page.mouse.click(bounds.x + markerPoint.x, bounds.y + markerPoint.y);
  assert.deepEqual(await page.evaluate(() => plant01.selection), { type: 'railLocation', id });
  await page.locator('#tabs [data-action="tab:railways"]').click();
  assert.match(await page.locator('#records').innerText(), /Fuel transfer/);
  assert(await page.locator(`#records [data-action="entity:${id}"]`).count());
  await page.locator(`#records [data-action="entity:${id}"]`).click();
  assert.equal(await page.evaluate(() => plant01.selection?.id), id);
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  assert.match(await page.locator('#inspector').innerText(), /Fuel transfer <A> & B/);
  assert.equal(await page.locator('#inspector a:not([data-action])').count(), 0);
  await page.screenshot({ path: base + '/railway-locations-preview.png' });
  await page.setViewportSize({ width: 768, height: 900 });
  const responsive = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(responsive.scroll <= responsive.width);
  assert(await page.locator('#rail-location-name').isVisible());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="tab:reports"]').click();
  await page
    .locator('#sql')
    .fill(
      'SELECT id, name, kind, track_id, route, offset_m, length_m FROM rail_locations ORDER BY id;',
    );
  await page.locator('[data-action="sql-run"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#sql-status')?.textContent.includes('rows'),
  );
  assert.equal(await page.locator('#sql-results tbody tr').count(), 1);
  assert.match(await page.locator('#sql-results').innerText(), /Fuel transfer/);
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.deepEqual(await page.evaluate(() => plant01.state.railLocations), [moved]);
  await page.evaluate((id) => {
    plant01.action('entity:' + id);
    plant01.step(0);
  }, id);
  await page.locator(`[data-action="rail-location-delete:${id}"]`).click();
  await page.evaluate(() => plant01.step(0));
  assert.equal(await page.evaluate(() => plant01.state.railLocations.length), 0);
  assert.equal(
    await page.evaluate(
      (id) => !!plant01.world.staticGroup.getObjectByName('railway-location-' + id),
      id,
    ),
    false,
  );
  return {
    passed: true,
    id,
    marker,
    moved,
    worldPicking: true,
    sqlRows: 1,
    duplicateNameRejected: true,
    escapedName: true,
    responsive,
    savedAndReloaded: true,
    deleted: true,
    logisticsUnchanged: true,
  };
}
