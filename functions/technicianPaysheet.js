const { companyActor, documentId, fail } = require('./companyActor');
const { date, dateKey, calendarDate, addCalendarDays, timeZone, routeStopIds } = require('./routeState');
const { selectPayRate } = require('./payrollCalculation');

const rows = snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, path: doc.ref.path }));
const done = value => ['finished', 'completed', 'complete', 'done'].includes(String(value.status || value.operationStatus || '').toLowerCase());
const live = value => !value.voidedAt && value.calculationStatus !== 'voided';
const review = value => ['pending', 'needsReview'].includes(value.calculationStatus);
const cents = value => {
  if (!Number.isSafeInteger(Number(value))) fail('failed-precondition', 'A pay amount needs management review.');
  return Number(value);
};
const sum = values => values.reduce((total, value) => total + cents(value.totalAmountCents), 0);
const millis = value => date(value)?.getTime() ?? null;
const unique = values => [...new Map(values.map(value => [value.path || value.id, value])).values()];
const completion = value => date(value.completedAt || value.finishedAt || value.endTime || value.serviceDate);
const inPeriod = (value, start, end) => value && value >= start && value < end;
const title = value => value.taskName || value.payTypeName || value.workTypeName || value.displayTitle || value.serviceStopTypeName || 'Work pay';

function rateLabel(line) {
  if (review(line)) return 'Amount pending review';
  if (line.source === 'manualAdjustment' || line.rateType === 'manual') return line.notes || 'Custom pay / adjustment';
  const money = value => '$' + (cents(value) / 100).toFixed(2);
  if (line.rateType === 'percentage') return `${Number(line.rateAmountCents) / 100}% of agreed base`;
  const hours = line.rateType === 'hourly';
  const quantity = Number(line.quantity || 0) / (hours && line.quantityUnit === 'minutes' ? 60 : 1);
  return `${Number(quantity.toFixed(2))}${hours ? ' hr' : ''} × ${money(line.rateAmountCents || 0)}${hours ? '/hr' : ''}`;
}

