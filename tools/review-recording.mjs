#!/usr/bin/env node
// Offline diagnostic review. No connection to a server or modification of a yard.
import { readFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) {
  console.error('Usage: node tools/review-recording.mjs recording.json');
  process.exit(1);
}
const archive = JSON.parse(readFileSync(path, 'utf8'));
if (archive.format !== 'plant01-diagnostics' || archive.version !== 1)
  throw new Error('Unsupported diagnostic format');
const frames = archive.entries;
const stalls = [],
  history = new Map(),
  reported = new Map();
for (const frame of frames) {
  if (frame.type === 'yard-loaded') {
    history.clear();
    reported.clear();
    continue;
  }
  if (frame.type !== 'positions') continue;
  for (const machine of frame.data.equipment) {
    const samples = history.get(machine.id) || [];
    samples.push({ elapsed: frame.elapsed, ...machine });
    while (samples.length > 1 && samples[0].elapsed < frame.elapsed - 20) samples.shift();
    history.set(machine.id, samples);
    if (samples.length < 3 || frame.elapsed - samples[0].elapsed < 15 || !machine.pathLength)
      continue;
    const displacement = Math.hypot(machine.x - samples[0].x, machine.z - samples[0].z);
    let yawTravel = 0,
      sign = 0,
      reversals = 0;
    for (let i = 1; i < samples.length; i++) {
      const delta = Math.atan2(
        Math.sin((samples[i].yaw || 0) - (samples[i - 1].yaw || 0)),
        Math.cos((samples[i].yaw || 0) - (samples[i - 1].yaw || 0)),
      );
      yawTravel += Math.abs(delta);
      if (Math.abs(delta) > 0.015) {
        const next = Math.sign(delta);
        if (sign && next !== sign) reversals++;
        sign = next;
      }
    }
    if (displacement > 0.35 || frame.elapsed - (reported.get(machine.id) || -Infinity) < 20)
      continue;
    reported.set(machine.id, frame.elapsed);
    stalls.push({
      equipment: machine.id,
      elapsed: frame.elapsed,
      seconds: frame.elapsed - samples[0].elapsed,
      displacement: Number(displacement.toFixed(3)),
      headingReversals: reversals,
      yawTravel: Number(yawTravel.toFixed(3)),
      blockedBy: machine.blockedBy || null,
      job: machine.job || machine.deliveryOrder || null,
      position: { x: machine.x, z: machine.z },
      nextWaypoints: machine.path,
    });
  }
}
const current = archive.current;
console.log(
  JSON.stringify(
    {
      format: archive.format,
      version: archive.gameVersion,
      records: archive.entries.length,
      dropped: archive.dropped,
      checkpoints: archive.checkpoints.length,
      range: { first: archive.entries[0]?.elapsed, last: archive.entries.at(-1)?.elapsed },
      stalls,
      unfinishedJobs: current.jobs
        .filter((j) => ['todo', 'doing'].includes(j.status))
        .map((j) => ({
          id: j.id,
          parent: j.parentId,
          phase: j.phase,
          reason: j.reason,
          equipment: j.equipment,
          operator: j.operator,
          worker: j.worker,
          stack: j.stack,
        })),
      waitingDeliveries: current.orders
        .filter((o) => o.status === 'unloading')
        .map((o) => ({
          id: o.id,
          note: o.note,
          handler: o.unload?.equipmentId,
          phase: o.unload?.phase,
        })),
    },
    null,
    2,
  ),
);
