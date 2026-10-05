import { trackGeometry, trackNetwork } from './track';
import { railLocationPose, railLocationStatus } from './rail-locations';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { State } from './types';
import { totals } from './sim';
import { equipmentAssistant } from './work-crews';
import { MATERIALS } from './catalog';
import { orderLines, orderMass, itemMass } from './procurement';
import { parkingStatus } from './workforce';
import { equipmentAssignment, jobRows, automaticEquipmentForWork } from './jobs';
import { equipmentRole, equipmentActivities, equipmentWorkSummary } from './equipment-roles';
export const SQL_EXAMPLES = [
  {
    name: 'Material balance',
    sql: 'SELECT item, delivered, stored, reserved, cargo, inConstruction, installed, incoming FROM inventory ORDER BY item;',
  },
  {
    name: 'Cost by category',
    sql: 'SELECT category, ROUND(SUM(amount), 2) AS total FROM costs GROUP BY category ORDER BY total DESC;',
  },
  {
    name: 'What is blocking work?',
    sql: "SELECT id, kind, phase, reason, x, z FROM jobs WHERE status = 'todo' ORDER BY id;",
  },
  {
    name: 'Diesel by machine',
    sql: 'SELECT id, kind, ROUND(fuel, 1) AS liters_remaining, ROUND(used, 2) AS liters_used FROM equipment;',
  },
  {
    name: 'Material trail',
    sql: 'SELECT time, item, qty, source, destination, reason FROM movements ORDER BY time DESC LIMIT 100;',
  },
  {
    name: 'Vehicle work roles',
    sql: 'SELECT id, kind, automaticWork, allowedWork, fuel FROM equipment ORDER BY id;',
  },
  {
    name: 'Active work orders',
    sql: "SELECT id, parentId, label, status, preferredEquipment, equipment, reason FROM work_orders WHERE status IN ('todo','doing') ORDER BY created DESC;",
  },
  {
    name: 'Parking and shifts',
    sql: 'SELECT id, kind, parking_x, parking_z, parkingStatus FROM equipment ORDER BY id;',
  },
  {
    name: 'Delivery manifests',
    sql: 'SELECT order_id, item, qty, arrived, mass_kg FROM order_lines ORDER BY order_id, line;',
  },
  {
    name: 'Named railway locations',
    sql: 'SELECT id, name, kind, track_id, route, offset_m, length_m, x, z, connected, status FROM rail_locations ORDER BY name;',
  },
];
let runtime: ReturnType<typeof initSqlJs> | undefined;
export async function query(s: State, sql: string) {
  if (!/^\s*(select|with|explain)\b/i.test(sql))
    throw new Error('Use SELECT, WITH, or EXPLAIN to query the reporting snapshot.');
  runtime ??= initSqlJs({ locateFile: () => wasmUrl });
  const SQL = await runtime;
  const db = new SQL.Database();
  const railNetwork = trackNetwork(s);
  const tables: Record<string, Record<string, unknown>[]> = {
    inventory: Object.keys(MATERIALS).map((item) => ({
      item,
      ...totals(s, item as keyof typeof MATERIALS),
    })),
    workers: s.workers.map(({ path, ...w }) => ({ ...w })),
    equipment: s.equipment.map(({ path, cargo, ...e }) => ({
      ...e,
      support_worker: equipmentAssistant(s, e.id)?.id || null,
      workRole: equipmentRole(e),
      allowedWork: equipmentActivities(e),
      automaticWork: equipmentWorkSummary(e),
      parkingStatus: parkingStatus(s, { ...e, path }),
      parking_x: e.parking?.x,
      parking_z: e.parking?.z,
      cargo_item: cargo?.item || '',
      cargo_qty: cargo?.qty || 0,
    })),
    jobs: s.jobs.map((j) => ({
      ...j,
      assigned_equipment: equipmentAssignment(s, j.id).equipmentId,
      assignment_source: equipmentAssignment(s, j.id).sourceId,
      automatic_equipment: automaticEquipmentForWork(s, j),
    })),
    job_groups: (s.jobGroups || []).map((g) => ({
      ...g,
      staging_equipment: g.railCrew?.stagingEquipment,
      installing_equipment: g.railCrew?.installingEquipment,
      buffer_secured: g.railBuffer?.pose.secured,
    })),
    work_orders: jobRows(s).map((r) => ({ ...r })),
    orders: s.orders.map(({ vehicle, handler, allocated, ...o }) => ({
      ...o,
      mass_kg: orderMass(o),
    })),
    order_lines: s.orders.flatMap((o) =>
      orderLines(o).map((l, line) => ({
        order_id: o.id,
        line,
        ...l,
        mass_kg: (itemMass(l.item) || 0) * l.qty,
      })),
    ),
    costs: s.costs.map((c) => ({ ...c })),
    events: s.events.map((e) => ({ ...e })),
    movements: s.movements.map(({ from, to, ...m }) => ({ ...m, source: from, destination: to })),
    stacks: s.stacks.map((t) => ({ ...t })),
    buildings: s.buildings.map((b) => ({ ...b })),
    rails: s.rails.map((r) => ({
      ...r,
      material: r.item || 'rail',
      layout: r.track?.layout || 'straight',
      heading: r.track?.heading ?? r.rotation,
      hand: r.track?.hand ?? 1,
      section: r.track?.section ?? 0,
      work_order: r.track?.groupId,
      entry_x: trackGeometry(r).entry.x,
      entry_z: trackGeometry(r).entry.z,
      exit_x: trackGeometry(r).end.x,
      exit_z: trackGeometry(r).end.z,
      selected_route: r.selectedRoute || null,
    })),
    track_ports: railNetwork.panels.flatMap((p) =>
      p.ports.map((port) => ({
        asset_id: p.id,
        port: port.portIndex,
        x: port.x,
        z: port.z,
        yaw: port.yaw,
        route: port.route,
        connected: port.connected,
        network_connected: p.connected,
        buffer: Math.hypot(port.x - s.buffer.x, port.z - s.buffer.z) < 0.1 ? 'BUFFER-001' : null,
      })),
    ),
    zones: s.zones.map((z) => ({ ...z })),
    rail_locations: (s.railLocations || []).map((l) => {
      const pose = railLocationPose(s, l),
        status = railLocationStatus(s, l, railNetwork);
      return {
        id: l.id,
        name: l.name,
        kind: l.kind,
        track_id: l.trackId,
        route: l.route,
        offset_m: l.offset,
        length_m: l.length,
        x: pose?.x ?? null,
        z: pose?.z ?? null,
        yaw: pose?.yaw ?? null,
        connected: status.connected,
        valid: status.valid,
        status: status.reason,
      };
    }),
  };
  const defaultCols: Record<string, string[]> = {
    rail_locations: [
      'id',
      'name',
      'kind',
      'track_id',
      'route',
      'offset_m',
      'length_m',
      'x',
      'z',
      'yaw',
      'connected',
      'valid',
      'status',
    ],
    inventory: [
      'item',
      'delivered',
      'recovered',
      'stored',
      'reserved',
      'cargo',
      'inConstruction',
      'installed',
      'incoming',
    ],
    order_lines: ['order_id', 'line', 'item', 'qty', 'arrived', 'mass_kg'],
    rails: [
      'id',
      'x',
      'z',
      'rotation',
      'length',
      'material',
      'layout',
      'work_order',
      'entry_x',
      'entry_z',
      'exit_x',
      'exit_z',
      'selected_route',
    ],
    track_ports: [
      'asset_id',
      'port',
      'x',
      'z',
      'yaw',
      'route',
      'connected',
      'network_connected',
      'buffer',
    ],
    zones: ['id', 'name', 'x', 'z', 'w', 'd'],
    job_groups: [
      'id',
      'label',
      'parentId',
      'preferredEquipment',
      'automaticEquipment',
      'staging_equipment',
      'installing_equipment',
      'buffer_secured',
      'created',
    ],
    work_orders: [
      'id',
      'label',
      'parentId',
      'status',
      'progress',
      'preferredEquipment',
      'assignmentSource',
      'equipment',
      'reason',
      'created',
      'worker',
      'operator',
    ],
    workers: [
      'assistingEquipment',
      'id',
      'name',
      'role',
      'duty',
      'status',
      'hours',
      'wage',
      'x',
      'z',
      'schedule',
      'shiftPhase',
      'commuteOrder',
      'vehicle',
      'job',
    ],
    equipment: [
      'support_worker',
      'id',
      'kind',
      'workRole',
      'allowedWork',
      'automaticWork',
      'fuel',
      'tank',
      'used',
      'x',
      'z',
      'parking_x',
      'parking_z',
      'parkingStatus',
      'operator',
      'job',
    ],
    jobs: [
      'id',
      'kind',
      'status',
      'phase',
      'reason',
      'x',
      'z',
      'progress',
      'parentId',
      'assigned_equipment',
      'assignment_source',
      'automatic_equipment',
    ],
    orders: ['id', 'item', 'qty', 'arrived', 'status', 'total', 'eta', 'automaticEquipment'],
    costs: ['id', 'time', 'category', 'entity', 'description', 'amount'],
    events: ['id', 'time', 'type', 'entity', 'text'],
    movements: ['id', 'time', 'item', 'qty', 'source', 'destination', 'reason'],
    stacks: ['id', 'item', 'qty', 'reserved', 'source', 'x', 'z', 'w', 'd', 'liters'],
    buildings: ['id', 'kind', 'name', 'connected', 'x', 'z', 'w', 'd'],
  };
  try {
    for (const [table, rows] of Object.entries(tables)) {
      const columns = [
        ...new Set([...(defaultCols[table] || []), ...rows.flatMap((r) => Object.keys(r))]),
      ];
      const q = (x: string) => `"${x.replaceAll('"', '""')}"`;
      db.run(
        `CREATE TABLE ${q(table)} (${columns.map((c) => `${q(c)} ${rows.some((r) => typeof r[c] === 'number') ? 'REAL' : 'TEXT'}`).join(',')})`,
      );
      const insert = db.prepare(
        `INSERT INTO ${q(table)} VALUES (${columns.map(() => '?').join(',')})`,
      );
      for (const row of rows)
        insert.run(
          columns.map((c) => {
            const v = row[c];
            return v === undefined
              ? null
              : typeof v === 'number' || typeof v === 'string'
                ? v
                : typeof v === 'boolean'
                  ? Number(v)
                  : JSON.stringify(v);
          }),
        );
      insert.free();
    }
    return db.exec(sql);
  } finally {
    db.close();
  }
}
export function csv(headers: string[], rows: unknown[][]) {
  const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
