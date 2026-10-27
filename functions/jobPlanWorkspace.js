const { jobLaborTotals } = require("./jobScopePricing");
const { HttpsError } = require('firebase-functions/v2/https');

const key = (value) => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const id = (value) => typeof value === 'object' ? value?.id || value?.value || '' : String(value || '');
const list = (value) => Array.isArray(value) ? value : [];
const ids = (value) => list(value).map(id).filter(Boolean);
const amount = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
const linkedTaskId = (item) => id(item.linkedTaskId || item.linkedJobTaskId || item.jobTaskId || item.sourceTaskId || item.taskId);
const taskIds = (item) => ids(item.taskIds?.length ? item.taskIds : item.laborLineTaskIds);
const stopIds = (item) => ids(item.plannedServiceStopIds?.length ? item.plannedServiceStopIds : item.laborLinePlannedServiceStopIds);
const materialIds = (task) => [id(task.shoppingListItemId), ...ids(task.shoppingListItemIds)].filter(Boolean);

const hasActualWork = (record) => Boolean(
  ['scheduled', 'inprogress', 'finished', 'completed', 'complete', 'done', 'canceled', 'cancelled', 'skipped'].includes(key(record.status || record.operationStatus || record.completionStatus)) ||
  Number(record.actualTime || 0) > 0 || record.startedAt || record.finishedAt || record.completedAt ||
  id(record.serviceStopId) || record.serviceStopIdString || record.scheduledServiceStopId || record.convertedServiceStopId ||
  record.scheduledDate || record.workerId || record.assignedTechId || record.laborContractId
);
const hasPurchasedMaterial = (item) => Boolean(
  ['ordered', 'purchased', 'delivered', 'installed', 'invoiced', 'paid'].includes(key(item.status)) ||
  item.purchasedItem || item.purchasedItemId || item.datePurchased || item.purchasedAt || item.installedEquipmentId ||
  item.invoiced || item.invoiceId || item.invoiceRef || item.installedAt
);

// Snapshot prices/descriptions may change. Execution and fulfillment belong to the live records.
const runtimeFields = new Set([
  'status', 'operationStatus', 'completionStatus', 'actualTime', 'laborContractId', 'serviceStopId', 'serviceStopIdString',
  'convertedServiceStopId', 'shoppingListItemId', 'shoppingListItemIds', 'datePurchased', 'dateCompleted', 'dateFinished',
  'replacementEquipmentId', 'newEquipmentId', 'equipmentId', 'equipmentName', 'serviceLocationId', 'bodyOfWaterId',
  'dataBaseItemId', 'needsAction', 'actionDate', 'shoppingListActive', 'estimateAccepted', 'estimateAcceptedAt',
  'planWorkspaceOnly', 'approvalRequestId', 'partApprovalRequestId', 'customerApprovalStatus', 'customerApprovalRequestId',
  'purchaserId', 'purchaserName', 'receiptId', 'receiptRef', 'assignedCompanyUserId',
]);
const runtimePrefix = /^(actual|worker|assignedTech|scheduled|started|finished|completed|purchased|installed|invoiced|invoice|delivered|staged)/;
const planningLinks = new Set(['shoppingListItemId', 'shoppingListItemIds', 'equipmentId', 'equipmentName', 'serviceLocationId', 'bodyOfWaterId', 'dataBaseItemId']);
const plannedFields = (snapshot) => Object.fromEntries(Object.entries(snapshot).filter(([name]) =>
  planningLinks.has(name) || (!runtimeFields.has(name) && !runtimePrefix.test(name))
));
const preserveRuntime = (incoming, current) => {
  if (!current) return incoming;
  const actual = hasActualWork(current) || hasPurchasedMaterial(current);
  const fields = Object.entries(current).filter(([name]) => runtimeFields.has(name) || runtimePrefix.test(name) ||
    (actual && ['linkedTaskId', 'linkedTaskName', 'linkedTaskType', 'dbItemId', 'genericItemId'].includes(name)));
  return { ...incoming, ...Object.fromEntries(fields) };
};

