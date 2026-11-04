// Maintenance/repair history is an effect of saved work, independent of the client.
// The planner performs every read before returning writes so closeout can include
// equipment changes in its existing Firestore transaction.
const { HttpsError } = require('firebase-functions/v2/https');
const text = value => String(value ?? '').trim();
const id = value => text(typeof value === 'object' ? value?.id : value);
const key = value => text(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values.map(id).filter(value => value && !value.includes('/')))];
const finished = row => ['finished', 'complete', 'completed', 'done'].includes(key(row?.status || row?.operationStatus));
const date = value => {
  if (!value) return null;
  const result = value?.toDate?.() || new Date(value instanceof Date ? value.getTime() : value?.seconds != null ? value.seconds * 1000 : value);
  return Number.isFinite(result.getTime()) ? result : null;
};
const cleanId = value => text(value).replaceAll('/', '_').replace(/\s/g, '_');
const rows = snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const equipmentIds = row => unique([row?.equipmentId, ...list(row?.equipmentIds), ...list(row?.companyEquipmentIds)]);
const historyType = value => {
  const type = key(value);
  if (['cleanfilter', 'filterclean', 'maintenance'].includes(type)) return 'Maintenance';
  if (type === 'repair') return 'Repair';
  return '';
};
const jobType = job => {
  const intent = key([job.jobIntent, job.equipmentContext?.jobIntent, job.type].filter(Boolean).join(' '));
  return intent.includes('repair') || job.repairRequestId ? 'Repair' : intent.includes('maintenance') ? 'Maintenance' : '';
};

function nextServiceDate(from, frequency, every) {
  const amount = Number(frequency), unit = key(every), result = new Date(from);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  if (['day', 'days', 'daily'].includes(unit)) result.setUTCDate(result.getUTCDate() + amount);
  else if (['week', 'weeks', 'weekly'].includes(unit)) result.setUTCDate(result.getUTCDate() + amount * 7);
  else if (['month', 'months', 'monthly', 'year', 'years', 'yearly', 'annually'].includes(unit)) {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + amount * (unit.startsWith('month') ? 1 : 12));
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
  } else return null;
  return result;
}

