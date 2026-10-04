import assert from 'node:assert/strict';

export async function checkPhysicalRendering(page) {
  const result = await page.evaluate(() => {
    const { world, Sim, state: s } = plant01;
    s.paused = true;
    world.update(s, 0, 1);
    world.scene.updateMatrixWorld(true);
    const contact = [];
    for (const worker of s.workers.filter((w) => !w.vehicle && !w.path.length)) {
      const model = world.models.get(worker.id);
      const feet = [];
      model.traverse((o) => {
        if (o.name !== 'boot') return;
        o.geometry.computeBoundingBox();
        feet.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).min.y);
      });
      contact.push({
        id: worker.id,
        feet,
        surface: s.paving[`${Math.floor(worker.x)},${Math.floor(worker.z)}`] ? 0.105 : 0,
      });
    }
    const worker = s.workers.find((w) => !w.vehicle && !w.path.length);
    const error = Sim.moveWorker(s, worker.id, { x: worker.x + 4, z: worker.z });
    world.capturePrevious(s);
    s.paused = false;
    Sim.tick(s, 0.1);
    s.paused = true;
    const workerFrames = [];
    for (let frame = 0; frame <= 6; frame++) {
      world.update(s, 1 / 60, frame / 6);
      workerFrames.push(world.models.get(worker.id).position.toArray());
    }

    const [id] = Sim.purchase(s, 'rail', 4, 'rail');
    s.paused = false;
    for (let elapsed = 0; elapsed < 300; elapsed += 0.1) {
      const order = s.orders.find((o) => o.id === id);
      if (order.status === 'approaching' && order.drive.distance > 132) break;
      Sim.tick(s, 0.1);
    }
    world.capturePrevious(s);
    Sim.tick(s, 0.1);
    s.paused = true;
    const trainFrames = [];
    for (let frame = 0; frame <= 6; frame++) {
      world.update(s, 1 / 60, frame / 6);
      trainFrames.push(world.models.get(`${id}-loco`).position.toArray());
    }
    world.scene.updateMatrixWorld(true);
    const train = ['loco', 'flat'].map((kind) => {
      const model = world.models.get(`${id}-${kind}`);
      const bogies = model.children.filter((o) => o.name === 'bogie');
      const wheels = [];
      model.traverse((o) => {
        if (o.name !== 'wheel-rotor') return;
        const position = o.getWorldPosition(world.camera.position.clone());
        wheels.push({ radius: o.userData.radius, bottom: position.y - o.userData.radius });
      });
      return {
        kind,
        bogies: bogies.map((b) => ({
          yaw: b.rotation.y,
          wheelCount: b.children.filter((c) => c.name === 'wheel').length,
        })),
        wheels,
        position: model.position.toArray(),
      };
    });
    return {
      contact,
      error,
      workerFrames,
      trainFrames,
      train,
      ghostHandlers: [...world.models.keys()].filter((id) =>
        /handler|water-excavator|exwater/.test(id),
      ),
      shadowBias: world.sun.shadow.normalBias,
    };
  });
  assert.equal(result.error, '');
  assert.ok(result.contact.length > 0);
  for (const worker of result.contact) {
    assert.equal(worker.feet.length, 2);
    for (const bottom of worker.feet)
      assert.ok(
        Math.abs(bottom - worker.surface) < 0.004,
        `${worker.id}: boots hover ${bottom - worker.surface} m above ground`,
      );
  }
  assert.ok(result.shadowBias <= 0.01, 'Shadow bias should not detach ground contact');
  for (const frames of [result.workerFrames, result.trainFrames]) {
    assert.equal(
      new Set(frames.map((p) => p.map((n) => n.toFixed(6)).join(','))).size,
      frames.length,
      'All render frames must move between the fixed simulation ticks',
    );
    const distances = frames
      .slice(1)
      .map((p, i) => Math.hypot(...p.map((n, axis) => n - frames[i][axis])));
    assert.ok(
      Math.max(...distances) < 0.12,
      `A rendered vehicle jumped ${Math.max(...distances)} m`,
    );
    assert.ok(Math.min(...distances) > 0);
  }
  for (const car of result.train) {
    assert.equal(car.bogies.length, 2, `${car.kind} needs two separate bogies`);
    assert.deepEqual(
      car.bogies.map((b) => b.wheelCount),
      [4, 4],
    );
    assert.equal(car.wheels.length, 8);
    for (const wheel of car.wheels)
      assert.ok(
        Math.abs(wheel.bottom - 0.325) < 1e-6,
        `${car.kind} wheel does not meet the rail head`,
      );
  }
  assert.ok(
    result.train.some((car) => car.bogies.some((b) => Math.abs(b.yaw) > 0.005)),
    'At least one bogie should articulate separately through the turnout',
  );
  const [engine, wagon] = result.train.map((car) => car.position);
  assert.ok(
    Math.hypot(engine[0] - wagon[0], engine[2] - wagon[2]) > 13,
    'Locomotive and flatcar bodies must not overlap',
  );
  assert.deepEqual(result.ghostHandlers, []);
  return result;
}
