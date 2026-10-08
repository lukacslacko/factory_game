import type { Job, State } from './types';

const active = (j: Job) => !['done', 'canceled'].includes(j.status);

/** A planned destination must remain in place until every incoming lift is secured. */
export function storageDestinationReserved(s: Pick<State, 'jobs'>, stackId: string) {
  return s.jobs.some((j) => active(j) && j.stockMove?.toStorage && j.stockMove.mergeId === stackId);
}

/** Fuel services and collection cannot claim a drum or reel being transported. */
export function storageMoveOwnsStack(s: Pick<State, 'jobs'>, stackId: string) {
  return s.jobs.some(
    (j) =>
      active(j) &&
      j.stockMove?.toStorage &&
      (j.stockMove.sourceId === stackId || j.stockMove.mergeId === stackId),
  );
}
