import assert from 'node:assert/strict';

export async function checkForkLoadRendering(page, base) {
  const result = await page.evaluate(async () => {
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    const { FORK_LOAD_CENTER, FORK_HEEL, FORK_LENGTH } = await import('/src/fork-geometry.ts');
    plant01.start('empty');
    plant01.action('dismiss-guide');
    const { Sim: S, world, state: active } = plant01;
    active.paused = true;
    const cases = [];
    let screenshotSave;
    for (const item of ['rail', 'slab']) {
      const s = S.createState();
      S.addZone(s, { x: 24, z: 26, w: 27, d: 24 });
      // Opening purchased assets isolate the receiving mechanism; procurement and
      // physical deployment are exercised independently by the full browser suite.
      const e = seedHandlingResources(s, 'forklift');
      const [id] = S.purchase(s, item, item === 'rail' ? 1 : 4, item === 'rail' ? 'rail' : 'road');
      const order = s.orders.find((o) => o.id === id);
      const seek = (predicate, label) => {
        for (let n = 0; n < 18000 && !predicate(); n++) S.tick(s, 0.1);
        if (!predicate())
          throw new Error(`${item}: never reached ${label}: ${order.note}, ${order.unload?.phase}`);
      };
      const sample = (label) => {
        s.paused = true;
        world.update(s, 1 / 60, 1);
        world.capturePrevious(s);
        s.paused = false;
        const phase = order.unload.phase;
        const before = {
          x: e.x,
          z: e.z,
          yaw: e.yaw || 0,
          reach: e.reach,
          y: order.unload.cargo.y,
        };
        S.tick(s, 0.1);
        s.paused = true;
        if (order.unload?.phase !== phase) throw new Error(`${label}: crossed phase boundary`);
        const frames = [];
        for (let i = 0; i <= 6; i++) {
          world.update(s, 1 / 60, i / 6);
          world.scene.updateMatrixWorld(true);
          const model = world.models.get(e.id),
            payload = world.models.get(`${e.id}-load`),
            carriage = model.getObjectByName('fork-carriage'),
            contact = model
              .getObjectByName('cargo-contact')
              .getWorldPosition(world.camera.position.clone()),
            origin = payload.getWorldPosition(contact.clone()),
            tines = carriage.children.filter((o) => o.name === 'fork-tine');
          const flatHeel = FORK_HEEL + carriage.position.x,
            flatEnd = flatHeel + FORK_LENGTH * 0.81,
            center = model.worldToLocal(origin.clone()).x;
          const contacts = [];
          for (const tine of tines) {
            // Rail panels bear across both sides of their width. Slabs use two
            // points within their 0.98 m footprint. Raycast the actual meshes.
            for (const offset of item === 'rail' ? [-0.82, 0.82] : [-0.25, 0.25]) {
              const x = center + offset;
              const point = model.localToWorld(
                contact.clone().set(x, carriage.position.y + 0.5, tine.position.z),
              );
              world.ray.ray.origin.copy(point);
              world.ray.ray.direction.set(0, -1, 0);
              const forkHit = world.ray.intersectObject(tine)[0];
              if (!forkHit) throw new Error(`${item}: bearing misses fork at ${label}`);
              world.ray.ray.origin.copy(forkHit.point).y -= 0.001;
              world.ray.ray.direction.set(0, 1, 0);
              const cargoHit = world.ray.intersectObject(payload, true)[0];
              if (!cargoHit) throw new Error(`${item}: load misses fork at ${label}`);
              contacts.push({
                x,
                flatHeel,
                flatEnd,
                verticalGap: cargoHit.point.y - forkHit.point.y,
                tineLength: tine.scale.x,
              });
            }
          }
          frames.push({
            chassis: model.position.toArray(),
            cargo: origin.toArray(),
            contact: contact.toArray(),
            carriage: carriage.position.toArray(),
            horizontalContactError: Math.hypot(contact.x - origin.x, contact.z - origin.z),
            contacts,
          });
        }
        s.paused = false;
        const motion = {
          translation: Math.hypot(e.x - before.x, e.z - before.z),
          turn: Math.abs(
            Math.atan2(Math.sin((e.yaw || 0) - before.yaw), Math.cos((e.yaw || 0) - before.yaw)),
          ),
          extension: Math.abs(e.reach - before.reach),
          lift: Math.abs(order.unload.cargo.y - before.y),
        };
        // The load moves farther than the chassis during a turn. Bound each
        // rendered step by translation + arc length + carriage/lift motion,
        // rather than imposing a shorter arbitrary limit on extended forks.
        const frameMotionBound =
          (motion.translation +
            Math.max(e.reach, before.reach) * motion.turn +
            motion.extension +
            motion.lift) /
            6 +
          0.0001;
        return { label, phase, reach: e.reach, frames, motion, frameMotionBound };
      };
      seek(
        () =>
          order.unload?.phase === 'carry' && e.path.length > 0 && e.reach > FORK_LOAD_CENTER + 0.25,
        'retracting transit',
      );
      const retracting = sample('retracting transit');
      seek(
        () =>
          order.unload?.phase === 'carry' &&
          e.path.length > 0 &&
          Math.abs(e.reach - FORK_LOAD_CENTER) < 0.005,
        'retracted transit',
      );
      const transit = sample('retracted transit');
      if (item === 'rail') {
        s.paused = true;
        screenshotSave = S.save(s);
        s.paused = false;
      }
      seek(
        () => order.unload?.phase === 'lower' && order.unload.clock > 0.5 && order.unload.clock < 2,
        'aligned storage lowering',
      );
      const storage = sample('aligned storage lowering');
      seek(() => order.status === 'done' && !order.unload, 'completed storage');
      cases.push({ item, retracting, transit, storage, stored: S.totals(s, item).stored });
    }
    // Install the real mid-delivery snapshot only for the screenshot. No cargo,
    // worker, machine, or work phase is fabricated for the image.
    Object.assign(active, S.load(screenshotSave));
    active.paused = true;
    const e = active.equipment[0];
    world.revision = -1;
    world.capturePrevious(active);
    world.controls.enableDamping = false;
    world.controls.target.set(e.x + 1, 0.8, e.z);
    world.camera.position.set(e.x + 8, 7, e.z + 10);
    world.controls.update();
    plant01.step(0);
    return {
      passed: true,
      cases,
      fixedTineLength: FORK_LENGTH,
      travelLoadCenter: FORK_LOAD_CENTER,
    };
  });
  for (const c of result.cases) {
    assert.equal(c.stored, c.item === 'rail' ? 1 : 4);
    for (const sample of [c.retracting, c.transit, c.storage]) {
      for (const frame of sample.frames) {
        assert.ok(
          frame.horizontalContactError < 0.004,
          `${c.item}: cargo drifts from carriage contact`,
        );
        assert.equal(frame.contacts.length, 4);
        for (const bearing of frame.contacts) {
          assert.ok(
            bearing.x > bearing.flatHeel && bearing.x < bearing.flatEnd,
            `${c.item}: load balanced on a tapered tip`,
          );
          assert.ok(
            Math.abs(bearing.verticalGap) < 0.005,
            `${c.item}: cargo/fork separation ${bearing.verticalGap}`,
          );
          assert.equal(bearing.tineLength, result.fixedTineLength);
        }
      }
      const cargo = sample.frames.map((f) => f.cargo);
      assert.ok(
        sample.motion.translation <= 0.32,
        'Chassis motion stays within its physical 100 ms travel rate',
      );
      assert.ok(
        sample.motion.turn <= 0.151,
        'Turning stays within its physical 100 ms angular rate',
      );
      assert.ok(
        sample.motion.extension <= 0.081,
        'Carriage extension stays within its physical 100 ms rate',
      );
      assert.equal(
        new Set(cargo.map((p) => p.map((n) => n.toFixed(7)).join(','))).size,
        7,
        `${c.item}: ${sample.label} does not interpolate`,
      );
      for (let i = 1; i < cargo.length; i++)
        assert.ok(
          Math.hypot(...cargo[i].map((n, a) => n - cargo[i - 1][a])) <= sample.frameMotionBound,
          `${c.item}: cargo jumps between render frames in ${sample.label}: ${JSON.stringify(cargo)}`,
        );
    }
    const reachMotion = c.retracting.frames.map((f) => f.carriage[0]);
    assert.ok(reachMotion[6] < reachMotion[0], `${c.item}: carried load does not retract smoothly`);
    assert.ok(Math.abs(c.transit.reach - result.travelLoadCenter) < 0.005);
  }
  await page.locator('#toast').evaluate((e) => (e.hidden = true));
  await page.locator('#delivery-toast').evaluate((e) => (e.hidden = true));
  await page.screenshot({ path: base + '/forklift-load-preview.png' });
  await page.evaluate(() => {
    plant01.start('demo');
    plant01.state.paused = true;
  });
  return result;
}
