const { companyActor, can, documentId, fail } = require('./companyActor');
const { timeZone, dateKey, calendarDate, addCalendarDays, newActiveRoute, orderedRoute, started } = require('./routeState');
function createOwnTechnicianRoute(db) {
  return async request => {
    const uid = request.auth?.uid, data = request.data || {}, companyId = documentId(data.companyId, 'Company');
    if (!uid) fail('unauthenticated', 'Sign in before starting your route.');
    if (data.techId && data.techId !== uid) fail('permission-denied', 'This command only prepares your assigned route.');
    if (!Number.isFinite(data.serviceDateMillis)) fail('invalid-argument', 'Choose a route date.');
    return db.runTransaction(async transaction => {
      const actor = await companyActor(db, transaction, companyId, uid, request.auth.token);
      if (!can(actor, '240')) fail('permission-denied', 'Service-stop access is required.');
      const zone = timeZone(actor.company, data.timeZone), key = dateKey(data.serviceDateMillis, zone);
      const start = calendarDate(key, zone, 0), end = calendarDate(addCalendarDays(key, 1), zone, 0);
      const company = db.collection('companies').doc(companyId);
      const [stopsSnapshot, routesSnapshot] = await Promise.all([
        transaction.get(company.collection('serviceStops').where('techId', '==', uid).where('serviceDate', '>=', start).where('serviceDate', '<', end)),
        transaction.get(company.collection('activeRoutes').where('techId', '==', uid).where('date', '>=', start).where('date', '<', end)),
      ]);
      const stops = stopsSnapshot.docs.map(doc => ({...doc.data(), id:doc.id}));
      const existing = routesSnapshot.docs.map(doc => ({...doc.data(), id:doc.id})).sort((a,b) => Number(started(b))-Number(started(a)) || String(a.id).localeCompare(String(b.id)))[0];
      if (existing && started(existing)) return {routeId:existing.id};
      // IDs, membership, counts, and identity come entirely from company records.
      const route = orderedRoute(existing || newActiveRoute({companyId,workerId:uid,workerName:actor.name,dayKey:key,zone}), stops);
      const reference = company.collection('activeRoutes').doc(route.id);
      const collision = await transaction.get(reference);
      if (collision.exists && (collision.data().techId !== uid || dateKey(collision.data().date, zone) !== key)) fail('failed-precondition', 'The saved route identity needs management review.');
      transaction.set(reference, route, {merge:true});
      return {routeId:route.id};
    });
  };
}
module.exports = { createOwnTechnicianRoute };