// A read-only, auth-UID scoped contract used by both technician clients. Source
// coverage is presentation data; it never creates a zero-dollar payroll record.
function createTechnicianPaysheet(db, now = () => new Date()) {
  async function limited(query, limit = 2500) {
    const snapshot = await query.limit(limit + 1).get();
    if (snapshot.size > limit) fail('resource-exhausted', 'This paysheet is too large to verify completely. Choose a shorter period or contact management.');
    return rows(snapshot);
  }
  return async request => {
    const uid = request.auth?.uid;
    if (!uid) fail('unauthenticated', 'Sign in to view your paysheet.');
    const input = request.data || {}, companyId = documentId(input.companyId, 'Company');
    if (input.technicianId && input.technicianId !== uid) fail('permission-denied', 'You can only view your own paysheet.');
    const actor = await companyActor(db, { get: ref => ref.get() }, companyId, uid, request.auth.token);
    const zone = timeZone(actor.company, input.timeZone || 'UTC');
    let endKey = input.endDateKey || dateKey(now(), zone);
    calendarDate(endKey, zone, 0);
    let startKey = input.startDateKey || addCalendarDays(endKey, -29);
    let start = calendarDate(startKey, zone, 0), end = calendarDate(addCalendarDays(endKey, 1), zone, 0);
    const dayCount = (Date.parse(endKey + 'T00:00:00Z') - Date.parse(startKey + 'T00:00:00Z')) / 86400000 + 1;
    if (start >= end || dayCount > 93 || endKey > dateKey(now(), zone)) fail('invalid-argument', 'Choose a past or current period of at most 93 days.');
    const c = db.collection('companies').doc(companyId), pay = c.collection('technicianPayLineItems');
    const own = query => query.where('technicianId', '==', uid);
    const allStatements = await limited(own(c.collection('technicianPayStatements')), 2000);
    const paidStatements = allStatements.filter(value => value.status !== 'voided' && (value.status === 'paid' || value.paidAt));
    const paidById = new Map(paidStatements.map(value => [value.id, value]));
    const paidByLine = new Map(paidStatements.flatMap(value => (value.lineItemIds || []).map(id => [id, value])));
    const statementFor = line => paidById.get(line.payStatementId) || paidByLine.get(line.id);
    const isPaid = line => Boolean(line.paidAt || line.calculationStatus === 'paid' || statementFor(line));
    const visible = line => live(line) && ['pending', 'needsReview', 'calculated', 'approved', 'adjusted', 'paid'].includes(line.calculationStatus) && (cents(line.totalAmountCents) !== 0 || review(line));
    const lineDTO = line => {
      const statement = statementFor(line), needsReview = !isPaid(line) && review(line);
      return { id: line.id, technicianId: uid, title: (line.payrollSource === 'payCorrection' ? 'Pay correction · ' : '') + title(line), customerName: line.customerName || line.displaySubtitle || '',
        serviceLocationAddress: line.serviceLocationAddress || '', completedDate: millis(line.completedDate),
        totalAmountCents: cents(line.totalAmountCents), rateDescription: rateLabel(line), needsReview, isPaid: isPaid(line),
        statusLabel: isPaid(line) ? 'Recorded paid' : needsReview ? 'Pay needs review' : line.calculationStatus === 'approved' ? 'Approved · unpaid' : 'Unpaid',
        paidAt: millis(line.paidAt || statement?.paidAt), paymentReference: line.paymentReference || statement?.paymentReference || statement?.externalReferenceId || '',
        payTypeId: line.payTypeId || line.workTypeId || '', payTypeName: line.payTypeName || line.workTypeName || '', rateType: line.rateType || 'manual', payBasis: line.payBasis || (line.source === 'serviceStopTask' ? 'serviceStopTask' : 'serviceStop'),
        source: line.source || '', serviceStopId: line.serviceStopId || '', serviceStopTaskId: line.serviceStopTaskId || '',
        jobId: line.jobId || '', jobTaskId: line.jobTaskId || '', activeRouteId: line.activeRouteId || '', calculationStatus: line.calculationStatus };
    };
    const statementDTO = value => ({ id: value.id, reference: value.statementReference || `Paysheet #${value.statementNumber || value.id}`,
      startDate: millis(value.startDate), endDate: millis(value.endDate), status: value.status,
      subtotalCents: cents(value.subtotalCents), adjustmentCents: cents(value.adjustmentCents || 0), totalCents: cents(value.totalCents),
      paidAt: millis(value.paidAt), paymentReference: value.paymentReference || value.externalReferenceId || '', notes: value.notes || '', paidNotes: value.paidNotes || '' });
    const statements = allStatements.filter(value => ['approved', 'paid'].includes(value.status) || value.status !== 'voided' && value.paidAt)
      .sort((a, b) => millis(b.endDate) - millis(a.endDate)).map(statementDTO);
    let missingCount = 0, selectedStatement = null, rawLines;
    if (input.statementId) {
      selectedStatement = allStatements.find(value => value.id === documentId(input.statementId, 'Statement') && value.status !== 'voided');
      if (!selectedStatement) fail('not-found', 'This statement is unavailable.');
      const linked = await limited(own(pay).where('payStatementId', '==', selectedStatement.id));
      const ids = [...new Set(selectedStatement.lineItemIds || [])];
      const missing = ids.filter(id => !linked.some(line => line.id === id));
      const legacy = await Promise.all(missing.map(async id => {
        const snapshot = await pay.doc(documentId(id, 'Pay item')).get();
        return snapshot.exists && snapshot.data().technicianId === uid ? { ...snapshot.data(), id: snapshot.id } : null;
      }));
      rawLines = unique([...linked, ...legacy.filter(Boolean)]);
      missingCount = ids.filter(id => !rawLines.some(line => line.id === id)).length;
      start = date(selectedStatement.startDate); end = new Date(millis(selectedStatement.endDate) + 1);
      startKey = dateKey(start, zone); endKey = dateKey(selectedStatement.endDate, zone);
    } else {
      rawLines = await limited(own(pay).where('completedDate', '>=', start).where('completedDate', '<', end));
    }
    const lines = rawLines.filter(visible), confirmed = lines.filter(line => !review(line) || isPaid(line));
    const older = input.statementId ? [] : (await limited(own(pay).where('completedDate', '<', start)
      .where('calculationStatus', 'in', ['pending', 'calculated', 'needsReview', 'approved', 'adjusted']))).filter(visible).filter(line => !isPaid(line));
    const summary = { earnedCents: sum(confirmed), recordedPaidCents: sum(confirmed.filter(isPaid)), remainingCents: sum(confirmed.filter(line => !isPaid(line))),
      olderUnpaidCents: sum(older.filter(line => !review(line))), olderReviewCount: older.filter(review).length,
      reviewCount: lines.filter(line => !isPaid(line) && review(line)).length, completedStops: 0, completedTasks: 0 };
    // Statement-level adjustments have no individual work completion date. Keep
    // them whole on the statement's period-ending date, never prorate or invent
    // earnings rows. Saved statements retain their authoritative original totals.
    const adjustments = selectedStatement ? [] : allStatements.filter(value =>
      ['approved', 'paid'].includes(value.status) && cents(value.adjustmentCents || 0) !== 0);
    const currentAdjustments = adjustments.filter(value => inPeriod(date(value.endDate), start, end));
    for (const value of currentAdjustments) {
      const amount = cents(value.adjustmentCents), paid = value.status === 'paid' || value.paidAt;
      summary.earnedCents += amount;
      summary[paid ? 'recordedPaidCents' : 'remainingCents'] += amount;
    }
    summary.olderUnpaidCents += adjustments.filter(value => date(value.endDate) < start && value.status !== 'paid' && !value.paidAt)
      .reduce((total, value) => total + cents(value.adjustmentCents), 0);
    const categories = new Map();
    confirmed.forEach(line => {
      const name = line.payrollSource === 'payCorrection' ? 'Pay corrections' : line.payrollSource === 'workOfferIncentive' ? 'Bonuses & incentives'
        : line.source === 'manualAdjustment' && line.payBasis === 'manualAdjustment' && !line.serviceStopId ? 'Other adjustments'
        : line.payTypeName || line.workTypeName || (line.rateType === 'hourly' ? 'Hourly work' : line.serviceStopTaskId || line.jobTaskId ? 'Task earnings' : 'Stop earnings');
      categories.set(name, (categories.get(name) || 0) + cents(line.totalAmountCents));
    });
    if (currentAdjustments.length) categories.set('Statement adjustments', currentAdjustments.reduce((total, value) => total + cents(value.adjustmentCents), 0));
    const response = { version: 1, companyName: actor.company.name || '', technicianName: actor.name, timeZone: zone, startDateKey: startKey, endDateKey: endKey,
      summary, earnings: [...categories].map(([label, amountCents]) => ({ id: label, label, amountCents })), lineItems: lines.map(lineDTO),
      statements, statement: selectedStatement ? statementDTO(selectedStatement) : null, missingCount,
      detailWarning: selectedStatement && !missingCount && sum(rawLines.filter(live)) !== cents(selectedStatement.subtotalCents)
        ? 'The loaded work does not match the saved statement subtotal. This breakdown needs review; the saved statement total is shown.' : '',
      days: [], olderItems: older.map(lineDTO) };

    const stopMap = new Map(), routes = new Map(), taskMap = new Map();
    const ownSource = value => (value.techId || value.technicianId) === uid;
    if (!selectedStatement) {
      const stopQueries = [];
      for (const identity of ['techId', 'technicianId']) for (const field of ['serviceDate', 'completedAt', 'finishedAt', 'endTime']) {
        stopQueries.push(limited(c.collection('serviceStops').where(identity, '==', uid).where(field, '>=', start).where(field, '<', end)));
      }
      const [stopResults, routeResults, taskResults] = await Promise.all([
        Promise.all(stopQueries), limited(c.collection('activeRoutes').where('techId', '==', uid).where('date', '>=', start).where('date', '<', end)),
        Promise.all(['completedAt', 'finishedAt', 'endTime', 'serviceDate'].map(field => limited(db.collectionGroup('tasks').where('workerId', '==', uid).where(field, '>=', start).where(field, '<', end))))
      ]);
      unique(stopResults.flat()).filter(value => ownSource(value) && done(value) && inPeriod(completion(value), start, end)).forEach(value => stopMap.set(value.id, value));
      routeResults.forEach(value => routes.set(value.id, value));
      unique(taskResults.flat()).filter(value => value.path.startsWith(c.path + '/') && done(value) && inPeriod(completion(value), start, end)).forEach(value => taskMap.set(value.path, value));
    }
    // Load source stops referenced by own earnings or independently assigned tasks.
    const stopIds = new Set(lines.filter(line => line.payrollSource !== 'payCorrection').map(line => line.serviceStopId).filter(Boolean));
    taskMap.forEach(task => { const parts = task.path.split('/'); if (parts[2] === 'serviceStops') stopIds.add(parts[3]); });
    await Promise.all([...stopIds].filter(id => !stopMap.has(id)).map(async id => {
      const snapshot = await c.collection('serviceStops').doc(documentId(id)).get();
      if (snapshot.exists) stopMap.set(id, { ...snapshot.data(), id });
    }));
    if (!selectedStatement) await Promise.all([...stopMap.values()].map(async stop => {
      (await limited(c.collection('serviceStops').doc(stop.id).collection('tasks'), 500)).filter(task => done(task) &&
        (task.workerId ? task.workerId === uid : ownSource(stop)) && inPeriod(completion(task) || completion(stop), start, end)).forEach(task => taskMap.set(task.path, task));
    }));
    // Only routes assigned to this user are returned, including older route links.
    const routeIds = new Set([...lines.map(line => line.activeRouteId), ...[...stopMap.values()].map(stop => stop.activeRouteId)].filter(Boolean));
    await Promise.all([...routeIds].filter(id => !routes.has(id)).map(async id => {
      const snapshot = await c.collection('activeRoutes').doc(documentId(id)).get();
      if (snapshot.exists && ownSource(snapshot.data())) routes.set(id, { ...snapshot.data(), id });
    }));
    const [rates, settingsSnapshot] = await Promise.all([
      !selectedStatement ? limited(c.collection('technicianRates').where('technicianId', '==', uid)) : [],
      c.collection('paySettings').doc('main').get(),
    ]);
    const settings = settingsSnapshot.data() || {};
    const days = new Map(), assigned = new Set();
    const dayRoute = (day, route) => {
      if (!days.has(day)) days.set(day, { id: day, routes: [] });
      const groups = days.get(day).routes, id = route?.id || 'outside-route';
      let group = groups.find(value => value.id === id);
      if (!group) { group = { id, name: route?.name || 'Work outside a route', stops: [], lines: [], totalCents: 0 }; groups.push(group); }
      return group;
    };
    const noAdditional = (record, basis, stop = {}) => {
      if (record.payrollMode === 'unpaid' || record.payrollAgreement?.paySource === 'Unpaid') return true;
      if (record.payrollMode === 'custom' && record.manualPayOverrideCents != null && Number(record.manualPayOverrideCents) === 0) return true;
      if (record.payrollMode === 'included') return true;
      const typeId = record.payTypeId || record.payWorkTypeId || record.workTypeId || (basis === 'serviceStop' ? stop.typeId : '');
      const rate = selectPayRate({ companyId, technicianId: uid, workTypeId: typeId, basis, rates, date: stop.serviceDate || completion(record) });
      return rate && Number(rate.amountCents) === 0;
    };
    const coverage = (record, values, parentLines = [], parent = {}) => {
      if (values.some(line => !isPaid(line) && review(line))) return 'Pay needs review';
      if (values.some(line => !review(line) || isPaid(line))) return values.every(isPaid) ? 'Recorded paid' : 'Unpaid';
      if (parent.hourlyCovered && record.payrollMode !== 'custom' && record.payrollStackBehavior !== 'stackable') return 'Included in route hourly pay';
      const fixedVisit = parent.payrollAgreement?.paySource === 'Offered Amount' && !(parent.payrollAgreement.taskIds || []).length &&
        (parent.payrollAgreement.stopTasks || []).some(value => value.taskId === record.id);
      const included = record.payrollMode === 'included' || fixedVisit || (parent.payrollMode === 'custom' && record.payrollStackBehavior !== 'stackable');
      if (included && parentLines.some(line => !review(line) && cents(line.totalAmountCents) > 0)) return 'Included in stop pay';
      if (noAdditional(record, parent.id ? 'serviceStopTask' : 'serviceStop', parent)) return 'No additional pay';
      return 'Pay needs review';
    };
    const claim = values => values.forEach(value => assigned.add(value.id));
    const tasksSeen = new Set();
    for (const stop of stopMap.values()) {
      const stopLines = lines.filter(line => line.serviceStopId === stop.id && line.payrollSource !== 'payCorrection');
      const taskKeys = new Set();
      const stopTasks = [...taskMap.values()].filter(task => {
        if (task.path.split('/')[2] !== 'serviceStops' || task.path.split('/')[3] !== stop.id) return false;
        const key = task.jobTaskId || task.workOrderTaskId || task.id;
        if (taskKeys.has(key)) return false;
        taskKeys.add(key); return true;
      });
      if (!ownSource(stop) && !stopLines.length && !stopTasks.length) continue;
      const route = [...routes.values()].find(route => route.id === stop.activeRouteId || routeStopIds(route).includes(stop.id));
      const hourlyCovered = settings.payMode === 'hourlyOnly' && ['activeRouteDuration', 'activeRouteLogs'].includes(settings.hourlyPaySource) &&
        route && lines.some(line => line.activeRouteId === route.id && line.rateType === 'hourly' && !review(line) && cents(line.totalAmountCents) > 0);
      const workDate = inPeriod(completion(stop), start, end) ? completion(stop) : completion(stopTasks[0] || {}) || date(stopLines[0]?.completedDate) || start;
      const day = dateKey(workDate, zone), group = dayRoute(day, route);
      const base = stopLines.filter(line => !line.serviceStopTaskId && !line.jobTaskId);
      const tasks = stopTasks.map(task => {
        const key = task.jobTaskId || task.workOrderTaskId;
        if (key && stop.jobId) tasksSeen.add(stop.jobId + ':' + key);
        const values = lines.filter(line => line.payrollSource !== 'payCorrection' && !assigned.has(line.id) && (line.serviceStopTaskId === task.id && line.serviceStopId === stop.id || key && line.jobTaskId === key && line.jobId === stop.jobId));
        claim(values);
        return { id: task.id, title: task.name || 'Completed task', coverageLabel: coverage(task, values, base, { ...stop, hourlyCovered }), lines: values.map(lineDTO) };
      });
      const remainder = stopLines.filter(line => !assigned.has(line.id)); claim(remainder);
      const stopCoverage = ownSource(stop) ? coverage(stop, base) : 'Assigned task work';
      const ownStop = ownSource(stop) && done(stop) && inPeriod(completion(stop), start, end);
      // A stop paid exclusively through its tasks is still accounted for.
      const taskOnly = settings.routePaySource === 'completedTasks' || settings.payMode === 'hourlyOnly' && settings.hourlyPaySource === 'taskActualTime';
      const routeHourly = route && lines.some(line => line.activeRouteId === route.id && line.rateType === 'hourly' && !review(line) && cents(line.totalAmountCents) > 0);
      const label = selectedStatement ? 'Statement work' : stopCoverage !== 'Pay needs review' ? stopCoverage
        : routeHourly ? 'Included in route hourly pay'
        : taskOnly && tasks.length && tasks.every(task => task.coverageLabel !== 'Pay needs review') ? 'Pay shown in tasks'
        : settings.routePaySource === 'none' && settings.payMode !== 'hourlyOnly' ? 'No additional stop pay' : stopCoverage;
      const stopAmount = [...remainder.map(lineDTO), ...tasks.flatMap(task => task.lines)].filter(line => !line.needsReview).reduce((total, line) => total + line.totalAmountCents, 0);
      group.stops.push({ id: stop.id, title: stop.customerName || stopLines[0]?.customerName || stop.type || 'Completed stop',
        subtitle: [stop.type, stop.address?.streetAddress].filter(Boolean).join(' · '),
        coverageLabel: tasks.some(task => task.coverageLabel === 'Pay needs review') ? 'Pay needs review' : label,
        ownPayNeedsReview: label === 'Pay needs review', amountCents: stopAmount, ownStop,
        order: (route?.order || []).find(value => value.serviceStopId === stop.id)?.order || routeStopIds(route || {}).indexOf(stop.id) + 1 || 999,
        lines: remainder.map(lineDTO), tasks });
    }
    // Independently assigned, unscheduled job tasks have no route or stop.
    for (const task of taskMap.values()) {
      const parts = task.path.split('/');
      if (parts[2] !== 'workOrders' || task.serviceStopId || tasksSeen.has(parts[3] + ':' + task.id)) continue;
      const values = lines.filter(line => line.jobId === parts[3] && line.jobTaskId === task.id); claim(values);
      dayRoute(dateKey(completion(task), zone), null).stops.push({ id: 'job-task:' + task.id, title: task.name || 'Completed job task', subtitle: 'Job task · outside a route',
        coverageLabel: coverage(task, values), ownPayNeedsReview: coverage(task, values) === 'Pay needs review',
        amountCents: sum(values.filter(line => !review(line) || isPaid(line))), ownStop: false, order: 999, lines: values.map(lineDTO), tasks: [] });
    }
    for (const line of lines.filter(line => !assigned.has(line.id))) {
      const route = routes.get(line.activeRouteId);
      dayRoute(dateKey(line.completedDate, zone), route).lines.push(lineDTO(line));
    }
    response.days = [...days.values()].sort((a, b) => b.id.localeCompare(a.id));
    const gaps = new Set();
    response.days.forEach(day => day.routes.forEach(group => {
      group.stops.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      group.stops.forEach(stop => {
        if (stop.ownStop) summary.completedStops++;
        summary.completedTasks += stop.tasks.length + (stop.id.startsWith('job-task:') ? 1 : 0);
        if (!selectedStatement && stop.ownPayNeedsReview && !stop.lines.some(line => line.needsReview)) gaps.add(stop.id);
        stop.tasks.forEach(task => { if (task.coverageLabel === 'Pay needs review' && !task.lines.some(line => line.needsReview)) gaps.add(stop.id + ':' + task.id); });
      });
      const groupLines = [...group.lines, ...group.stops.flatMap(stop => [...stop.lines, ...stop.tasks.flatMap(task => task.lines)])];
      group.totalCents = groupLines.filter(line => !line.needsReview).reduce((total, line) => total + line.totalAmountCents, 0);
    }));
    summary.reviewCount += gaps.size;
    return input.mode === 'summary' ? { ...response, earnings: [], lineItems: [], statements: [], olderItems: [], days: [] } : response;
  };
}
module.exports = { createTechnicianPaysheet, rateLabel };
