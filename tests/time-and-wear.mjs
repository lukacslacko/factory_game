import assert from 'node:assert/strict';

export async function checkTimeAndWear(page, base) {
  await page.evaluate(() => {
    plant01.start('empty');
    plant01.action('dismiss-guide');
    plant01.state.paused = true;
  });
  const rates = [];
  for (const speed of [1, 3, 10]) {
    await page.locator(`[data-action="speed:${speed}"]`).click();
    const before = await page.evaluate(() => ({
      wall: performance.now(),
      time: plant01.state.time,
      elapsed: plant01.state.elapsed,
    }));
    await page.waitForTimeout(1600);
    const after = await page.evaluate(() => {
      const s = plant01.state;
      s.paused = true;
      return { wall: performance.now(), time: s.time, elapsed: s.elapsed };
    });
    const wall = (after.wall - before.wall) / 1000,
      elapsed = after.elapsed - before.elapsed;
    assert.ok(
      Math.abs(elapsed - wall * speed) < 0.3 * speed,
      `${speed}× actually scales foreground physical time`,
    );
    assert.ok(
      Math.abs(after.time - before.time - elapsed) < 1e-7,
      'Calendar and movement advance identically',
    );
    rates.push({ speed, wallSeconds: wall, elapsedSeconds: elapsed });
  }
  await page.waitForTimeout(350);
  assert.match(await page.locator('#time').textContent(), /\d{2}:\d{2}:\d{2}/);
  // A focused opening-asset fixture. All repeated travel and boarding uses the
  // same public commands and collision-checked ticks as player control.
  const wear = await page.evaluate(() => {
    plant01.start('demo');
    plant01.action('dismiss-guide');
    const s = plant01.state,
      S = plant01.Sim,
      e = s.equipment[0],
      op = s.workers.find((w) => w.role === 'operator');
    e.x = 80.5;
    e.z = 65.5;
    e.yaw = 0;
    e.path = [];
    op.x = 79.5;
    op.z = 65.5;
    op.path = [];
    for (const w of s.workers) w.duty = 'manual';
    s.speed = 1;
    s.paused = false;
    if (S.enterVehicle(s, op.id, e.id)) throw new Error('Fixture boarding failed');
    for (let t = 0; t < 40 && op.vehicle !== e.id; t += 0.1) S.tick(s, 0.1);
    if (op.vehicle !== e.id) throw new Error('Operator did not physically board');
    for (let pass = 0; pass < 16; pass++) {
      const goal = { x: pass % 2 ? 80.5 : 108.5, z: 65.5 };
      const error = S.moveWorker(s, op.id, goal);
      if (error) throw new Error(error);
      for (let t = 0; t < 120 && e.path.length; t += 0.1) S.tick(s, 0.1);
      if (e.path.length) throw new Error('Equipment did not complete clear travel');
    }
    const before = JSON.stringify(s.groundWear);
    S.tick(s, 2);
    if (JSON.stringify(s.groundWear) !== before) throw new Error('Parked equipment added wear');
    s.paused = true;
    plant01.world.controls.enableDamping = false;
    plant01.world.controls.target.set(94, 0, 65);
    plant01.world.camera.position.set(104, 25, 96);
    plant01.world.controls.update();
    plant01.step(0);
    return {
      cells: Object.keys(s.groundWear).length,
      strongest: Math.max(...Object.values(s.groundWear)),
      traveledMeters: e.travel,
      surfaceVersion: s.version,
    };
  });
  assert.ok(
    wear.cells > 30 && wear.strongest > 0.2,
    'Repeated actual passes establish visible worn lanes',
  );
  await page.waitForTimeout(650);
  const rendered = await page.evaluate(() => {
    const mesh = plant01.world.scene.getObjectByName('equipment-worn-paths');
    const canvas = mesh.material.map.image;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let marked = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 20) marked++;
    return { visible: mesh.visible, markedPixels: marked };
  });
  assert.ok(
    rendered.visible && rendered.markedPixels > 100,
    'Persisted simulation wear reaches the rendered ground',
  );
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.locator('#delivery-toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/worn-path-preview.png' });
  // A real completed yard exercises thousands of persistent wear cells.
  await page.locator('[data-action="menu"]').first().click();
  await page.locator('#import-file').setInputFiles(base + '/examples/willow-siding.json');
  await page.waitForTimeout(650);
  const denseExample = await page.evaluate(() => {
    const s = plant01.state,
      paths = plant01.world.wornPaths;
    paths.nextUpdate = -Infinity;
    paths.elapsed = -1;
    const start = performance.now();
    if (!paths.update(s)) throw new Error('Dense wear update was skipped');
    const updateMs = performance.now() - start;
    const revision = s.revision;
    let throttled = true;
    for (let i = 0; i < 20; i++) {
      s.revision++;
      if (paths.update(s)) throttled = false;
    }
    s.revision = revision;
    paths.nextUpdate = -Infinity;
    const unchangedSkipped = !paths.update(s);
    // Renderer-only maximum-map fixture, never installed as the playable yard.
    const maximum = {
      ...s,
      groundWear: Object.fromEntries(
        Array.from({ length: 12000 }, (_, i) => [
          `${20 + (i % 120)},${20 + Math.floor(i / 120)}`,
          0.5,
        ]),
      ),
    };
    const maxStart = performance.now();
    paths.update(maximum);
    const saturatedUpdateMs = performance.now() - maxStart;
    paths.update(s);
    plant01.step(0);
    return {
      cells: Object.keys(s.groundWear || {}).length,
      updateMs,
      throttled,
      unchangedSkipped,
      saturatedCells: Object.keys(maximum.groundWear).length,
      saturatedUpdateMs,
    };
  });
  assert.ok(denseExample.cells > 3000, 'Real completed example retains its worn lanes');
  assert.ok(
    denseExample.updateMs < 500 && denseExample.saturatedUpdateMs < 1000,
    'Dense and maximum wear masks finish without per-cell filter stalls',
  );
  assert.ok(
    denseExample.throttled && denseExample.unchangedSkipped,
    'Revision changes cannot bypass the rate limit, and paused textures stay unchanged',
  );
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/completed-worn-path-preview.png' });
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.action('dismiss-guide');
    plant01.state.paused = true;
    plant01.step(0);
  });
  return { rates, wear, rendered, denseExample };
}
