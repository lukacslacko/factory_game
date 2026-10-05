import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/sim';
import { groupConnectedRailWork, railWorkGroup } from '../src/rail-work-groups';
import { setRailCrew, workLeaves, jobEquipmentAssignment } from '../src/jobs';
import { seedHandlingResources } from './support/yard';
import { railBatchContinues } from '../src/rail-batch';

test('consecutive modern 5 m plans share one whole-run crew and buffer, retaining component geometry IDs', () => {
  let s = S.createState();
  const a = seedHandlingResources(s, 'excavator'),
    b = seedHandlingResources(s, 'excavator');
  b.x = 17.5;
  const first = S.planRailLayout(s, 'straight', { x: 125, z: 5 });
  assert.equal(setRailCrew(s, first.group!.id, a.id, b.id), '');
  const second = S.planRailLayout(s, 'straight', { x: 130, z: 5 });
  const third = S.planRailLayout(s, 'straight', { x: 135, z: 5 });
  assert.equal(second.group!.id, first.group!.id);
  assert.equal(third.group!.id, first.group!.id);
  assert.equal(
    new Set([...first.jobs, ...second.jobs, ...third.jobs].map((j) => j.track!.groupId)).size,
    3,
  );
  assert.equal(workLeaves(s, first.group!.id).filter((j) => j.kind === 'rail').length, 3);
  for (const j of s.jobs) assert.equal(jobEquipmentAssignment(s, j).equipmentId, a.id);
  assert.equal(railBatchContinues(s, first.jobs[0]), true);
  assert.equal(railBatchContinues(s, second.jobs[0]), true);
  s = S.load(S.save(s));
  assert.equal(s.jobGroups!.filter((g) => !g.parentId).length, 1);
  for (const j of s.jobs) assert.equal(railWorkGroup(s, j)?.id, first.group!.id);
});

test('a curve followed by a tangent-matched straight belongs to one rail work run', () => {
  const s = S.createState();
  const curve = S.planRailLayout(s, 'curve', { x: 125, z: 5 });
  assert.equal(curve.error, '');
  const straight = S.planRailLayout(s, 'straight', { x: 145, z: 25 }, 1);
  assert.equal(straight.error, '');
  assert.equal(straight.group!.id, curve.group!.id);
  assert.equal(workLeaves(s, curve.group!.id).filter((j) => j.kind === 'rail').length, 7);
  assert.equal(railBatchContinues(s, curve.jobs.at(-1)!), true);
  assert.equal(S.load(S.save(s)).jobs.length, 7);
});

test('nearby footprints or a crossing never merge unrelated rail work groups', () => {
  const s = S.createState();
  const a = S.plan(s, 'rail', 30, 30).job!,
    b = S.plan(s, 'rail', 36, 30).job!,
    c = S.plan(s, 'rail', 30, 35).job!;
  assert.ok(a && b && c);
  groupConnectedRailWork(s);
  assert.equal(new Set([a, b, c].map((j) => railWorkGroup(s, j)?.id)).size, 3);
});

test('saved separate connected rail groups merge on import without changing geometry or stock', () => {
  const s = S.createState();
  const a = S.planRailLayout(s, 'straight', { x: 125, z: 5 });
  const b = S.planRailLayout(s, 'straight', { x: 130, z: 5 });
  const child = s.jobGroups!.find((g) => g.id === b.jobs[0].track!.groupId)!;
  child.parentId = undefined;
  const before = JSON.stringify(s.jobs.map((j) => j.track));
  const loaded = S.load(S.save(s));
  assert.equal(
    railWorkGroup(loaded, loaded.jobs[0])?.id,
    railWorkGroup(loaded, loaded.jobs[1])?.id,
  );
  assert.equal(JSON.stringify(loaded.jobs.map((j) => j.track)), before);
});

test('resuming the whole rail work restores canceled panels in all connected components', () => {
  let s = S.createState();
  const first = S.planRailLayout(s, 'straight', { x: 125, z: 5 });
  const second = S.planRailLayout(s, 'straight', { x: 130, z: 5 });
  S.cancelJob(s, first.jobs[0].id);
  S.cancelJob(s, second.jobs[0].id);
  s = S.load(S.save(s));
  assert.equal(S.resumeTrackWork(s, first.group!.id), '');
  assert.equal(s.jobs.filter((j) => j.status === 'todo').length, 2);
  assert.equal(s.jobs.filter((j) => j.status === 'canceled').length, 0);
});
