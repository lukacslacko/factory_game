import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function checkOperationsUI(page, base) {
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.state.paused = true;
    plant01.Sim.pave(plant01.state, { x: 85, z: 62, w: 2, d: 1 });
    plant01.Sim.plan(plant01.state, 'office', 90, 50);
    plant01.step(0);
  });
  await page.locator('[data-action="dismiss-guide"]').click();
  const data = await page.evaluate(() => ({
    group: plant01.state.jobGroups.find((g) => g.label.startsWith('Place')),
    equipment: plant01.state.equipment.find((e) => e.kind === 'excavator'),
    worker: plant01.state.workers.find((w) => w.role === 'operator'),
  }));
  await page.locator('#tabs [data-action="tab:jobs"]').click();
  assert(
    await page
      .locator('[data-action="filter:active"]')
      .evaluate((e) => e.classList.contains('active')),
  );
  const initialRows = await page.locator('#records tbody tr').count();
  await page.locator(`[data-job-equipment="${data.group.id}"]`).selectOption(data.equipment.id);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).preferredEquipment,
      data.group.id,
    ),
    data.equipment.id,
  );
  await page.locator(`[data-action="toggle-work:${data.group.id}"]`).click();
  assert((await page.locator('#records tbody tr').count()) > initialRows);
  const idButton = page.locator(`#records [data-action="entity:${data.group.id}"]`).first();
  await idButton.click();
  assert.equal(await page.evaluate(() => plant01.selection.type), 'jobGroup');
  await page.locator(`#inspector [data-action="entity:${data.equipment.id}"]`).first().click();
  assert.equal(await page.evaluate(() => plant01.selection.type), 'equipment');
  await page.locator('#parking-x').fill('82');
  await page.locator('#parking-z').fill('75');
  await page.locator('#parking-direction').selectOption('2');
  await page.locator(`[data-action="parking-save:${data.equipment.id}"]`).click();
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).parking,
      data.equipment.id,
    ),
    { x: 82, z: 75, rotation: 2 },
  );
  // Click placement is also real world input, with snapped coordinates.
  await page.locator(`[data-action="parking-pick:${data.equipment.id}"]`).click();
  await page.evaluate(() => plant01.world.focus({ x: 70, z: 65 }, 1.3));
  await page.waitForTimeout(250);
  const canvas = await page.locator('#world').boundingBox(),
    point = await page.evaluate(() => plant01.world.project({ x: 72.2, z: 68.2 }));
  await page.mouse.click(canvas.x + point.x, canvas.y + point.y);
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).parking,
      data.equipment.id,
    ),
    { x: 72, z: 68, rotation: 2 },
  );
  await page.locator('#tabs [data-action="tab:workers"]').click();
  await page.locator(`[data-worker-schedule="${data.worker.id}"]`).selectOption('22,6');
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.workers.find((w) => w.id === id).schedule,
      data.worker.id,
    ),
    { start: 22, end: 6 },
  );
  const header = page.locator('#records th').filter({ hasText: 'Hours' }).locator('button');
  await header.click();
  assert.equal(await header.locator('..').getAttribute('aria-sort'), 'ascending');
  await header.click();
  assert.equal(await header.locator('..').getAttribute('aria-sort'), 'descending');
  await page.locator('[data-action="column-filters"]').click();
  const nameFilter = page.locator('[aria-label="Filter Name"]');
  await nameFilter.fill('Worker #1');
  assert.equal(await page.locator('#records tbody tr').count(), 1);
  await nameFilter.fill('');
  await page.locator('[data-action="column-filters"]').click();
  await page.locator('#tabs [data-action="tab:jobs"]').click();
  await page.screenshot({ path: base + '/work-orders-preview.png' });
  await page.locator('#tabs [data-action="tab:activity"]').click();
  const waiting = page.waitForEvent('download');
  await page.locator('[data-action="export-diagnostics"]').click();
  const download = await waiting;
  const file = base + '/test-results/operations-diagnostics.json';
  await download.saveAs(file);
  const archive = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(archive.format, 'plant01-diagnostics');
  assert.equal(archive.gameVersion, '0.6.0');
  assert(archive.entries.some((e) => e.type === 'equipment-assignment'));
  assert(archive.checkpoints.length > 0);
  assert(archive.current.equipment.some((e) => e.parking));
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).preferredEquipment,
      data.group.id,
    ),
    data.equipment.id,
  );
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.workers.find((w) => w.id === id).schedule,
      data.worker.id,
    ),
    { start: 22, end: 6 },
  );
  await page.evaluate(() => {
    plant01.start('empty');
    plant01.state.paused = true;
  });
  await page.locator('[data-action="dismiss-guide"]').click();
  await page.locator('#tabs [data-action="tab:reports"]').click();
  for (const sql of [
    'SELECT equipment, reason, created FROM work_orders',
    'SELECT parking_x, parkingStatus FROM equipment',
    'SELECT schedule, shiftPhase FROM workers',
  ]) {
    await page.locator('#sql').fill(sql);
    await page.locator('[data-action="sql-run"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#sql-status').textContent.includes('rows'),
    );
    assert((await page.locator('#sql-status').textContent()).includes('0 rows'));
  }
  return {
    passed: true,
    hierarchy: true,
    manualAssignments: true,
    entityLinks: true,
    sorting: true,
    columnFilters: true,
    parkingCoordinates: true,
    parkingClick: true,
    schedules: true,
    diagnosticExport: true,
    saveReload: true,
  };
}
