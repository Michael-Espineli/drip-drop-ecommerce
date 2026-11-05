const { date, routeStopIds } = require('./routeState');

const id = value => String(typeof value === 'object' ? value?.id || '' : value || '');
const positive = value => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) <= 0 ? null : Number(value);
const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
const identity = (stops, field) => stops.every(stop => id(stop[field])) ? JSON.stringify(stops.map(stop => id(stop[field])).sort()) : null;

function recordedTotals(route) {
  if (route.duplicateOf || !route.endTime && !['finished', 'completed', 'complete'].includes(String(route.status).toLowerCase())) return null;
  if (['cancelled', 'canceled', 'skipped'].includes(String(route.status).toLowerCase())) return null;
  const start = date(route.startTime), end = date(route.endTime);
  const minutes = start && end && end > start ? (end - start) / 60000 : positive(route.durationSeconds) / 60 || positive(route.durationMin);
  const mileageStart = route.startMileage ?? route.startMilage, mileageEnd = route.endMileage ?? route.endMilage;
  const hasOdometer = mileageStart != null && mileageEnd != null && mileageStart !== '' && mileageEnd !== '' && Number.isFinite(Number(mileageStart)) && Number.isFinite(Number(mileageEnd)) && Number(mileageEnd) >= Number(mileageStart);
  const miles = hasOdometer ? Number(mileageEnd) - Number(mileageStart) : positive(route.distanceMiles) ?? positive(route.distance);
  return { minutes: minutes || null, miles };
}

// Compare complete runs with precisely the offered stops. Never prorate a full
// route's driving time/mileage for a partial claim. Bound history and stop reads.
async function workOfferRouteSummary(t, company, offer, stops, now = new Date()) {
  if (!offer.routeId) return null;
  const stopIds = stops.map(stop => stop.id);
  const serviceTimes = stops.map(stop => positive(stop.estimatedDuration) ?? positive(stop.estimatedMinutes) ?? positive(stop.estimatedTime));
  const summary = { stopIds, totalMinutes: null, totalDistanceMiles: null, serviceMinutes: serviceTimes.every(value => value != null) ? Math.ceil(serviceTimes.reduce((sum, value) => sum + value, 0)) : null, timeSampleCount: 0, distanceSampleCount: 0 };
  if (!stops.length) return { ...summary, totalMinutes: 0, totalDistanceMiles: 0 };
  const fields = ['recurringServiceStopId', 'serviceLocationId'];
  const identities = Object.fromEntries(fields.map(field => [field, identity(stops, field)]));
  const since = new Date(now.getTime() - 90 * 86400000);
  const source = await t.get(company.collection(offer.routeSource === 'recurringRoutes' ? 'recurringRoutes' : 'activeRoutes').doc(offer.routeId));
  const technicianId = id(source.data()?.techId || stops[0]?.techId);
  let query = company.collection('activeRoutes');
  if (technicianId) query = query.where('techId', '==', technicianId);
  const history = await t.get(query.where('date', '>=', since).where('date', '<=', now).orderBy('date', 'desc').limit(80));
  const targetDay = date(offer.routeDate || stops[0]?.serviceDate || source.data()?.date)?.getUTCDay();
  const candidates = [...history.docs].sort((a, b) => Number(date(b.data().date)?.getUTCDay() === targetDay) - Number(date(a.data().date)?.getUTCDay() === targetDay));
  const times = [], distances = [];
  const cache = new Map(stops.map(stop => [stop.id, stop]));
  let remainingReads = 240;
  for (const document of candidates) {
    const route = document.data(), totals = recordedTotals(route), ids = routeStopIds(route);
    if (!totals || ids.length !== stops.length || !totals.minutes && totals.miles == null) continue;
    const missing = ids.filter(value => !cache.has(value));
    if (missing.length && !Object.values(identities).some(Boolean)) continue;
    if (missing.length > remainingReads) continue;
    remainingReads -= missing.length;
    const snapshots = await Promise.all(missing.map(value => t.get(company.collection('serviceStops').doc(value))));
    snapshots.forEach((snapshot, index) => cache.set(missing[index], snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null));
    const historicalStops = ids.map(value => cache.get(value));
    if (historicalStops.some(stop => !stop)) continue;
    if (historicalStops.some(stop => (stop.operationStatus || stop.status) && !['finished', 'completed', 'complete', 'done'].includes(String(stop.operationStatus || stop.status).toLowerCase()))) continue;
    const sameIds = JSON.stringify([...ids].sort()) === JSON.stringify([...stopIds].sort());
    const historicalRecurring = identity(historicalStops, 'recurringServiceStopId');
    const sameScope = sameIds || (identities.recurringServiceStopId && historicalRecurring
      ? identities.recurringServiceStopId === historicalRecurring
      : identities.serviceLocationId && identity(historicalStops, 'serviceLocationId') === identities.serviceLocationId);
    if (!sameScope) continue;
    if (totals.minutes != null && times.length < 5) times.push(totals.minutes);
    if (totals.miles != null && distances.length < 5) distances.push(totals.miles);
    if (times.length === 5 && distances.length === 5) break;
  }
  return { ...summary, totalMinutes: average(times), totalDistanceMiles: average(distances), timeSampleCount: times.length, distanceSampleCount: distances.length };
}

module.exports = { workOfferRouteSummary };
