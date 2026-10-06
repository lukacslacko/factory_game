import type { Item, BuildKind, EquipmentKind, Role } from './types';
export const TRACK_GAUGE = 1.435;
export const RAIL_HEAD_WIDTH = 0.072;
/** Eight supported layers stay below 3 m; lift and carrier mass limits are independent. */
export const RAIL_STACK_LIMIT = 8;
export const RAIL_CENTER_OFFSET = (TRACK_GAUGE + RAIL_HEAD_WIDTH) / 2;
export const MATERIALS: Record<
  Item,
  {
    name: string;
    unit: string;
    price: number;
    mass: number;
    w: number;
    d: number;
    max: number;
    work: number;
    color: number;
    description: string;
  }
> = {
  bufferStop: {
    name: 'Rail buffer stop',
    unit: 'stops',
    price: 1250,
    mass: 850,
    w: 2,
    d: 2,
    max: 1,
    work: 5,
    color: 0xc85b36,
    description:
      'Clamp-on standard-gauge buffer stop. Delivered, rigged, lifted onto an open track end, then fastened by a worker. Recoverable into a 2 × 2 m stockyard slot.',
  },
  slab: {
    name: 'Concrete slab',
    unit: 'slabs',
    price: 38,
    mass: 280,
    w: 1,
    d: 1,
    max: 12,
    work: 2.2,
    color: 0xb7b7ad,
    description:
      '1 × 1 m paving slab. Up to 12 slabs per 1 m² physical stack (about 2.2 m high, including spacers).',
  },
  rail: {
    name: 'Rail panel',
    unit: 'panels',
    price: 780,
    mass: 1450,
    w: 5,
    d: 3,
    max: RAIL_STACK_LIMIT,
    work: 9,
    color: 0x676c68,
    description:
      '5 m panel; 1,435 mm gauge. Two-cell track footprint; 5 × 3 m storage slots include handling clearance. Stack up to eight panels with spacers (2.85 m high).',
  },
  railCurve: {
    name: 'Curved rail panel · 15°',
    unit: 'panels',
    price: 1120,
    mass: 1520,
    w: 6,
    d: 3,
    max: RAIL_STACK_LIMIT,
    work: 9,
    color: 0x676c68,
    description:
      '20 m radius; 5.236 m arc, 1,435 mm gauge. Six separately lifted panels make a 90° curve. 6 × 3 m storage slot. Stack up to eight panels with spacers (2.85 m high).',
  },
  railPoints: {
    name: 'Turnout points module',
    unit: 'modules',
    price: 3100,
    mass: 1750,
    w: 6,
    d: 3,
    max: RAIL_STACK_LIMIT,
    work: 12,
    color: 0x676c68,
    description:
      'First 5 m of a 20 m modular turnout: stock rails, movable blades, sleepers, and a manual lever. Stack up to eight modules with spacers (2.85 m high).',
  },
  railFrog: {
    name: 'Turnout frog module',
    unit: 'modules',
    price: 2450,
    mass: 1520,
    w: 6,
    d: 3,
    max: RAIL_STACK_LIMIT,
    work: 12,
    color: 0x676c68,
    description:
      'Second diverging panel: crossing frog and guard rails. Lay a separate straight panel alongside. Stack up to eight modules with spacers (2.85 m high).',
  },
  railClosure: {
    name: 'Turnout closure module',
    unit: 'modules',
    price: 2100,
    mass: 1520,
    w: 6,
    d: 3,
    max: RAIL_STACK_LIMIT,
    work: 12,
    color: 0x676c68,
    description:
      'Third diverging panel: closure rails. Lay a separate straight panel alongside. Stack up to eight modules with spacers (2.85 m high).',
  },
  railExit: {
    name: 'Turnout exit module',
    unit: 'modules',
    price: 1950,
    mass: 1520,
    w: 6,
    d: 3,
    max: RAIL_STACK_LIMIT,
    work: 12,
    color: 0x676c68,
    description:
      'Fourth diverging panel: grid-aligned exit 5 m from the through track. Lay a separate straight panel alongside. Stack up to eight modules with spacers (2.85 m high).',
  },
  office: {
    name: 'Office container',
    unit: 'units',
    price: 7200,
    mass: 4800,
    w: 6,
    d: 3,
    max: 1,
    work: 16,
    color: 0xc6b997,
    description: '6 × 3 m office with steps and windows. Requires paved foundations.',
  },
  sanitary: {
    name: 'Sanitary container',
    unit: 'units',
    price: 4600,
    mass: 2000,
    w: 3,
    d: 2,
    max: 1,
    work: 13,
    color: 0x9cb6ac,
    description: '3 × 2 m WC and showers. Water service required for operation.',
  },
  shed: {
    name: 'Equipment shed kit',
    unit: 'kits',
    price: 5200,
    mass: 2200,
    w: 4,
    d: 2,
    max: 1,
    work: 28,
    color: 0x7e9190,
    description: 'Build an 8 × 6 m open shed. Pillars, bracing, and corrugated roof.',
  },
  store: {
    name: 'Stores building kit',
    unit: 'kits',
    price: 6400,
    mass: 2600,
    w: 4,
    d: 3,
    max: 1,
    work: 24,
    color: 0x939d8d,
    description: 'Build a 6 × 4 m workshop and stores building.',
  },
  lamp: {
    name: 'Light pole kit',
    unit: 'kits',
    price: 340,
    mass: 160,
    w: 4,
    d: 1,
    max: 3,
    work: 10,
    color: 0xb2b9ad,
    description: '6 m pole, base and lamp. Requires paving and electricity.',
  },
  diesel: {
    name: 'Diesel drum · 200 L',
    unit: 'drums',
    price: 320,
    mass: 185,
    w: 1,
    d: 1,
    max: 1,
    work: 4,
    color: 0xba8645,
    description: 'A physical 200 L drum. Empty drums remain in storage.',
  },
  fence: {
    name: 'Fence panel',
    unit: 'panels',
    price: 115,
    mass: 60,
    w: 3,
    d: 1,
    max: 8,
    work: 6,
    color: 0x748980,
    description: '3 m fence panel with posts; marks a 3 × 1 m strip.',
  },
};
export const BUILDINGS: Record<
  string,
  { name: string; w: number; d: number; foundation: boolean }
