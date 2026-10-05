import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { State } from './types';
import { totals } from './sim';
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
];
let runtime: ReturnType<typeof initSqlJs> | undefined;
export async function query(s: State, sql: string) {
  if (!/^\s*(select|with|explain)\b/i.test(sql))
    throw new Error('Use SELECT, WITH, or EXPLAIN to query the reporting snapshot.');
  runtime ??= initSqlJs({ locateFile: () => wasmUrl });
  const SQL = await runtime;
  const db = new SQL.Database();
  const tables: Record<string, Record<string, unknown>[]> = {
    inventory: Object.keys(MATERIALS).map((item) => ({
      item,
      ...totals(s, item as keyof typeof MATERIALS),
    })),
    workers: s.workers.map(({ path, ...w }) => ({ ...w })),
    equipment: s.equipment.map(({ path, cargo, ...e }) => ({
      ...e,
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
    job_groups: (s.jobGroups || []).map((g) => ({ ...g })),
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
    rails: s.rails.map((r) => ({ ...r })),
    zones: s.zones.map((z) => ({ ...z })),
  };
  const defaultCols: Record<string, string[]> = {
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
    rails: ['id', 'x', 'z', 'rotation', 'length'],
    zones: ['id', 'name', 'x', 'z', 'w', 'd'],
    job_groups: ['id', 'label', 'parentId', 'preferredEquipment', 'automaticEquipment', 'created'],
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
