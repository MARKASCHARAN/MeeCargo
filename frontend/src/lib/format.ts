export function formatPaise(paise?: number | null): string {
  if (paise === undefined || paise === null || !Number.isFinite(paise)) {
    return '—';
  }
  return `₹${(paise / 100).toFixed(2)}`;
}
