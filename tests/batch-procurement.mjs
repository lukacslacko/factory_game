import assert from 'node:assert/strict';
export async function checkBatchProcurement(page, base) {
  await page.evaluate(() => {
    plant01.start('empty');
    plant01.state.paused = true;
  });
  await page.locator('[data-action="dismiss-guide"]').click();
  await page.locator('[data-action="shop"]').click();
  assert.deepEqual((await page.locator('.catalog-group h3').allTextContents()).slice(0, 4), [
    'Workers',
    'Equipment',
    'Paving and buildings',
    'Railway',
  ]);
  assert.equal(await page.locator('[data-action="purchase:power"], #qty-power').count(), 0);
  assert.equal(
    await page.evaluate(
      () => plant01.state.buildings.filter((building) => building.kind === 'power').length,
    ),
    1,
  );
  await page.locator('#qty-builder').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.action),
    'purchase:builder',
  );
  for (const [item, qty] of [
    ['builder', 3],
    ['operator', 2],
    ['engineer', 1],
  ]) {
    await page.locator('#qty-' + item).fill(String(qty));
    await page.locator('[data-action="cart-add:' + item + '"]').click();
  }
  assert.match(await page.locator('#batch-summary').innerText(), /1 crew bus/);
  assert.equal(
    await page
      .locator('[data-catalog-row="builder"]')
      .evaluate((row) => row.classList.contains('in-batch')),
    true,
  );
  assert.equal(await page.locator('#batch-builder').innerText(), 'In batch: 3');
  assert.equal(await page.locator('#cost-builder').innerText(), '$270');
  assert.equal(await page.locator('.cart-lines > div').count(), 3);
  assert.match(await page.locator('.cart-lines').innerText(), /× 3[\s\S]*\$270/);
  await page.locator('[data-action="purchase-batch"]').click();
  let orders = await page.evaluate(() => plant01.state.orders);
  assert.equal(orders.length, 1);
  assert.equal(await page.locator('.catalog-row.in-batch').count(), 0);
  assert.equal(await page.locator('.cart-lines > div').count(), 0);
  assert.equal(orders[0].qty, 6);
  assert.deepEqual(
    orders[0].manifest.map((l) => [l.item, l.qty]),
    [
      ['builder', 3],
      ['operator', 2],
      ['engineer', 1],
    ],
  );
  for (const [item, qty] of [
    ['slab', 24],
    ['rail', 1],
    ['diesel', 1],
  ]) {
    await page.locator('#qty-' + item).fill(String(qty));
    await page.locator('[data-action="cart-add:' + item + '"]').click();
  }
  assert.equal(await page.locator('#mass-slab').innerText(), '6.72 t');
  assert.equal(await page.locator('#cost-slab').innerText(), '$912');
  assert.equal(await page.locator('#batch-slab').innerText(), 'In batch: 24');
  const catalog = await page
    .locator('.catalog-list')
    .evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  assert(catalog.scroll > catalog.height && catalog.height <= 480, JSON.stringify(catalog));
  assert.match(await page.locator('#batch-summary').innerText(), /2 truck loads/);
  await page.locator('#transport').selectOption('rail');
  assert.match(
    await page.locator('#batch-summary').innerText(),
    /8.36 t cargo.*1 train · 1 flatcar/,
  );
  await page.screenshot({ path: base + '/procurement-preview.png' });
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const modal = await page
      .locator('.modal.shop')
      .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    assert(modal.scroll <= modal.width, JSON.stringify(modal));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="purchase-batch"]').click();
  orders = await page.evaluate(() => plant01.state.orders);
  assert.equal(orders.length, 2);
  assert.equal(orders[1].mode, 'rail');
  assert.deepEqual(
    orders[1].manifest.map((l) => [l.item, l.qty]),
    [
      ['slab', 24],
      ['rail', 1],
      ['diesel', 1],
    ],
  );
  await page.locator('[data-action="close-modal"]').click();
  await page.locator('#tabs [data-action="tab:deliveries"]').click();
  const text = await page.locator('#records').innerText();
  assert.match(text, /8\.36 t/);
  assert.match(text, /Diesel drum/);
  await page.evaluate((id) => plant01.action('entity:' + id), orders[1].id);
  assert.match(await page.locator('#inspector').innerText(), /0 \/ 24 received/);
  // Reporting uses one row per catalog item, linked to the shared carrier ID.
  const report = await page.evaluate(async () => {
    const { query } = await import('/src/reports.ts');
    return query(
      plant01.state,
      'SELECT order_id,item,qty,arrived,mass_kg FROM order_lines ORDER BY order_id,line',
    );
  });
  assert.equal(report[0].values.length, 6);
  await page.evaluate(() => plant01.Sim.load(plant01.Sim.save(plant01.state)));
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.state.paused = true;
    plant01.world.grid.visible = false;
    plant01.world.focus({ x: -16, z: 30 }, 1.4);
  });
  await page.locator('[data-action="dismiss-guide"]').click();
  await page.waitForTimeout(700);
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.locator('#delivery-toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/terrain-fix-preview.png' });
  return {
    mixedCrew: 6,
    crewBuses: 1,
    mixedCargoKg: 8355,
    roadLoads: 2,
    railLoads: 1,
    sqlLines: 6,
    layouts: [1440, 1024, 768],
    thematicGroups: true,
    keyboardFocus: true,
    selectedRowsAndLinePrices: true,
    preinstalledPower: true,
  };
}
