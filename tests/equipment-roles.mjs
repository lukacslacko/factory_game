import assert from 'node:assert/strict';

export async function checkEquipmentRoles(page, base) {
  const machines = await page.evaluate(() =>
    plant01.state.equipment.map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z })),
  );
  const excavator = machines.find((e) => e.kind === 'excavator');
  const forklift = machines.find((e) => e.kind === 'forklift');
  await page.locator('#tabs [data-action="tab:equipment"]').click();
  async function choose(scope, id, activities) {
    const dropdown = page.locator(`${scope} [data-equipment-work="${id}"]`);
    if (!(await dropdown.evaluate((el) => el.open))) {
      if (await page.locator('details.equipment-role[open]').count())
        await page.keyboard.press('Escape');
      await dropdown.locator('summary').click();
    }
    await dropdown.locator('[data-equipment-work-preset="none"]').click();
    for (const activity of activities) await dropdown.locator(`input[value="${activity}"]`).check();
    return dropdown;
  }
  await choose('#records', excavator.id, ['paving']);
  await choose('#records', forklift.id, ['receiving']);
  assert.deepEqual(
    await page.evaluate(() =>
      plant01.state.equipment.map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z })),
    ),
    machines,
  );
  await page.keyboard.press('Escape');
  await page.locator(`#records [data-action="locate:equipment:${excavator.id}"]`).click();
  const inspector = page.locator(`#inspector [data-equipment-work="${excavator.id}"]`);
  assert.equal(await inspector.locator('input[value="paving"]').isChecked(), true);
  await choose('#inspector', excavator.id, []);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).workRole,
      excavator.id,
    ),
    'hold',
  );
  await inspector.locator('input[value="paving"]').check();
  await inspector.locator('input[value="receiving"]').check();
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).allowedWork,
      excavator.id,
    ),
    ['receiving', 'paving'],
  );
  assert.equal(
    await inspector.evaluate((el) => el.open),
    true,
    'Selecting several kinds keeps dropdown open',
  );
  const checkbox = inspector.locator('input[value="receiving"]');
  await checkbox.focus();
  const field = await checkbox.elementHandle();
  const beforeRefresh = await page.evaluate(() => ({
    paused: plant01.state.paused,
    elapsed: plant01.state.elapsed,
  }));
  await page.evaluate(() => {
    plant01.state.paused = false;
  });
  await page.waitForTimeout(900);
  const elapsedAfter = await page.evaluate(() => plant01.state.elapsed);
  await page.evaluate((paused) => {
    plant01.state.paused = paused;
  }, beforeRefresh.paused);
  assert(
    elapsedAfter > beforeRefresh.elapsed,
    'The focus check must include running simulation refreshes',
  );
  assert(
    await field.evaluate((el) => el.isConnected && el === document.activeElement),
    'Live inspector updates must not replace an open checkbox or its focus',
  );
  assert.equal(await inspector.evaluate((el) => el.open), true);
  await checkbox.uncheck();
  await page.keyboard.press('Escape');
  assert.equal(await inspector.evaluate((el) => el.open), false);
  await page.locator('#tabs [data-action="tab:reports"]').click();
  await page.locator('#sql').fill('SELECT kind, workRole FROM equipment ORDER BY kind');
  await page.locator('[data-action="sql-run"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#sql-status')?.textContent.includes('rows'),
  );
  const rows = await page.locator('#sql-results tbody tr').allTextContents();
  assert(rows.some((row) => row.includes('excavator') && row.includes('paving')));
  assert(rows.some((row) => row.includes('forklift') && row.includes('receiving')));
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).workRole,
      excavator.id,
    ),
    'paving',
  );
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).workRole,
      forklift.id,
    ),
    'receiving',
  );
  await page.locator('#tabs [data-action="tab:equipment"]').click();
  assert.equal(
    await page
      .locator(`#records [data-equipment-work="${excavator.id}"] input[value="paving"]`)
      .isChecked(),
    true,
  );
  assert.equal(
    await page
      .locator(`#records [data-equipment-work="${forklift.id}"] input[value="receiving"]`)
      .isChecked(),
    true,
  );
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/equipment-roles-preview.png' });
  return {
    passed: true,
    register: true,
    inspector: true,
    focusPreserved: true,
    unpausedRefreshPreserved: true,
    mixedCheckboxSelection: true,
    escapeClosesDropdown: true,
    sql: true,
    savedRoles: { excavator: 'paving', forklift: 'receiving' },
  };
}
