import type { Building, Point, RailLocation, Rect, State } from './types';
import { nearestRailLocationAnchor, railLocationPath, railLocationStatus } from './rail-locations';
import { bufferAssets } from './buffers';
import { railCells, trackGeometry } from './track';
import { parkShunter } from './rail-operations';

/** Drive-through local Z axis; rotation one aligns the bay east/west. */
export function engineShedCenter(b: Rect): Point {
  return { x: b.x + b.w / 2, z: b.z + b.d / 2 };
}
function locationAt(s: State, b: Rect, rotation: number): RailLocation | undefined {
  const c = engineShedCenter(b),
    anchor = nearestRailLocationAnchor(s, c, 0.05);
  if (!anchor) return;
  const wanted = rotation % 2 ? 0 : Math.PI / 2;
  if (Math.abs(Math.sin(anchor.point.yaw - wanted)) > 0.0001) return;
  return {
    id: '',
    name: 'Engine shed bay',
    kind: 'parking',
    trackId: anchor.trackId,
    route: anchor.route,
    offset: anchor.offset,
    length: 14,
  };
}
export function engineShedRailCell(s: State, x: number, z: number): boolean {
  return s.rails.some((r) => railCells(r).some((p) => p.x === x && p.z === z));
}
export function engineShedPlacementError(s: State, b: Rect, rotation: number): string {
  const l = locationAt(s, b, rotation);
  if (!l)
    return 'Center the engine shed on a straight track, with both doors aligned to its direction.';
  const status = railLocationStatus(s, l),
    path = railLocationPath(s, l);
  if (!status.valid || !status.connected || !path)
    return 'The engine shed requires 14 m of continuous internal track connected to the yard.';
  const c = engineShedCenter(b),
    across = rotation % 2 ? 'z' : 'x';
  if (path.some((p) => Math.abs(p[across] - c[across]) > 0.01))
    return 'The internal track must remain straight through both engine shed doors.';
  if (
    s.rails.some((r) =>
      trackGeometry(r).paths.some((p) =>
        p.points.some(
          (q) =>
            q.x >= b.x &&
            q.x <= b.x + b.w &&
            q.z >= b.z &&
            q.z <= b.z + b.d &&
            Math.abs(q[across] - c[across]) > 0.01,
        ),
      ),
    )
  )
    return 'The shed footprint must contain only its own straight center track; move nearby crossing or parallel rails clear of the walls.';
  if (
    bufferAssets(s).some(
      (p) => !p.carried && p.x >= b.x && p.x <= b.x + b.w && p.z >= b.z && p.z <= b.z + b.d,
    )
  )
    return 'Recover the buffer stop inside the shed footprint first; both doors must remain clear.';
  return '';
}
/** A saved ordinary named rail location drives the existing physical shunter movement. */
export function engineShedParkingLocation(
  s: State,
  buildingId: string,
): { location?: RailLocation; error: string } {
  const b = s.buildings.find((b) => b.id === buildingId && b.kind === 'engineShed');
  if (!b) return { error: 'Select a completed engine shed.' };
  const error = engineShedPlacementError(s, b, b.rotation);
  if (error) return { error };
  const l = locationAt(s, b, b.rotation)!;
  l.id = b.parkingLocationId || `${b.id}/BAY`;
  l.name = `${b.name} · ${b.id}`;
  b.parkingLocationId = l.id;
  s.railLocations ||= [];
  const i = s.railLocations.findIndex((p) => p.id === l.id);
  if (i < 0) s.railLocations.push(l);
  else s.railLocations[i] = l;
  return { location: l, error: '' };
}
export function assignEngineShedParking(
  s: State,
  shunterId: string,
  buildingId: string,
): string | undefined {
  const { location, error } = engineShedParkingLocation(s, buildingId);
  if (error) return error;
  const result = parkShunter(s, shunterId, location!.id);
  if (!result) {
    const e = s.shunters!.find((e) => e.id === shunterId)!;
    e.parkingLocationId = location!.id;
    e.shedId = buildingId;
    s.revision++;
  }
  return result;
}
export function engineShedComponentIds(id: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ anchor: 6, post: 6, beam: 3, roof: 8, wall: 6 }).flatMap(([kind, n]) =>
      Array.from({ length: n }, (_, i) => [`${kind}/${i}`, `${id}/${kind.toUpperCase()}-${i + 1}`]),
    ),
  );
}
