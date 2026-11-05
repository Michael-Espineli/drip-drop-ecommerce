const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { workOfferRouteSummary } = require('./workOfferRouteSummary');
const now = new Date('2026-10-26T20:00:00Z');
const base = 'companies/company';
const stops = [
  { id:'one', recurringServiceStopId:'r1', serviceLocationId:'l1', estimatedDuration:30 },
  { id:'two', recurringServiceStopId:{id:'r2'}, serviceLocationId:'l2', estimatedDuration:45 },
];
const offer = { routeId:'source' };
const history = (name, patch = {}) => ({
  [base+'/activeRoutes/'+name]: { date:new Date('2026-10-19T08:00:00Z'), status:'Finished', serviceStopsIds:[name+'1',name+'2'], durationSeconds:10800, distanceMiles:20, ...patch },
  [base+'/serviceStops/'+name+'1']: { recurringServiceStopId:'r1', serviceLocationId:'l1' },
  [base+'/serviceStops/'+name+'2']: { recurringServiceStopId:'r2', serviceLocationId:'l2' },
});
const summary = (records = {}, selection = stops, draft = offer) => {
  const db = new MemoryFirestore(records);
  return db.runTransaction(t => workOfferRouteSummary(t, db.doc(base), draft, selection, now));
};

test('typical totals average matching completed routes, including elapsed service/travel time and odometer miles', async () => {
  const result = await summary({ ...history('a'), ...history('b', { startTime:new Date('2026-10-19T08:00:00Z'), endTime:new Date('2026-10-19T12:00:00Z'), durationSeconds:60, startMilage:100, endMilage:130, distanceMiles:999 }) });
  assert.deepEqual(result, { stopIds:['one','two'], totalMinutes:210, totalDistanceMiles:25, serviceMinutes:75, timeSampleCount:2, distanceSampleCount:2 });
});
test('ignores unrelated, unfinished, duplicate, future, stale and cancelled runs', async () => {
  const result = await summary({ ...history('unrelated', { serviceStopsIds:['wrong1','wrong2'] }), ...history('inProgress', { status:'In Progress' }), ...history('duplicate', { duplicateOf:'original' }), ...history('future', { date:new Date('2026-11-01') }), ...history('stale', { date:new Date('2026-01-01') }), ...history('cancelled', { status:'Cancelled', endTime:now }) });
  assert.equal(result.totalMinutes, null); assert.equal(result.totalDistanceMiles, null); assert.equal(result.serviceMinutes, 75);
});
test('partial claims never receive prorated whole-route totals, and an empty selection stays empty', async () => {
  const partial = await summary(history('a'), stops.slice(0,1));
  assert.equal(partial.totalMinutes, null); assert.equal(partial.totalDistanceMiles, null); assert.equal(partial.serviceMinutes, 30);
  const empty = await summary(history('a'), []);
  assert.equal(empty.totalMinutes, 0); assert.equal(empty.totalDistanceMiles, 0); assert.deepEqual(empty.stopIds, []);
});
test('legacy minutes and distance are supported; missing estimates and default zero mileage remain unknown', async () => {
  const legacy = await summary(history('a', { durationSeconds:undefined, durationMin:120, distanceMiles:undefined, distance:12.4 }));
  assert.equal(legacy.totalMinutes, 120); assert.equal(legacy.totalDistanceMiles, 12.4);
  const unknown = await summary(history('a', { durationSeconds:0, distanceMiles:0 }), [{id:'one'}, {id:'two'}]);
  assert.equal(unknown.totalMinutes, null); assert.equal(unknown.totalDistanceMiles, null); assert.equal(unknown.serviceMinutes, null);
  const zeroMiles = await summary(history('a', { startMileage:0, endMileage:0 }));
  assert.equal(zeroMiles.totalDistanceMiles, 0); assert.equal(zeroMiles.distanceSampleCount, 1);
  assert.equal(await summary({}, stops, {}), null);
});
test('different recurring work at the same locations cannot supply a route estimate', async () => {
  const records = history('a'); records[base+'/serviceStops/a1'].recurringServiceStopId = 'different';
  assert.equal((await summary(records)).timeSampleCount, 0);
});
test('finished routes with skipped or incomplete stops cannot supply typical totals', async () => {
  for (const operationStatus of ['Skipped', 'Cancelled', 'Not Finished']) {
    const records = history('a'); records[base+'/serviceStops/a1'].operationStatus = operationStatus;
    assert.equal((await summary(records)).timeSampleCount, 0);
  }
});
test('the source technician scopes the history query before the recent-route limit', async () => {
  const records = { ...history('mine', { techId:'original' }), ...history('other', { techId:'other', durationSeconds:36000 }), [base+'/activeRoutes/source']:{ techId:'original' } };
  const result = await summary(records);
  assert.equal(result.timeSampleCount, 1); assert.equal(result.totalMinutes, 180);
});
test('caps matching samples at five recent runs and bounds history reads', async () => {
  const records = Object.assign({}, ...Array.from({length:100}, (_, i) => history(String(i), { date:new Date(now.getTime() - (i+1)*60000), durationSeconds:(i+1)*3600 })));
  const db = new MemoryFirestore(records);
  const result = await db.runTransaction(t => workOfferRouteSummary(t, db.doc(base), offer, stops, now));
  assert.equal(result.timeSampleCount, 5); assert.equal(result.totalMinutes, 180);
  assert.ok(db.readLog.reduce((sum, read) => sum + read.reads, 0) <= 320);
});
