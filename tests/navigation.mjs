import assert from 'node:assert/strict';

export async function checkNavigation(page) {
  const geometry = await page.evaluate(() => {
    const w = plant01.world;
    const span = (z) => {
      const a = w.project({ x: 25, z }),
        b = w.project({ x: 35, z });
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const rail = w.scene.getObjectByName('rail-heads');
    const first = w.camera.matrix.clone(),
      second = first.clone();
    rail.getMatrixAt(0, first);
    rail.getMatrixAt(1, second);
    const gauge =
      Math.abs(first.elements[14] - second.elements[14]) -
      Math.hypot(...first.elements.slice(8, 11));
    const arms = [],
      wires = [],
      uprights = [];
    w.scene.traverse((o) => {
      if (o.name === 'utility-crossarm') arms.push([o.scale.x, o.scale.z]);
      if (o.name === 'utility-wire') wires.push(o.geometry.parameters.path.getPoint(0).z);
      if (o.name === 'buffer-upright') uprights.push([o.position.x, o.scale.y]);
    });
    return {
      perspective: w.camera.isPerspectiveCamera,
      near: span(55),
      far: span(5),
      gauge,
      arms,
      wires,
      uprights,
    };
  });
  assert.equal(geometry.perspective, true);
  assert(geometry.near > geometry.far * 1.2, 'Perspective must visibly change size with distance');
  assert(
    Math.abs(geometry.gauge - 1.435) < 1e-6,
    'Rendered inner rail faces must be 1,435 mm apart',
  );
  assert(geometry.arms.length > 0 && geometry.arms.every(([x, z]) => z > x * 10));
  assert.deepEqual(geometry.wires.slice(0, 3), [-21, -20, -19]);
  assert.deepEqual(geometry.uprights, [
    [0, 1.1],
    [0, 1.1],
  ]);

  const canvas = await page.locator('#world').boundingBox();
  // Exercise the real orbit gesture before checking keys; fixed world axes would fail.
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvas.x + canvas.width / 2 + 190, canvas.y + canvas.height / 2, {
    steps: 12,
  });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(900);
  for (const [key, x, z] of [
    ['w', 0, -1],
    ['a', -1, 0],
    ['s', 0, 1],
    ['d', 1, 0],
  ]) {
    const before = await page.evaluate(() => {
      const w = plant01.world;
      return { target: w.controls.target.toArray(), camera: w.camera.position.toArray() };
    });
    await page.keyboard.down(key);
    await page.waitForTimeout(160);
    await page.keyboard.up(key);
    const after = await page.evaluate(() => plant01.world.controls.target.toArray());
    const bx = before.camera[0] - before.target[0],
      bz = before.camera[2] - before.target[2];
    const expected = [bz * x + bx * z, -bx * x + bz * z];
    const actual = [after[0] - before.target[0], after[2] - before.target[2]];
    assert(Math.hypot(...actual) > 0.5, `${key} must move the camera`);
    const cosine =
      (actual[0] * expected[0] + actual[1] * expected[1]) /
      Math.hypot(...actual) /
      Math.hypot(...expected);
    assert(cosine > 0.995, `${key} must move relative to the current view, got ${cosine}`);
  }
  await checkFloorDrag(page);
  await page.evaluate(() => {
    const w = plant01.world;
    w.camera.position.set(48, 52, 91);
    w.controls.target.set(30, 0, 30);
    w.controls.update();
    w.focus({ x: 30, z: 30 }, 1.45);
  });
}

export async function checkFloorDrag(page) {
  // Bare ground near the camera target, away from the receiving area.
  const point = { x: 7.4, z: 56.4 };
  await page.evaluate((p) => plant01.world.focus(p, 1.5), point);
  const screen = await page.evaluate((p) => plant01.world.project(p), point);
  const canvas = await page.locator('#world').boundingBox();
  const before = await page.evaluate(() => ({
    jobs: plant01.state.jobs.length,
    paths: plant01.state.workers.map((w) => w.path),
    selection: plant01.selection,
  }));
  await page.mouse.move(canvas.x + screen.x, canvas.y + screen.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + screen.x + 95, canvas.y + screen.y + 45, { steps: 12 });
  await page.mouse.up();
  const after = await page.evaluate(
    (p) => ({
      screen: plant01.world.project(p),
      jobs: plant01.state.jobs.length,
      paths: plant01.state.workers.map((w) => w.path),
      selection: plant01.selection,
    }),
    point,
  );
  assert(
    Math.abs(after.screen.x - screen.x - 95) < 3,
    'Grabbed ground must follow the pointer horizontally',
  );
  assert(
    Math.abs(after.screen.y - screen.y - 45) < 3,
    'Grabbed ground must follow the pointer vertically',
  );
  assert.equal(after.jobs, before.jobs, 'Panning must not construct');
  assert.deepEqual(after.paths, before.paths, 'Panning must not issue worker movement');
  assert.deepEqual(after.selection, before.selection, 'Dragging must not trigger a click');
}
