/** Heavy-load fork extensions have fixed dimensions; reach moves the carriage,
 * rather than stretching its tines. Both rail-panel bearings fit on their flat section. */
export const FORK_HEEL = 1.1;
export const FORK_LENGTH = 2.7;
export const FORK_LOAD_CENTER = FORK_HEEL + FORK_LENGTH / 2;

export function forkCarriageOffset(reach: number) {
  return Math.max(0, (Number.isFinite(reach) ? reach : FORK_LOAD_CENTER) - FORK_LOAD_CENTER);
}

export function forkTip(reach: number) {
  return FORK_HEEL + FORK_LENGTH + forkCarriageOffset(reach);
}