> = {
  slab: { name: 'Paving', w: 1, d: 1, foundation: false },
  rail: { name: 'Rail · 5 m', w: 5, d: 2, foundation: false },
  office: { name: 'Office', w: 6, d: 3, foundation: true },
  sanitary: { name: 'WC / showers', w: 3, d: 2, foundation: true },
  shed: { name: 'Equipment shed', w: 8, d: 6, foundation: true },
  store: { name: 'Workshop', w: 6, d: 4, foundation: true },
  lamp: { name: 'Light pole', w: 1, d: 1, foundation: true },
  fence: { name: 'Fence', w: 3, d: 1, foundation: false },
};
export const EQUIPMENT: Record<
  EquipmentKind,
  { name: string; price: number; mass: number; capacity: number; tank: number; description: string }
> = {
  excavator: {
    name: 'EX-6 tracked excavator',
    mass: 8500,
    price: 64000,
    capacity: 6000,
    tank: 80,
    description: '6 t lift capacity. Carries every starter kit. Arrives fueled.',
  },
  forklift: {
    name: 'FL-25 rough-terrain forklift',
    mass: 4500,
    price: 28500,
    capacity: 2500,
    tank: 45,
    description: '2.5 t lift capacity. Handles slabs, rail panels, poles and fuel.',
  },
};
export const ROLES: Record<
  Role,
  { name: string; price: number; wage: number; description: string }
> = {
  builder: {
    name: 'Construction worker',
    price: 90,
    wage: 28,
    description: 'Installs paving, rails and buildings. Arrives by crew bus.',
  },
  operator: {
    name: 'Equipment operator',
    price: 120,
    wage: 36,
    description: 'Drives excavators and forklifts; handles construction lifts.',
  },
  engineer: {
    name: 'Site engineer',
    price: 150,
    wage: 42,
    description: 'Installs site infrastructure; can also perform construction work.',
  },
};
export const SERVICES = {
  power: {
    name: 'Electrical connection',
    price: 1800,
    description:
      'Utility crew installs a 16 kVA site connection. Lights are wired during installation.',
  },
  water: {
    name: 'Water and sewer connection',
    price: 2300,
    description: 'Utility crew brings a small excavator and connects site water and sewer.',
  },
};
export const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
export const clock = (t: number, seconds = false) => {
  const m = Math.floor(t / 60);
  const hhmm = `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return seconds ? `${hhmm}:${String(Math.floor(t) % 60).padStart(2, '0')}` : hhmm;
};
export const day = (t: number) => Math.floor(t / 86400) + 1;
export const label = (key: string) =>
  (MATERIALS as any)[key]?.name ||
  (EQUIPMENT as any)[key]?.name ||
  (ROLES as any)[key]?.name ||
  (SERVICES as any)[key]?.name ||
  (
    {
      moveStock: 'Relocate rail stock',
      remove: 'Recovery',
      refuel: 'Refueling',
      throwSwitch: 'Operate turnout lever',
    } as any
  )[key] ||
  key;
export const bounds = { minX: -14, maxX: 220, minZ: 10, maxZ: 110 };
export function footprint(kind: BuildKind | string, x: number, z: number, r = 0) {
  const b = BUILDINGS[kind] || { w: 1, d: 1 };
  return { x: Math.floor(x), z: Math.floor(z), w: r % 2 ? b.d : b.w, d: r % 2 ? b.w : b.d };
}
