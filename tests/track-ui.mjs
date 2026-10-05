import assert from 'node:assert/strict';
import fs from 'node:fs';

export async function checkTrackUI(page, base) {
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.action('dismiss-guide');
    plant01.state.paused = true;
  });
  await page.locator('[data-action="rail-end"]').click();
  await page.locator('[data-action="rail-layout:curve"]').click();
  assert.match(await page.locator('.rail-bill').innerText(), /6 × Curved rail/);
  const place = async (x, z) => {
    await page.waitForTimeout(120);
    const p = await page.evaluate(({ x, z }) => plant01.world.project({ x, z }), { x, z });
    const b = await page.locator('#world').boundingBox();
    await page.mouse.move(b.x + p.x, b.y + p.y);
    await page.mouse.click(b.x + p.x, b.y + p.y);
  };
  await place(125, 5);
  assert.equal(
    await page.evaluate(() => plant01.state.jobs.filter((j) => j.track?.layout === 'curve').length),
    6,
  );
  await page.locator('[data-action="buy-missing"]').first().click();
  await page.keyboard.press('Escape');
  const run = async (layout) => {
    const result = await page.evaluate(async (layout) => {
      const { Sim: S, state: s } = plant01;
      const { requestLowFuelService } = await import('/tests/support/yard.ts');
      s.paused = false;
      for (
        let n = 0;
        n < 60000 &&
        (s.jobs.some((j) => j.status === 'todo' || j.status === 'doing') ||
          s.orders.some((o) => o.status !== 'done'));
        n++
      ) {
        S.tick(s, 0.1);
        requestLowFuelService(s);
      }
      s.paused = true;
      plant01.step(0);
      const active = s.jobs.filter((j) => j.status === 'todo' || j.status === 'doing');
      if (active.length)
        return {
          failure: JSON.stringify(
            active.map((j) => ({ id: j.id, phase: j.phase, reason: j.reason })),
          ),
          save: S.save(s),
        };
      if (s.orders.some((o) => o.status !== 'done'))
        throw new Error(
          JSON.stringify(
            s.orders
              .filter((o) => o.status !== 'done')
              .map((o) => ({ id: o.id, note: o.note, phase: o.unload?.phase })),
          ),
        );
      return {
        layout,
        panels: s.rails.filter((r) => r.track?.layout === layout).length,
        buffer: s.buffer,
        balances: Object.keys(S.missingMaterials(s)),
        completed: s.jobs.filter((j) => j.status === 'done').length,
      };
    }, layout);
    if (result.failure) {
      fs.writeFileSync(base + '/test-results/track-ui-failure.json', result.save);
      assert.fail(result.failure);
    }
    return result;
  };
  const curve = await run('curve');
  assert.equal(curve.panels, 6);
  assert.deepEqual(curve.buffer, { x: 145, z: 25 });
  await page.locator('[data-action="rail-end"]').click();
  await page.locator('[data-action="rail-layout:turnout"]').click();
  assert.match(await page.locator('.rail-options').innerText(), /Facing south/);
  await place(145, 25);
  assert.equal(
    await page.evaluate(
      () => plant01.state.jobs.filter((j) => j.track?.layout === 'turnout').length,
    ),
    7,
  );
  await page.locator('[data-action="buy-missing"]').first().click();
  await page.keyboard.press('Escape');
  const turnout = await run('turnout');
  assert.equal(turnout.panels, 7);
  assert.deepEqual(turnout.buffer, { x: 145, z: 45 });
  await page.locator('[data-action="tab:railways"]').click();
  const register = await page.locator('#records').innerText();
  assert.match(register, /13.*installed panels/s);
  assert.match(register, /Uncapped/);
  assert.match(register, /BUFFER-001/);
  await page.locator('[data-action="tab:site"]').click();
  const pointsId = await page.evaluate(
    () =>
      plant01.state.rails.find((r) => r.track?.layout === 'turnout' && r.track.section === 0).id,
  );
  await page.evaluate((id) => plant01.action('locate:building:' + id), pointsId);
  await page.locator(`[data-action="turnout:${pointsId}:branch"]`).click();
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.rails.find((r) => r.id === id).selectedRoute || 'straight',
      pointsId,
    ),
    'straight',
    'A route request must wait for its worker',
  );
  await page.evaluate(() => {
    plant01.state.paused = false;
    for (
      let n = 0;
      n < 10000 &&
      plant01.state.jobs.some(
        (j) => j.kind === 'throwSwitch' && ['todo', 'doing'].includes(j.status),
      );
      n++
    )
      plant01.Sim.tick(plant01.state, 0.1);
    plant01.state.paused = true;
    plant01.step(0);
  });
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.rails.find((r) => r.id === id).selectedRoute,
      pointsId,
    ),
    'branch',
  );
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('[data-action="save"]').click();
  await page.reload();
  await page.waitForFunction(() => window.plant01);
  assert.equal(await page.evaluate(() => plant01.state.rails.length), 13);
  assert.equal(
    await page.evaluate(
      (id) => plant01.state.rails.find((r) => r.id === id).selectedRoute,
      pointsId,
    ),
    'branch',
  );
  await page.evaluate(() => {
    plant01.action('tab:site');
    plant01.action('deselect');
    plant01.world.controls.enableDamping = false;
    plant01.world.controls.target.set(140, 0, 27);
    plant01.world.camera.position.set(168, 40, 68);
    plant01.world.controls.update();
    plant01.step(0);
  });
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/railway-construction-preview.png' });
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.state.paused = true;
  });
  return {
    passed: true,
    curve,
    turnout,
    actualInstalled: 13,
    routeChangedByWorker: true,
    savedAndReloaded: true,
  };
}
