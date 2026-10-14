import type { Equipment, EquipmentKind, Item, Point, Rect, Stack, State } from './types';
import { EQUIPMENT, MATERIALS } from './catalog';
import { center, overlap, segmentClear } from './path';
import { pendingOrderLine } from './procurement';
import { staticRailAisle, staticRailPickupFaces } from './rail-pickup';
import { boxOverlap, equipmentBoxes, staticObstacleRects, storageMoveStockHeight } from './traffic';

const isRail = (item: Item) => item === 'rail' || item.startsWith('rail');
const nearby = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + 10 && a.x + a.w + 10 > b.x &&
  a.z < b.z + b.d + 10 && a.z + a.d + 10 > b.z;
const touches = (p: Point, r: Rect, pad: number) =>
  p.x > r.x - pad && p.x < r.x + r.w + pad &&
  p.z > r.z - pad && p.z < r.z + r.d + pad;

/** A finite, top-layer handling witness for ordinary stock. Rail panels have
 * their more exact sling/loaded-withdrawal screen in delivery's rail checker.
 * This screen protects the chassis, rigger and an aisle to a yard mouth while
 * still permitting adjacent, fully occupied one-meter slab bays. */
function ordinaryWitness(s: State, stack: Stack, solids: readonly Rect[]): Point[] | null {
  const zone = s.zones.find((z) => stack.x >= z.x && stack.z >= z.z &&
    stack.x + stack.w <= z.x + z.w && stack.z + stack.d <= z.z + z.d);
  const c = center(stack);
  const itemMass = MATERIALS[stack.item].mass;
  const height = storageMoveStockHeight(stack.item, stack.qty);
  // The top layer must be liftable. A stack at its material limit remains a
  // stack of individual units; its whole mass is never treated as one lift.
  if (stack.qty < 1 || stack.qty > MATERIALS[stack.item].max || height > 4.5) return null;
  for (const kind of ['forklift', 'excavator'] as EquipmentKind[]) {
    if (EQUIPMENT[kind].capacity < itemMass) continue;
    const machine: Equipment = {
      id: 'storage-access-probe', kind, x: 0, z: 0, yaw: 0, heading: 0,
      path: [], fuel: 1, tank: 80, used: 0, work: 0,
    };
    for (const side of [
      { dx: 1, dz: 0, edge: stack.w / 2 },
      { dx: -1, dz: 0, edge: stack.w / 2 },
      { dx: 0, dz: 1, edge: stack.d / 2 },
      { dx: 0, dz: -1, edge: stack.d / 2 },
    ]) {
      const reach = side.edge + (kind === 'forklift' ? 2.65 : 3.5);
      const dock = { x: c.x + side.dx * reach, z: c.z + side.dz * reach };
      const approach = { x: dock.x + side.dx * 2.2, z: dock.z + side.dz * 2.2 };
      const yaw = Math.atan2(c.z - dock.z, c.x - dock.x);
      const chassisClear = [dock, approach].every((pose) =>
        solids.every((r) => !equipmentBoxes(machine, { ...pose, yaw }, false)
          .some((box) => boxOverlap(box,
            { ...center(r), length: r.w, width: r.d, yaw: 0 }, 0.06))));
      if (!chassisClear) continue;
      const workerPoints = [
        { x: c.x + stack.w / 2 + 0.65, z: c.z },
        { x: c.x - stack.w / 2 - 0.65, z: c.z },
        { x: c.x, z: c.z + stack.d / 2 + 0.65 },
        { x: c.x, z: c.z - stack.d / 2 - 0.65 },
      ];
      if (!workerPoints.some((p) =>
        segmentClear(p, p, [...solids], 0.28) &&
        !equipmentBoxes(machine, { ...dock, yaw }, false).some((b) =>
          boxOverlap(b, { ...p, length: 0.65, width: 0.65, yaw: 0 }, 0.04)))) continue;
      const aisle = zone
        ? staticRailAisle(zone, approach, [...solids], kind === 'forklift' ? 1.04 : 1.35)
        : [approach];
      if (aisle) return aisle;
    }
  }
  return null;
}

/** Pending stock is already promised physical space. Exclude the candidate's
 * own planned record at the caller before invoking this read-only checker. */
