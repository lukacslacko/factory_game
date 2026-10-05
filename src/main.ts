import './styles.css';
import { World } from './world';
import { orderLines, orderDescription, orderMass } from './procurement';
import * as Sim from './sim';
import {
  EQUIPMENT_ACTIVITIES,
  equipmentActivities,
  equipmentWorkSummary,
  equipmentAllows,
  jobActivity,
} from './equipment-roles';
import {
  MATERIALS,
  BUILDINGS,
  EQUIPMENT,
  ROLES,
  SERVICES,
  money,
  clock,
  day,
  label,
  footprint,
} from './catalog';
import type {
  State,
  Selection,
  Point,
  Rect,
  Item,
  BuildKind,
  Worker,
  Equipment,
  EquipmentActivity,
  Job,
} from './types';
import { SQL_EXAMPLES, query, csv } from './reports';
import { key, center } from './path';
import { DiagnosticRecorder, diagnosticStore } from './diagnostics';
import { compareValues, tableKey } from './registers';
import {
  jobRows,
  equipmentAssignment,
  setJobEquipment,
  workLeaves,
  sortWorkRows,
  automaticEquipmentForWork,
} from './jobs';
import {
  setWorkerSchedule,
  setEquipmentParking,
  clearEquipmentParking,
  parkingStatus,
  workerAvailable,
} from './workforce';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const badge = (text: string, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
const btn = (action: string, text: string, cls = '', extra = '') =>
  `<button data-action="${action}" class="${cls}" ${extra}>${text}</button>`;
const SAVE = 'plant01-save-v1';
const renderedMarkup = new WeakMap<HTMLElement, string>();
function stableHTML(element: HTMLElement, html: string, force = false) {
  if (force || renderedMarkup.get(element) !== html) {
    element.innerHTML = html;
    renderedMarkup.set(element, html);
  }
}
let saved: State | undefined;
let saveError = '';
try {
  const json = localStorage.getItem(SAVE);
  if (json) saved = Sim.load(json);
} catch (e) {
  saveError = String(e);
}
let state = saved || Sim.createState(),
  tab = 'site',
  tool = 'select',
  rotation = 0,
  selection: Selection | undefined,
  controlled: string | undefined,
  hover: Point = { x: 0, z: 0 },
  search = '',
  recordFilter = 'active',
  toastTimer = 0,
  modal = '',
  lastUI = 0,
  lastSave = 0,
  lastTime = performance.now(),
  accumulator = 0,
  follow = false,
  lastNotice = '',
  noticeTimer = 0;
const recorder = new DiagnosticRecorder();
let diagnosticPersistence = 'Opening local recorder…';
let diagnosticDB: Awaited<ReturnType<typeof diagnosticStore>> | undefined;
let diagnosticWritePending = false;
void diagnosticStore()
  .then(async (db) => {
    diagnosticDB = db;
    const previous = await db.read();
    if (previous) recorder.restore(previous);
    recorder.observe(state);
    diagnosticPersistence = 'Stored on this device';
  })
  .catch(() => {
    diagnosticPersistence = 'Memory only · export before closing';
  });
const registerSort = new Map<string, { column: number; direction: number }>();
const registerPages = new Map<string, number>();
const registerFilters = new Map<string, Map<number, string>>();
let showColumnFilters = false;
const expandedWork = new Set<string>();
let parkingEquipment: string | undefined;
const keys = new Set<string>();
const purchaseCart = new Map<string, number>();
let purchaseTransport: 'road' | 'rail' = 'road';
const massLabel = (kg: number) =>
  kg >= 1000
    ? `${(kg / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} t`
    : `${kg.toLocaleString('en-US')} kg`;
const catalogEntry = (item: string): any =>
  MATERIALS[item as Item] ||
  (EQUIPMENT as any)[item] ||
  (ROLES as any)[item] ||
  (SERVICES as any)[item];
function itemMass(item: string) {
  return catalogEntry(item)?.mass || 0;
}
function renderCart() {
  const el = document.querySelector<HTMLElement>('#purchase-cart');
  if (!el) return;
  const lines = [...purchaseCart].map(([item, qty]) => ({ item, qty }));
  let summary = 'Add catalog rows to combine supplies on one delivery, or workers on one bus.';
  let valid = lines.length > 0;
  try {
    if (lines.length) {
      const loads = Sim.planPurchaseBatch(lines, purchaseTransport);
      const materials = loads.filter((l) => l.manifest[0].item in MATERIALS);
      const buses = loads.filter((l) => l.manifest[0].item in ROLES);
      const dedicated = loads.length - materials.length - buses.length;
      const weight = lines.reduce((n, l) => n + itemMass(l.item) * l.qty, 0);
      const total =
        lines.reduce((n, l) => n + catalogEntry(l.item).price * l.qty, 0) +
        loads.reduce((n, l) => n + (l.mode === 'rail' ? 240 : 90), 0);
      summary = `${weight ? massLabel(weight) + ' cargo · ' : ''}${[materials.length ? `${materials.length} ${purchaseTransport === 'rail' ? 'train' : 'truck'} load${materials.length === 1 ? '' : 's'}` : '', buses.length ? `${buses.length} crew bus${buses.length === 1 ? '' : 'es'}` : '', dedicated ? `${dedicated} dedicated deliver${dedicated === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' · ')} · ${money(total)}`;
    }
  } catch (error) {
    summary = (error as Error).message;
    valid = false;
  }
  el.innerHTML = `<div class="cart-head"><b>Order batch</b><span id="batch-summary" aria-live="polite">${esc(summary)}</span></div>${lines.length ? `<div class="cart-lines">${lines.map((l) => `<div><span>${esc(label(l.item))}</span><b>${l.qty}</b><span>${itemMass(l.item) ? massLabel(itemMass(l.item) * l.qty) : l.item in ROLES ? 'Passengers' : 'Service'}</span>${btn('cart-remove:' + l.item, '×', 'small', 'aria-label="Remove ' + esc(label(l.item)) + ' from batch"')}</div>`).join('')}</div>` : ''}<div class="cart-footer"><small>12 t truck / 48 t train · 12 seats per bus. Deck space can require another load before its weight limit.</small>${btn('cart-clear', 'Clear', 'small')}${btn('purchase-batch', 'Place batch order', 'primary', valid ? '' : 'disabled')}</div>`;
}
$('#app').innerHTML =
  `<header><button class="brand" data-action="menu"><span class="brand-mark">P<span>01</span></span><span>PLANT <b>01</b><small>STARTER YARD</small></span></button><nav id="tabs"></nav><div class="top-stats"><span id="time"></span><div class="time-controls">${btn('pause', 'Ⅱ', '', 'title="Pause / resume · Space"')} ${btn('speed:1', '1×', 'active')}${btn('speed:3', '3×')}${btn('speed:10', '10×')}</div>${btn('notices', 'Inbox <span id="notice-count">0</span>', 'inbox')}${btn('menu', '☰', 'menu-button', 'aria-label="Game menu"')}</div></header>
 <main><section id="site"><canvas id="world" tabindex="0" aria-label="3D construction yard"></canvas><div class="site-title"><span class="eyebrow">FIELD OPERATIONS</span><strong id="site-name"></strong><span>1 m grid · standard gauge · diesel traction</span></div><div class="map-actions">${btn('home', '⌂ Yard')}${btn('rail-end', '↗ Rail end')}${btn('overview', '▱ Overview')}${btn('grid', 'Grid', 'active')}${btn('help', '?', '', 'aria-label="Controls and help"')}</div><div id="guide"></div><aside id="inspector" hidden></aside><div id="mode-hint"></div><div id="buildbar"></div><div id="scale-bar"><i></i><span>10 m</span></div><div id="site-status"><span id="coords"></span><span id="work-summary"></span><span>Drag empty ground: pan · WASD: view-relative · Right drag: orbit · Scroll: zoom</span></div><div id="delivery-toast" hidden></div></section><section id="records" hidden></section></main><div id="toast" role="status" hidden></div><div id="modal-root"></div><input id="import-file" type="file" accept="application/json,.json" hidden><div id="error-banner" role="alert" hidden></div>`;
let world: World;
try {
  world = new World($('#world'));
} catch (e) {
  $('#app').innerHTML =
    `<div class="fatal"><h1>WebGL could not start</h1><p>This local game needs a browser with hardware acceleration enabled.</p><pre>${esc(e)}</pre><p>Try Chrome, Edge, or Safari with WebGL enabled.</p></div>`;
  throw e;
}
const tabs = [
  ['site', 'Yard'],
  ['materials', 'Materials'],
  ['workers', 'Workers'],
  ['equipment', 'Equipment'],
  ['deliveries', 'Deliveries'],
  ['jobs', 'Work'],
  ['activity', 'Activity'],
  ['costs', 'Costs'],
  ['reports', 'SQL'],
];
function renderTabs() {
  $('#tabs').innerHTML = tabs
    .map(([id, text]) => btn(`tab:${id}`, text, tab === id ? 'active' : ''))
    .join('');
  $('#site').hidden = tab !== 'site';
  $('#records').hidden = tab === 'site';
}
function toast(text: string, error = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = error ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), error ? 6500 : 4000);
}
function persistDiagnostics() {
  if (!diagnosticDB || diagnosticWritePending) return;
  diagnosticWritePending = true;
  void diagnosticDB
    .write(recorder.archive(state))
    .then(() => {
      diagnosticPersistence = 'Stored on this device';
    })
    .catch(() => {
      diagnosticPersistence = 'Memory only · export before closing';
    })
    .finally(() => {
      diagnosticWritePending = false;
    });
}
function persist(silent = false) {
  persistDiagnostics();
  lastSave = performance.now();
  try {
    localStorage.setItem(SAVE, Sim.save(state));
    lastSave = performance.now();
    if (!silent) toast('Yard saved in this browser.');
    return true;
  } catch (e) {
    toast('Browser storage is full or unavailable. Use Export save to keep your yard.', true);
    return false;
  }
}
function download(name: string, contents: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function rectFor(kind: string, p: Point): Rect {
  let x = Math.floor(p.x),
    z = Math.floor(p.z);
  if (kind === 'rail') {
    if (rotation % 2) {
      x -= 1;
      z = Math.round(z / 5) * 5;
    } else {
      x = Math.round(x / 5) * 5;
      z -= 1;
    }
  }
  return footprint(kind, x, z, rotation);
}
function currentRect() {
  if (tool === 'parking')
    return { x: Math.round(hover.x) - 2, z: Math.round(hover.z) - 2, w: 4, d: 4 };
  if ((tool === 'slab' || tool === 'zone') && world.pointerStart) {
    const a = world.pointerStart.p;
    return {
      x: Math.floor(Math.min(a.x, hover.x)),
      z: Math.floor(Math.min(a.z, hover.z)),
      w: Math.abs(Math.floor(a.x) - Math.floor(hover.x)) + 1,
      d: Math.abs(Math.floor(a.z) - Math.floor(hover.z)) + 1,
    };
  }
  return tool === 'zone'
    ? { x: Math.floor(hover.x), z: Math.floor(hover.z), w: 12, d: 12 }
    : rectFor(tool, hover);
}
function setTool(t: string) {
  tool = t;
  world.dragMode = t === 'slab' || t === 'zone';
  world.panMode = t === 'select';
  world.preview(undefined);
  renderBuildbar();
  renderHint();
}
function renderBuildbar() {
  const tools = [
    ['select', '↖', 'Inspect'],
    ['slab', '▦', 'Pave'],
    ['rail', '╫', 'Rail'],
    ['office', '▤', 'Office'],
    ['sanitary', '▥', 'WC'],
    ['shed', '⌂', 'Shed'],
    ['store', '▣', 'Stores'],
    ['lamp', '†', 'Light'],
    ['fence', '╬', 'Fence'],
    ['zone', '▱', 'Stockyard'],
    ['recover', '↶', 'Recover'],
  ];
  $('#buildbar').innerHTML =
    `<div class="tool-group">${tools.map(([t, icon, name]) => btn(`tool:${t}`, `<span>${icon}</span>${name}`, tool === t ? 'selected' : '', `title="${name}"`)).join('')}</div><div class="build-actions">${btn('rotate', '↻ R', '', 'title="Rotate footprint by 90 degrees"')}${btn('buy-missing', 'Buy missing', '', 'title="Order the missing materials for all plans"')}${btn('shop', '+ Purchase', 'primary')}</div>`;
}
function renderHint() {
  const el = $('#mode-hint');
  if (tool === 'parking') {
    stableHTML(
      el,
      `<b>PARKING · ${esc(parkingEquipment)}</b> Click the bay center on the meter grid. R rotates the parked direction. <span>Esc cancel</span>`,
    );
    return;
  }
  if (controlled) {
    const w = state.workers.find((w) => w.id === controlled);
    stableHTML(
      el,
      `<b>DIRECT CONTROL · ${esc(w?.name)}</b> ${w?.job ? 'Working on ' + esc(w.job) + '. Finish or cancel that assignment to move freely.' : 'Click a clear cell to ' + (w?.vehicle ? 'drive' : 'walk') + '.'} Select equipment to board, or a plan to work. ${btn('release', 'Return to automatic')}`,
    );
  } else if (tool !== 'select') {
    stableHTML(
      el,
      `<b>${tool === 'zone' ? 'STOCKYARD' : tool === 'recover' ? 'RECOVER' : esc(BUILDINGS[tool]?.name.toUpperCase())}</b> ${tool === 'recover' ? 'Click a structure, player-built rail, or paved cell to recover it.' : tool === 'slab' ? 'Drag an area to pave.' : tool === 'zone' ? 'Drag a storage area, or click for 12 × 12 m.' : tool === 'rail' ? 'Place 5 m panels. Centers snap to grid lines.' : 'Click to plan. Foundations are queued automatically.'} <span>R rotate · Esc cancel</span>`,
    );
  } else {
    stableHTML(el, '');
  }
}
function updatePreview() {
  if (tool === 'select') {
    world.preview(undefined);
    return;
  }
  const r = currentRect();
  const valid =
    tool === 'parking' || tool === 'zone' || tool === 'recover' || !Sim.validPlan(state, tool, r);
  world.preview(r, valid);
}
function doBuild(r: Rect) {
  recorder.record(state, 'plan', { tool, rect: r, rotation });
  if (tool === 'recover') {
    const error = Sim.recoverAt(state, r);
    toast(
      error || 'Recovery queued. The crew will return the material to physical storage.',
      !!error,
    );
    return;
  }
  if (tool === 'zone') {
    const e = Sim.addZone(state, r, `Stockyard ${state.zones.length + 1}`);
    toast(e || `Designated ${r.w} × ${r.d} m stockyard.`, !!e);
  } else if (tool === 'slab') {
    if (r.w * r.d > 600) {
      toast('Plan up to 600 paving cells at a time.', true);
      return;
    }
    const n = Sim.pave(state, r);
    toast(
      n ? `Planned ${n} m². Crew will use delivered slabs.` : 'No clear cells in this area.',
      !n,
    );
  } else {
    const result = Sim.plan(state, tool as BuildKind, r.x, r.z, rotation);
    toast(
      result.error || `${label(tool)} planned. Foundations and installation are in the work queue.`,
      !!result.error,
    );
    if (result.job) {
      selection = { type: 'job', id: result.job.id };
      renderInspector();
    }
  }
  persist(true);
  updatePreview();
}
world.onNavigate = () => {
  follow = false;
};
world.onHover = (p) => {
  hover = p;
  $('#coords').textContent = `E ${Math.floor(p.x)} · S ${Math.floor(p.z)}`;
  updatePreview();
};
world.onDrag = (a, b) => {
  doBuild({
    x: Math.floor(Math.min(a.x, b.x)),
    z: Math.floor(Math.min(a.z, b.z)),
    w: Math.abs(Math.floor(a.x) - Math.floor(b.x)) + 1,
    d: Math.abs(Math.floor(a.z) - Math.floor(b.z)) + 1,
  });
};
// Stockyard clicks use a useful default footprint; dragging always uses the exact grid rectangle.
world.onPick = (picked, p) => {
  if (tool === 'parking' && parkingEquipment) {
    recorder.record(state, 'parking-assignment', {
      equipmentId: parkingEquipment,
      x: Math.round(p.x),
      z: Math.round(p.z),
      rotation,
    });
    const error = setEquipmentParking(
      state,
      parkingEquipment,
      Math.round(p.x),
      Math.round(p.z),
      rotation,
    );
    toast(
      error ||
        'Parking bay assigned. An available operator will park this machine when it is idle.',
      !!error,
    );
    if (!error) {
      setTool('select');
      persist(true);
      renderInspector(true);
    }
    return;
  }
  if (tool !== 'select') {
    doBuild(
      tool === 'zone' ? { x: Math.floor(p.x), z: Math.floor(p.z), w: 12, d: 12 } : rectFor(tool, p),
    );
    return;
  }
  if (controlled && !picked) {
    recorder.record(state, 'move-command', { workerId: controlled, point: p });
    const error = Sim.moveWorker(state, controlled, p);
    if (error) toast(error, true);
    renderHint();
    return;
  }
  selection = picked;
  renderInspector();
};
function selectedEntity(): any {
  if (!selection) return;
  const lists: any = {
    worker: state.workers,
    equipment: state.equipment,
    stack: state.stacks,
    building: [...state.buildings, ...state.rails],
    job: state.jobs,
    jobGroup: state.jobGroups || [],
    order: state.orders,
    zone: state.zones,
    buffer: [{ id: 'BUFFER-001', ...state.buffer }],
  };
  return lists[selection.type]?.find((o: any) => o.id === selection!.id);
}
function locate(type: string, id: string) {
  const lists: any = {
    worker: state.workers,
    equipment: state.equipment,
    stack: state.stacks,
    building: [...state.buildings, ...state.rails],
    job: state.jobs,
    jobGroup: state.jobGroups || [],
    order: state.orders,
    zone: state.zones,
  };
  const e = lists[type]?.find((v: any) => v.id === id);
  if (!e) return;
  selection = { type: type as any, id };
  tab = 'site';
  renderTabs();
  const position =
    typeof e.vehicle === 'string'
      ? state.equipment.find((q) => q.id === e.vehicle) || e
      : e.vehicle || e;
  world.focus(position, 1.35);
  renderInspector();
}
function locateAny(id: string) {
  if (id === 'BUFFER-001') {
    selection = { type: 'buffer', id };
    tab = 'site';
    renderTabs();
    world.focus(state.buffer, 1.35);
    renderInspector();
    return;
  }
  for (const [type, arr] of Object.entries({
    worker: state.workers,
    equipment: state.equipment,
    stack: state.stacks,
    building: [...state.buildings, ...state.rails],
    job: state.jobs,
    jobGroup: state.jobGroups || [],
    order: state.orders,
    zone: state.zones,
  })) {
    if (arr.some((e) => e.id === id)) {
      locate(type, id);
      return;
    }
  }
  const related = state.events.filter((e) => e.id === id || e.entity === id || e.text.includes(id));
  const movement = state.movements.filter((m) => m.id === id || m.from === id || m.to === id);
  const costs = state.costs.filter((c) => c.id === id || c.entity === id);
  const notices = state.notices.filter((n) => n.id === id || n.entity === id);
  modal = 'reference';
  const activity = related
    .slice(-30)
    .map((e) => `<p>${reference(`D${day(e.time)} ${clock(e.time)} · ${e.text}`)}</p>`)
    .join('');
  const trail = movement
    .slice(-30)
    .map(
      (m) =>
        `<p>${reference(`${m.qty} × ${label(m.item)} · ${m.from} → ${m.to} · ${m.reason}`)}</p>`,
    )
    .join('');
  const ledger = costs
    .map((c) => `<p>${reference(c.description)} · ${money(c.amount)}</p>`)
    .join('');
  const notes = notices.map((n) => `<p>${reference(n.title + ' · ' + n.detail)}</p>`).join('');
  $('#modal-root').innerHTML =
    `<div class="modal-backdrop"><section class="modal"><div class="modal-close">${btn('close-modal', '×', '', 'aria-label="Close reference"')}</div><h1>${esc(id)}</h1><p class="subtitle">Historical reference · current assets open their yard inspector.</p>${activity ? '<h3>Activity</h3>' + activity : ''}${trail ? '<h3>Material trail</h3>' + trail : ''}${ledger ? '<h3>Recorded costs</h3>' + ledger : ''}${notes}${!activity && !trail && !ledger && !notes ? '<p>No current asset or retained history for this reference.</p>' : ''}${btn('close-modal', 'Return')}</section></div>`;
}
const details = (rows: [string, unknown][]) =>
  `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${linkCells(String(v))}</dd>`).join('')}</dl>`;
function equipmentPendingWork(e: Equipment) {
  const active = e.job ? state.jobs.find((j) => j.id === e.job) : undefined;
  return e.deliveryOrder && !equipmentAllows(e, 'receiving')
    ? 'After current unloading batch'
    : active && !equipmentAllows(e, jobActivity(active))
      ? 'After current job'
      : '';
}
function equipmentRoleControl(e: Equipment) {
  const selected = equipmentActivities(e),
    finishing = equipmentPendingWork(e);
  return `<div class="equipment-work-control"><details class="equipment-role" data-equipment-work="${esc(e.id)}"><summary aria-label="Automatic work for ${esc(e.id)}">${esc(equipmentWorkSummary(e))}</summary><div class="equipment-work-options" popover="manual" role="group" aria-label="Automatic job kinds for ${esc(e.id)}"><div class="equipment-work-presets"><button type="button" data-equipment-work-preset="all" data-equipment-id="${esc(e.id)}">All</button><button type="button" data-equipment-work-preset="none" data-equipment-id="${esc(e.id)}">None</button></div>${Object.entries(
    EQUIPMENT_ACTIVITIES,
  )
    .map(
      ([activity, text]) =>
        `<label ${activity === 'rail' && e.kind !== 'excavator' ? 'title="Rail construction requires an excavator"' : ''}><input type="checkbox" data-equipment-activity="${esc(e.id)}" value="${activity}" ${selected.includes(activity as EquipmentActivity) ? 'checked' : ''} ${activity === 'rail' && e.kind !== 'excavator' ? 'disabled' : ''}> ${text}${activity === 'rail' && e.kind !== 'excavator' ? ' · excavator' : ''}</label>`,
    )
    .join(
      '',
    )}<small>Driving and refueling remain available.</small></div></details><small class="role-pending" ${finishing ? '' : 'hidden'}>${finishing}</small></div>`;
}
function updateEquipmentWork(eid: string, activities: EquipmentActivity[]) {
  const error = Sim.setEquipmentActivities(state, eid, activities);
  const equipment = state.equipment.find((e) => e.id === eid);
  if (error || !equipment) {
    toast(error || 'Equipment not found.', true);
    return;
  }
  const selected = equipmentActivities(equipment);
  // Update both views in place, retaining the open checklist and keyboard focus.
  for (const dropdown of document.querySelectorAll<HTMLElement>(`[data-equipment-work="${eid}"]`)) {
    dropdown.querySelector('summary')!.textContent = equipmentWorkSummary(equipment);
    for (const input of dropdown.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      input.checked = selected.includes(input.value as EquipmentActivity);
    const pending = dropdown.parentElement!.querySelector<HTMLElement>('.role-pending')!;
    pending.textContent = equipmentPendingWork(equipment);
    pending.hidden = !pending.textContent;
  }
  recorder.record(state, 'equipment-automatic-work', { equipmentId: eid, activities: selected });
  toast(`Automatic work: ${equipmentWorkSummary(equipment)}.`);
  persist(true);
}
function assignmentControl(id: string) {
  const a = equipmentAssignment(state, id),
    own = state.jobs.find((j) => j.id === id) || state.jobGroups?.find((g) => g.id === id);
  if (own && 'kind' in own && own.kind === 'refuel')
    return `${reference(own.target || 'Equipment')}<small class="role-pending">Refueling target · serviced by a worker</small>`;
  const done = !workLeaves(state, id).some((j) => ['todo', 'doing'].includes(j.status));
  return `<select class="assignment-select" data-job-equipment="${esc(id)}" aria-label="Assign equipment to ${esc(id)}" ${done ? 'disabled' : ''}><option value="">${a.inherited ? `Inherit ${a.equipmentId}` : 'Automatic / inherit'}</option>${state.equipment.map((e) => `<option value="${e.id}" ${own?.preferredEquipment === e.id ? 'selected' : ''}>${e.id} · ${label(e.kind)}</option>`).join('')}</select><small class="role-pending">${reference(a.text)}</small>`;
}
function scheduleControl(w: Worker) {
  const value = w.schedule ? `${w.schedule.start},${w.schedule.end}` : '';
  const options = [
    ['', 'Always on'],
    ['7,17', '07:00–17:00'],
    ['8,16', '08:00–16:00'],
    ['22,6', '22:00–06:00'],
  ];
  if (value && !options.some((o) => o[0] === value))
    options.push([
      value,
      `${String(Math.floor(w.schedule!.start)).padStart(2, '0')}:${String(Math.round((w.schedule!.start % 1) * 60)).padStart(2, '0')}–${String(Math.floor(w.schedule!.end)).padStart(2, '0')}:${String(Math.round((w.schedule!.end % 1) * 60)).padStart(2, '0')}`,
    ]);
  return `<select data-worker-schedule="${w.id}" aria-label="Shift for ${esc(w.name)}">${options.map(([v, t]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
}
function parkingControls(e: Equipment) {
  return `<p class="note">${esc(parkingStatus(state, e))}${e.parking ? ` · E${e.parking.x}, S${e.parking.z}` : ''}</p><div class="button-stack">${btn(`parking-pick:${e.id}`, 'Choose bay in yard')}${e.parking ? btn(`parking-clear:${e.id}`, 'Clear parking bay') : ''}</div><div class="parking-controls"><label>E <input id="parking-x" type="number" step="1" value="${e.parking?.x ?? Math.round(e.x)}"></label><label>S <input id="parking-z" type="number" step="1" value="${e.parking?.z ?? Math.round(e.z)}"></label><label>Face <select id="parking-direction">${['East', 'South', 'West', 'North'].map((v, i) => `<option value="${i}" ${e.parking?.rotation === i ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${btn(`parking-save:${e.id}`, 'Assign coordinates', 'small')}</div>`;
}
function renderInspector(force = false) {
  const panel = $('#inspector'),
    e = selectedEntity();
  if (!e || !selection) {
    panel.hidden = true;
    world.highlight(undefined);
    return;
  }
  if (
    !force &&
    (panel.querySelector('details.equipment-role[open]') ||
      (panel.contains(document.activeElement) &&
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')))
  )
    return;
  panel.hidden = false;
  const r = e.w ? e : { x: e.x - 1, z: e.z - 1, w: 2, d: 2 };
  world.highlight(selection.type === 'order' ? undefined : r);
  let title =
      e.name || e.label || (e.length ? 'Rail panel' : label(e.kind || e.item || selection.type)),
    body = '';
  if (selection.type === 'worker') {
    const w = e as Worker;
    body = details([
      ['Role', label(w.role)],
      ['Duty', badge(w.duty)],
      ['Shift', scheduleControl(w)],
      ['Shift action', esc(w.shiftPhase || 'Working')],
      ['Current action', esc(w.status)],
      ['Location', `${w.x.toFixed(1)}, ${w.z.toFixed(1)}`],
      ['Vehicle', esc(w.vehicle || w.commuteOrder || w.transportOrder || 'On foot')],
      ['Assignment', esc(w.deliveryOrder || w.transportOrder || w.job || 'None')],
      ['Time on site', `${w.hours.toFixed(1)} h`],
      ['Hourly rate', money(w.wage)],
    ]);
    body += `<div class="parking-controls"><label>Shift start <input id="shift-start" type="number" min="0" max="23.99" step="0.25" value="${w.schedule?.start ?? 7}"></label><label>Shift end <input id="shift-end" type="number" min="0" max="23.99" step="0.25" value="${w.schedule?.end ?? 17}"></label>${btn(`shift-save:${w.id}`, 'Set custom shift', 'small')}</div><div class="button-stack">${btn(`control:${w.id}`, w.id === controlled ? 'Controlling this worker' : 'Take direct control', 'primary', w.job || w.deliveryOrder || w.transportOrder || w.transition || !workerAvailable(state, w) ? 'disabled' : '')}${w.vehicle ? btn(`exit:${w.id}`, 'Leave vehicle', '', w.job || w.deliveryOrder || w.transportOrder || w.transition || !workerAvailable(state, w) ? 'disabled' : '') : ''}${btn(`duty:${w.id}`, w.duty === 'rest' ? 'Return to duty' : 'Rest / hold assignments', '', w.job || w.deliveryOrder || w.transportOrder || w.transition || !workerAvailable(state, w) ? 'disabled' : '')}</div>`;
  }
  if (selection.type === 'equipment') {
    const e2 = e as Equipment;
    body =
      details([
        ['Automatic work', equipmentRoleControl(e2)],
        ['Fuel', `${e2.fuel.toFixed(1)} / ${e2.tank} L`],
        ['Diesel consumed', `${e2.used.toFixed(2)} L`],
        ['Refueling job', esc(e2.refueling || 'None')],
        ['Lift limit', `${(EQUIPMENT[e2.kind].capacity / 1000).toFixed(1)} t`],
        [
          'Operator',
          esc(
            e2.operator
              ? `${state.workers.find((w) => w.id === e2.operator)?.name || 'Operator'} · ${e2.operator}`
              : 'Unoccupied',
          ),
        ],
        [
          'Assignment',
          esc(
            e2.transportOrder
              ? `On lowloader · ${e2.transportOrder}`
              : e2.deliveryOrder || e2.job || 'Available',
          ),
        ],
        [
          'Traffic',
          esc(
            e2.blockedBy ? `Waiting for ${e2.blockedBy}` : e2.path.length ? 'Traveling' : 'Clear',
          ),
        ],
        ['Cargo', e2.cargo ? `${e2.cargo.qty} × ${label(e2.cargo.item)}` : 'Empty'],
      ]) +
      `<div class="meter"><i style="width:${(e2.fuel / e2.tank) * 100}%"></i></div><p class="note">The current job or unloading batch finishes before a new role takes effect. Direct driving and refueling stay available.</p><div class="button-stack">${controlled ? btn(`enter:${e2.id}`, 'Board with selected operator', 'primary') : ''}${btn(`refuel:${e2.id}`, 'Request refueling')}${btn('tab:equipment', 'Equipment register')}</div><h3>Parking</h3>${parkingControls(e2)}`;
  }
  if (selection.type === 'stack') {
    body =
      details([
        ['Material', esc(label(e.item))],
        ['Quantity', `${e.qty} ${MATERIALS[e.item as Item].unit}`],
        ['Reserved', e.reserved],
        ['Footprint', `${e.w} × ${e.d} m`],
        ['Mass', `${((MATERIALS[e.item as Item].mass * e.qty) / 1000).toFixed(2)} t`],
        ['Source', esc(e.source)],
        ...(e.item === 'diesel'
          ? [['Contents', `${e.liters?.toFixed(1)} / 200 L`] as [string, unknown]]
          : []),
      ]) +
      `<p class="note">This is physical stock. Hauling removes material from this location before it is installed.</p>${btn('tab:materials', 'Material register')}`;
  }
  if (selection.type === 'job') {
    const j = e as Job;
    body =
      details([
        ['State', badge(j.status, j.status === 'done' ? 'green' : '')],
        ['Step', esc(j.phase)],
        ['Progress', `${Math.round(j.progress * 100)}%`],
        [
          'Worker',
          esc(
            j.worker
              ? `${state.workers.find((w) => w.id === j.worker)?.name || 'Worker'} · ${j.worker}`
              : 'Unassigned',
          ),
        ],
        ['Equipment', esc(j.equipment || automaticEquipmentForWork(state, j) || 'Unassigned')],
        ['Assign equipment', assignmentControl(j.id)],
        ['Parent work', esc(j.parentId || 'Standalone job')],
        ['Operator', esc(j.operator || 'Unassigned')],
        ['Reserved stock', esc(j.stack || 'None')],
        ['Material', j.item ? `${j.qty} × ${label(j.item)}` : 'Service'],
        ...(j.shedAssembly
          ? ([
              ['Shed assembly', esc(j.shedAssembly.phase)],
              [
                'Installed parts',
                `${j.shedAssembly.anchors}/6 anchors · ${j.shedAssembly.posts}/6 posts · ${j.shedAssembly.beams}/3 beams`,
              ],
              [
                'Enclosure',
                `${j.shedAssembly.roofSheets}/4 roof sheets · ${j.shedAssembly.wallPanels}/2 wall panels · ${j.shedAssembly.braces}/1 braces`,
              ],
              [
                'Current part',
                j.shedAssembly.part
                  ? `${label(j.shedAssembly.part.kind)} #${j.shedAssembly.part.index + 1}`
                  : 'None',
              ],
            ] as [string, unknown][])
          : []),
        ['Footprint', `${j.w} × ${j.d} m`],
      ]) +
      (j.reason ? `<div class="blocked">${esc(j.reason)}</div>` : '') +
      `<div class="button-stack">${controlled && j.status === 'todo' ? btn(`assign:${j.id}`, 'Work with controlled worker', 'primary') : ''}${j.status === 'todo' ? btn(`priority:${j.id}`, 'Move to front of queue') : ''}${['todo', 'doing'].includes(j.status) ? btn(`cancel:${j.id}`, 'Cancel plan', 'danger') : ''}${btn('buy-missing', 'Order missing materials')}</div>`;
  }
  if (selection.type === 'jobGroup') {
    const row = jobRows(state).find((r) => r.id === e.id)!;
    body =
      details([
        ['State', badge(row.status)],
        ['Progress', `${Math.round(row.progress * 100)}%`],
        ['Parent', esc(e.parentId || 'Top-level work order')],
        ['Assign equipment', assignmentControl(e.id)],
        ['Automatic machine', esc(automaticEquipmentForWork(state, e) || 'Not selected yet')],
        ['Worker', esc(row.worker || 'See tasks')],
        ['Operator', esc(row.operator || 'See tasks')],
        ['Working equipment', esc(row.equipment || 'See tasks')],
        ['Next requirement', esc(row.reason)],
      ]) +
      `<div class="button-stack">${btn('tab:jobs', 'Work register')}${row.status === 'todo' || row.status === 'doing' ? btn(`priority-group:${e.id}`, 'Prioritize remaining tasks') : ''}</div><h3>Individual tasks</h3>${workLeaves(
        state,
        e.id,
      )
        .slice(0, 60)
        .map(
          (j) =>
            `<p class="note">${reference(j.id)} · ${esc(label(j.kind))} · ${esc(j.status)} · ${reference(j.reason || j.phase)}</p>`,
        )
        .join('')}`;
  }
  if (selection.type === 'building') {
    body =
      details([
        ['Footprint', `${e.w || 5} × ${e.d || 3} m`],
        ['Grid position', `${e.x}, ${e.z}`],
        [
          'Connection',
          e.connected === false ? badge('Needs utility service', 'amber') : badge('Ready', 'green'),
        ],
      ]) +
      `<div class="button-stack">${e.kind === 'sanitary' && !state.utilities.water ? btn('purchase:water', 'Order water connection', 'primary') : ''}${e.kind === 'lamp' && !state.utilities.power ? btn('purchase:power', 'Order electricity connection', 'primary') : ''}${e.kind in MATERIALS ? btn(`remove:${e.id}`, 'Dismantle and recover kit', 'danger') : ''}</div><p class="note">${e.kind === 'shed' ? 'Shelters equipment. Its open sides remain accessible.' : e.kind === 'office' ? 'A physical site office. Staffing and welfare policies arrive in a later version.' : e.kind === 'sanitary' ? 'Requires the site water and sewer service to operate.' : 'Stable asset ID retained in the site register.'}</p>`;
  }
  if (selection.type === 'order') {
    body =
      details([
        ['Material / service', esc(orderDescription(e))],
        ['Ordered', e.qty],
        ['Received', e.arrived],
        ['Cargo weight', orderMass(e) ? massLabel(orderMass(e)) : 'Passengers / service'],
        ...orderLines(e).map((l): [string, unknown] => [
          label(l.item),
          `${l.arrived} / ${l.qty} received${itemMass(l.item) ? ' · ' + massLabel(itemMass(l.item) * l.qty) : ''}`,
        ]),
        ['Status', badge(e.status)],
        ['Transport', e.mode],
        [
          'Carrier',
          e.carrierDeparted || e.status === 'done'
            ? 'Left the yard'
            : e.status === 'departing'
              ? 'Departing; site handling can continue'
              : e.status,
        ],
        [
          'Machine',
          esc(
            e.unload?.equipmentId || e.automaticEquipment || e.equipmentId || 'Awaiting assignment',
          ),
        ],
        ['Operator', esc(e.unload?.operatorId || e.operatorId || 'Unassigned')],
        ['Rigger', esc(e.unload?.riggerId || 'None')],
        ['Operation', esc(e.unload?.phase || e.deployment || e.status)],
        ['Total', money(e.total)],
      ]) +
      `<div class="blocked">${esc(e.note)}</div><div class="button-stack">${controlled && e.status === 'unloading' && !e.unload && (!e.deployment || e.deployment === 'waiting') ? btn(`unload:${e.id}`, 'Unload with controlled operator', 'primary') : ''}${e.unload?.equipmentId || e.equipmentId ? btn(`locate:equipment:${e.unload?.equipmentId || e.equipmentId}`, 'Locate handling machine') : ''}${btn('tab:deliveries', 'Delivery register')}</div>`;
  }
  if (selection.type === 'zone') {
    body =
      details([
        ['Footprint', `${e.w} × ${e.d} m`],
        ['Position', `${e.x}, ${e.z}`],
      ]) +
      `<p class="note">A planning designation. Remove it when empty to build in this area.</p>${btn('remove-zone:' + e.id, 'Remove empty designation')}`;
  }
  if (selection.type === 'buffer') {
    title = 'Siding buffer';
    body =
      details([
        ['Asset ID', 'BUFFER-001'],
        ['Position', `${e.x.toFixed(1)}, ${e.z.toFixed(1)}`],
      ]) +
      '<p class="note">Extend the siding from its current end. The crew moves this same buffer after installing the next panel.</p>';
  }
  const markup = linkCells(
    `<div class="panel-head"><span>${esc(selection.id)}</span>${btn('deselect', '×', '', 'aria-label="Close inspector"')}</div><h2>${esc(title)}</h2>${body}`,
  );
  stableHTML(panel, markup, force);
}
function reference(text: unknown) {
  const safe = esc(text);
  return safe.replace(
    /\b(?:WRK|EQ|STK|BLD|RAIL|JOB|WORK|PO|ZONE|EV|COST|MV|N|BUFFER)-\d+\b/g,
    (id) => btn(`entity:${id}`, id, 'text-link entity-link'),
  );
}
function linkCells(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest('button,select,input,textarea,a,code')) continue;
    const content = node.textContent || '';
    if (!/\b(?:WRK|EQ|STK|BLD|RAIL|JOB|WORK|PO|ZONE|EV|COST|MV|N|BUFFER)-\d+\b/.test(content))
      continue;
    const replacement = document.createElement('template');
    replacement.innerHTML = reference(content);
    node.replaceWith(replacement.content);
  }
  return template.innerHTML;
}
const visible = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content
    .querySelectorAll('select')
    .forEach((el) =>
      el.replaceWith(document.createTextNode(el.selectedOptions[0]?.textContent || '')),
    );
  return t.content.textContent || '';
};
function table(headers: string[], rows: string[][], empty = 'No records yet.') {
  const key = tableKey(tab, headers),
    sort = registerSort.get(key),
    filters = registerFilters.get(key);
  let filtered = rows.filter(
    (row) =>
      !filters ||
      [...filters].every(([i, value]) =>
        visible(row[i] || '')
          .toLowerCase()
          .includes(value.toLowerCase()),
      ),
  );
  if (tab === 'jobs') {
    const data = new Map(jobRows(state).map((r) => [r.id, r]));
    const wrappers = filtered.map((row) => ({
      ...data.get(visible(row[0])),
      id: visible(row[0]),
      row,
    }));
    filtered = sortWorkRows(
      wrappers,
      sort
        ? (a, b) =>
            sort.direction *
            compareValues(visible(a.row[sort.column] || ''), visible(b.row[sort.column] || ''))
        : undefined,
    ).map((r) => r.row);
  } else if (sort)
    filtered.sort(
      (a, b) =>
        sort.direction *
        compareValues(visible(a[sort.column] || ''), visible(b[sort.column] || '')),
    );
  const page = Math.min(
    registerPages.get(key) || 0,
    Math.max(0, Math.ceil(filtered.length / 250) - 1),
  );
  const shown = filtered.slice(page * 250, (page + 1) * 250);
  return `<div class="table-wrap"><table data-register="${key}"><thead><tr>${headers.map((h, i) => `<th aria-sort="${sort?.column === i ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none'}">${h ? btn(`sort:${key}:${i}`, `${h}<span class="sort-arrow">${sort?.column === i ? (sort.direction === 1 ? '▴' : '▾') : '↕'}</span>`, 'sort-header') : ''}</th>`).join('')}</tr>${showColumnFilters ? `<tr class="column-filters">${headers.map((h, i) => `<th>${h ? `<input type="search" data-column-filter="${key}" data-column="${i}" aria-label="Filter ${esc(visible(h))}" value="${esc(filters?.get(i) || '')}">` : ''}</th>`).join('')}</tr>` : ''}</thead><tbody>${shown.length ? shown.map((r) => `<tr>${r.map((v) => `<td>${linkCells(v)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>${filtered.length > 250 ? `<div class="register-pager">${btn(`register-page:${key}:${page - 1}`, '← Previous', 'small', page === 0 ? 'disabled' : '')}<span>${page * 250 + 1}–${Math.min((page + 1) * 250, filtered.length)} of ${filtered.length} records</span>${btn(`register-page:${key}:${page + 1}`, 'Next →', 'small', (page + 1) * 250 >= filtered.length ? 'disabled' : '')}</div>` : ''}`;
}
const loc = (type: string, id: string) =>
  btn(`locate:${type}:${id}`, '↗', 'icon-button', 'title="Locate in yard"');
function renderRecords(force = false) {
  if (tab === 'site') return;
  if (
    !force &&
    ($('#records').querySelector('details.equipment-role[open]') ||
      ($('#records').contains(document.activeElement) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement!.tagName)))
  )
    return;
  const title = tabs.find((t) => t[0] === tab)?.[1] || 'Inbox';
  let body = '',
    subtitle = '',
    actions = btn('shop', '+ Purchase', 'primary');
  const matches = (o: any) =>
    !search || JSON.stringify(o).toLowerCase().includes(search.toLowerCase());
  if (tab === 'materials') {
    subtitle = 'Physical stock, reservations, in-transit cargo, and installation totals.';
    body =
      `<div class="summary-strip"><span><b>${state.stacks.filter((s) => s.qty > 0).length}</b> stock locations</span><span><b>${state.zones.length}</b> designated yards</span><span><b>${state.stacks
        .filter((t) => t.item === 'diesel')
        .reduce((n, t) => n + (t.liters || 0), 0)
        .toFixed(0)} L</b> stored diesel</span></div>` +
      table(
        [
          'Material',
          'Delivered',
          'Recovered opening assets',
          'Stored',
          'Reserved',
          'Free',
          'In equipment',
          'Assembly',
          'Installed',
          'Incoming',
          'Unit',
        ],
        Object.keys(MATERIALS)
          .filter((i) => matches(label(i)))
          .map((item) => {
            const t = Sim.totals(state, item as Item);
            return [
              esc(label(item)),
              `${t.delivered}`,
              `${t.recovered}`,
              `${t.stored}`,
              `${t.reserved}`,
              `${t.stored - t.reserved}`,
              `${t.cargo}`,
              `${t.inConstruction}`,
              `${t.installed}`,
              `${t.incoming}`,
              MATERIALS[item as Item].unit,
            ];
          }),
      ) +
      `<h3>Storage zones</h3>` +
      table(
        ['Zone', 'Position', 'Area', ''],
        state.zones
          .filter(matches)
          .map((z) => [
            esc(z.name),
            `${z.x}, ${z.z}`,
            `${z.w} × ${z.d} m`,
            loc('zone', z.id) + btn('remove-zone:' + z.id, 'Remove if empty', 'small'),
          ]),
      ) +
      `<h3>Physical storage</h3>` +
      table(
        ['ID', 'Material', 'Quantity', 'Reserved', 'Position', 'Footprint', 'Source', ''],
        state.stacks
          .filter((t) => (t.qty > 0 || t.item === 'diesel') && matches(t))
          .map((t) => [
            esc(t.id),
            label(t.item),
            t.item === 'diesel' ? `${t.liters?.toFixed(1)} L` : `${t.qty}`,
            `${t.reserved}`,
            `${t.x}, ${t.z}`,
            `${t.w} × ${t.d} m`,
            esc(t.source),
            loc('stack', t.id),
          ]),
      );
  }
  if (tab === 'workers') {
    subtitle = 'Hire workers, take direct control, or release them to automatic assignments.';
    body = table(
      [
        'ID',
        'Name',
        'Role',
        'Duty',
        'Shift',
        'Action',
        'Vehicle',
        'Assignment',
        'Hours',
        'Rate / h',
        '',
      ],
      state.workers
        .filter(matches)
        .map((w) => [
          w.id,
          esc(w.name),
          label(w.role),
          badge(w.duty),
          scheduleControl(w),
          esc(w.shiftPhase ? `${w.shiftPhase} · ${w.status}` : w.status),
          esc(w.vehicle || '—'),
          esc(w.commuteOrder || w.deliveryOrder || w.transportOrder || w.job || '—'),
          w.hours.toFixed(1),
          money(w.wage),
          loc('worker', w.id) +
            btn(
              `control:${w.id}`,
              'Control',
              'small',
              w.job ||
                w.deliveryOrder ||
                w.transportOrder ||
                w.transition ||
                !workerAvailable(state, w)
                ? 'disabled'
                : '',
            ),
        ]),
    );
  }
  if (tab === 'equipment') {
    subtitle =
      'Set Automatic work to dedicate machines. Each working machine needs an operator; current work finishes safely before switching roles.';
    body =
      table(
        [
          'ID',
          'Equipment',
          'Automatic work',
          'Fuel',
          'Consumed',
          'Operator',
          'Assignment',
          'Cargo',
          'Parking',
          '',
        ],
        state.equipment
          .filter(matches)
          .map((e) => [
            e.id,
            label(e.kind),
            equipmentRoleControl(e),
            `${e.fuel.toFixed(1)} / ${e.tank} L`,
            `${e.used.toFixed(2)} L`,
            esc(
              e.operator
                ? `${state.workers.find((w) => w.id === e.operator)?.name || 'Worker'} · ${e.operator}`
                : '—',
            ),
            esc(
              e.blockedBy
                ? `Waiting for ${e.blockedBy}`
                : e.transportOrder
                  ? `On lowloader · ${e.transportOrder}`
                  : e.deliveryOrder || e.job || 'Available',
            ),
            e.cargo ? `${e.cargo.qty} × ${label(e.cargo.item)}` : 'Empty',
            esc(parkingStatus(state, e)) +
              (e.parking
                ? `<small class="role-pending">E${e.parking.x}, S${e.parking.z}</small>`
                : ''),
            loc('equipment', e.id) + btn(`refuel:${e.id}`, 'Refuel', 'small'),
          ]),
      ) +
      `<h3>Structures and utilities</h3>` +
      table(
        ['Asset', 'Name', 'Type', 'Position', 'Footprint', 'Status', ''],
        state.buildings
          .filter(matches)
          .map((b) => [
            b.id,
            esc(b.name),
            label(b.kind),
            `${b.x}, ${b.z}`,
            `${b.w} × ${b.d} m`,
            badge(b.connected ? 'Ready' : 'Needs utility', b.connected ? 'green' : 'amber'),
            loc('building', b.id),
          ]),
      );
  }
  if (tab === 'equipment') {
    body +=
      '<h3>Rail assets</h3>' +
      table(
        ['Asset', 'Type', 'Position', 'Length', 'Direction', ''],
        state.rails
          .filter(matches)
          .map((r) => [
            r.id,
            'Rail panel',
            `${r.x}, ${r.z}`,
            `${r.length} m`,
            r.rotation % 2 ? 'North–south' : 'East–west',
            loc('building', r.id),
          ]),
      ) +
      `<p class="note">${reference('BUFFER-001')} · siding buffer · E${state.buffer.x}, S${state.buffer.z}</p>`;
  }
  if (tab === 'deliveries') {
    subtitle =
      'Freight waits for your machine and operator. Separate berths receive people, machines, materials, and utility crews.';
    body = table(
      [
        'Order',
        'Item / service',
        'Qty',
        'Received',
        'Weight',
        'Mode',
        'ETA / arrival',
        'Status',
        'Receiving note',
        'Total',
        '',
      ],
      state.orders
        .filter(matches)
        .slice()
        .reverse()
        .map((o) => [
          o.id,
          orderDescription(o),
          `${o.qty}`,
          `${o.arrived}`,
          orderMass(o) ? massLabel(orderMass(o)) : '—',
          o.mode,
          `D${day(o.eta)} ${clock(o.eta)}`,
          badge(o.status, o.status === 'done' ? 'green' : ''),
          esc(o.note),
          money(o.total),
          loc('order', o.id),
        ]),
    );
  }
  if (tab === 'jobs') {
    subtitle =
      'Assign a machine to a whole work order, a foundation, or one task. Explicit assignments override automatic roles after current work finishes safely.';
    actions = btn('buy-missing', 'Buy missing materials') + actions;
    const counts = ['todo', 'doing', 'done'].map((k) => [
      k,
      state.jobs.filter((j) => j.status === k).length,
    ]);
    const allRows = jobRows(state),
      parents = new Map(allRows.map((r) => [r.id, r.parentId]));
    const showing = (row: (typeof allRows)[number]) => {
      const valid =
        recordFilter === 'all' ||
        (recordFilter === 'active' && ['todo', 'doing'].includes(row.status)) ||
        row.status === recordFilter;
      if (!valid || !matches(row)) return false;
      if (search) return true;
      let parent = row.parentId;
      while (parent) {
        if (!expandedWork.has(parent)) return false;
        parent = parents.get(parent);
      }
      return true;
    };
    body =
      `<div class="filter-strip">${[['active', 'Active work'], ['all', 'All work'], ...counts.map(([k, n]) => [k, `${k} (${n})`]), ['canceled', 'Canceled']].map(([k, n]) => btn(`filter:${k}`, String(n), recordFilter === k ? 'active' : '')).join('')}${btn('expand-work', 'Expand all', 'small')}${btn('collapse-work', 'Collapse all', 'small')}</div>` +
      table(
        [
          'Work ID',
          'Work / task',
          'State',
          'Progress',
          'Worker',
          'Operator',
          'Working equipment',
          'Assign equipment',
          'Blocking / next requirement',
          '',
        ],
        allRows
          .filter(showing)
          .map((r) => [
            r.id,
            `<span class="work-depth" style="--depth:${search ? 0 : r.depth}">${r.group ? btn(`toggle-work:${r.id}`, expandedWork.has(r.id) ? '▾' : '▸', 'icon-button', `aria-label="${expandedWork.has(r.id) ? 'Collapse' : 'Expand'} ${esc(r.label)}"`) : '·'}${esc(r.label)}</span>`,
            badge(r.status, r.status === 'done' ? 'green' : ''),
            `${Math.round(r.progress * 100)}%`,
            esc(r.worker || '—'),
            esc(r.operator || '—'),
            esc(r.equipment || '—'),
            assignmentControl(r.id),
            esc(r.reason || '—'),
            loc(r.group ? 'jobGroup' : 'job', r.id) +
              (!r.group && ['todo', 'doing'].includes(r.status)
                ? btn(`cancel:${r.id}`, '×', 'icon-button', 'title="Cancel plan"')
                : ''),
          ]),
        'No matching work. Choose All work to see completed orders.',
      );
  }
  if (tab === 'activity') {
    actions = btn('export-diagnostics', 'Export diagnostic history', 'primary');
    subtitle = `Orders, receipts, construction, handling, and fuel. Rolling diagnostics: ${recorder.entries.length.toLocaleString()} records · ${(recorder.size / 1000000).toFixed(1)} MB · ${diagnosticPersistence}.`;
    body =
      table(
        ['Time', 'Type', 'Entity', 'Event'],
        state.events
          .filter(matches)
          .slice()
          .reverse()
          .map((e) => [
            `D${day(e.time)} ${clock(e.time)}`,
            badge(e.type),
            btn(`entity:${e.entity}`, esc(e.entity || 'SITE'), 'text-link'),
            esc(e.text),
          ]),
      ) +
      `<h3>Material movements</h3>` +
      table(
        ['Time', 'Material', 'Qty', 'From', 'To', 'Reason'],
        state.movements
          .filter(matches)
          .slice()
          .reverse()
          .map((m) => [
            `D${day(m.time)} ${clock(m.time)}`,
            label(m.item),
            `${m.qty}`,
            m.from,
            m.to,
            m.reason,
          ]),
      );
  }
  if (tab === 'costs') {
    const actual = state.costs.reduce((n, c) => n + c.amount, 0),
      committed = state.orders.filter((o) => !o.invoiced).reduce((n, o) => n + o.total, 0);
    subtitle =
      'No spending limit. Purchases are recorded once on arrival; labor accrues every 15 game minutes.';
    body =
      `<div class="summary-strip"><span><b>${money(actual)}</b> recorded actual</span><span><b>${money(committed)}</b> outstanding commitments</span><span><b>${money(state.workers.reduce((n, w) => n + w.wage, 0))}</b> hourly crew cost</span><span class="unlimited">∞ No budget limit</span></div>` +
      table(
        ['Time', 'Category', 'Entity', 'Description', 'Amount'],
        state.costs
          .filter(matches)
          .slice()
          .reverse()
          .map((c) => [
            `D${day(c.time)} ${clock(c.time)}`,
            c.category,
            esc(c.entity),
            esc(c.description),
            money(c.amount),
          ]),
      );
    actions = btn('export-costs', 'Export CSV');
  }
  if (tab === 'notices') {
    subtitle =
      'Keep operational notices in To do, Doing, or Done. Dismissing a popup never completes a notice.';
    actions = btn('read-all', 'Mark all seen');
    body = `<div class="notice-board">${(['todo', 'doing', 'done'] as const)
      .map(
        (stage) =>
          `<section><h3>${{ todo: 'To do', doing: 'Doing', done: 'Done' }[stage]} <span>${state.notices.filter((n) => n.state === stage).length}</span></h3>${
            state.notices
              .filter((n) => n.state === stage && matches(n))
              .map(
                (n) =>
                  `<article class="notice-card"><div><span>D${day(n.time)} ${clock(n.time)}</span>${!n.seen ? badge('New', 'amber') : ''}</div><h4>${esc(n.title)}</h4><p>${esc(n.detail)}</p><footer>${btn(`entity:${n.entity}`, 'Locate', 'text-link')}<select data-notice="${n.id}" aria-label="Notice status"><option value="todo" ${stage === 'todo' ? 'selected' : ''}>To do</option><option value="doing" ${stage === 'doing' ? 'selected' : ''}>Doing</option><option value="done" ${stage === 'done' ? 'selected' : ''}>Done</option></select></footer></article>`,
              )
              .join('') || '<p class="empty">Nothing here.</p>'
          }</section>`,
      )
      .join('')}</div>`;
  }
  if (tab === 'reports') {
    if (!force && document.querySelector('#sql')) return;
    subtitle = 'A fresh SQLite snapshot of this yard. Queries cannot change the live simulation.';
    body = `<div class="sql-layout"><div><div class="sql-examples">${SQL_EXAMPLES.map((e, i) => btn(`sql-example:${i}`, e.name, 'small')).join('')}</div><textarea id="sql" spellcheck="false" aria-label="SQL query">${esc(SQL_EXAMPLES[0].sql)}</textarea><div class="sql-run">${btn('sql-run', 'Run query', 'primary')}<span id="sql-status">Ready · snapshot created when you run</span></div><div id="sql-results"></div></div><aside><h3>Tables</h3><p>inventory<br>workers<br>equipment<br>jobs<br>job_groups<br>work_orders<br>orders<br>stacks<br>buildings<br>rails<br>zones<br>movements<br>costs<br>events</p><p class="note">Time is seconds since day 1 midnight. Positions use meters. Inventory counts exclude demo infrastructure supplied as opening assets.</p><p class="note">SELECT, WITH, and EXPLAIN are accepted. Run <code>SELECT * FROM jobs LIMIT 5</code> to inspect a table.</p></aside></div>`;
    actions = '';
  }
  stableHTML(
    $('#records'),
    `<div class="records-head"><div><span class="eyebrow">SITE REGISTER / ${esc(state.name.toUpperCase())}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="record-actions">${actions}</div></div>${tab !== 'reports' ? `<div class="search-row"><label>Filter <input id="search" type="search" placeholder="Type to filter records…" value="${esc(search)}"></label>${btn('column-filters', showColumnFilters ? 'Hide column filters' : 'Column filters', 'small')}<span>Live records · D${day(state.time)} ${clock(state.time)}</span></div>` : ''}${body}`,
    force,
  );
}
function renderGuide() {
  const el = $('#guide');
  if (!state.guide) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const none = state.workers.length === 0 && state.orders.length === 0;
  el.innerHTML = `<div class="guide-top"><span>FIELD NOTES</span>${btn('dismiss-guide', '×', '', 'aria-label="Dismiss field notes"')}</div><b>${none ? 'Start with a delivery' : 'Make this yard your own'}</b><p>${none ? 'Choose Stockyard and drag a storage area. Then order a crew, a machine, and materials. The starter order is an optional shortcut.' : 'Designate a Stockyard before materials arrive. Place construction plans; your crew will haul stock and install it. Use Buy missing for supplies.'}</p><div>${none ? btn('starter-order', 'Order starter supplies', 'primary') : btn('tab:jobs', 'Inspect work queue')}${btn('help', 'Controls')}</div><p class="guide-foot">Optional notes. No required sequence.</p>`;
}
function openModal(which: string) {
  modal = which;
  const root = $('#modal-root');
  let content = '';
  if (which === 'start') {
    content = `<div class="start-title"><span class="eyebrow">A PHYSICAL FACTORY SANDBOX</span><h1>Every piece<br>has a place.</h1><p>Start with an open yard and a rail connection.<br>Bring people and materials. Build what comes next.</p></div><div class="start-choices">${btn('new:starter', '<b>Start a new yard</b><span>Empty ground, with a starter supply order on its way.</span>', 'start-choice recommended')}${btn('new:empty', '<b>Start completely empty</b><span>Choose every worker, machine, and material yourself.</span>', 'start-choice')}${btn('new:demo', '<b>Explore Birch Junction</b><span>A small working base, stocked and ready to expand.</span>', 'start-choice')}</div><p class="note">No budget limit · construction and logistics · local saves · version 0.11</p>`;
  }
  if (which === 'menu') {
    content = `<h1>${esc(state.name)}</h1><p class="subtitle">Starter Yard · version 0.11.0</p><div class="menu-grid">${btn('save', 'Save to browser', 'primary')}${btn('export-save', 'Export save file')}${btn('export-diagnostics', 'Export diagnostic history')}${btn('source-code', 'Source code · MIT')}${btn('import-save', 'Import save file')}${btn('restore-backup', 'Restore previous yard')}${btn('help', 'Controls and guide')}${btn('new-confirm', 'Start a new yard')}${btn('close-modal', 'Return to yard')}</div><p class="note">Autosaves every 20 seconds. Export a file for a portable backup. Your game stays on this computer.</p>`;
  }
  if (which === 'new-confirm') {
    content = `<h1>Start another yard</h1><p>Your current yard will be saved as a browser backup before the new yard is created.</p><div class="button-stack">${btn('new:starter', 'New yard + starter supplies', 'primary')}${btn('new:empty', 'Completely empty yard')}${btn('new:demo', 'Birch Junction example')}${btn('close-modal', 'Keep current yard')}</div>`;
  }
  if (which === 'help') {
    content = `<span class="eyebrow">FIELD GUIDE</span><h1>Build a working starter yard</h1><div class="help-grid"><section><h3>Getting started</h3><p>Use <b>Purchase</b> to hire a builder and an operator, buy an excavator, and order slabs. The <b>starter order</b> includes a useful first set.</p><p>An empty yard has no storage assigned. Choose <b>Stockyard</b> and drag an area before deliveries arrive. Your operator drives purchased equipment down the lowloader ramps, then uses it to unload freight. Slabs stack up to 12 high in neighboring 1 m² cells. Keep the loading face and travel aisles accessible.</p><p><b>Drag with Pave</b> to lay out an area. Click Office, WC, Shed, or Stores to place a plan. Required foundations are added automatically. <b>Buy missing</b> orders supplies for your plans. <b>Recover</b> dismantles buildings, lifts player-built rail, or recovers a paving slab and hauls it back to storage.</p><p>For the existing siding, choose <b>Rail end</b>, then Rail. Start at E125, S5. Each panel extends 5 m. The crew stages the panel beside the track, releases and lifts the buffer aside, lays and fastens the panel, then reinstalls the same buffer. Leave clear space beside the extension for these lifts.</p><h3>Direct control</h3><p>Select a worker and click <b>Take direct control</b>. Click clear ground to walk. With an operator controlled, select equipment and click <b>Board</b>. Then click to drive. Select a waiting delivery and choose <b>Unload with controlled operator</b> to give that operator the handling assignment.</p><p>Select a queued construction plan and click <b>Work with controlled worker</b>. A builder and operator perform the same physical handling sequence used in automatic mode. <b>Return to automatic</b> releases control.</p></section><section><h3>Controls</h3>${details(
      [
        ['Pan', 'Left drag empty ground / W A S D relative to view'],
        ['Orbit', 'Right mouse drag'],
        ['Zoom', 'Mouse wheel'],
        ['Rotate placement', 'R'],
        ['Cancel tool / close', 'Esc'],
        ['Pause', 'Space'],
        ['Speed', '1 / 2 / 3 → 1× / 3× / 10×'],
        ['Grid', 'G'],
        ['Yard camera', 'H'],
        ['Follow worker', 'F'],
        ['Purchase', 'B'],
        ['Save', 'Ctrl / Cmd + S'],
      ],
    )}<h3>Physical constraints</h3><p>Leave <b>3 m clear aisles</b> for machines. Offices need the 6 t excavator; the forklift cannot lift them. Diesel drums contain 200 L and stay in place when empty. Request refueling from Equipment.</p><p>The <b>Work</b> register explains blocked assignments. Canceling rail work first places its load safely and secures the buffer. A rail panel already installed stays in place. Other loaded jobs deposit their kits at the site. Finished buildings can be dismantled and recovered.</p><h3>Vehicle work roles</h3><p>Open <b>Equipment</b> and change a machine’s <b>Automatic work</b> selector, or select it in the yard. For parallel receiving and paving, check only <b>Receiving deliveries</b> for the forklift and only <b>Paving</b> for the excavator, with an operator for each. The dropdown lets you check several job kinds together. Automatic dispatch keeps one machine on each work order or delivery across its individual tasks and lifts. Separate work orders can run in parallel. Changes finish the current job or unloading batch before switching. <b>All</b> restores shared assignments; <b>None</b> holds new work while leaving driving and refueling available.</p><h3>Work orders, parking, and shifts</h3><p><b>Work</b> starts with active orders. Expand a building or paving order; assign equipment to a parent or child. Explicit assignments override automatic roles after current work finishes. Click asset IDs to inspect assigned people, stock, or equipment. Click table headers to sort; use Column filters to narrow records.</p><p>Select equipment to choose a parking bay in the yard or enter its coordinates. Workers have Always on, daily, overnight, and custom schedules. They finish current work, park, exit, walk to the actual bus, and return next shift. Chartered trips appear in Costs.</p><p>Use <b>Activity → Export diagnostic history</b> after a problem. The local rolling record includes positions, routes, blockers, phases, and recent full yard checkpoints.</p><h3>Traffic</h3><p>Road traffic keeps right. Buses continue forward after their stop; delivery trucks back clear of their berth before departing forward. Machines yield to people and route around obstructions. Keep receiving and turning areas clear; the equipment inspector identifies any actor blocking a route.</p><h3>First-version boundaries</h3><p>A 232 × 98 m buildable yard, straight rail panels, owned-equipment freight handling and simplified utility services. No chemical production, seasons, maintenance failures, full rail dispatch yet.</p></section></div>`;
  }
  if (which === 'shop') {
    content = `<div class="shop-head"><div><span class="eyebrow">PROCUREMENT</span><h1>People, machines & materials</h1><p>Order freely. Costs are recorded; there is no spending limit.</p></div>${btn('starter-order', 'Order starter supplies')}</div><div class="shop-options"><label>Material transport <select id="transport"><option value="road" ${purchaseTransport === 'road' ? 'selected' : ''}>Truck · 12 t loads</option><option value="rail" ${purchaseTransport === 'rail' ? 'selected' : ''}>Rail · 48 t loads</option></select></label><span>Your equipment unloads · $90 / road load · $240 / rail load</span></div><div id="purchase-cart" class="purchase-cart"></div><div class="catalog-head"><span>Item</span><span>Unit cost</span><span>Unit weight</span><span>Qty</span><span>Line weight</span><span>Order / batch</span></div>${[
      ['Crew', ROLES],
      ['Equipment', EQUIPMENT],
      ['Materials', MATERIALS],
      ['Utility services', SERVICES],
    ]
      .map(
        ([name, items]) =>
          `<h3>${name}</h3><div class="catalog">${Object.entries(items)
            .map(
              ([k, v]: [string, any]) =>
                `<div class="catalog-row"><div><b>${esc(v.name)}</b><small>${esc(v.description)}</small></div><span class="price">${money(v.price)}</span><span class="catalog-mass">${v.mass ? massLabel(v.mass) : k in ROLES ? 'Passenger' : 'Service'}</span><input type="number" id="qty-${k}" data-catalog-item="${k}" min="1" max="1000" value="${k === 'slab' ? 24 : k === 'rail' ? 4 : 1}" aria-label="Quantity of ${esc(v.name)}"><span class="catalog-mass" id="mass-${k}">${v.mass ? massLabel(v.mass * (k === 'slab' ? 24 : k === 'rail' ? 4 : 1)) : '—'}</span><div class="catalog-actions">${btn(`purchase:${k}`, k in ROLES ? 'Hire' : 'Order', 'small')}${btn(`cart-add:${k}`, 'Add', 'small', 'aria-label="Add ' + esc(v.name) + ' to batch"')}</div></div>`,
            )
            .join('')}</div>`,
      )
      .join('')}`;
  }
  if (which === 'help')
    content +=
      '<p class="note"><a href="/manual.html" target="_blank" rel="noopener">Open the complete illustrated player guide →</a></p>';
  root.innerHTML = `<div class="modal-shade"><section class="modal ${which === 'start' ? 'welcome' : ''} ${which === 'shop' ? 'shop' : ''} ${which === 'help' ? 'help' : ''}" role="dialog" aria-modal="true" aria-label="${which}">${which !== 'start' ? btn('close-modal', '×', 'modal-close', 'aria-label="Close dialog"') : ''}${content}</section></div>`;
  if (which === 'shop') renderCart();
}
function closeModal() {
  modal = '';
  $('#modal-root').innerHTML = '';
}
function start(kind: string) {
  if (state.elapsed > 0 || state.orders.length) {
    try {
      localStorage.setItem('plant01-backup-v1', Sim.save(state));
    } catch {}
  }
  state = kind === 'demo' ? Sim.demoState() : Sim.createState();
  accumulator = 0;
  lastTime = performance.now();
  purchaseCart.clear();
  if (kind === 'starter') Sim.starterOrder(state);
  world.revision = -1;
  selection = undefined;
  controlled = undefined;
  tab = 'site';
  setTool('select');
  closeModal();
  world.focus({ x: 28, z: 25 }, 1.7);
  renderTabs();
  renderGuide();
  renderInspector();
  uiTick();
  persist(true);
  toast(
    kind === 'demo' ? 'Birch Junction is ready to explore.' : 'Your yard is open. Plan freely.',
  );
}
async function action(value: string) {
  recorder.record(state, 'command', { action: value });
  const [a, b, c] = value.split(':');
  switch (a) {
    case 'tab':
      tab = b;
      search = '';
      recordFilter = b === 'jobs' ? 'active' : 'all';
      renderTabs();
      renderRecords(true);
      break;
    case 'register-page':
      registerPages.set(b, Number(c));
      renderRecords(true);
      break;
    case 'toggle-work':
      if (expandedWork.has(b)) expandedWork.delete(b);
      else expandedWork.add(b);
      renderRecords(true);
      break;
    case 'expand-work':
      for (const g of state.jobGroups || []) expandedWork.add(g.id);
      renderRecords(true);
      break;
    case 'collapse-work':
      expandedWork.clear();
      renderRecords(true);
      break;
    case 'priority-group': {
      const ids = new Set(
        workLeaves(state, b)
          .filter((j) => j.status === 'todo')
          .map((j) => j.id),
      );
      state.jobs.sort((x, y) => Number(ids.has(y.id)) - Number(ids.has(x.id)));
      toast('Remaining tasks moved to the front of the queue.');
      persist(true);
      break;
    }
    case 'parking-pick':
      parkingEquipment = b;
      rotation = state.equipment.find((e) => e.id === b)?.parking?.rotation || 0;
      setTool('parking');
      break;
    case 'parking-clear': {
      const error = clearEquipmentParking(state, b);
      toast(error || 'Parking bay cleared.', !!error);
      renderInspector(true);
      persist(true);
      break;
    }
    case 'parking-save': {
      const error = setEquipmentParking(
        state,
        b,
        Number($<HTMLInputElement>('#parking-x').value),
        Number($<HTMLInputElement>('#parking-z').value),
        Number($<HTMLSelectElement>('#parking-direction').value),
      );
      toast(error || 'Parking bay assigned.', !!error);
      renderInspector(true);
      persist(true);
      break;
    }
    case 'shift-save': {
      const error = setWorkerSchedule(
        state,
        b,
        Number($<HTMLInputElement>('#shift-start').value),
        Number($<HTMLInputElement>('#shift-end').value),
      );
      toast(error || 'Shift schedule set.', !!error);
      renderInspector(true);
      persist(true);
      break;
    }
    case 'tool':
      setTool(b);
      break;
    case 'rotate':
      rotation = (rotation + 1) % (tool === 'parking' ? 4 : 2);
      updatePreview();
      toast(`Placement ${rotation ? 'north–south' : 'east–west'}.`);
      break;
    case 'pause':
      state.paused = !state.paused;
      break;
    case 'speed':
      state.speed = Number(b);
      state.paused = false;
      break;
    case 'home':
      world.focus({ x: 28, z: 25 }, 1.7);
      break;
    case 'rail-end':
      world.focus({ x: state.buffer.x, z: 12 }, 1.6);
      setTool('rail');
      break;
    case 'overview':
      world.focus({ x: 100, z: 48 }, 0.5);
      setTool('select');
      break;
    case 'grid':
      world.grid.visible = !world.grid.visible;
      document
        .querySelector('[data-action="grid"]')
        ?.classList.toggle('active', world.grid.visible);
      break;
    case 'shop':
      openModal('shop');
      break;
    case 'source-code':
      window.open('https://github.com/lukacslacko/factory_game', '_blank', 'noopener,noreferrer');
      break;
    case 'menu':
      openModal('menu');
      break;
    case 'help':
      openModal('help');
      break;
    case 'new-confirm':
      openModal('new-confirm');
      break;
    case 'new':
      start(b);
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'starter-order':
      Sim.starterOrder(state);
      renderGuide();
      toast('Starter supplies ordered. Follow arrivals in Deliveries.');
      persist(true);
      break;
    case 'cart-add': {
      const qty = Number($<HTMLInputElement>(`#qty-${b}`)?.value || 1);
      if (!Number.isInteger(qty) || qty < 1 || qty + (purchaseCart.get(b) || 0) > 1000) {
        toast('Use a whole batch quantity between 1 and 1,000 per item.', true);
        break;
      }
      purchaseCart.set(b, (purchaseCart.get(b) || 0) + qty);
      renderCart();
      break;
    }
    case 'cart-remove':
      purchaseCart.delete(b);
      renderCart();
      break;
    case 'cart-clear':
      purchaseCart.clear();
      renderCart();
      break;
    case 'purchase-batch': {
      const lines = [...purchaseCart].map(([item, qty]) => ({ item, qty }));
      try {
        const ids = Sim.purchaseBatch(state, lines, purchaseTransport);
        recorder.record(state, 'purchase-batch', { lines, mode: purchaseTransport, orders: ids });
        purchaseCart.clear();
        renderCart();
        persist(true);
        toast(
          `Batch ordered · ${ids.length} physical delivery${ids.length === 1 ? '' : ' loads'}.`,
        );
      } catch (error) {
        toast((error as Error).message, true);
      }
      break;
    }
    case 'purchase': {
      const qty = Number($<HTMLInputElement>(`#qty-${b}`)?.value || 1);
      const mode = b in MATERIALS ? $<HTMLSelectElement>('#transport')?.value || 'road' : 'road';
      try {
        recorder.record(state, 'purchase', { item: b, qty, mode });
        const ids = Sim.purchase(state, b, qty, mode as any);
        toast(
          `${qty} × ${label(b)} ordered · ${ids.length} delivery load${ids.length === 1 ? '' : 's'}.`,
        );
        persist(true);
      } catch (e) {
        toast((e as Error).message, true);
      }
      break;
    }
    case 'buy-missing': {
      const n = Sim.buyMissing(state);
      toast(
        n
          ? `Ordered ${n} missing units for your construction plans.`
          : 'All planned materials are in stock, assigned, or already ordered.',
      );
      persist(true);
      break;
    }
    case 'dismiss-guide':
      state.guide = false;
      renderGuide();
      persist(true);
      break;
    case 'deselect':
      selection = undefined;
      renderInspector();
      break;
    case 'locate':
      locate(b, c);
      break;
    case 'entity':
      locateAny(b);
      break;
    case 'control': {
      const w = state.workers.find((w) => w.id === b);
      if (!w || w.job || !workerAvailable(state, w)) {
        toast('That worker has an active assignment or is off shift.', true);
        break;
      }
      if (controlled && controlled !== b) Sim.releaseWorker(state, controlled);
      controlled = b;
      w.duty = 'manual';
      tab = 'site';
      renderTabs();
      setTool('select');
      selection = { type: 'worker', id: b };
      world.focus(w, 1.6);
      renderInspector();
      renderHint();
      break;
    }
    case 'release':
      if (controlled) {
        const w = state.workers.find((w) => w.id === controlled);
        if (w?.job) {
          w.duty = 'auto';
        } else Sim.releaseWorker(state, controlled);
      }
      controlled = undefined;
      follow = false;
      renderHint();
      renderInspector();
      break;
    case 'enter':
      if (controlled) {
        const error = Sim.enterVehicle(state, controlled, b);
        toast(error || 'Boarding equipment.', !!error);
        renderHint();
      } else toast('Take control of an operator first.', true);
      break;
    case 'exit':
      Sim.exitVehicle(state, b);
      renderHint();
      break;
    case 'duty': {
      const w = state.workers.find((w) => w.id === b);
      if (w && !w.job && !w.deliveryOrder && !w.transportOrder && !w.transition) {
        if (w.vehicle) Sim.exitVehicle(state, w.id);
        w.duty = w.duty === 'rest' ? 'auto' : 'rest';
        if (controlled === b) controlled = undefined;
      }
      renderInspector();
      renderHint();
      break;
    }
    case 'remove-zone': {
      const error = Sim.removeZone(state, b);
      toast(error || 'Empty stockyard designation removed.', !!error);
      renderInspector();
      renderRecords(true);
      break;
    }
    case 'unload': {
      if (controlled) {
        const err = Sim.unloadDelivery(state, b, controlled);
        toast(err || 'Operator assigned to the delivery.', !!err);
        renderInspector();
      }
      break;
    }
    case 'refuel': {
      const err = Sim.refuel(state, b);
      toast(err || 'Refueling added to the work queue.', !!err);
      break;
    }
    case 'remove': {
      const err = Sim.removeBuilding(state, b);
      toast(err || 'Recovery added to the work queue.', !!err);
      break;
    }
    case 'assign': {
      const j = state.jobs.find((j) => j.id === b);
      if (j && controlled) {
        j.preferredWorker = controlled;
        const i = state.jobs.indexOf(j);
        state.jobs.splice(i, 1);
        state.jobs.unshift(j);
        toast(
          'Assignment prioritized for your controlled worker. Other required crew will assist.',
        );
      }
      break;
    }
    case 'priority': {
      const i = state.jobs.findIndex((j) => j.id === b);
      if (i >= 0) {
        const j = state.jobs.splice(i, 1)[0];
        state.jobs.unshift(j);
        toast('Moved to the front of the queue.');
      }
      break;
    }
    case 'cancel':
      Sim.cancelJob(state, b);
      renderInspector();
      renderRecords(true);
      break;
    case 'filter':
      recordFilter = b;
      renderRecords(true);
      break;
    case 'notices':
      tab = 'notices';
      renderTabs();
      renderRecords(true);
      break;
    case 'notice-hide':
      $('#delivery-toast').hidden = true;
      break;
    case 'notice-open': {
      const n = state.notices.find((n) => n.id === b);
      if (n) {
        n.seen = true;
        locateAny(n.entity);
      }
      $('#delivery-toast').hidden = true;
      break;
    }
    case 'read-all':
      for (const n of state.notices) n.seen = true;
      renderRecords(true);
      break;
    case 'save':
      persist();
      break;
    case 'export-diagnostics':
      download(
        `plant01-diagnostics-day${day(state.time)}.json`,
        JSON.stringify(recorder.archive(state)),
      );
      toast('Diagnostic history exported, including the current yard and recent checkpoints.');
      break;
    case 'column-filters':
      showColumnFilters = !showColumnFilters;
      renderRecords(true);
      break;
    case 'sort': {
      const prior = registerSort.get(b);
      registerSort.set(b, {
        column: Number(c),
        direction: prior?.column === Number(c) ? -prior.direction : 1,
      });
      if (tab === 'reports') {
        const table = document.querySelector<HTMLTableElement>(`table[data-register="${b}"]`);
        if (table) {
          const sort = registerSort.get(b)!;
          const rows = Array.from(table.tBodies[0].rows);
          rows.sort(
            (x, y) =>
              sort.direction *
              compareValues(
                x.cells[sort.column]?.textContent || '',
                y.cells[sort.column]?.textContent || '',
              ),
          );
          table.tBodies[0].append(...rows);
          table
            .querySelectorAll('th')
            .forEach((h, i) =>
              h.setAttribute(
                'aria-sort',
                i === sort.column ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none',
              ),
            );
        }
      } else renderRecords(true);
      break;
    }
    case 'export-save':
      download(`plant01-day${day(state.time)}.json`, Sim.save(state));
      toast('Save exported.');
      break;
    case 'import-save':
      $('#import-file').click();
      break;
    case 'restore-backup': {
      try {
        const json = localStorage.getItem('plant01-backup-v1');
        if (!json) {
          toast('No previous yard backup is available.', true);
          break;
        }
        const old = Sim.save(state);
        state = Sim.load(json);
        localStorage.setItem('plant01-backup-v1', old);
        state.paused = true;
        world.revision = -1;
        selection = undefined;
        controlled = undefined;
        closeModal();
        tab = 'site';
        renderTabs();
        renderGuide();
        uiTick();
        persist(true);
        toast('Previous yard restored and paused. The replaced yard is now the backup.');
      } catch (e) {
        toast((e as Error).message, true);
      }
      break;
    }
    case 'export-costs':
      download(
        'plant01-costs.csv',
        csv(
          ['id', 'time_seconds', 'category', 'entity', 'description', 'amount_usd'],
          state.costs.map((c) => [c.id, c.time, c.category, c.entity, c.description, c.amount]),
        ),
        'text/csv',
      );
      break;
    case 'sql-example':
      $<HTMLTextAreaElement>('#sql').value = SQL_EXAMPLES[Number(b)].sql;
      break;
    case 'sql-run': {
      const status = $('#sql-status');
      status.textContent = 'Building snapshot…';
      try {
        const start = performance.now(),
          result = await query(state, $<HTMLTextAreaElement>('#sql').value);
        $('#sql-results').innerHTML =
          result
            .map((r) =>
              table(
                r.columns.map(esc),
                r.values.slice(0, 2000).map((row) => row.map(esc)),
              ),
            )
            .join('') || '<p class="empty">No rows returned.</p>';
        status.textContent = `${result.reduce((n, r) => n + r.values.length, 0)} rows · ${Math.round(performance.now() - start)} ms · snapshot D${day(state.time)} ${clock(state.time)}`;
      } catch (e) {
        status.textContent = (e as Error).message;
      }
      break;
    }
  }
}
document.addEventListener(
  'toggle',
  (e) => {
    const dropdown = e.target;
    if (!(dropdown instanceof HTMLDetailsElement) || !dropdown.dataset.equipmentWork) return;
    const options = dropdown.querySelector<HTMLElement>('.equipment-work-options')!;
    if (!dropdown.open) {
      options.hidePopover();
      return;
    }
    options.showPopover();
    const anchor = dropdown.getBoundingClientRect(),
      width = options.offsetWidth,
      height = options.offsetHeight;
    options.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, anchor.right - width))}px`;
    options.style.top = `${Math.max(
      8,
      Math.min(
        innerHeight - height - 8,
        anchor.bottom + height + 2 <= innerHeight - 8 ? anchor.bottom + 2 : anchor.top - height - 2,
      ),
    )}px`;
  },
  true,
);
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  for (const open of document.querySelectorAll<HTMLDetailsElement>('details.equipment-role[open]'))
    if (!open.contains(target)) open.open = false;
  const preset = target.closest<HTMLElement>('[data-equipment-work-preset]');
  if (preset) {
    updateEquipmentWork(
      preset.dataset.equipmentId!,
      preset.dataset.equipmentWorkPreset === 'all'
        ? (Object.keys(EQUIPMENT_ACTIVITIES) as EquipmentActivity[])
        : [],
    );
    return;
  }
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (b && !(b as HTMLButtonElement).disabled) void action(b.dataset.action!);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  let closed = false;
  for (const open of document.querySelectorAll<HTMLDetailsElement>(
    'details.equipment-role[open]',
  )) {
    open.open = false;
    open.querySelector<HTMLElement>('summary')?.focus();
    closed = true;
  }
  if (closed) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
});
document.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.catalogItem) {
    const item = target.dataset.catalogItem;
    const el = document.querySelector<HTMLElement>(`#mass-${item}`);
    if (el)
      el.textContent =
        itemMass(item) && Number.isFinite(Number(target.value))
          ? massLabel(itemMass(item) * Number(target.value))
          : '—';
    return;
  }
  if (target.dataset.columnFilter) {
    const key = target.dataset.columnFilter,
      index = Number(target.dataset.column);
    const filters = registerFilters.get(key) || new Map<number, string>();
    filters.set(index, target.value);
    registerFilters.set(key, filters);
    const position = target.selectionStart;
    renderRecords(true);
    const next = document.querySelector<HTMLInputElement>(
      `[data-column-filter="${key}"][data-column="${index}"]`,
    );
    next?.focus();
    next?.setSelectionRange(position, position);
    return;
  }
  if ((e.target as HTMLElement).id === 'search') {
    search = (e.target as HTMLInputElement).value;
    const input = e.target as HTMLInputElement,
      pos = input.selectionStart;
    renderRecords(true);
    const next = $<HTMLInputElement>('#search');
    next.focus();
    next.setSelectionRange(pos, pos);
  }
});
document.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement;
  if (target.id === 'transport') {
    purchaseTransport = target.value as 'road' | 'rail';
    renderCart();
    return;
  }
  if (target.dataset.jobEquipment) {
    const error = setJobEquipment(state, target.dataset.jobEquipment, target.value || undefined);
    recorder.record(state, 'equipment-assignment', {
      workId: target.dataset.jobEquipment,
      equipmentId: target.value,
      error,
    });
    toast(
      error || 'Equipment assignment updated. Current work finishes safely before handover.',
      !!error,
    );
    renderInspector(true);
    renderRecords(true);
    persist(true);
    return;
  }
  if (target.dataset.workerSchedule) {
    const [start, end] = target.value.split(',').map(Number);
    const error = setWorkerSchedule(
      state,
      target.dataset.workerSchedule,
      target.value ? start : null,
      end,
    );
    recorder.record(state, 'worker-schedule', {
      workerId: target.dataset.workerSchedule,
      start: target.value ? start : null,
      end,
      error,
    });
    toast(error || 'Shift schedule updated.', !!error);
    renderInspector(true);
    renderRecords(true);
    persist(true);
    return;
  }
  if (target.dataset.equipmentActivity) {
    const dropdown = target.closest<HTMLElement>('[data-equipment-work]')!;
    const activities = [...dropdown.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter((input) => input.checked)
      .map((input) => input.value as EquipmentActivity);
    updateEquipmentWork(target.dataset.equipmentActivity, activities);
    return;
  }
  if (target.dataset.notice) {
    const n = state.notices.find((n) => n.id === target.dataset.notice);
    if (n) {
      n.state = target.value as any;
      n.seen = true;
      renderRecords(true);
      persist(true);
    }
  }
});
$('#import-file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const next = Sim.load(await file.text());
    localStorage.setItem('plant01-backup-v1', Sim.save(state));
    state = next;
    state.paused = true;
    world.revision = -1;
    selection = undefined;
    controlled = undefined;
    closeModal();
    tab = 'site';
    renderTabs();
    renderGuide();
    renderInspector();
    persist(true);
    toast('Save imported and paused. Press Space to resume.');
  } catch (e) {
    toast(`Import failed: ${(e as Error).message}. Current yard kept.`, true);
  }
  input.value = '';
});
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    persist();
    return;
  }
  if (modal && e.key !== 'Escape') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'escape') {
    if (modal && modal !== 'start') closeModal();
    else {
      setTool('select');
      selection = undefined;
      renderInspector();
    }
  } else if (k === ' ') {
    e.preventDefault();
    state.paused = !state.paused;
  } else if (k === 'r') void action('rotate');
  else if (k === 'g') void action('grid');
  else if (k === 'h') void action('home');
  else if (k === 'b') openModal('shop');
  else if (k === 'f') {
    follow = !follow;
    toast(follow ? 'Following controlled worker.' : 'Camera follow off.');
  } else if (['1', '2', '3'].includes(k)) {
    state.speed = ({ 1: 1, 2: 3, 3: 10 } as any)[k];
    state.paused = false;
  }
});
document.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
});
window.addEventListener('beforeunload', () => persist(true));
function uiTick() {
  renderHint();
  const newest = state.notices[0];
  if (newest && newest.id !== lastNotice) {
    lastNotice = newest.id;
    if (!newest.seen && modal !== 'start') {
      const el = $('#delivery-toast');
      el.hidden = false;
      el.innerHTML = `<div><b>${esc(newest.title)}</b>${btn('notice-hide', '×', '', 'aria-label="Dismiss notification popup"')}</div><p>${esc(newest.detail)}</p><footer>${btn('notice-open:' + newest.id, 'Inspect', 'small')}${btn('notices', 'Open inbox', 'text-link')}</footer>`;
      clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => (el.hidden = true), 10000);
    }
  }
  $('#time').innerHTML = `<b>D${day(state.time)}</b> ${clock(state.time, true)}`;
  $('#site-name').textContent = state.name;
  $('#notice-count').textContent = String(state.notices.filter((n) => !n.seen).length);
  $('#work-summary').textContent =
    `${state.workers.length} workers · ${state.jobs.filter((j) => j.status === 'doing').length} working · ${state.jobs.filter((j) => j.status === 'todo').length} queued · ${money(state.costs.reduce((n, c) => n + c.amount, 0))} recorded`;
  for (const n of [1, 3, 10])
    document
      .querySelector(`[data-action="speed:${n}"]`)
      ?.classList.toggle('active', state.speed === n && !state.paused);
  const pause = document.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
  pause.textContent = state.paused ? '▶' : 'Ⅱ';
  pause.classList.toggle('active', state.paused);
  renderInspector();
  if (tab !== 'reports') renderRecords();
}
function frame(now: number) {
  const wallDt = Math.max(0, (now - lastTime) / 1000);
  const realDt = Math.min(wallDt, 0.1);
  lastTime = now;
  if (!modal || modal === 'shop' || modal === 'help' || modal === 'menu') {
    if (!state.paused) {
      // Keep a slow foreground frame on the same clock as movement. Camera
      // panning is clamped separately; suspended/background time is not replayed.
      accumulator += Math.min(wallDt, 1) * state.speed;
      let steps = 0;
      while (accumulator >= 0.1 && steps++ < 20) {
        world.capturePrevious(state);
        Sim.tick(state, 0.1);
        recorder.observe(state);
        accumulator -= 0.1;
      }
    }
  }
  if (tab === 'site') {
    if (!modal) {
      const x = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0),
        z = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
      if (x || z) world.pan(x, z, realDt);
    }
    if (follow && controlled) {
      const w = state.workers.find((w) => w.id === controlled);
      if (w) world.followWorker(state, w.id, state.paused ? 1 : Math.min(1, accumulator / 0.1));
    }
    world.update(state, realDt, state.paused ? 1 : Math.min(1, accumulator / 0.1));
    const center = world.controls.target;
    const a = world.project({ x: center.x, z: center.z }),
      b = world.project({ x: center.x + 10, z: center.z });
    const projected = Math.hypot(a.x - b.x, a.y - b.y);
    const meters = [10, 5, 2, 1].find((m) => (projected * m) / 10 <= 160) || 1;
    $<HTMLElement>('#scale-bar i').style.width = `${(projected * meters) / 10}px`;
    $('#scale-bar span').textContent = `${meters} m at view center`;
  }
  if (now - lastUI > 600) {
    uiTick();
    lastUI = now;
  }
  if (now - lastSave > 20000 && modal !== 'start') persist(true);
  requestAnimationFrame(frame);
}
renderTabs();
renderBuildbar();
renderGuide();
uiTick();
if (!saved) openModal('start');
if (saveError)
  toast('The browser save could not be loaded. You can import a backup from the menu.', true);
requestAnimationFrame(frame);
// A small development harness allows repeatable integration checks against the same simulation used by the UI.
if (import.meta.env.DEV)
  (window as any).plant01 = {
    get state() {
      return state;
    },
    world,
    Sim,
    start,
    action,
    step(seconds: number) {
      for (let t = 0; t < seconds; t += 0.1) {
        world.capturePrevious(state);
        Sim.tick(state, 0.1);
        recorder.observe(state);
      }
      world.update(state, 0.016);
      uiTick();
    },
    get selection() {
      return selection;
    },
  };
