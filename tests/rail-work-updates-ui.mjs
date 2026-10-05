import assert from 'node:assert/strict';
import fs from 'node:fs';

export async function checkRailWorkUpdatesUI(page, base) {
  const fixture = await page.evaluate(async () => {
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const { Sim: S, state: s } = plant01;
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    const old = seedHandlingResources(s, 'excavator');
    Object.assign(old, { x: 27, z: 36 });
    s.stacks.push({
      id: S.id(s, 'stack'),
      item: 'rail',
      qty: 4,
      reserved: 0,
      source: 'opening',
      x: 30,
      z: 29,
      w: 5,
      d: 3,
    });
    const plans = [125, 130, 135, 140].map((x) => S.planRailLayout(s, 'straight', { x, z: 5 }));
    if (plans.some((p) => p.error)) throw Error(JSON.stringify(plans));
    const group = plans[0].group.id,
      jobs = plans.map((p) => p.jobs[0]);
    if (plans.some((p) => p.group.id !== group)) throw Error('Expected whole connected work');
    s.paused = false;
    for (let i = 0; i < 3000 && jobs[0].railWork?.phase !== 'source-approach'; i++) S.tick(s, 0.1);
    if (jobs[0].equipment !== old.id || jobs[0].railWork?.phase !== 'source-approach')
      throw Error('Expected actual automatic source approach');
    const stager = seedHandlingResources(s, 'excavator');
    Object.assign(stager, { x: 60, z: 35 });
    const installer = seedHandlingResources(s, 'excavator');
    Object.assign(installer, { x: 95, z: 35 });
    const { setEquipmentAssistant } = await import('/src/work-crews.ts');
    const builders = s.workers.filter((w) => w.role === 'builder');
    setEquipmentAssistant(s, stager.id, builders[1].id);
    setEquipmentAssistant(s, installer.id, builders[2].id);
    s.paused = true;
    plant01.action('entity:' + jobs[3].id);
    plant01.step(0);
    return {
      group,
      jobs: jobs.map((j) => j.id),
      component: jobs[3].parentId,
      old: old.id,
      stager: stager.id,
      installer: installer.id,
    };
  });
  assert(
    await page.locator(`#inspector [data-action="entity:${fixture.group}"]`).count(),
    'A clicked 5 m panel links its whole work run',
  );
  await page.locator(`#inspector [data-action="entity:${fixture.group}"]`).first().click();
  assert.match(await page.locator('.rail-crew-controls legend').innerText(), /4 panels/);
  await page.evaluate((f) => {
    plant01.Sim.cancelJob(plant01.state, f.jobs[3]);
    plant01.action('entity:' + f.group);
  }, fixture);
  await page.locator(`[data-action="resume-track:${fixture.group}"]`).click();
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.jobs.find((j) => j.id === id).status,
      fixture.jobs[3],
    ),
    'todo',
    'The whole-work resume control restores a canceled child component',
  );
  await page.locator('#rail-staging-equipment').selectOption(fixture.stager);
  await page.locator('#rail-installing-equipment').selectOption(fixture.installer);
  await page.locator(`[data-action="rail-crew-save:${fixture.group}"]`).click();
  const handed = await page.evaluate((f) => {
    const s = plant01.state,
      old = s.equipment.find((e) => e.id === f.old),
      j = s.jobs.find((j) => j.id === f.jobs[0]);
    return {
      status: j.status,
      equipment: j.equipment,
      oldJob: old.job,
      oldPath: old.path.length,
      stock: s.stacks.reduce((n, t) => n + t.qty, 0),
    };
  }, fixture);
  assert.deepEqual(handed, {
    status: 'todo',
    equipment: undefined,
    oldJob: undefined,
    oldPath: 0,
    stock: 4,
  });
  const loaded = await page.evaluate((f) => {
    const { Sim: S, state: s } = plant01;
    s.paused = false;
    const e = s.equipment.find((e) => e.id === f.stager),
      j = s.jobs.find((j) => j.id === f.jobs[0]);
    for (let i = 0; i < 12000 && j.railWork?.phase !== 'stage-travel'; i++) S.tick(s, 0.1);
    if (e.cargo?.qty !== 4 || j.railWork?.phase !== 'stage-travel')
      throw Error(
        'Full supported batch did not reach travel: ' +
          JSON.stringify({ cargo: e.cargo, phase: j.railWork?.phase, reason: j.reason }),
      );
    s.paused = true;
    plant01.action('entity:' + e.id);
    const world = plant01.world;
    world.controls.enableDamping = false;
    world.controls.target.set(e.x, 0, e.z);
    world.camera.position.set(e.x + 18, 22, e.z + 30);
    world.controls.update();
    plant01.step(0);
    return {
      qty: e.cargo.qty,
      leader: j.id,
      batch: j.railWork.stagingBatch,
      save: S.save(s),
      x: e.x,
      z: e.z,
    };
  }, fixture);
  assert.equal(loaded.batch.jobIds.length, 4);
  const rendering = await page.evaluate((id) => {
    let panel;
    plant01.world.dynamicGroup.traverse((o) => {
      if (o.name === `${id}-rail-panel`) panel = o;
    });
    // The retained dynamic object is identified by its job selection, rather than renderer-specific node names.
    if (!panel)
      plant01.world.dynamicGroup.traverse((o) => {
        if (o.userData.selection?.id === id && o.children.some((c) => c.name === 'panel-parts'))
          panel = o;
      });
    if (!panel) throw Error('Missing carried panel rendering');
    let meshes = 0;
    panel.traverse((o) => {
      if (o.isMesh) meshes++;
    });
    return { meshes };
  }, loaded.leader);
  assert(rendering.meshes >= 40, 'All four real rail panels are rendered in the carried stack');
  fs.writeFileSync(base + '/test-results/rail-work-updates-production-save.json', loaded.save);
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/rail-batch-staging-preview.png' });
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  const after = await page.evaluate((f) => {
    const s = plant01.state;
    return {
      crew: s.jobGroups.find((g) => g.id === f.group).railCrew,
      cargo: s.equipment.find((e) => e.id === f.stager).cargo?.qty,
      held: s.jobs.filter((j) => j.railStagingBatch).length,
    };
  }, fixture);
  assert.deepEqual(after, {
    crew: { stagingEquipment: fixture.stager, installingEquipment: fixture.installer },
    cargo: 4,
    held: 4,
  });
  await page.evaluate((id) => plant01.action('entity:' + id), fixture.component);
  assert.match(await page.locator('#inspector').innerText(), /whole connected rail work/);
  assert.equal(
    await page.locator('#rail-staging-equipment').count(),
    0,
    'Component layouts direct crew editing to the whole work',
  );
  await page.locator(`#inspector [data-action="entity:${fixture.group}"]`).first().click();
  assert.equal(await page.locator('#rail-staging-equipment').inputValue(), fixture.stager);
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/connected-rail-work-preview.png' });
  return {
    passed: true,
    ...fixture,
    manualOverrideBeforePickup: true,
    wholeRunAssignment: true,
    wholeRunResume: true,
    carriedPanels: 4,
    savedBatchRetained: true,
    rendering,
  };
}
