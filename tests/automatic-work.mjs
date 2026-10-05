import assert from 'node:assert/strict';

export async function checkAutomaticWork(page, base) {
  const result = await page.evaluate(() => {
    plant01.start('demo');
    plant01.action('dismiss-guide');
    const s = plant01.state;
    s.paused = false;
    plant01.Sim.pave(s, { x: 56, z: 35, w: 4, d: 1 });
    for (let t = 0; t < 3; t += 0.1) plant01.Sim.tick(s, 0.1);
    s.paused = true;
    plant01.step(0);
    const group = s.jobGroups[0];
    return {
      group: group.id,
      owner: group.automaticEquipment,
      assigned: s.jobs.filter((j) => j.equipment).map((j) => j.equipment),
      reason: s.jobs.find((j) => !j.equipment)?.reason,
    };
  });
  assert.ok(result.owner);
  assert.deepEqual([...new Set(result.assigned)], [result.owner]);
  assert(result.reason.includes(result.owner));
  await page.locator('#tabs [data-action="tab:jobs"]').click();
  await page.locator(`#records [data-action="entity:${result.group}"]`).first().click();
  assert((await page.locator('#inspector').textContent()).includes('Automatic machine'));
  assert(
    await page.locator('#inspector').evaluate((el) => el.scrollWidth <= el.clientWidth),
    'Assignment controls must not clip linked equipment IDs',
  );
  await page.locator(`#inspector [data-action="entity:${result.owner}"]`).first().click();
  assert.equal(await page.evaluate(() => plant01.selection.type), 'equipment');
  await page.locator('#tabs [data-action="tab:jobs"]').click();
  await page.locator(`#records [data-action="entity:${result.group}"]`).first().click();
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/automatic-work-preview.png' });
  await page.locator('#tabs [data-action="tab:reports"]').click();
  await page
    .locator('#sql')
    .fill(`SELECT automaticEquipment FROM job_groups WHERE id = '${result.group}'`);
  await page.locator('[data-action="sql-run"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#sql-status')?.textContent.includes('rows'),
  );
  assert((await page.locator('#sql-results').textContent()).includes(result.owner));
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).automaticEquipment,
      result.group,
    ),
    result.owner,
  );
  return { passed: true, ...result };
}
