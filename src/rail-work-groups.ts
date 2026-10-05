import type { Job, JobGroup, State } from './types';
import { trackGeometry } from './track';
import { dist } from './path';
import { angleDelta } from './motion';

/** Component layout IDs retain their geometry; their parent owns the whole work run. */
export function railWorkGroup(s: State, j: Job): JobGroup | undefined {
  let group = s.jobGroups?.find((g) => g.id === (j.parentId || j.track?.groupId));
  const visited = new Set<string>();
  while (group?.parentId && !visited.has(group.id)) {
    visited.add(group.id);
    group = s.jobGroups?.find((g) => g.id === group!.parentId) || group;
  }
  return group;
}

const unfinished = (j: Job) => j.kind === 'rail' && !['done', 'canceled'].includes(j.status);
/** Join actual planned joints, never crossings or merely neighboring footprints. */
export function groupConnectedRailWork(s: State): void {
  const jobs = s.jobs.filter(unfinished);
  const roots = new Map<string, JobGroup>();
  for (const j of jobs) {
    const group = railWorkGroup(s, j);
    if (group) roots.set(group.id, group);
  }
  if (roots.size < 2) return;
  const parent = new Map([...roots.keys()].map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const joints = new Map<
    string,
    { groupId: string; port: { x: number; z: number; yaw: number } }[]
  >();
  for (const job of jobs) {
    const group = railWorkGroup(s, job);
    if (!group) continue;
    for (const port of trackGeometry(job).ports) {
      const x = Math.floor(port.x / 0.02),
        z = Math.floor(port.z / 0.02);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const other of joints.get(`${x + dx},${z + dz}`) || []) {
            if (
              find(group.id) !== find(other.groupId) &&
              dist(port, other.port) < 0.02 &&
              Math.abs(Math.abs(angleDelta(port.yaw, other.port.yaw)) - Math.PI) < 0.02
            )
              parent.set(find(group.id), find(other.groupId));
          }
      const key = `${x},${z}`;
      const records = joints.get(key) || [];
      records.push({ groupId: group.id, port });
      joints.set(key, records);
    }
  }
  const clusters = new Map<string, JobGroup[]>();
  for (const group of roots.values()) {
    const id = find(group.id);
    clusters.set(id, [...(clusters.get(id) || []), group]);
  }
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => s.jobGroups!.indexOf(a) - s.jobGroups!.indexOf(b));
    const root = members[0];
    const assigned = members
      .filter((g) => g.railCrew || g.preferredEquipment)
      .sort((a, b) => (b.equipmentPriority || 0) - (a.equipmentPriority || 0))[0];
    if (assigned) {
      root.railCrew = assigned.railCrew ? { ...assigned.railCrew } : undefined;
      root.preferredEquipment = assigned.preferredEquipment;
      root.equipmentPriority = assigned.equipmentPriority;
      root.automaticEquipment = undefined;
    }
    const buffer =
      members.find((g) => g.railBuffer && !g.railBuffer.pose.secured) ||
      members.find((g) => g.railBuffer);
    if (buffer) root.railBuffer = buffer.railBuffer;
    const minX = Math.min(...members.map((g) => g.x)),
      minZ = Math.min(...members.map((g) => g.z));
    root.w = Math.max(...members.map((g) => g.x + g.w)) - minX;
    root.d = Math.max(...members.map((g) => g.z + g.d)) - minZ;
    root.x = minX;
    root.z = minZ;
    for (const child of members.slice(1)) {
      child.parentId = root.id;
      child.railCrew = undefined;
      child.preferredEquipment = undefined;
      child.equipmentPriority = undefined;
      child.automaticEquipment = undefined;
      child.railBuffer = undefined;
    }
    const count = jobs.filter((j) => railWorkGroup(s, j)?.id === root.id).length;
    root.label = `Build connected rail work · ${count} panels`;
    s.revision++;
  }
}