function createEquipmentCompletion(db, now = () => new Date()) {
  async function plan(transaction, { companyId, jobId = '', job = {}, tasks = [], stopTasks = [], finishJob = false, completedAt = now() }) {
    if (job.otherCompany && id(job.senderId) && id(job.senderId) !== companyId) {
      // A copied stop's mainCompanyId is client writable. Only an accepted
      // contract and its assigned canonical tasks authorize external effects.
      const contractId = id(job.receivedLaborContractId || job.laborContractId);
      if (!contractId || contractId.includes('/')) return [];
      const contractSnapshot = await transaction.get(db.collection('laborContracts').doc(contractId));
      const contract = contractSnapshot.data() || {}, ownerId = id(job.senderId), ownerJobId = id(contract.senderJobId);
      if (!contractSnapshot.exists || contract.senderId !== ownerId || contract.receiverId !== companyId || !ownerJobId || ownerJobId.includes('/') ||
          contract.senderAcceptance !== true || contract.receiverAcceptance !== true || ['cancelled', 'canceled', 'rejected', 'expired'].includes(key(contract.status))) return [];
      const ownerJobRef = db.collection('companies').doc(ownerId).collection('workOrders').doc(ownerJobId);
      const ownerJob = await transaction.get(ownerJobRef);
      if (!ownerJob.exists) return [];
      const incoming = [...tasks, ...stopTasks.map(value => value.task)].filter(finished), authorized = new Map();
      for (const task of incoming) {
        const taskId = id(task.jobTaskId || task.workOrderTaskId || task.sourceTaskId || task.id);
        if (!taskId || taskId.includes('/')) continue;
        const source = await transaction.get(ownerJobRef.collection('tasks').doc(taskId));
        if (!source.exists || id(source.data().laborContractId) !== contractId) continue;
        authorized.set(taskId, { ...source.data(), id: taskId, status: 'Finished', completedAt: source.data().completedAt || task.completedAt || completedAt,
          workerId: task.workerId || source.data().workerId || '', workerName: task.workerName || source.data().workerName || '' });
      }
      return plan(transaction, { companyId: ownerId, jobId: ownerJobId, job: ownerJob.data(), tasks: [...authorized.values()], finishJob: false, completedAt });
    }
    const candidates = new Map();
    const addTask = (task, stop = null) => {
      const type = historyType(task.type);
      if (!finished(task) || !type) return;
      const sourceTaskId = id(task.jobTaskId || task.workOrderTaskId || task.sourceTaskId || task.id);
      if (!sourceTaskId) return;
      for (const equipmentId of equipmentIds(task)) {
        const canonical = tasks.find(value => value.id === sourceTaskId);
        const source = canonical && finished(canonical) ? { ...task, ...canonical } : task;
        const candidate = {
          equipmentId, type, sourceTaskId, id: `auto_equ_sh_${cleanId(sourceTaskId)}`,
          name: source.name || `${type} equipment`, description: source.description || `Auto-created from finished ${source.type} task.`,
          date: date(source.completedAt || source.finishedAt) || date(stop?.completedAt || stop?.finishedAt || stop?.endTime) || completedAt,
          performedBy: key(source.workerType).includes('contractor') ? 'Contractor' : key(source.workerType).includes('employee') ? 'Company' : '',
          techId: source.workerId || stop?.techId || job.assignedTechId || '',
          techName: source.workerName || stop?.tech || job.assignedTechName || '',
          sourceTaskType: source.type || type, taskId: sourceTaskId, jobTaskId: canonical?.id || (stop ? id(task.jobTaskId || task.workOrderTaskId) : task.id) || '',
          serviceStopId: stop?.id || id(source.serviceStopId), serviceStopTaskId: stop ? task.id : '',
          partIds: list(source.partIds), statusOnCompletion: source.equipmentStatusOnCompletion || '',
        };
        const candidateKey = `${equipmentId}/${candidate.id}`;
        // Prefer the canonical job task, enriching it with the scheduled copy's visit.
        const previous = candidates.get(candidateKey);
        candidates.set(candidateKey, previous ? { ...candidate, ...previous, serviceStopId: candidate.serviceStopId || previous.serviceStopId, serviceStopTaskId: candidate.serviceStopTaskId || previous.serviceStopTaskId } : candidate);
      }
    };
    tasks.forEach(task => addTask(task));
    stopTasks.forEach(({ task, stop }) => addTask(task, stop));

    const completedByCompany = finishJob && !['customerresolved', 'canceled', 'cancelled', 'expired', 'rejected'].includes(key(job.billingStatus));
    const fallbackType = completedByCompany ? jobType(job) : '';
    // Older native equipment scheduling stored the only equipment link here.
    const scheduled = completedByCompany && jobId ? (await transaction.get(db.collectionGroup('scheduledWork').where('jobId', '==', jobId))).docs
      .filter(doc => {
        const parts = doc.ref.path.split('/');
        return parts.length === 6 && parts[0] === 'companies' && parts[1] === companyId && parts[2] === 'equipment';
      }) : [];
    const fallbackIds = fallbackType ? unique([...equipmentIds(job), ...equipmentIds(job.equipmentContext), ...tasks.flatMap(equipmentIds), ...stopTasks.flatMap(value => [...equipmentIds(value.task), ...equipmentIds(value.stop)]), ...scheduled.map(doc => doc.ref.path.split('/')[3])]) : [];
    const ids = unique([...candidates.values()].map(value => value.equipmentId).concat(fallbackIds, scheduled.map(doc => doc.ref.path.split('/')[3])));
    const equipment = await Promise.all(ids.map(async equipmentId => {
      const ref = db.collection('companies').doc(companyId).collection('equipment').doc(equipmentId);
      const [snapshot, history, latest] = await Promise.all([
        transaction.get(ref),
        jobId ? transaction.get(ref.collection('serviceHistory').where('jobId', '==', jobId)) : Promise.resolve({ docs: [] }),
        transaction.get(ref.collection('serviceHistory').orderBy('date', 'desc').limit(1)),
      ]);
      return { equipmentId, ref, snapshot, history: rows(history), latest: rows(latest)[0] };
    }));
    const writes = [];
    for (const item of equipment) {
      if (!item.snapshot.exists) continue; // Deleted equipment must never be recreated by a retry.
      const data = item.snapshot.data(), source = [...candidates.values()].filter(value => value.equipmentId === item.equipmentId);
      const fallbackId = `auto_equ_sh_job_equipment_${cleanId(jobId)}_${fallbackType.toLowerCase()}`;
      const previousFallback = item.history.find(value => value.id === fallbackId);
      let events = previousFallback ? [{ ...previousFallback, equipmentId: item.equipmentId }] : source;
      const hasOpenEquipmentTask = [...tasks, ...stopTasks.map(value => value.task)].some(task => equipmentIds(task).includes(item.equipmentId) && historyType(task.type) && !finished(task));
      const hasEquipmentLifecycleTask = [...tasks, ...stopTasks.map(value => value.task)].some(task => equipmentIds(task).includes(item.equipmentId) && ['install', 'replace', 'replacement', 'remove'].includes(key(task.type)));
      if (fallbackIds.includes(item.equipmentId) && !events.length && !item.history.length && !hasOpenEquipmentTask && !hasEquipmentLifecycleTask) {
        events = [{ id: fallbackId, equipmentId: item.equipmentId, type: fallbackType, name: `${fallbackType} ${data.name || job.equipmentName || 'equipment'}`,
          date: date(job.completedAt || job.finishedAt) || completedAt, description: job.description || `Auto-created from finished ${fallbackType} job.`,
          sourceTaskId: `job_equipment_${jobId}_${fallbackType.toLowerCase()}`, sourceTaskType: fallbackType,
          techId: job.assignedTechId || job.adminId || '', techName: job.assignedTechName || job.adminName || '', performedBy: job.assignedTechId ? 'Company' : '', partIds: [] }];
      }
      const resolved = [];
      for (const event of events) {
        const ref = item.ref.collection('serviceHistory').doc(event.id);
        const existing = item.history.find(value => value.id === event.id) || (await transaction.get(ref)).data() || {};
        const { statusOnCompletion, ...fields } = event;
        const history = { ...fields, addedBy: 'Auto', jobId, ...existing };
        for (const field of ['techId', 'techName', 'performedBy', 'sourceTaskId', 'taskId', 'jobTaskId', 'serviceStopId', 'serviceStopTaskId', 'sourceTaskType']) {
          if (!history[field] && fields[field]) history[field] = fields[field];
        }
        history.date = date(existing.date) || date(event.date) || completedAt;
        history.completionEffectsVersion = 1;
        resolved.push({ history, statusOnCompletion, needsEffects: existing.completionEffectsVersion !== 1 });
        if (JSON.stringify(history) !== JSON.stringify(existing)) writes.push({ ref, data: history });
      }
      // Once applied atomically, a replay must not clear a subsequent issue flag.
      const pendingEffects = resolved.filter(value => value.needsEffects).sort((a, b) => b.history.date - a.history.date);
      const newest = pendingEffects[0];
      if (newest) {
        const at = newest.history.date;
        const update = {};
        const maintenance = pendingEffects.find(value => value.history.type === 'Maintenance');
        const lastMaintenanceDate = [date(data.lastServiceDate), item.latest?.type === 'Maintenance' ? date(item.latest.date) : null].filter(Boolean).sort((a, b) => b - a)[0];
        if (maintenance && (!lastMaintenanceDate || maintenance.history.date >= lastMaintenanceDate)) {
          update.lastServiceDate = maintenance.history.date;
          update.nextServiceDate = nextServiceDate(maintenance.history.date, data.serviceFrequency, data.serviceFrequencyEvery);
        }
        const latestDate = [date(data.lastServiceDate), date(data.lastEquipmentCompletionAt), date(item.latest?.date)].filter(Boolean).sort((a, b) => b - a)[0];
        if (!latestDate || at >= latestDate) {
          update.lastEquipmentCompletionAt = at;
          if (data.isActive !== false && !['replaced', 'removed', 'inactive'].includes(key(data.status))) {
            const status = newest.statusOnCompletion || (['needsmaintenance', 'maintenance', 'needsservice', 'needsrepair', 'repair'].includes(key(data.status || data.operationStatus || data.equipmentStatus)) ? 'Operational' : '');
            if (status) update.status = status;
          }
        }
        const changed = Object.fromEntries(Object.entries(update).filter(([field, value]) => value instanceof Date ? date(data[field])?.getTime() !== value.getTime() : data[field] !== value));
        if (Object.keys(changed).length) writes.push({ ref: item.ref, data: changed });
      }
    }
    for (const snapshot of scheduled) {
      const value = snapshot.data();
      if (['completed', 'finished', 'cancelled', 'canceled'].includes(key(value.status))) continue;
      const equipmentId = snapshot.ref.path.split('/')[3];
      // Unused visits may retain scheduled copies of completed canonical tasks.
      if (tasks.some(task => equipmentIds(task).includes(equipmentId) && historyType(task.type) && !finished(task))) continue;
      writes.push({ ref: snapshot.ref, data: { status: 'Completed', dateCompleted: value.dateCompleted || date(job.completedAt || job.finishedAt) || completedAt } });
    }
    if (writes.length > 350) throw new HttpsError('resource-exhausted', 'Complete this equipment work in smaller groups.');
    return writes;
  }

  const apply = (transaction, writes) => writes.forEach(write => transaction.set(write.ref, write.data, { merge: true }));
  async function reconcileJob(companyId, jobId, completedAt = now()) {
    return db.runTransaction(async transaction => {
      const company = db.collection('companies').doc(companyId), ref = company.collection('workOrders').doc(jobId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const job = snapshot.data(), tasks = rows(await transaction.get(ref.collection('tasks')));
      const stops = new Map();
      for (const field of ['jobId', 'jobId.id', 'workOrderId', 'assignedJobId']) {
        for (const stop of rows(await transaction.get(company.collection('serviceStops').where(field, '==', jobId)))) stops.set(stop.id, stop);
      }
      for (const stopId of unique(list(job.serviceStopIds))) {
        const stop = await transaction.get(company.collection('serviceStops').doc(stopId));
        if (stop.exists && (!id(stop.data().jobId) || id(stop.data().jobId) === jobId)) stops.set(stopId, { ...stop.data(), id: stopId });
      }
      const stopTasks = (await Promise.all([...stops.values()].map(async stop => rows(await transaction.get(company.collection('serviceStops').doc(stop.id).collection('tasks'))).map(task => ({ task, stop }))))).flat();
      const writes = await plan(transaction, { companyId, jobId, job, tasks, stopTasks, finishJob: finished({ operationStatus: job.operationStatus }), completedAt: date(job.completedAt) || completedAt });
      apply(transaction, writes);
    });
  }
  async function onJob(event) {
    if (!event.data?.after?.exists) return;
    const after = event.data.after.data();
    if (!finished({ operationStatus: after.operationStatus })) return;
    return reconcileJob(event.params.companyId, event.params.jobId, date(event.time) || now());
  }
  async function onTask(event) {
    if (!event.data?.after?.exists || !finished(event.data.after.data())) return;
    return reconcileJob(event.params.companyId, event.params.jobId, date(event.time) || now());
  }
  async function onStopTask(event) {
    if (!event.data?.after?.exists || !finished(event.data.after.data())) return;
    const { companyId, stopId, taskId } = event.params;
    return db.runTransaction(async transaction => {
      const company = db.collection('companies').doc(companyId), ref = company.collection('serviceStops').doc(stopId);
      const [stopSnapshot, taskSnapshot] = await Promise.all([transaction.get(ref), transaction.get(ref.collection('tasks').doc(taskId))]);
      if (!stopSnapshot.exists || !taskSnapshot.exists || !finished(taskSnapshot.data())) return;
      const stop = { ...stopSnapshot.data(), id: stopId }, task = { ...taskSnapshot.data(), id: taskId };
      // Equipment belongs to the originating company for contracted visits.
      const jobId = id(task.jobId) || id(stop.jobId);
      const job = jobId ? await transaction.get(company.collection('workOrders').doc(jobId)) : null;
      const context = job?.data() || {};
      if (stop.otherCompany && id(stop.mainCompanyId) && id(stop.mainCompanyId) !== companyId) {
        context.otherCompany = true;
        context.senderId = id(stop.mainCompanyId);
        context.receivedLaborContractId = stop.laborContractId || context.receivedLaborContractId || '';
      }
      const writes = await plan(transaction, { companyId, jobId, job: context, stopTasks: [{ task: { ...task, workerId: task.workerId || stop.techId || '', workerName: task.workerName || stop.tech || '' }, stop }], completedAt: date(task.completedAt) || date(event.time) || now() });
      apply(transaction, writes);
    });
  }
  return { plan, apply, reconcileJob, onJob, onTask, onStopTask };
}
module.exports = { createEquipmentCompletion, historyType, nextServiceDate };
