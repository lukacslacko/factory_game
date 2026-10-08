import assert from 'node:assert/strict';
export async function checkShedRendering(page, base) {
  const result = await page.evaluate(async () => {
    const { seedHandlingResources } = await import('/tests/support/yard.ts');
    const { Sim, world, state } = plant01;
    const s = Sim.createState();
    seedHandlingResources(s, 'excavator');
    s.stacks.push({
      id: 'SHED-RENDER-KIT',
      item: 'shed',
      qty: 1,
      reserved: 0,
      x: 24,
      z: 32,
      w: 4,
      d: 2,
      source: 'opening',
    });
    for (let x = 45; x < 53; x++) for (let z = 35; z < 41; z++) s.paving[`${x},${z}`] = 'EXISTING';
    const { job, error } = Sim.plan(s, 'shed', 45, 35);
    if (error) throw new Error(error);
    const samples = [],
      animation = [];
    let preview, ladder;
    let waitingLiftSamples = 0;
    for (let t = 0; t < 1800 && job.status !== 'done'; t += 0.1) {
      Sim.tick(s, 0.1);
      const a = job.shedAssembly;
      if (
        a?.ladder &&
        !ladder &&
        s.workers.find((w) => w.id === job.worker).y > 0.5 &&
        /Climb assembly/.test(s.workers.find((w) => w.id === job.worker).status)
      ) {
        world.update(s, 0, 1);
        world.capturePrevious(s);
        Sim.tick(s, 0.1);
        const heights = [];
        for (let f = 0; f <= 6; f++) {
          world.update(s, 1 / 60, f / 6);
          heights.push(world.models.get(job.worker).position.y);
        }
        ladder = { heights, visible: !!world.models.get(`${job.id}-shed-ladder`) };
      }
      if (
        !a?.part ||
        a.phase !== 'lift' ||
        a.clock < 1 ||
        samples.some((p) => p.kind === a.part.kind)
      )
        continue;
      world.update(s, 0, 1);
      world.capturePrevious(s);
      const clockBefore = a.clock;
      const kindBefore = a.part.kind;
      const indexBefore = a.part.index;
      Sim.tick(s, 0.1);
      // Safety may pause a partly raised member while its rigger walks clear.
      // Sample a real advancing lift interval, then require every intervening
      // rendered frame to move smoothly; waiting frames legitimately stay still.
      if (
        a.phase !== 'lift' ||
        a.clock <= clockBefore ||
        a.part.kind !== kindBefore ||
        a.part.index !== indexBefore
      ) {
        waitingLiftSamples++;
        continue;
      }
      const positions = [],
        tips = [];
      for (let frame = 0; frame <= 6; frame++) {
        world.update(s, 1 / 60, frame / 6);
        world.scene.updateMatrixWorld(true);
        const model = world.models.get(`${job.id}-shed-moving-part`);
        if (!model) throw new Error('Missing visible construction component');
        positions.push(model.position.toArray());
        const machine = world.models.get(job.equipment);
        tips.push(
          machine.getObjectByName('tool-tip').getWorldPosition(machine.position.clone()).toArray(),
        );
      }
      samples.push({
        kind: a.part.kind,
        phase: a.phase,
        buildings: s.buildings.filter((building) => building.kind === 'shed').length,
        counts: [a.posts, a.beams, a.roofSheets, a.wallPanels, a.braces],
        frameMembers: world.models
          .get(`${job.id}-shed-frame`)
          .getObjectByName('members')
          .children.filter((o) => o.name.startsWith('shed-')).length,
      });
      animation.push({ kind: a.part.kind, positions, tips });
      if (a.part.kind === 'roof') preview = Sim.save(s);
    }
    if (job.status !== 'done')
      throw new Error(
        JSON.stringify({ phase: job.phase, reason: job.reason, e: s.equipment, w: s.workers }),
      );
    world.update(s, 0, 1);
    const completed = world.staticGroup.children.find(
      (g) => g.userData.selection?.id === s.buildings.find((building) => building.kind === 'shed').id,
    );
    if (!completed) throw new Error('Missing completed shed render');
    let completeMembers = 0;
    completed.traverse((o) => {
      if (/^shed-(post|beam|roof|wall|brace)-\d+$/.test(o.name)) completeMembers++;
    });
    Object.assign(state, Sim.load(preview));
    state.paused = true;
    world.capturePrevious(state);
    world.update(state, 0, 1);
    world.focus({ x: 49, z: 38 }, 3.2);
    return {
      samples,
      animation,
      ladder,
      completeMembers,
      buildingCount: s.buildings.filter((building) => building.kind === 'shed').length,
      waitingLiftSamples,
    };
  });
  assert.deepEqual(
    result.samples.map((p) => p.kind),
    ['post', 'beam', 'roof', 'wall', 'brace'],
  );
  for (const s of result.samples) {
    assert.equal(s.buildings, 0, 'Completed building cannot exist before fastening all parts');
    assert.equal(
      s.frameMembers,
      s.counts.reduce((n, v) => n + v, 0),
      'Only actually fastened members appear',
    );
  }
  for (const a of result.animation)
    for (const field of ['positions', 'tips']) {
      assert.equal(
        new Set(a[field].map((v) => v.map((x) => x.toFixed(7)).join(','))).size,
        7,
        `${a.kind} ${field} interpolates in every frame`,
      );
      for (let i = 1; i < a[field].length; i++)
        assert(
          Math.hypot(...a[field][i].map((v, k) => v - a[field][i - 1][k])) < 0.2,
          `${a.kind} ${field} jumps`,
        );
    }
  assert.equal(result.ladder.visible, true);
  assert.equal(new Set(result.ladder.heights.map((y) => y.toFixed(7))).size, 7);
  assert.equal(result.completeMembers, 16);
  assert.equal(result.buildingCount, 1);
  await page.locator('[data-action="tab:site"]').click();
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.waitForTimeout(200);
  await page.screenshot({ path: base + '/shed-assembly-preview.png' });
  return { passed: true, ...result };
}