function reconcileJobPlanScope(current, incoming) {
  const protectedIds = {
    tasks: new Set(current.tasks.filter(hasActualWork).map((item) => item.id)),
    plannedServiceStops: new Set(current.plannedServiceStops.filter(hasActualWork).map((item) => item.id)),
    shoppingItems: new Set(current.shoppingItems.filter(hasPurchasedMaterial).map((item) => item.id)),
    laborLineItems: new Set(current.laborLineItems.filter(hasActualWork).map((item) => item.id)),
  };
  let previousSize;
  do {
    previousSize = Object.values(protectedIds).reduce((sum, items) => sum + items.size, 0);
    current.shoppingItems.forEach((item) => {
      if (protectedIds.shoppingItems.has(item.id) && linkedTaskId(item)) protectedIds.tasks.add(linkedTaskId(item));
      if (protectedIds.tasks.has(linkedTaskId(item))) protectedIds.shoppingItems.add(item.id);
    });
    current.tasks.forEach((task) => {
      if (materialIds(task).some((value) => protectedIds.shoppingItems.has(value))) protectedIds.tasks.add(task.id);
      if (protectedIds.tasks.has(task.id)) materialIds(task).forEach((value) => protectedIds.shoppingItems.add(value));
    });
    current.plannedServiceStops.forEach((stop) => {
      if (protectedIds.plannedServiceStops.has(stop.id) || taskIds(stop).some((value) => protectedIds.tasks.has(value))) {
        protectedIds.plannedServiceStops.add(stop.id);
        taskIds(stop).forEach((value) => protectedIds.tasks.add(value));
      }
    });
    current.laborLineItems.forEach((line) => {
      if (taskIds(line).some((value) => protectedIds.tasks.has(value)) || stopIds(line).some((value) => protectedIds.plannedServiceStops.has(value))) {
        protectedIds.laborLineItems.add(line.id);
        taskIds(line).forEach((value) => protectedIds.tasks.add(value));
        stopIds(line).forEach((value) => protectedIds.plannedServiceStops.add(value));
      }
    });
  } while (Object.values(protectedIds).reduce((sum, items) => sum + items.size, 0) !== previousSize);

  for (const name of Object.keys(protectedIds)) {
    const incomingIds = new Set(incoming[name].map((item) => item.id));
    // Only existing records need to be preserved; older links may refer to a deleted record.
    if (current[name].some((item) => protectedIds[name].has(item.id) && !incomingIds.has(item.id))) {
      throw new HttpsError('failed-precondition', 'This plan would remove assigned or completed work, purchased materials, or their linked scope. Include that work in the revised plan before loading or accepting it.');
    }
  }

  return Object.fromEntries(Object.keys(incoming).map((name) => {
    const currentById = new Map(current[name].map((item) => [item.id, item]));
    return [name, incoming[name].map((item) => name === 'laborLineItems' ? item : preserveRuntime(item, currentById.get(item.id)))];
  }));
}

function normalizeLaborLines(lines, base, newId) {
  return list(lines).map((line, index) => {
    const lineId = line.id || line.laborLineId || newId('comp_job_labor_line');
    const quantity = Math.max(Number(line.quantity || line.defaultQuantity || 1) || 1, 1);
    const totalPriceCents = amount(line.totalPriceCents ?? line.totalAmountCents ?? line.amount ?? line.price ?? amount(line.unitPriceCents ?? line.unitAmountCents ?? line.rate) * quantity);
    return {
      ...line, ...base, id: lineId, laborLineId: lineId, quantity, totalPriceCents,
      unitPriceCents: amount(line.unitPriceCents ?? line.unitAmountCents ?? totalPriceCents / quantity),
      internalCostCents: amount(line.internalCostCents ?? line.internalLaborCostCents ?? line.laborCostCents ?? line.unitCostCents ?? line.cost),
      taskIds: taskIds(line), laborLineTaskIds: taskIds(line),
      plannedServiceStopIds: stopIds(line), laborLinePlannedServiceStopIds: stopIds(line),
      sortOrder: Number(line.sortOrder ?? index),
    };
  });
}

