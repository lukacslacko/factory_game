import { trackGeometry, trackNetwork } from './track';
import { bufferAssets } from './buffers';
import { railLocationPose, railLocationStatus } from './rail-locations';
import { railFreightCarPose } from './rail-freight';
import { railReservationRows } from './rail-operations';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { State } from './types';
import { totals } from './sim';
import { processRows } from './process-fluids';
import { equipmentAssistant } from './work-crews';
import { MATERIALS } from './catalog';
import { orderLines, orderMass, itemMass } from './procurement';
import { parkingStatus } from './workforce';
import { equipmentAssignment, jobRows, automaticEquipmentForWork } from './jobs';
import { equipmentRole, equipmentActivities, equipmentWorkSummary } from './equipment-roles';
export const SQL_EXAMPLES = [
  {name: 'Paid collections', sql: 'SELECT id, status, phase, massKg, total FROM collections ORDER BY created DESC;'},
  {name: 'Fluid inventory', sql: 'SELECT id, product, liters, capacity FROM process_tanks UNION ALL SELECT id, product, liters, capacity FROM process_lines;'},
  {name: 'Transfer interlocks', sql: 'SELECT id, carId, tankId, hose, flow, transferred, status FROM process_pumps;'},
  {name: 'Fluid movement ledger', sql: 'SELECT time, product, liters, "from", "to" FROM fluid_movements ORDER BY updated DESC;'},
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
  const process = processRows(s);
  const tables: Record<string, Record<string, unknown>[]> = {
    process_tanks: process.tanks.map(r=>({...r})),
    process_pumps: process.pumps.map(r=>({...r})),
    process_lines: process.lines.map(r=>({...r})),
    process_valves: process.valves.map(r=>({...r})),
    process_gauges: process.gauges.map(r=>({...r})),
    process_operations: process.operations.map(r=>({...r})),
    fluid_movements: (s.process?.ledger||[]).map(r=>({...r})),
    inventory: Object.keys(MATERIALS).map((item) => ({
      item,
      ...totals(s, item as keyof typeof MATERIALS),
    })),
    collections: (s.collections||[]).map(({task,lines,fees,...c})=>({...c,...fees})),
    collection_lines: (s.collections||[]).flatMap(c=>c.lines.map((l,line)=>({...l,collection_id:c.id,line,sourceSnapshot:undefined}))),
    retired_equipment: (s.retiredEquipment||[]).map(({path,...e})=>({...e})),
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
      stock_move_source: j.stockMove?.sourceId,
      stock_move_x: j.stockMove?.destination.x,
      stock_move_z: j.stockMove?.destination.z,
      staging_batch_leader: j.railStagingBatch,
      staging_batch_qty: j.railWork?.stagingBatch?.qty || 0,
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
      mass_kg: o.collectionId ? s.collections?.find(c=>c.id===o.collectionId)?.massKg : orderMass(o),
      direction: o.collectionId ? "outbound" : "incoming",
    })),
    order_lines: s.orders.flatMap((o) =>
      (o.collectionId ? [] : orderLines(o)).map((l, line) => ({
        order_id: o.id,
        line,
        ...l,
        mass_kg: (itemMass(l.item) || 0) * l.qty,
      })),
    ),
    rail_shunters: (s.shunters||[]).map(e=>({...e,driver:e.driverId,location:e.locationId})),
    rail_return_trains: (s.railReturns||[]).map(r=>({...r})),
    rail_reservations: railReservationRows(s),
    rail_service_crew: (s.railServiceCrew || []).map(c=>({...c})),
    rail_possessions: (s.railPossessions || []).map(p=>({...p})),
    freight_cars: s.orders.flatMap(o => (o.railFreight?.cars || []).map((car,index) => ({
      id: car.id, order_id: o.id, status: o.status, length_m: car.length,
      kind: car.kind, liquid: car.tank?.product, liters: car.tank?.liters, capacity_liters: car.tank?.capacity,
      coupled_to: car.coupledTo?.join(', '), handbrake: car.handbrake, brake_hose_connected: car.brakeHoseConnected,
      payload_kg: car.mass, tare_kg: car.tareMass, deck_length_m: car.deckLength,
      received_units: car.manifest.reduce((n,line)=>n+line.arrived,0),
      remaining_kg: car.manifest.reduce((n,line)=>n+(line.qty-line.arrived)*(itemMass(line.item)||0),0),
      reception_location: o.railFreight?.receptionLocationId,
      location_id: car.locationId, returned: car.returned||false, consist: car.groupId,
      storage_zone: o.railFreight?.storageZoneId,
      ...railFreightCarPose(o,index),
    }))),
    freight_car_lines: s.orders.flatMap(o => (o.railFreight?.cars || []).flatMap(car => car.manifest.map(line => ({
      car_id: car.id, order_id: o.id, ...line,
    })))),
    costs: s.costs.map((c) => ({ ...c })),
    events: s.events.map((e) => ({ ...e, severity: e.severity || 'info' })),
    movements: s.movements.map(({ from, to, ...m }) => ({ ...m, source: from, destination: to })),
    stacks: s.stacks.map((t) => ({ ...t, staging_job_ids: t.railStagingJobs?.join(', ') || '' })),
    buildings: s.buildings.map((b) => ({ ...b })),
    rails: s.rails.map((r) => ({
      ...r,
      material: r.item || 'rail',
      layout: r.track?.layout || 'straight',
      heading: r.track?.heading ?? r.rotation,
      hand: r.track?.hand ?? 1,
      flow: r.track?.flow || 'diverging',
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
        buffer:
          bufferAssets(s).find(
            (b) => b.secured && !b.carried && Math.hypot(port.x - b.x, port.z - b.z) < 0.1,
          )?.id ?? null,
      })),
    ),
    buffers: bufferAssets(s).map((b) => ({ ...b })),
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
    collections: ['id','carrierOrderId','kind','status','phase','note','equipmentId','massKg','transport','disposal','total','invoiced','charged','created','finished'],
    collection_lines: ['collection_id','line','stackId','item','qty','reserved','loaded','collected','massKg'],
    retired_equipment: ['id','kind','fuel','used','collectionId','retiredAt','retirementReason'],
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
    buffers: ['id', 'x', 'z', 'y', 'yaw', 'secured', 'carried', 'source'],
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
      'staging_batch_leader',
      'staging_batch_qty',
    ],
    process_tanks: ['id','product','liters','capacity','x','z','status'],
    process_pumps: ['id','carId','tankId','hose','enabled','rate','flow','transferred','status'],
    process_lines: ['id','kind','product','liters','capacity','flow','x','z','status'],
    process_valves: ['id','open','operation','status'],
    process_gauges: ['id','product','level','capacity','lineCapacity','flow','direction','calibrated','tankId','status'],
    process_operations: ['id','buildingId','workerId','carId','kind','phase','clock','status'],
    fluid_movements: ['id','runId','time','updated','product','liters','from','to'],
    orders: ['id', 'item' , 'qty', 'arrived', 'status', 'total', 'eta', 'automaticEquipment'],
    rail_shunters: ['id','name','driver','location','phase','status','fuel','tank','used','manualControl','parkingLocationId','shedId','x','z','yaw'],
    rail_return_trains: ['id','locomotiveId','orderIds','carIds','phase','status','waitingSeconds','waitingCost','x','z','yaw'],
    rail_reservations: ['id','owner','phase','tracks','distance','end','blockedBy','carIds'],
    rail_service_crew: ['id','name','ownerId','locomotiveId','phase','status','x','z','yaw'],
    rail_possessions: ['id','kind','from','to','z','assetIds','released'],
    freight_cars: ['id', 'order_id', 'kind','liquid','liters','capacity_liters','coupled_to','handbrake','brake_hose_connected','status', 'length_m', 'payload_kg', 'tare_kg', 'remaining_kg', 'x', 'z', 'yaw', 'reception_location', 'storage_zone'],
    freight_car_lines: ['car_id', 'order_id', 'item', 'qty', 'arrived', 'orderLineIndex'],
    costs: ['id', 'time', 'category', 'entity', 'description', 'amount'],
    events: ['id', 'time', 'severity', 'type', 'entity', 'text'],
    movements: ['id', 'time', 'item', 'qty', 'source', 'destination', 'reason'],
    stacks: [
      'id',
      'item',
      'qty',
      'reserved',
      'source',
      'x',
      'z',
      'w',
      'd',
      'liters',
      'staging_job_ids',
    ],
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
