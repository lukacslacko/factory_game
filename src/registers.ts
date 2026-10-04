/** Dense register sorting uses visible values, with natural numeric ordering. */
export function compareValues(a: string, b: string): number {
  const number = (v: string) => {
    const trimmed = v.trim().replace(/[$,%]/g, '');
    return /^-?\d+(\.\d+)?(?:\s*(?:L|h|m|t|%))?$/.test(trimmed) ? parseFloat(trimmed) : NaN;
  };
  const x = number(a),
    y = number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return a.localeCompare(b, 'en-US', { numeric: true, sensitivity: 'base' });
}
export const tableKey = (tab: string, headers: string[]) =>
  tab + '-' + headers.join('-').replace(/[^a-zA-Z0-9]+/g, '-');