function pendingStock(s: State, projected: readonly Stack[]): Stack[] {
  const pending = [...projected];
  for (const o of s.orders) {
    const r = o.allocated || o.unload?.destination;
    const item = o.unload?.item || pendingOrderLine(o)?.item;
    if (!r || !item || !Object.hasOwn(MATERIALS, item) || o.status === 'done') continue;
    pending.push({ ...r, id: `${o.id}-storage`, item: item as Item, qty: 1,
      reserved: 0, source: o.id });
  }
  for (const j of s.jobs) {
    if (j.recoveryStack) pending.push(j.recoveryStack);
    if (j.railWork && ['todo', 'doing'].includes(j.status) &&
        ['stored', 'carried', 'staged'].includes(j.railWork.panel.state) && j.item) {
      const r = j.railWork.stage;
      pending.push({ ...r, id: `${j.id}-staging`, item: j.item,
        qty: 1, reserved: 0, source: j.id });
    }
    if (!j.stockMove || !['todo', 'doing'].includes(j.status)) continue;
    const item = j.item || s.stacks.find((t) => t.id === j.stockMove!.sourceId)?.item;
    if (item) pending.push({ ...j.stockMove.destination,
      id: `${j.id}-storage`, item, qty: 1, reserved: 0, source: j.id });
  }
  return pending;
}

/** Build once per allocation scan. The returned predicate protects every
 * previously retrievable ordinary stack and tests all finite top layers of the
 * proposed stack. Existing legacy piles with no possible witness are not made
 * worse by this check; recovery remains available for those older saves. */
export function createStorageAccessCheck(
  s: State,
  projected: readonly Stack[] = [],
): (item: Item, r: Rect, yaw?: number, qty?: number) => boolean {
  const pending = pendingStock(s, projected);
  const solids = [...staticObstacleRects(s), ...pending];
  const existing = [...s.stacks.filter((t) => t.qty > 0 && !t.storageCarriedBy), ...pending]
    .filter((t) => !isRail(t.item));
  const exposed = existing.flatMap((stack) => {
    const aisle = ordinaryWitness(s, stack, solids);
    return aisle ? [{ stack, aisle }] : [];
  });
  return (item, r, yaw = 0, qty = 1) => {
    if (!Number.isInteger(qty) || qty < 1 || qty > MATERIALS[item].max) return false;
    if (pending.some((p) => overlap(p, r))) return false;
    const affected = exposed.filter(({ stack, aisle }) =>
      nearby(stack, r) || aisle.some((point) => touches(point, r, 1.4)));
    if (isRail(item) && !affected.length) return true;
    const obstacles = [...solids, r];
    if (!isRail(item)) {
      const fresh: Stack = { ...r, id: 'storage-access-preview', item, qty,
        yaw, reserved: 0, source: 'preview' };
      if (!ordinaryWitness(s, fresh, obstacles)) return false;
    }
    return affected.every(({ stack }) => !!ordinaryWitness(s, stack, obstacles));
  };
}

export function storagePlacementPreservesAccess(
  s: State, item: Item, r: Rect, yaw?: number, qty?: number,
): boolean {
  return createStorageAccessCheck(s)(item, r, yaw, qty);
}

/** A merge adds vertical layers but no new ground footprint. Check the new
 * top-layer height and the same loading face before accepting its capacity. */
export function storageMergePreservesAccess(
  s: State, target: Stack, addedQty: number, projected: readonly Stack[] = [],
): boolean {
  const qty = target.qty + addedQty;
  if (!Number.isInteger(addedQty) || addedQty < 1 || qty > MATERIALS[target.item].max)
    return false;
  const raised = { ...target, qty };
  const solids = [...staticObstacleRects(s), ...pendingStock(s, projected)];
  if (!isRail(target.item)) return !!ordinaryWitness(s, raised, solids);
  const zone = s.zones.find((z) => raised.x >= z.x && raised.z >= z.z &&
    raised.x + raised.w <= z.x + z.w && raised.z + raised.d <= z.z + z.d);
  return (['forklift', 'excavator'] as EquipmentKind[]).some((kind) =>
    EQUIPMENT[kind].capacity >= MATERIALS[target.item].mass &&
    staticRailPickupFaces(s, raised, kind, solids).some((face) =>
      !zone || !!staticRailAisle(zone, face.approach, solids,
        kind === 'forklift' ? 1.04 : 1.35)));
}
