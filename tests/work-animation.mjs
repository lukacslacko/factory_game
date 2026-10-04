import assert from 'node:assert/strict';
export async function checkWorkAnimation(page) {
  const result = await page.evaluate(() => {
    const { Sim, world } = plant01,
      s = Sim.demoState();
    const job = Sim.plan(s, 'rail', 125, 4).job;
    const seek = (phase) => {
      for (
        let i = 0;
        i < 18000 && !(job.railWork?.phase === phase && job.railWork.clock >= 0.5);
        i++
      )
        Sim.tick(s, 0.1);
      if (job.railWork?.phase !== phase)
        throw new Error(`Never reached ${phase}: ${job.phase} / ${job.reason}`);
    };
    const sample = (phase, kind) => {
      seek(phase);
      world.update(s, 1 / 60, 1);
      world.capturePrevious(s);
      Sim.tick(s, 0.1);
      if (job.railWork.phase !== phase)
        throw new Error('Animation sample crossed a phase boundary');
      const clock = { before: job.railWork.clock - 0.1, after: job.railWork.clock };
      const values = [];
      for (let frame = 0; frame <= 6; frame++) {
        world.update(s, 1 / 60, frame / 6);
        const model = world.models.get(kind === 'crane' ? job.equipment : job.worker);
        values.push(
          kind === 'crane'
            ? model.getObjectByName('tool-tip').position.toArray()
            : [model.getObjectByName('arm-right').rotation.z],
        );
      }
      return { phase, clock, values };
    };
    return { crane: sample('source-rig', 'crane'), worker: sample('unbolt-buffer', 'worker') };
  });
  for (const sample of Object.values(result)) {
    assert.equal(
      new Set(sample.values.map((v) => v.map((x) => x.toFixed(7)).join(','))).size,
      7,
      `${sample.phase} must change in every rendered frame between ticks`,
    );
    const changes = sample.values
      .slice(1)
      .map((v, i) => Math.hypot(...v.map((x, a) => x - sample.values[i][a])));
    assert(Math.max(...changes) < 0.2, `${sample.phase} has a visible joint jump`);
  }
  return { passed: true, ...result };
}
