import fs from 'node:fs';
import assert from 'node:assert/strict';

export async function checkRailCrewsUI(page, base) {
  const fixture = await page.evaluate(async () => {
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const s = plant01.state;
    s.paused = true;
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    const stager = seedHandlingResources(s, 'excavator');
    const installer = seedHandlingResources(s, 'excavator');
    installer.x = 17.5;
    const plan = plant01.Sim.planRailLayout(s, 'curve', { x: 125, z: 5 });
    if (plan.error) throw new Error(plan.error);
    const legacyA = plant01.Sim.plan(s, 'rail', 185, 49);
    const legacyB = plant01.Sim.plan(s, 'rail', 190, 49);
    if (legacyA.error || legacyB.error) throw new Error(legacyA.error || legacyB.error);
    if (legacyA.job.parentId !== legacyB.job.parentId)
      throw new Error('Adjacent legacy rail panels should share their work group');
    plant01.step(0);
    return {
      group: plan.group.id,
      legacyGroup: legacyA.job.parentId,
      staging: stager.id,
      installing: installer.id,
      helpers: s.workers.filter((w) => w.role === 'builder').map((w) => w.id),
      operator: s.workers.find((w) => w.role === 'operator').id,
    };
  });
  await page.locator('#tabs [data-action="tab:equipment"]').click();
  const helperSelector = (equipment) =>
    page.locator(`#records [data-equipment-assistant="${equipment}"]`);
  assert.equal(
    await helperSelector(fixture.staging).locator(`option[value="${fixture.operator}"]`).count(),
    0,
    'An operator cannot be selected as a ground support worker',
  );
  await helperSelector(fixture.staging).selectOption(fixture.helpers[0]);
  await helperSelector(fixture.installing).selectOption(fixture.helpers[1]);
  assert.deepEqual(
    await page.evaluate(() =>
      plant01.state.workers
        .filter((w) => w.assistingEquipment)
        .map((w) => [w.id, w.assistingEquipment]),
    ),
    [
      [fixture.helpers[0], fixture.staging],
      [fixture.helpers[1], fixture.installing],
    ],
  );
  // A helper cannot silently switch away from another assigned machine.
  await helperSelector(fixture.installing).selectOption(fixture.helpers[0]);
  assert.match(await page.locator('#toast').innerText(), /already supports|release/i);
  assert.equal(await helperSelector(fixture.installing).inputValue(), fixture.helpers[1]);
  await page.evaluate((id) => plant01.action('entity:' + id), fixture.group);
  assert(await page.locator('#rail-staging-equipment').isVisible());
  assert(await page.locator('#rail-installing-equipment').isVisible());
  await page.locator('#rail-staging-equipment').selectOption(fixture.staging);
  await page.evaluate((id) => {
    plant01.state.jobs.find((j) => j.parentId === id).reason = 'Waiting for ordered panels';
    plant01.step(0);
  }, fixture.group);
  assert.equal(
    await page.locator('#rail-staging-equipment').inputValue(),
    fixture.staging,
    'Live job updates preserve an unfinished crew edit',
  );
  await page.locator('#rail-installing-equipment').selectOption(fixture.staging);
  await page.locator(`[data-action="rail-crew-save:${fixture.group}"]`).click();
  assert.match(await page.locator('#toast').innerText(), /different|same/i);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).railCrew,
      fixture.group,
    ),
    undefined,
  );
  await page.locator('#rail-staging-equipment').selectOption(fixture.staging);
  await page.locator('#rail-installing-equipment').selectOption(fixture.installing);
  await page.locator(`[data-action="rail-crew-save:${fixture.group}"]`).click();
  const expectedCrew = {
    stagingEquipment: fixture.staging,
    installingEquipment: fixture.installing,
  };
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).railCrew,
      fixture.group,
    ),
    expectedCrew,
  );
  assert.equal(
    await page.locator('#inspector [data-job-equipment]').count(),
    0,
    'An explicit rail crew replaces the misleading single-machine selector',
  );
  assert.equal(
    (await page.locator(`#inspector [data-action="entity:${fixture.staging}"]`).count()) > 0,
    true,
  );
  await page.locator(`#inspector [data-action="entity:${fixture.staging}"]`).first().click();
  assert.equal(
    await page.locator('#inspector [data-equipment-assistant]').inputValue(),
    fixture.helpers[0],
  );
  await page.locator(`#inspector [data-action="entity:${fixture.helpers[0]}"]`).first().click();
  assert.match(await page.locator('#inspector').innerText(), /Supports equipment|Stays near/);
  assert(await page.locator(`#inspector [data-action="entity:${fixture.staging}"]`).count());
  await page.locator(`[data-action="assistant-clear:${fixture.helpers[0]}"]`).click();
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.workers.find((w) => w.id === id).assistingEquipment,
      fixture.helpers[0],
    ),
    undefined,
  );
  await page.evaluate((id) => plant01.action('entity:' + id), fixture.staging);
  await page.locator('#inspector [data-equipment-assistant]').selectOption(fixture.helpers[0]);
  // Controls fit the narrow inspector and remain linked after a real browser reload.
  await page.evaluate((id) => plant01.action('entity:' + id), fixture.group);
  await page.setViewportSize({ width: 768, height: 900 });
  const responsive = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(responsive.scroll <= responsive.width);
  assert(await page.locator('#rail-installing-equipment').isVisible());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: base + '/rail-work-crew-preview.png' });
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).railCrew,
      fixture.group,
    ),
    expectedCrew,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      plant01.state.workers
        .filter((w) => w.assistingEquipment)
        .map((w) => [w.id, w.assistingEquipment]),
    ),
    [
      [fixture.helpers[0], fixture.staging],
      [fixture.helpers[1], fixture.installing],
    ],
  );
  await page.evaluate((id) => plant01.action('entity:' + id), fixture.group);
  await page.locator('#rail-staging-equipment').selectOption('');
  await page.locator('#rail-installing-equipment').selectOption('');
  await page.locator(`[data-action="rail-crew-save:${fixture.group}"]`).click();
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).railCrew,
      fixture.group,
    ),
    undefined,
  );
  fs.writeFileSync(
    base + '/test-results/rail-crews-production-save.json',
    await page.evaluate(() => JSON.stringify(plant01.state)),
  );
  // Legacy multi-piece straight orders do not have group.track, but use the same crew controls.
  await page.evaluate((id) => plant01.action('entity:' + id), fixture.legacyGroup);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).track,
      fixture.legacyGroup,
    ),
    undefined,
  );
  assert(await page.locator('#rail-staging-equipment').isVisible());
  await page.locator('#rail-staging-equipment').selectOption(fixture.staging);
  await page.locator('#rail-installing-equipment').selectOption(fixture.installing);
  await page.locator(`[data-action="rail-crew-save:${fixture.legacyGroup}"]`).click();
  assert.deepEqual(
    await page.evaluate(
      (id) => plant01.state.jobGroups.find((g) => g.id === id).railCrew,
      fixture.legacyGroup,
    ),
    expectedCrew,
  );
  await page.screenshot({ path: base + '/test-results/rail-crews-inspector.png' });
  return {
    passed: true,
    ...fixture,
    assignedCrew: expectedCrew,
    duplicateMachineRejected: true,
    duplicateHelperRejected: true,
    clickableReferences: true,
    workerRelease: true,
    savedAndReloaded: true,
    liveEditPreserved: true,
    singleMachineRestored: true,
    legacyStraightGroup: true,
    responsive,
  };
}
