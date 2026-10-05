import assert from 'node:assert/strict';

export async function checkTrackRendering(page, base) {
  const result = await page.evaluate(async () => {
    const { trackSections, trackGeometry } = await import('/src/track.ts');
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const { Sim: S, world, state: s } = plant01;
    S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
    const e = seedHandlingResources(s);
    const [id] = S.purchase(s, 'railCurve', 1);
    const order = s.orders.find((o) => o.id === id);
    for (
      let tick = 0;
      tick < 18000 && !(e.cargo?.item === 'railCurve' && order.unload?.phase === 'carry');
      tick++
    )
      S.tick(s, 0.1);
    if (e.cargo?.item !== 'railCurve')
      throw new Error(`Curved delivery never lifted: ${order.note}`);
    s.paused = true;
    world.capturePrevious(s);
    world.update(s, 1 / 60, 1);
    const cargo = world.models.get(`${e.id}-load`);
    const deliveredShape = !!cargo?.getObjectByName('physical-curved-rail-panel');
    s.paused = false;
    for (let tick = 0; tick < 18000 && (order.status !== 'done' || order.unload); tick++)
      S.tick(s, 0.1);
    if (order.status !== 'done' || order.unload)
      throw new Error(`Curved delivery stalled: ${order.note}`);
    const totals = S.totals(s, 'railCurve');

    // The following fixtures test rendering/selection only. They do not claim
    // that the simulation constructed these extra installed layouts.
    s.paused = true;
    s.rails = [];
    for (const [layout, origin, hand] of [
      ['curve', { x: 125, z: 5 }, 1],
      ['curve', { x: 95, z: 65 }, -1],
      ['turnout', { x: 40, z: 60 }, 1],
      ['turnout', { x: 65, z: 35 }, -1],
    ]) {
      for (const piece of trackSections(layout, origin, 0, hand)) {
        const geometry = trackGeometry(piece);
        s.rails.push({
          ...geometry.rect,
          id: S.id(s, 'rail'),
          rotation: 0,
          length: geometry.length,
          track: piece,
          selectedRoute: 'straight',
        });
      }
    }
    s.revision++;
    world.capturePrevious(s);
    world.update(s, 1 / 60, 1);
    const innerGauges = [];
    world.scene.updateMatrixWorld(true);
    for (const rail of s.rails.filter((r) => r.track.layout === 'curve')) {
      const model = world.staticGroup.children.find((g) => g.userData.selection?.id === rail.id);
      const pair = [];
      model.traverse((o) => {
        if (o.name.startsWith('track-rail-')) pair.push(o);
      });
      const negative = pair.find((o) => o.userData.centerOffset < 0),
        positive = pair.find((o) => o.userData.centerOffset > 0);
      const expected = trackGeometry(rail).paths[0].points;
      for (let i = 0; i < expected.length; i++) {
        const a = negative.localToWorld(
          world.camera.position
            .clone()
            .fromBufferAttribute(negative.geometry.getAttribute('position'), i * 12 + 6),
        );
        const b = positive.localToWorld(
          world.camera.position
            .clone()
            .fromBufferAttribute(positive.geometry.getAttribute('position'), i * 12 + 7),
        );
        const p = expected[i];
        innerGauges.push(-Math.sin(p.yaw) * (b.x - a.x) + Math.cos(p.yaw) * (b.z - a.z));
      }
    }
    const heads = [],
      levers = [],
      frogs = [];
    world.staticGroup.traverse((object) => {
      if (object.name.startsWith('track-rail-'))
        heads.push({
          name: object.name,
          gauge: object.userData.gauge,
          vertices: object.geometry.getAttribute('position').count,
        });
      if (object.name === 'turnout-manual-lever') levers.push(object.userData.selectedRoute);
      if (object.name === 'turnout-crossing-frog') frogs.push(object.position.toArray());
    });
    for (const rail of s.rails)
      if (rail.track.layout === 'turnout' && rail.track.section === 0)
        rail.selectedRoute = 'branch';
    s.revision++;
    world.update(s, 1 / 60, 1);
    const thrownLevers = [];
    world.staticGroup.traverse((object) => {
      if (object.name === 'turnout-manual-lever') thrownLevers.push(object.userData.selectedRoute);
    });
    const preview = trackSections('curve', { x: 110, z: 35 }, 0, 1);
    world.previewTrack(preview, true);
    const ghostPanels = world.hover.children.filter(
      (c) => c.name === 'physical-curved-rail-panel',
    ).length;
    world.previewTrack(undefined);
    world.controls.enableDamping = false;
    world.controls.target.set(132, 0, 16);
    world.camera.position.set(146, 30, 47);
    world.controls.update();
    plant01.step(0);
    return {
      passed: true,
      deliveredShape,
      totals,
      installedFixturePanels: s.rails.length,
      heads,
      innerGauges,
      levers,
      thrownLevers,
      frogs,
      ghostPanels,
    };
  });
  assert.ok(
    result.deliveredShape,
    'The actual delivered curved panel must retain its curved physical model',
  );
  assert.equal(result.totals.delivered, 1);
  assert.equal(result.totals.stored, 1);
  assert.equal(result.installedFixturePanels, 26);
  assert.ok(result.heads.length >= 52);
  const invalidHeads = result.heads.filter((h) => h.gauge !== 1.435 || h.vertices <= 24);
  assert.equal(invalidHeads.length, 0, `Invalid track profiles: ${JSON.stringify(invalidHeads)}`);
  assert.ok(
    result.innerGauges.length > 200 &&
      result.innerGauges.every((gap) => Math.abs(gap - 1.435) < 1e-5),
    'The rendered mesh inner head faces must retain gauge throughout both curves',
  );
  assert.deepEqual(result.levers, ['straight', 'straight']);
  assert.deepEqual(result.thrownLevers, ['branch', 'branch']);
  assert.equal(result.frogs.length, 2);
  assert.equal(result.ghostPanels, 6);
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.locator('#delivery-toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/curve-track-preview.png' });
  await page.evaluate(() => {
    const world = plant01.world;
    world.controls.target.set(49, 0, 63);
    world.camera.position.set(60, 20, 84);
    world.controls.update();
    plant01.step(0);
  });
  await page.screenshot({ path: base + '/turnout-track-preview.png' });
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.state.paused = true;
  });
  return result;
}