// All reads happen before apply(). Callers can include agreement acceptance in the same transaction.
async function prepareJobPlanWorkspace({
  db, transaction, companyId, jobId, planId, accepted = false, updateBillingStatus = true,
  selectedOption = null, actorUserId = '', actorUserName = '', timestamp, newId,
  jobUpdates: extraJobUpdates = {}, recordHistory = true, historyTitle = '',
}) {
  const companyRef = db.collection('companies').doc(companyId);
  const jobRef = companyRef.collection('workOrders').doc(jobId);
  const [jobSnap, planSnap, legacySnap, companySnap, tasksSnap, stopsSnap, materialsSnap, linesSnap, plansSnap, solutionsSnap] = await Promise.all([
    transaction.get(jobRef), transaction.get(jobRef.collection('plans').doc(planId)),
    transaction.get(jobRef.collection('solutions').doc(planId)), transaction.get(companyRef),
    transaction.get(jobRef.collection('tasks')), transaction.get(jobRef.collection('plannedServiceStops')),
    transaction.get(companyRef.collection('shoppingList').where('jobId', '==', jobId)),
    transaction.get(jobRef.collection('laborLineItems')),
    transaction.get(jobRef.collection('plans')), transaction.get(jobRef.collection('solutions')),
  ]);
  if (!jobSnap.exists) throw new HttpsError('not-found', 'This job is no longer available.');
  if (!planSnap.exists && !legacySnap.exists && !selectedOption) throw new HttpsError('not-found', 'This plan is no longer available.');
  const job = jobSnap.data();
  if (['invoiced', 'paid', 'comped'].includes(key(job.billingStatus)) || job.salesInvoiceId || job.invoiceDate) {
    throw new HttpsError('failed-precondition', 'This job has already been invoiced. Create a revision instead of replacing its plan scope.');
  }
  const selectedRef = planSnap.exists || !legacySnap.exists ? jobRef.collection('plans').doc(planId) : jobRef.collection('solutions').doc(planId);
  const plan = planSnap.exists ? planSnap.data() : legacySnap.exists ? legacySnap.data() : selectedOption;
  if (accepted && selectedOption) {
    const quotedTotal = selectedOption.totalAmountCents ?? selectedOption.rateAmountCents;
    const savedTotal = plan.totalAmountCents ?? plan.rateAmountCents;
    const billingSignature = (lines) => {
      let sequence = 0;
      return normalizeLaborLines(lines, {}, (prefix) => `${prefix}_${++sequence}`).map((line) => ({
        id: line.id, quantity: line.quantity, totalPriceCents: line.totalPriceCents,
        taxable: Boolean(line.taxable), taskIds: taskIds(line).sort(), plannedServiceStopIds: stopIds(line).sort(),
      })).sort((left, right) => left.id.localeCompare(right.id));
    };
    if ((quotedTotal !== undefined && savedTotal !== undefined && amount(quotedTotal) !== amount(savedTotal)) ||
        (Array.isArray(selectedOption.laborLineItems) && JSON.stringify(billingSignature(selectedOption.laborLineItems)) !== JSON.stringify(billingSignature(plan.laborLineItems ?? plan.estimateLaborLineItems)))) {
      throw new HttpsError('failed-precondition', 'This plan changed after the estimate was prepared. Request a revised estimate before accepting.');
    }
  }
  if (!['tasks', 'plannedServiceStops', 'shoppingItems', 'laborLineItems', 'estimateLaborLineItems'].some((name) => Array.isArray(plan[name]))) {
    throw new HttpsError('failed-precondition', 'This plan has no saved work scope. Open the job and save the plan before loading or accepting it.');
  }
  const readDocs = (snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  const current = {
    tasks: readDocs(tasksSnap), plannedServiceStops: readDocs(stopsSnap), shoppingItems: readDocs(materialsSnap),
    laborLineItems: normalizeLaborLines(job.laborLineItems ?? job.estimateLaborLineItems ?? readDocs(linesSnap), {}, newId),
  };
  const base = { companyId, jobId, sourcePlanId: planId, sourceSolutionId: planId };
  const tasks = list(plan.tasks).map((task, index) => ({
    ...plannedFields(task), ...base, id: task.id || newId('comp_job_task'), status: 'Draft', actualTime: 0,
    workerId: '', workerName: '', workerType: 'Not Assigned', laborContractId: '', serviceStopId: { id: '', internalId: '' },
    sortOrder: Number(task.sortOrder ?? index),
  }));
  const validTasks = new Set(tasks.map((task) => task.id));
  const plannedServiceStops = list(plan.plannedServiceStops).map((stop, index) => ({
    ...plannedFields(stop), ...base, id: stop.id || newId('comp_job_plan_stop'),
    taskIds: taskIds(stop).filter((value) => validTasks.has(value)), sortOrder: Number(stop.sortOrder ?? index),
  }));
  const validStops = new Set(plannedServiceStops.map((stop) => stop.id));
  const laborLineItems = normalizeLaborLines(plan.laborLineItems ?? plan.estimateLaborLineItems, base, newId).map((line) => ({
    ...line, taskIds: taskIds(line).filter((value) => validTasks.has(value)), laborLineTaskIds: taskIds(line).filter((value) => validTasks.has(value)),
    plannedServiceStopIds: stopIds(line).filter((value) => validStops.has(value)), laborLinePlannedServiceStopIds: stopIds(line).filter((value) => validStops.has(value)),
    acceptedPlanScope: accepted,
  }));
  const company = companySnap.data() || {};
  const shoppingItems = list(plan.shoppingItems).map((item, index) => {
    const taskId = linkedTaskId(item);
    const customerId = job.customerId || '';
    const serviceLocationId = job.serviceLocationId || '';
    return {
      ...plannedFields(item), ...base, id: item.id || newId('comp_shop'), category: 'Job', customerId, serviceLocationId,
      customerName: job.customerName || '', status: 'Need to Purchase', linkedTaskId: validTasks.has(taskId) ? taskId : '',
      purchasedItem: '', invoiced: false, datePurchased: null,
      customerApprovalStatus: item.customerApprovalRequired ? 'pending' : 'notRequired',
      estimateAccepted: accepted, estimateAcceptedAt: accepted ? timestamp : null,
      jobBillingStatus: accepted ? 'accepted' : key(job.billingStatus || 'Draft'),
      planWorkspaceOnly: !accepted, shoppingListActive: accepted, needsAction: accepted,
      planId, solutionId: planId, sortOrder: Number(item.sortOrder ?? index),
      autoInvoiceOnInstall: item.autoInvoiceOnInstall ?? (company.shoppingItemInstallInvoiceAutomationEnabled === true),
      prepKeys: [`job:${jobId}`, customerId && `customer:${customerId}`, serviceLocationId && `serviceLocation:${serviceLocationId}`, validTasks.has(taskId) && `jobTask:${taskId}`].filter(Boolean),
    };
  });
  for (const items of [tasks, plannedServiceStops, laborLineItems, shoppingItems]) {
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new HttpsError('failed-precondition', 'This plan contains duplicate scope IDs. Save a corrected plan before continuing.');
  }
  const scope = reconcileJobPlanScope(current, { tasks, plannedServiceStops, laborLineItems, shoppingItems });
  if (accepted) {
    scope.shoppingItems = scope.shoppingItems.map((item) => ({
      ...item, estimateAccepted: true, estimateAcceptedAt: item.estimateAcceptedAt || timestamp,
      jobBillingStatus: 'accepted', planWorkspaceOnly: false, shoppingListActive: true,
      needsAction: !['installed', 'invoiced', 'paid'].includes(key(item.status)),
    }));
  }
  // Keep both sides of task/material links when restoring older plan snapshots.
  scope.tasks = scope.tasks.map((task) => {
    const shoppingListItemIds = [...new Set([
      ...materialIds(task).filter((value) => scope.shoppingItems.some((item) => item.id === value)),
      ...scope.shoppingItems.filter((item) => linkedTaskId(item) === task.id).map((item) => item.id),
    ])];
    return { ...task, shoppingListItemId: shoppingListItemIds[0] || '', shoppingListItemIds };
  });

  const tier = Math.min(4, Math.max(1, Number(plan.planTier || plan.solutionTier || 2) || 2));
  const tierLabel = plan.planTierLabel || plan.solutionTierLabel || ['', 'Minimum Repair', 'Standard Fix', 'Better Fix', 'Best Upgrade'][tier];
  const selectionStatus = accepted ? 'Accepted' : plan.status || 'Draft';
  const jobUpdates = {
    ...extraJobUpdates, activePlanId: planId, activeSolutionId: planId, activePlanTier: tier, activeSolutionTier: tier,
    activePlanTierLabel: tierLabel, activeSolutionTierLabel: tierLabel,
    activePlanRecommendationRank: tier, activePlanRecommendationRankLabel: tierLabel,
    planSelectionStatus: selectionStatus, solutionSelectionStatus: selectionStatus,
    laborLineItems: scope.laborLineItems, estimateLaborLineItems: scope.laborLineItems,
    laborLineCount: scope.laborLineItems.length, taskCount: scope.tasks.length,
    plannedStopCount: scope.plannedServiceStops.length, materialCount: scope.shoppingItems.length,
    updatedAt: timestamp, updatedAtMillis: Date.now(),
  };
  if (accepted) {
    const materialPrice = scope.shoppingItems.reduce((sum, item) => sum + amount(item.plannedTotalPriceCents ?? Number(item.plannedUnitPriceCents ?? item.price ?? 0) * Number(item.quantity ?? 1)), 0);
    const { priceCents: laborPrice, costCents: laborCost } = jobLaborTotals(scope);
    const totalPrice = amount(plan.totalAmountCents ?? plan.rateAmountCents ?? selectedOption?.totalAmountCents ?? selectedOption?.rateAmountCents ?? (laborPrice + materialPrice));
    Object.assign(jobUpdates, {
      acceptedPlanId: planId, acceptedSolutionId: planId, acceptedPlanTier: tier, acceptedSolutionTier: tier,
      acceptedPlanTierLabel: tierLabel, acceptedSolutionTierLabel: tierLabel,
      acceptedPlanTitle: plan.title || plan.name || '', acceptedSolutionTitle: plan.title || plan.name || '',
      acceptedPlanRecommendationRank: tier, acceptedPlanRecommendationRankLabel: tierLabel,
      rate: totalPrice,
      laborCost: amount(plan.costSummary?.plannedLaborCostCents ?? plan.laborCostCents ?? plan.plannedLaborCostCents ?? laborCost),
      estimateLineItems: list(plan.estimateLineItems ?? plan.lineItems ?? selectedOption?.lineItems),
      estimateSubtotalCents: amount(plan.subtotalAmountCents ?? totalPrice),
      estimateTotalCents: totalPrice,
      acceptedPlanCostSummary: plan.costSummary || {}, acceptedPlanBillingSummary: plan.billingSummary || {},
    });
    if (updateBillingStatus) {
      jobUpdates.billingStatus = 'Accepted';
      jobUpdates.operationStatus = !job.operationStatus || job.operationStatus === 'Estimate Pending' ? 'Unscheduled' : job.operationStatus;
    }
  }

  const operations = [];
  const set = (ref, data, merge = false) => operations.push((writer) => merge ? writer.set(ref, data, { merge: true }) : writer.set(ref, data));
  const replace = (snapshot, items, refFor) => {
    const keep = new Set(items.map((item) => item.id));
    snapshot.docs.filter((doc) => !keep.has(doc.id)).forEach((doc) => operations.push((writer) => writer.delete(doc.ref)));
    items.forEach((item) => set(refFor(item.id), item));
  };
  replace(tasksSnap, scope.tasks, (value) => jobRef.collection('tasks').doc(value));
  replace(stopsSnap, scope.plannedServiceStops, (value) => jobRef.collection('plannedServiceStops').doc(value));
  replace(materialsSnap, scope.shoppingItems, (value) => companyRef.collection('shoppingList').doc(value));
  replace(linesSnap, scope.laborLineItems, (value) => jobRef.collection('laborLineItems').doc(value));
  set(jobRef, jobUpdates, true);
  const planDocs = [...plansSnap.docs, ...solutionsSnap.docs];
  if (!planDocs.some((doc) => doc.ref.path === selectedRef.path)) planDocs.push({ ref: selectedRef, data: () => plan });
  planDocs.forEach((doc) => {
    const selected = doc.ref.path === selectedRef.path;
    const existing = doc.data();
    const updates = { isActivePlan: selected, updatedAt: timestamp };
    if (accepted) {
      Object.assign(updates, { isAccepted: selected });
      if (selected) Object.assign(updates, {
        status: 'Accepted', acceptedAt: existing.acceptedAt || timestamp,
        acceptedByUserId: existing.acceptedByUserId || actorUserId, acceptedByUserName: existing.acceptedByUserName || actorUserName,
      });
      else if (key(existing.status) === 'accepted') Object.assign(updates, { status: 'Superseded', supersededAt: timestamp });
    }
    set(doc.ref, updates, true);
  });
  if (recordHistory) {
    const historyId = newId('comp_job_hist');
    set(jobRef.collection('history').doc(historyId), {
      id: historyId, companyId, jobId, eventType: 'Plan',
      title: historyTitle || `Plan ${accepted ? 'accepted' : 'loaded for editing'}: ${plan.title || plan.name || planId}`,
      description: plan.description || '', actorUserId, actorUserName, createdAt: timestamp, createdAtMillis: Date.now(),
      metadata: { planId, planTier: tier, preservedExecutionState: true },
      changes: Object.keys(scope).map((name) => ({ field: name, label: name, before: String(current[name].length), after: String(scope[name].length) })),
      severity: accepted ? 'success' : 'info',
    });
  }
  // Leave room for agreement/subscription writes in a surrounding acceptance transaction.
  if (operations.length > 450) throw new HttpsError('failed-precondition', 'This job is too large to replace its plan in one update. No work has been changed.');
  return { scope, jobUpdates, plan, apply: () => operations.forEach((operation) => operation(transaction)) };
}

module.exports = { reconcileJobPlanScope, prepareJobPlanWorkspace };
