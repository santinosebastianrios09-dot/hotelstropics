const counters = new Map<string, number>();

export function inc(metric: string, by = 1) {
  counters.set(metric, (counters.get(metric) ?? 0) + by);
}
export function get(metric: string) {
  return counters.get(metric) ?? 0;
}
export function snapshot() {
  return Object.fromEntries(counters.entries());
}
