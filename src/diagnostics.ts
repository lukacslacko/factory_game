import type { State } from './types';

export type DiagnosticEntry = {
  seq: number;
  wallTime: number;
  elapsed: number;
  time: number;
  type: string;
  data: unknown;
};
export type DiagnosticCheckpoint = { seq: number; wallTime: number; elapsed: number; state: State };
export type DiagnosticArchive = {
  format: 'plant01-diagnostics';
  version: 1;
  gameVersion: string;
  started: number;
  entries: DiagnosticEntry[];
  checkpoints: DiagnosticCheckpoint[];
  dropped: number;
  current: State;
};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const round = (v: number | undefined) =>
  v === undefined ? undefined : Math.round(v * 1000) / 1000;

/** Passive observer: never mutates the simulation. Bounded records and full checkpoints
 * make exported stalls inspectable even when the user did not start recording first. */
export class DiagnosticRecorder {
  entries: DiagnosticEntry[] = [];
  checkpoints: DiagnosticCheckpoint[] = [];
  dropped = 0;
  started = Date.now();
  private seq = 0;
  private bytes = 0;
  private state?: State;
  private lastSample = -Infinity;
  private lastSimSample = -Infinity;
  private lastCheckpoint = -Infinity;
  private signatures = new Map<string, string>();
  private lastEvent = 0;
  private lastMovement = 0;
  constructor(
    readonly maxEntries = 18000,
    readonly maxBytes = 6_000_000,
  ) {}

  record(s: State, type: string, data: unknown, wallTime = Date.now()) {
    const entry = {
      seq: ++this.seq,
      wallTime,
      elapsed: round(s.elapsed)!,
      time: round(s.time)!,
      type,
      data: copy(data),
    };
    this.entries.push(entry);
    this.bytes += JSON.stringify(entry).length;
    while (this.entries.length > this.maxEntries || this.bytes > this.maxBytes) {
      this.bytes -= JSON.stringify(this.entries.shift()).length;
      this.dropped++;
    }
  }
  private changed(s: State, key: string, data: unknown, wallTime: number) {
    const signature = JSON.stringify(data);
    if (this.signatures.get(key) === signature) return;
    this.signatures.set(key, signature);
    this.record(s, 'transition', { id: key, ...(data as object) }, wallTime);
  }
  observe(s: State, wallTime = Date.now()) {
    if (this.state !== s) {
      this.state = s;
      this.signatures.clear();
      this.lastEvent = s.events.length;
      this.lastMovement = s.movements.length;
      this.lastSample = -Infinity;
      this.lastSimSample = -Infinity;
      this.lastCheckpoint = -Infinity;
      this.record(s, 'yard-loaded', { name: s.name, saveVersion: s.version }, wallTime);
    }
    // Full state once a minute of real play, independent of simulation speed.
    if (wallTime - this.lastCheckpoint >= 60000) {
      this.checkpoints.push({ seq: this.seq, wallTime, elapsed: s.elapsed, state: copy(s) });
      while (this.checkpoints.length > 4) this.checkpoints.shift();
      this.lastCheckpoint = wallTime;
    }
    for (const j of s.jobs)
      this.changed(
        s,
        j.id,
        {
          status: j.status,
          phase: j.phase,
          reason: j.reason,
          worker: j.worker,
          operator: j.operator,
          equipment: j.equipment,
          stack: j.stack,
          handlingPhase: j.handling?.phase,
          railPhase: j.railWork?.phase,
          panel: j.railWork?.panel.state,
          cargoState: j.handling?.state,
          equipmentReleased: j.handling?.equipmentReleased,
        },
        wallTime,
      );
    for (const o of s.orders)
      this.changed(
        s,
        o.id,
        {
          status: o.status,
          arrived: o.arrived,
          carrierDeparted: o.carrierDeparted,
          note: o.note,
          equipment: o.unload?.equipmentId,
          operator: o.unload?.operatorId,
          phase: o.unload?.phase || o.deployment,
        },
        wallTime,
      );
    for (const e of s.events.slice(this.lastEvent)) this.record(s, 'event', e, wallTime);
    for (const m of s.movements.slice(this.lastMovement))
      this.record(s, 'material-movement', m, wallTime);
    this.lastEvent = s.events.length;
    this.lastMovement = s.movements.length;
    const moving =
      s.equipment.some((e) => e.path.length || e.work || e.cargo) ||
      s.workers.some((w) => w.path.length || w.transition) ||
      s.orders.some((o) => ['approaching', 'departing'].includes(o.status));
    if (
      wallTime - this.lastSample < 500 &&
      (!moving || s.elapsed - this.lastSimSample < 0.2 - 1e-8)
    )
      return;
    this.lastSample = wallTime;
    this.lastSimSample = s.elapsed;
    const motion = (a: any) => ({
      id: a.id,
      x: round(a.x),
      z: round(a.z),
      y: round(a.y),
      yaw: round(a.yaw),
      velocity: round(a.velocity),
      reverse: a.reverse,
      blockedBy: a.blockedBy,
      trafficWait: round(a.trafficWait),
      path: a.path?.slice(0, 8),
      pathLength: a.path?.length,
      destination: a.destination,
      job: a.job,
      deliveryOrder: a.deliveryOrder,
      operator: a.operator,
      vehicle: a.vehicle,
      status: a.status,
      shiftPhase: a.shiftPhase,
      fuel: round(a.fuel),
      cargo: a.cargo,
      lift: round(a.lift),
      reach: round(a.reach),
    });
    this.record(
      s,
      'positions',
      {
        equipment: s.equipment.map(motion),
        workers: s.workers.map(motion),
        carriers: s.orders
          .filter((o) => !['ordered', 'done'].includes(o.status) && !o.carrierDeparted)
          .map((o) => ({
            id: o.id,
            item: o.item,
            manifest: o.manifest,
            status: o.status,
            position: o.vehicle,
            drive: o.drive,
          })),
      },
      wallTime,
    );
  }
  archive(s: State): DiagnosticArchive {
    this.observe(s);
    return copy({
      format: 'plant01-diagnostics',
      version: 1,
      gameVersion: '0.10.0',
      started: this.started,
      entries: this.entries,
      checkpoints: this.checkpoints,
      dropped: this.dropped,
      current: s,
    });
  }
  restore(data: DiagnosticArchive) {
    if (data.format !== 'plant01-diagnostics' || data.version !== 1 || !Array.isArray(data.entries))
      return;
    this.entries = data.entries.slice(-this.maxEntries);
    this.checkpoints = data.checkpoints.slice(-4);
    this.started = data.started;
    this.dropped = data.dropped;
    this.seq = Math.max(0, ...this.entries.map((e) => e.seq));
    this.bytes = this.entries.reduce((n, e) => n + JSON.stringify(e).length, 0);
    while (this.bytes > this.maxBytes && this.entries.length) {
      this.bytes -= JSON.stringify(this.entries.shift()).length;
      this.dropped++;
    }
  }
  get size() {
    return this.bytes;
  }
}

/** IndexedDB keeps diagnostic history separate from the portable yard save. */
export async function diagnosticStore(): Promise<{
  read(): Promise<DiagnosticArchive | undefined>;
  write(data: DiagnosticArchive): Promise<void>;
}> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('plant01-diagnostics-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('rolling');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return {
    read: () =>
      new Promise((resolve, reject) => {
        const r = db.transaction('rolling').objectStore('rolling').get('latest');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
    write: (data) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('rolling', 'readwrite');
        tx.objectStore('rolling').put(data, 'latest');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  };
}
