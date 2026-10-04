import test from 'node:test';
import assert from 'node:assert/strict';
import { rampSupportPose } from '../src/delivery';
test('forklift front and rear tires remain supported across both lowloader ramp hinges', () => {
  const surface = (x: number) => (x >= -5.25 ? 0.82 : Math.max(0, 0.82 * (1 + (x + 5.25) / 4.5)));
  for (let x = -1.5; x >= -13.5; x -= 0.025) {
    const { y, pitch } = rampSupportPose('forklift', x);
    for (const [a, r] of [
      [0.78, 0.41],
      [-1.05, 0.32],
    ]) {
      const wx = x + a * Math.cos(pitch) - r * Math.sin(pitch);
      const bottom = y + a * Math.sin(pitch) + r * Math.cos(pitch) - r;
      assert(
        Math.abs(bottom - surface(wx)) < 0.001,
        `tire contact at ${x}: ${bottom - surface(wx)}`,
      );
    }
  }
});
