export const clientServiceDate = value => {
  if (!value) return null;
  const date = value.toDate?.() || (typeof value.seconds === 'number' ? new Date(value.seconds * 1000) : new Date(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const key = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
export const clientStopCompleted = stop => ['finished', 'complete', 'completed', 'done'].includes(key(stop.operationStatus || stop.status)) || Boolean(stop.completedAt || stop.finishedAt);
export const clientStopCancelled = stop => ['cancelled', 'canceled', 'skipped', 'deleted', 'unavailable'].includes(key(stop.operationStatus || stop.status));
export function clientVisitSummary(stops, now = new Date()) {
  const completed = stops.filter(stop => clientStopCompleted(stop) && !clientStopCancelled(stop)).sort((a, b) => (clientServiceDate(b.serviceDate)?.getTime() || 0) - (clientServiceDate(a.serviceDate)?.getTime() || 0));
  const upcoming = stops.filter(stop => !clientStopCompleted(stop) && !clientStopCancelled(stop) && (clientServiceDate(stop.serviceDate)?.getTime() || 0) >= new Date(now).setHours(0, 0, 0, 0)).sort((a, b) => clientServiceDate(a.serviceDate) - clientServiceDate(b.serviceDate));
  return {
    lastService: completed[0] || null,
    nextService: upcoming[0] || null,
    completed,
    upcoming
  };
}
