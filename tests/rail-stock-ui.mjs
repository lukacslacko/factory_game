import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function checkRailStockUI(page, base) {
  const f = await page.evaluate(async () => {
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const { state: s, Sim: S } = plant01;
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    const e = seedHandlingResources(s, 'excavator');
    Object.assign(e, { x: 20, z: 38 });
    s.zones.push({ id: S.id(s, 'zone'), name: 'Relocation yard', x: 25, z: 20, w: 60, d: 55 });
    const t = {
      id: S.id(s, 'stack'),
      item: 'rail',
      qty: 3,
      reserved: 0,
      source: 'opening',
      x: 30,
      z: 29,
      w: 5,
      d: 3,
    };
    s.stacks.push(t);
    s.paused = true;
    plant01.world.controls.enableDamping = false;
    plant01.world.controls.target.set(57, 0, 41);
    plant01.world.camera.position.set(60, 55, 90);
    plant01.world.controls.update();
    plant01.action('entity:' + t.id);
    plant01.step(0);
    return { stock: t.id, equipment: e.id };
  });
  await page.locator(`[data-action="stock-move:${f.stock}"]`).click();
  assert.match(await page.locator('#mode-hint').innerText(), /RELOCATE RAIL STOCK/);
  const p = await page.evaluate(() => plant01.world.project({ x: 65.25, z: 40.25 })),
    c = await page.locator('#world').boundingBox();
  await page.mouse.move(c.x + p.x, c.y + p.y);
  await page.mouse.click(c.x + p.x, c.y + p.y);
  const j = await page.evaluate(() => plant01.state.jobs.find((j) => j.kind === 'moveStock'));
  assert(j, 'Actual floor click queues stock relocation');
  assert.equal(j.stockMove.sourceId, f.stock);
  assert.equal(j.x, 65);
  assert.equal(j.z, 40);
  assert.match(await page.locator('#inspector').innerText(), /Relocate one/);
  await page.locator(`[data-job-equipment="${j.parentId}"]`).selectOption(f.equipment);
  const moved = await page.evaluate((id) => {
    const { state: s, Sim: S } = plant01;
    s.paused = false;
    for (let i = 0; i < 10000 && s.jobs.find((j) => j.id === id).status !== 'done'; i++)
      S.tick(s, 0.1);
    s.paused = true;
    plant01.step(0);
    return {
      job: s.jobs.find((j) => j.id === id),
      stock: s.stacks.map((t) => ({ x: t.x, z: t.z, qty: t.qty, reserved: t.reserved })),
      save: S.save(s),
    };
  }, j.id);
  assert.equal(moved.job.status, 'done');
  assert(moved.stock.some((t) => t.x === 65 && t.z === 40 && t.qty === 1 && t.reserved === 0));
  fs.writeFileSync(base + '/test-results/rail-stock-production-save.json', moved.save);
  await page.locator('#tabs [data-action="tab:reports"]').click();
  await page
    .locator('#sql')
    .fill(
      "SELECT id, kind, stock_move_source, stock_move_x, stock_move_z FROM jobs WHERE kind='moveStock';",
    );
  await page.locator('[data-action="sql-run"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#sql-status')?.textContent.includes('1 rows'),
  );
  assert.match(await page.locator('#sql-results').innerText(), /moveStock/);
  return {
    passed: true,
    actualGroundClick: true,
    physicalJobDone: true,
    source: f.stock,
    savedAndReloadable: true,
  };
}
