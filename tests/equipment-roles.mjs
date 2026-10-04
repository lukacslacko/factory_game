import assert from 'node:assert/strict';

export async function checkEquipmentRoles(page, base) {
  const machines = await page.evaluate(() =>
    plant01.state.equipment.map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z })),
  );
  const excavator = machines.find((e) => e.kind === 'excavator');
  const forklift = machines.find((e) => e.kind === 'forklift');
  await page.locator('#tabs [data-action="tab:equipment"]').click();
  await page.locator(`#records [data-equipment-role="${excavator.id}"]`).selectOption('paving');
  await page.locator(`#records [data-equipment-role="${forklift.id}"]`).selectOption('receiving');
  assert.deepEqual(
    await page.evaluate(() =>
      plant01.state.equipment.map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z })),
    ),
    machines,
  );
  await page.locator(`#records [data-action="locate:equipment:${excavator.id}"]`).click();
  const inspector = page.locator(`#inspector [data-equipment-role="${excavator.id}"]`);
  assert.equal(await inspector.inputValue(), 'paving');
  await inspector.selectOption('hold');
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.equipment.find((e) => e.id === id).workRole,
      excavator.id,
    ),
    'hold',
  );
  await inspector.selectOption('paving');
  await inspector.focus();
  const field = await inspector.elementHandle();
  await page.waitForTimeout(700);
  assert(
    await field.evaluate((el) => el.isConnected && el === document.activeElement),
    'Live inspector updates must not replace an open role selector',
  );
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
    await page.locator(`#records [data-equipment-role="${excavator.id}"]`).inputValue(),
    'paving',
  );
  assert.equal(
    await page.locator(`#records [data-equipment-role="${forklift.id}"]`).inputValue(),
    'receiving',
  );
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/equipment-roles-preview.png' });
  return {
    passed: true,
    register: true,
    inspector: true,
    focusPreserved: true,
    sql: true,
    savedRoles: { excavator: 'paving', forklift: 'receiving' },
  };
}
