export function cellColor(pct: number): string {
  if (pct >= 2) return '#15803d';
  if (pct >= 1) return '#16a34a';
  if (pct >= 0.25) return '#4ade80';
  if (pct >= 0) return '#bbf7d0';
  if (pct >= -0.25) return '#fecaca';
  if (pct >= -1) return '#f87171';
  if (pct >= -2) return '#dc2626';
  return '#991b1b';
}

export function textColor(pct: number): string {
  return Math.abs(pct) >= 0.25 ? '#ffffff' : '#374151';
}
