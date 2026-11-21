const { active, can, companyActor, documentId, fail } = require('./companyActor');
const { addCalendarDays, calendarDate, date, dateKey, finished, shiftDay, stable, started, timeZone } = require('./routeState');
const { protectedWork, planDailyRouteChanges, planStopTaskMove } = require('./routeWork');

const intervalByFrequency = new Map([
  ['Weekly', 7], ['Twice Weekly', 7], ['Three Times Weekly', 7], ['Bi-Weekly', 14],
]);
const records = snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const weekOf = key => addCalendarDays(key, -new Date(key + 'T12:00:00Z').getUTCDay());
const daysBetween = (start, end) => (Date.parse(end) - Date.parse(start)) / 86400000;
const moveLimit = 30;
const stopLimit = 64;
const stale = () => fail('failed-precondition', 'The schedule or visit changed. Refresh the review before saving.');

function eligibleDate(key, { anchor, end, interval }) {
  return key >= anchor && (!end || key <= end) && daysBetween(anchor, key) % interval === 0;
}

function nextAnchor(old, day, firstWeek) {
  let week = weekOf(old.anchor);
  const elapsed = Math.max(0, daysBetween(week, firstWeek));
  week = addCalendarDays(week, Math.ceil(elapsed / old.interval) * old.interval);
  const first = shiftDay(week, day);
  return first < old.start ? addCalendarDays(first, old.interval) : first;
}

function scheduleFor(template, zone) {
  const interval = intervalByFrequency.get(template.frequency);
  if (!interval || !date(template.startDate) || (Array.isArray(template.daysOfWeek) && template.daysOfWeek.length > 1)) {
    fail('failed-precondition', 'This route review supports recurring stops with a single weekly or biweekly visit day.');
  }
  return {
    interval,
    start: dateKey(template.startDate, zone),
    anchor: template.routeScheduleAnchorDateKey || shiftDay(dateKey(template.startDate, zone), template.day),
    end: !template.noEndDate && date(template.endDate) ? dateKey(template.endDate, zone) : null,
  };
}

function visitState(stop, tasks) {
  if (finished(stop)) return 'history';
  if (protectedWork(stop) || tasks.some(protectedWork)) return 'coverage';
  if (started(stop) || tasks.some(started)) return 'started';
  if (stop.oneTimeRouteMove) return 'previousMove';
  return 'open';
}

async function activeWorker(t, db, company, companyId, value) {
  const id = documentId(value, 'Technician');
  const [direct, members, access] = await Promise.all([
    t.get(company.collection('companyUsers').doc(id)),
    t.get(company.collection('companyUsers').where('userId', '==', id)),
    t.get(db.collection('users').doc(id).collection('userAccess').doc(companyId)),
  ]);
  const directMember = direct.data();
  const worker = [
    ...(directMember && (!directMember.userId || directMember.userId === id) ? [directMember] : []),
    ...records(members),
  ].find(member => active(member) && (!member.companyId || member.companyId === companyId));
  if (!worker || access.exists && !active(access.data())) {
    fail('failed-precondition', 'Select an active technician in this company.');
  }
  return { ...worker, id, name: worker.userName || [worker.firstName, worker.lastName].filter(Boolean).join(' ') || worker.name || id };
}

function choicesFor(review) {
  if (!Array.isArray(review.choices) || review.choices.length > moveLimit * 3) {
    fail('invalid-argument', 'Review the handling of this week’s visits before saving.');
  }
  const choices = review.choices.map(choice => {
    const id = documentId(choice?.stopId, 'Service stop');
    if (choice.action === 'keep') return { stopId: id, action: 'keep' };
    if (choice.action !== 'move') fail('invalid-argument', 'Choose Keep or Move for each open visit.');
    return { stopId: id, action: 'move', dateKey: choice.dateKey, techId: documentId(choice.techId, 'Technician') };
  }).sort((left, right) => left.stopId.localeCompare(right.stopId));
  if (new Set(choices.map(choice => choice.stopId)).size !== choices.length) fail('invalid-argument', 'Choose only once per visit.');
  return choices;
}

