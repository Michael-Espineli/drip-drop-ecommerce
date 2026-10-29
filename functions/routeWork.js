const { companyActor, active, can, documentId, fail } = require('./companyActor');
const { ids, date, started, timeZone, dateKey, calendarDate, addCalendarDays, routeStopIds, stable, newActiveRoute, orderedRoute } = require('./routeState');
const rows = snap => snap.docs.map(doc => ({ ...doc.data(), id:doc.id }));
const protectedWork = value => Boolean(value.workOfferId || value.pendingWorkOfferId || value.workOfferClaimId || value.claimedWorkOfferId || value.assignedFromWorkOffer || value.payrollAgreement && Object.keys(value.payrollAgreement).length);
const assertMovable = value => {
  if (started(value)) fail('failed-precondition', 'Work has already started or finished. Review the work before moving it.');
  if (protectedWork(value)) fail('failed-precondition', 'This work has accepted or pending coverage. Resolve or transfer that agreement before moving it.');
};

function createRouteWork(db, now = () => new Date()) {
  async function command(request) {
    if (!request.auth?.uid) fail('unauthenticated', 'Sign in first.');
    const data = request.data || {};
    const companyId = documentId(data.companyId, 'Company'), requestId = documentId(data.requestId, 'Move request');
    if (data.action !== 'oneTime') fail('invalid-argument', 'Select a supported route move.');
    const workerId = documentId(data.techId, 'Technician');
    if (!Array.isArray(data.stops) || !data.stops.length || data.stops.length > 100) fail('invalid-argument', 'Select between 1 and 100 stops per move.');
    const expected = data.stops.map(value => {
      const id = documentId(value.id, 'Service stop');
      if (typeof value.techId !== 'string' || !Number.isFinite(value.serviceDateMillis)) fail('invalid-argument', 'Refresh the stops before moving them.');
      if (value.assignmentRevision != null && (!Number.isInteger(value.assignmentRevision) || value.assignmentRevision < 0)) fail('invalid-argument', 'Invalid assignment revision.');
      return { id, techId:value.techId, serviceDateMillis:value.serviceDateMillis, assignmentRevision:value.assignmentRevision ?? null };
    }).sort((a,b)=>a.id.localeCompare(b.id));
    if (ids(expected).length !== expected.length) fail('invalid-argument', 'A stop may only be selected once.');
    const fingerprint = stable(JSON.stringify({ action:data.action, expected, workerId, serviceDateKey:data.serviceDateKey, timeZone:data.timeZone || 'UTC' }));
    const c = db.collection('companies').doc(companyId);
    return db.runTransaction(async t => {
      const actor = await companyActor(db,t,companyId,request.auth.uid,request.auth.token);
      if (!can(actor,'244') && !can(actor,'234')) fail('permission-denied', 'Route or service-stop management permission is required.');
      const journal = c.collection('routeMoveRequests').doc(requestId), previous = await t.get(journal);
      if (previous.exists) {
        const old = previous.data();
        if (old.actorId !== actor.uid || old.fingerprint !== fingerprint) fail('already-exists', 'This request ID belongs to a different move.');
        return { ...old.result, alreadyApplied:true };
      }
      const zone = timeZone(actor.company,data.timeZone), destinationDate = calendarDate(data.serviceDateKey,zone,0);
      const [staff, access, direct] = await Promise.all([
        t.get(c.collection('companyUsers').where('userId','==',workerId)),
        t.get(db.collection('users').doc(workerId).collection('userAccess').doc(companyId)),
        t.get(c.collection('companyUsers').doc(workerId)),
      ]);
      const worker = [...rows(staff),...(direct.exists && (!direct.data().userId || direct.data().userId===workerId) ? [{...direct.data(),id:direct.id}] : [])]
        .find(value=>active(value) && (!value.companyId || value.companyId===companyId));
      if (!worker || access.exists && !active(access.data())) fail('failed-precondition', 'Select an active technician in this company.');
      const workerName = worker.userName || [worker.firstName,worker.lastName].filter(Boolean).join(' ') || workerId;
      const stops = await Promise.all(expected.map(async value => {
        const snap = await t.get(c.collection('serviceStops').doc(value.id));
        if (!snap.exists) fail('not-found', 'A selected service stop no longer exists.');
        const stop = { ...snap.data(), id:snap.id };
        if (stop.companyId && stop.companyId!==companyId) fail('permission-denied','The stop belongs to another company.');
        if (stop.techId!==value.techId || date(stop.serviceDate)?.getTime()!==value.serviceDateMillis || value.assignmentRevision!=null && (stop.assignmentRevision || 0)!==value.assignmentRevision) fail('failed-precondition', 'A selected stop changed. Refresh the route and try again.');
        assertMovable(stop);
        return stop;
      }));
      const moving = stops.filter(stop=>stop.techId!==workerId || dateKey(stop.serviceDate,zone)!==data.serviceDateKey);
      if (!moving.length) fail('failed-precondition', 'The selected stops already have this technician and date.');
      const at = now(), updates = new Map(), before = [];
      const write = (ref,patch) => updates.set(ref.path,{ref,patch:{...(updates.get(ref.path)?.patch || {}),...patch}});
      const moved = new Map();
      for (const stop of moving) {
        const tasks = rows(await t.get(c.collection('serviceStops').doc(stop.id).collection('tasks')));
        for (const task of tasks) {
          assertMovable(task);
          const inherited = task.workerAssignmentMode !== 'task' && (!task.workerId || task.workerId===stop.techId || task.workerAssignmentMode==='stop');
          const assignment = { workerId, workerName, workerType:worker.workerType || 'Not Assigned', workerAssignmentMode:'stop', updatedAt:at };
          if (inherited) write(c.collection('serviceStops').doc(stop.id).collection('tasks').doc(task.id),assignment);
          const linkedId = task.jobTaskId || task.workOrderTaskId;
          if (linkedId && stop.jobId) {
            const linked = c.collection('workOrders').doc(documentId(stop.jobId,'Job')).collection('tasks').doc(documentId(linkedId,'Job task'));
            const snap = await t.get(linked);
            if (!snap.exists) fail('failed-precondition','A linked job task is missing. Review this stop before moving it.');
            assertMovable(snap.data());
            const jobTask = snap.data();
            if (inherited && jobTask.workerAssignmentMode!=='task' && (!jobTask.workerId || jobTask.workerId===stop.techId || jobTask.workerAssignmentMode==='stop')) write(linked,assignment);
          }
        }
        const patch = { techId:workerId, tech:workerName, serviceDate:destinationDate, serviceDateKey:data.serviceDateKey,
          assignmentRevision:(stop.assignmentRevision || 0)+1, updatedAt:at,
          oneTimeRouteMove:{ requestId, movedAt:at, actorId:actor.uid, originalTechId:stop.techId || '', originalServiceDate:stop.serviceDate } };
        write(c.collection('serviceStops').doc(stop.id),patch);
        moved.set(stop.id,{...stop,...patch});
        before.push({id:stop.id,techId:stop.techId,serviceDateMillis:date(stop.serviceDate).getTime(),assignmentRevision:stop.assignmentRevision || 0});
      }
      // Query affected workers/days, not the company's lifetime of routes or
      // every technician's visits. These compound indexes ship with the workflow.
      // Keep every read before the first transaction write.
      const affected = new Map();
      moving.forEach(stop=>affected.set(stop.techId+'|'+dateKey(stop.serviceDate,zone),{workerId:stop.techId,workerName:stop.tech || stop.techId,dayKey:dateKey(stop.serviceDate,zone)}));
      affected.set(workerId+'|'+data.serviceDateKey,{workerId,workerName,dayKey:data.serviceDateKey});
      const routes = new Map(), dayStops = new Map();
      for (const scope of affected.values()) {
        const start=calendarDate(scope.dayKey,zone,0), end=calendarDate(addCalendarDays(scope.dayKey,1),zone,0);
        for (const [name,target] of [['serviceStops',dayStops],['activeRoutes',routes]]) {
          const field=name==='activeRoutes'?'date':'serviceDate';
          const snap = await t.get(c.collection(name).where('techId','==',scope.workerId).where(field,'>=',start).where(field,'<',end).limit(401));
          if (snap.size>400) fail('resource-exhausted','This technician/day needs a larger route reconciliation. No stops were moved.');
          rows(snap).forEach(value=>target.set(value.id,value));
        }
      }
      for (const stop of moving) {
        const snap=await t.get(c.collection('activeRoutes').where('serviceStopsIds','array-contains',stop.id).limit(401));
        if(snap.size>400) fail('resource-exhausted','This stop needs route reconciliation. No stops were moved.');
        rows(snap).forEach(route=>routes.set(route.id,route));
      }
      moved.forEach((stop,id)=>dayStops.set(id,stop));
      const routeIds = [], handled = new Set();
      for (const scope of affected.values()) {
        const matches=[...routes.values()].filter(route=>route.techId===scope.workerId && dateKey(route.date,zone)===scope.dayKey);
        matches.sort((a,b)=>Number(Boolean(a.duplicateOf))-Number(Boolean(b.duplicateOf)) || Number(Boolean(b.startTime || b.endTime))-Number(Boolean(a.startTime || a.endTime)) || a.id.localeCompare(b.id));
        const route=matches[0] || newActiveRoute({companyId,...scope,zone});
        if (!matches.length) {
          const existing = await t.get(c.collection('activeRoutes').doc(route.id));
          if (existing.exists) fail('failed-precondition','The destination route ID conflicts with another route. Review it before moving stops.');
        }
        const members=[...dayStops.values()].filter(stop=>stop.techId===scope.workerId && dateKey(stop.serviceDate,zone)===scope.dayKey);
        const incoming=members.some(stop=>moved.has(stop.id) && !routeStopIds(route).includes(stop.id));
        if (incoming && (route.endTime || route.endMilage!=null || route.endMileage!=null || ['finished','completed'].includes(String(route.status).toLowerCase()))) fail('failed-precondition','The destination route is closed. Reopen it before adding stops.');
        write(c.collection('activeRoutes').doc(route.id),{...orderedRoute(route,members),updatedAt:at});
        routeIds.push(route.id); handled.add(route.id);
        matches.slice(1).forEach(duplicate=>{
          write(c.collection('activeRoutes').doc(duplicate.id),{...orderedRoute(duplicate,[]),duplicateOf:route.id,updatedAt:at}); handled.add(duplicate.id);
        });
      }
      // Strip stale extra membership without rewriting historical clock evidence.
      for (const route of routes.values()) if (!handled.has(route.id) && routeStopIds(route).some(id=>moved.has(id))) {
        const patch = { serviceStopsIds:routeStopIds(route).filter(id=>!moved.has(id)), order:(route.order || []).filter(v=>!moved.has(v.serviceStopId)).map((v,i)=>({...v,order:i+1})), updatedAt:at };
        patch.totalStops=patch.serviceStopsIds.length;
        write(c.collection('activeRoutes').doc(route.id),patch);
      }
      if (updates.size>440) fail('resource-exhausted','Split this move into fewer stops. No changes were saved.');
      const result={ status:200,companyId,requestId,movedStopIds:[...moved.keys()],unchangedStopIds:stops.filter(s=>!moved.has(s.id)).map(s=>s.id),routeIds,serviceDateKey:data.serviceDateKey,techId:workerId };
      updates.forEach(({ref,patch})=>t.set(ref,patch,{merge:true}));
      const after=[...moved.values()].map(stop=>({id:stop.id,techId:stop.techId,serviceDateMillis:date(stop.serviceDate).getTime(),assignmentRevision:stop.assignmentRevision}));
      t.set(journal,{id:requestId,actorId:actor.uid,action:'oneTime',reason:'One-time route move',fingerprint,before,after,result,timeZone:zone,createdAt:at});
      return result;
    });
  }
  return { command };
}
module.exports={createRouteWork,assertMovable};
