// taskGroup/taskGroup/taskItems is canonical. Plural paths are read-only compatibility.
const DEFAULT_RECURRING_TASK_GROUP_ID = 'com_set_tg_recurring_service_stops';

async function loadTaskGroupItems(db, companyId, groupId = DEFAULT_RECURRING_TASK_GROUP_ID) {
  const base = db.collection('companies').doc(companyId).collection('settings');
  const canonical = base.doc('taskGroup').collection('taskGroup').doc(groupId);
  const [group, items] = await Promise.all([canonical.get(), canonical.collection('taskItems').get()]);
  if (group.exists || items.docs.length) {
    return items.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  }
  const plural = base.doc('taskGroups').collection('taskGroups').doc(groupId);
  const snapshots = await Promise.all([plural.collection('taskItems').get(), plural.collection('tasks').get()]);
  const tasks = new Map();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) tasks.set(doc.id, { ...doc.data(), id: doc.id });
  }
  return [...tasks.values()];
}

async function seedDefaultRecurringTaskGroup(db, companyId, tasks, { createdAt, createdByUserId }) {
  const groupId = DEFAULT_RECURRING_TASK_GROUP_ID;
  const group = db.collection('companies').doc(companyId).collection('settings')
    .doc('taskGroup').collection('taskGroup').doc(groupId);
  await group.set({
    id: groupId, name: 'Weekly Service', description: 'Default tasks for recurring service stops',
    numberOfTasks: tasks.length, canDelete: false, isActive: true,
    estimatedMinutes: tasks.reduce((sum, task) => sum + Number(task.estimatedTime || 0), 0),
    estimatedLaborCents: tasks.reduce((sum, task) => sum + Number(task.contractedRate || 0), 0),
    createdAt, createdByUserId,
  });
  for (const task of tasks) await group.collection('taskItems').doc(task.id).set(task);
}

module.exports = { DEFAULT_RECURRING_TASK_GROUP_ID, loadTaskGroupItems, seedDefaultRecurringTaskGroup };