async function reviewCurrentWeekRouteMove({
  db, companyId, auth, action, review, selection = [], targetDay, targetTechId,
  destinationRouteId = '', recurringPatch, assignRoute, linkPatch, now = () => new Date(),
}) {
  const previewOnly = review?.action === 'preview';
  if (!previewOnly && review?.action !== 'commit') {
    fail('failed-precondition', 'Review what happens to this week’s visits before changing the schedule. Open the current web app or update Drip Drop and try again.');
  }
  const requestId = previewOnly ? null : documentId(review.requestId, 'Move request');
  if (!selection.length || selection.length > moveLimit) {
    fail('resource-exhausted', `Select up to ${moveLimit} recurring stops at a time.`);
  }
  const choices = previewOnly ? [] : choicesFor(review);
  const fingerprint = stable(JSON.stringify([action, [...selection].sort(), targetDay, targetTechId, destinationRouteId, review.previewId, choices]));
  const c = db.collection('companies').doc(companyId);

  return db.runTransaction(async t => {
    const actor = await companyActor(db, t, companyId, auth?.uid, auth?.token);
    if (!can(actor, '244') && (action === 'update' || !can(actor, '234'))) {
      fail('permission-denied', 'Route or service-stop management permission is required.');
    }
    const journal = requestId ? c.collection('routeMoveRequests').doc(requestId) : null;
    const previous = journal && await t.get(journal);
    if (previous?.exists) {
      const old = previous.data();
      if (old.actorId !== actor.uid || old.fingerprint !== fingerprint) {
        fail('already-exists', 'This request ID belongs to a different route change.');
      }
      return { ...old.result, alreadyApplied: true };
    }
    const at = now();
    const zone = timeZone(actor.company);
    const today = dateKey(at, zone);
    const weekStart = weekOf(today);
    const nextWeek = addCalendarDays(weekStart, 7);
    const weekEnd = addCalendarDays(nextWeek, -1);
    const stopsRef = c.collection('serviceStops');
    const templatesRef = c.collection('recurringServiceStop');
    const selectedStops = action === 'permanentMove'
      ? await Promise.all(selection.map(id => t.get(stopsRef.doc(documentId(id, 'Service stop')))))
      : [];
    if (selectedStops.some(snap => !snap.exists || !snap.data().recurringServiceStopId)) {
      fail('failed-precondition', 'Select only recurring service stops for a permanent move.');
    }
    const rssIds = [...new Set(selectedStops.length ? selectedStops.map(snap => snap.data().recurringServiceStopId) : selection)].sort();
    const templates = await Promise.all(rssIds.map(id => t.get(templatesRef.doc(documentId(id, 'Recurring service stop')))));
    if (templates.some(snap => !snap.exists)) fail('not-found', 'A recurring service stop no longer exists.');
    const target = await activeWorker(t, db, c, companyId, targetTechId);
    const plans = [];

    for (const snap of templates) {
      const template = snap.data();
      if (template.companyId && template.companyId !== companyId) fail('permission-denied', 'The stop belongs to another company.');
      const changesSchedule = template.day !== targetDay || template.techId !== target.id;
      if (action === 'update' && !changesSchedule && previewOnly) return { reviewRequired: false };
      const oldSchedule = scheduleFor(template, zone);
      if (recurringPatch && (
        recurringPatch.frequency !== template.frequency ||
        dateKey(recurringPatch.startDate, zone) !== dateKey(template.startDate, zone) ||
        (date(recurringPatch.endDate) ? dateKey(recurringPatch.endDate, zone) : null) !== oldSchedule.end ||
        (Array.isArray(recurringPatch.daysOfWeek) && recurringPatch.daysOfWeek.length > 1)
      )) {
        fail('failed-precondition', 'Save the route day or technician change separately from changes to the service cadence or start and end dates.');
      }
      const newSchedule = { ...oldSchedule, anchor: nextAnchor(oldSchedule, targetDay, nextWeek) };
      const candidates = await t.get(stopsRef.where('recurringServiceStopId', '==', snap.id)
        .where('serviceDate', '>=', calendarDate(addCalendarDays(weekStart, -14), zone, 0)).limit(stopLimit + 1));
      if (candidates.size > stopLimit) fail('resource-exhausted', 'This schedule has too many visits to review in one change.');
      const visits = [];
      for (const stop of records(candidates)) {
        const day = dateKey(stop.serviceDate, zone);
        const original = stop.recurringServiceStopDateKey ||
          (date(stop.oneTimeRouteMove?.originalServiceDate) ? dateKey(stop.oneTimeRouteMove.originalServiceDate, zone) : day);
        if (day < weekStart && original < weekStart) continue;
        const tasks = records(await t.get(stopsRef.doc(stop.id).collection('tasks').limit(101)));
        if (tasks.length > 100) fail('resource-exhausted', 'A visit has too many tasks to move safely.');
        const state = visitState(stop, tasks);
        const inWeek = day < nextWeek || original < nextWeek;
        const newDay = original < nextWeek ? day : shiftDay(weekOf(original), targetDay);
        visits.push({ stop, tasks, day, original, inWeek, newDay, state });
      }
      const expectedThisWeek = shiftDay(weekStart, template.day);
      const expected = eligibleDate(expectedThisWeek, oldSchedule);
      const fulfilled = visits.filter(visit => visit.original === expectedThisWeek);
      const conflict = expected && fulfilled.length !== 1
        ? fulfilled.length ? 'More than one visit was found for this week’s scheduled occurrence.' : 'The expected visit for this week is missing.'
        : '';
      const future = visits.filter(visit => visit.original >= nextWeek &&
        (eligibleDate(visit.original, oldSchedule) || eligibleDate(visit.newDay, newSchedule)));
      const futureDates = future.filter(visit => eligibleDate(visit.newDay, newSchedule)).map(visit => visit.newDay);
      const unique = new Set(futureDates);
      if (unique.size !== futureDates.length) fail('failed-precondition', 'More than one visit matches a future occurrence. Resolve the duplicate visits before editing this schedule.');
      const nextDates = [0, 1, 2].map(index => addCalendarDays(newSchedule.anchor, index * newSchedule.interval))
        .filter(key => eligibleDate(key, newSchedule));
      plans.push({ snap, template, newSchedule, visits, future, futureDates, conflict, nextDates });
    }

    const summaries = plans.map(({ snap, template, visits, conflict, nextDates }) => ({
      id: snap.id, customer: template.customerName || 'Customer', location: template.address?.streetAddress || '',
      previousDay: template.day, previousTech: template.tech || template.techId || 'Unassigned',
      nextDay: targetDay, nextTech: target.name, nextDates, conflict,
      visits: visits.filter(visit => visit.inWeek).map(({ stop, day, state }) => ({
        id: stop.id, dateKey: day, technician: stop.tech || stop.techId || 'Unassigned', techId: stop.techId || '',
        status: stop.operationStatus || stop.status || 'Not Finished', state,
      })),
    }));
    const previewId = stable(JSON.stringify([companyId, actor.uid, today, destinationRouteId, summaries,
      plans.map(({ template, visits }) => [
        template.routeScheduleRevision || 0, date(template.updatedAt)?.getTime() || 0,
        visits.map(({ stop, original, day, state }) => [stop.id, stop.assignmentRevision || 0, stop.techId, original, day, state]),
      ]),
    ]));
    const resultPreview = { reviewRequired: true, previewId, today, weekStart, weekEnd, effectiveDate: nextWeek, schedules: summaries };
    if (previewOnly) {
      const roster = await t.get(c.collection('companyUsers').limit(401));
      if (roster.size > 400) fail('resource-exhausted', 'This company needs a narrower technician selection for route changes.');
      const technicians = [...new Map(records(roster).filter(member => active(member) &&
        (!member.companyId || member.companyId === companyId)).map(member => {
        const id = member.userId || member.id;
        return [id, { id, name: member.userName || [member.firstName, member.lastName].filter(Boolean).join(' ') || member.name || id }];
      })).values()].sort((left, right) => left.name.localeCompare(right.name));
      return { ...resultPreview, technicians };
    }
    if (review.previewId !== previewId) stale();
    if (plans.some(plan => plan.conflict)) {
      fail('failed-precondition', 'Resolve the missing or duplicate visit shown in the review before changing this schedule.');
    }

    const byId = new Map(choices.map(choice => [choice.stopId, choice]));
    const required = plans.flatMap(plan => plan.visits.filter(visit => visit.inWeek && visit.state === 'open'));
    if (required.length !== choices.length || required.some(visit => !byId.has(visit.stop.id))) {
      fail('failed-precondition', 'Choose Keep or Move for every open visit shown in the review.');
    }
    const workers = new Map([[target.id, target]]);
    for (const choice of choices.filter(value => value.action === 'move')) {
      calendarDate(choice.dateKey, zone);
      if (choice.dateKey < today || choice.dateKey > weekEnd) {
        fail('invalid-argument', 'Choose today or a remaining date this week.');
      }
      if (!workers.has(choice.techId)) workers.set(choice.techId, await activeWorker(t, db, c, companyId, choice.techId));
    }

    const updates = new Map();
    const originals = [];
    const moved = new Map();
    const futureStopIds = new Set();
    const confirmations = [];
    const templateUpdates = new Map();
    const write = (ref, patch) => updates.set(ref.path, { ref, patch: { ...updates.get(ref.path)?.patch, ...patch } });
    async function updateVisit(visit, day, worker, key, exception, extra = {}) {
      const { stop } = visit;
      const patch = { ...extra };
      if (key) Object.assign(patch, { recurringServiceStopDateKey: key, recurringServiceStopDedupKey: stop.recurringServiceStopId + '|' + key });
      if (exception) patch.routeScheduleException = exception;
      if (worker && (day !== visit.day || worker.id !== stop.techId)) {
        await planStopTaskMove({ t, c, stop, worker, workerId: worker.id, workerName: worker.name, at, write, tasks: visit.tasks });
        Object.assign(patch, {
          serviceDate: day === visit.day ? stop.serviceDate : calendarDate(day, zone),
          serviceDateKey: day, techId: worker.id, tech: worker.name, assignmentRevision: (stop.assignmentRevision || 0) + 1,
        });
        originals.push(stop);
        moved.set(stop.id, { ...stop, ...patch });
      }
      if (Object.keys(patch).length) write(stopsRef.doc(stop.id), { ...patch, updatedAt: at });
    }

    for (const plan of plans) {
      const { snap, template, newSchedule, visits, future, futureDates } = plan;
      const occupied = new Set();
      for (const visit of visits.filter(row => row.inWeek)) {
        const choice = byId.get(visit.stop.id);
        const newDay = choice?.action === 'move' ? choice.dateKey : visit.day;
        const worker = choice?.action === 'move' ? workers.get(choice.techId) : null;
        if (worker && visits.some(other => other.stop.id !== visit.stop.id &&
          (byId.get(other.stop.id)?.dateKey || other.day) === newDay)) {
          fail('failed-precondition', 'Two visits for this property would land on the same day.');
        }
        if (worker && occupied.has(newDay)) fail('failed-precondition', 'Select different dates for the visits to this property.');
        occupied.add(newDay);
        await updateVisit(visit, newDay, worker, visit.original, {
          requestId, action: choice?.action || visit.state, originalDateKey: visit.original, reviewedAt: at,
        });
        confirmations.push({ stopId: visit.stop.id, dateKey: newDay, technician: worker?.name || visit.stop.tech || visit.stop.techId || '', action: choice?.action || visit.state });
      }
      for (const visit of future) {
        const onSchedule = eligibleDate(visit.newDay, newSchedule);
        if (!onSchedule || visit.state !== 'open' || visit.inWeek) {
          if (onSchedule) await updateVisit(visit, visit.day, null, visit.newDay, {
            requestId, action: visit.state, originalDateKey: visit.original, reviewedAt: at,
          });
          continue;
        }
        if (visits.some(other => other.stop.id !== visit.stop.id &&
            !future.includes(other) && other.day === visit.newDay)) {
          fail('failed-precondition', 'The new schedule would overlap a visit already assigned to that date. Review the existing visit first.');
        }
        futureStopIds.add(visit.stop.id);
        const fields = recurringPatch ? Object.fromEntries([
          'description', 'type', 'typeId', 'typeImage', 'category', 'payTypeId', 'payTypeName',
          'defaultWorkTypeIds', 'serviceStopTypeUseCaseRawValue',
        ].filter(field => recurringPatch[field] !== undefined).map(field => [field, recurringPatch[field]])) : {};
        await updateVisit(visit, visit.newDay, target, visit.newDay, null, fields);
      }

      let cursor = null;
      for (let key = newSchedule.anchor; futureDates.includes(key); key = addCalendarDays(key, newSchedule.interval)) cursor = key;
      templateUpdates.set(snap.id, {
        ...recurringPatch, day: targetDay, techId: target.id, tech: target.name,
        ...(template.daysOfWeek ? { daysOfWeek: Array.isArray(template.daysOfWeek) ? [targetDay] : targetDay } : {}),
        routeScheduleRevision: (template.routeScheduleRevision || 0) + 1,
        routeScheduleEffectiveDateKey: nextWeek, routeScheduleAnchorDateKey: newSchedule.anchor, routeScheduleTimeZone: zone,
        lastCreated: cursor ? calendarDate(cursor, zone) : null, updatedAt: at,
      });
    }

    const routeIds = await planDailyRouteChanges({ t, c, companyId, zone, at, originals, moved, write });
    const assigned = await assignRoute({ db, transaction: t, companyId, recurringServiceStopIds: rssIds,
      targetDay, targetTechId: target.id, targetTechName: target.name, destinationRouteId, templateUpdates });
    const routeLink = linkPatch(assigned.destinationRouteId);
    for (const stopId of futureStopIds) write(stopsRef.doc(stopId), routeLink);
    if (updates.size + rssIds.length + assigned.updatedRouteCount + assigned.deletedRouteCount > 440) {
      fail('resource-exhausted', 'Split this route change into fewer stops. No changes were saved.');
    }
    const result = { success: true, status: 200, companyId, requestId, recurringServiceStopIds: rssIds,
      ...assigned, routeIds, currentWeekVisits: confirmations, schedules: summaries,
      selectedServiceStopCount: selection.length, futureServiceStopCount: futureStopIds.size,
      updatedFutureServiceStopCount: futureStopIds.size, updatedServiceStopCount: futureStopIds.size + confirmations.length };
    for (const { ref, patch } of updates.values()) t.set(ref, patch, { merge: true });
    t.set(journal, { actorId: actor.uid, action, fingerprint, createdAt: at, timeZone: zone, review: resultPreview, choices, result });
    return result;
  });
}

module.exports = { reviewCurrentWeekRouteMove };
