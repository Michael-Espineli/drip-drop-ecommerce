const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryFirestore } = require('./testSupport/memoryFirestore');
const { DEFAULT_RECURRING_TASK_GROUP_ID: id, loadTaskGroupItems, seedDefaultRecurringTaskGroup } = require('./taskGroupStorage');
const base = 'companies/company/settings';
const canonical = `${base}/taskGroup/taskGroup/${id}`;
const plural = `${base}/taskGroups/taskGroups/${id}`;

test('setup writes a native-compatible group and its items only to canonical storage', async () => {
  const db = new MemoryFirestore({}); const createdAt = new Date();
  await seedDefaultRecurringTaskGroup(db, 'company', [{ id: 'brush', name: 'Brush', estimatedTime: 5, contractedRate: 250 }], { createdAt, createdByUserId: 'owner' });
  assert.deepEqual([...db.records.keys()].sort(), [canonical, `${canonical}/taskItems/brush`].sort());
  assert.equal(db.records.get(canonical).name, 'Weekly Service');
  assert.equal(db.records.get(canonical).createdByUserId, 'owner');
  assert.equal(db.records.get(canonical).estimatedMinutes, 5);
  assert.equal(db.records.get(canonical).estimatedLaborCents, 250);
  assert.equal(db.records.get(canonical).canDelete, false);
});
test('canonical tasks beat both plural variants and document IDs beat stale embedded IDs', async () => {
  const db = new MemoryFirestore({ [canonical]: {}, [`${canonical}/taskItems/brush`]: { id: 'wrong', name: 'Canonical' }, [`${plural}/tasks/brush`]: { name: 'Plural' } });
  assert.deepEqual(await loadTaskGroupItems(db, 'company'), [{ id: 'brush', name: 'Canonical' }]);
  assert.equal(db.version, 0);
});
test('an intentionally empty canonical group does not revive plural tasks', async () => {
  const db = new MemoryFirestore({ [canonical]: { numberOfTasks: 0 }, [`${plural}/tasks/brush`]: { name: 'Stale' } });
  assert.deepEqual(await loadTaskGroupItems(db, 'company'), []);
});
test('historical canonical items work even when the parent group document is absent', async () => {
  const db = new MemoryFirestore({ [`${canonical}/taskItems/brush`]: { name: 'Brush' } });
  assert.deepEqual(await loadTaskGroupItems(db, 'company'), [{ name: 'Brush', id: 'brush' }]);
});
test('plural compatibility merges setup and web items by ID, with later web edits winning', async () => {
  const db = new MemoryFirestore({ [`${plural}/taskItems/brush`]: { name: 'Old' }, [`${plural}/taskItems/skim`]: { name: 'Skim' }, [`${plural}/tasks/brush`]: { name: 'Edited', payrollMode: 'included' } });
  assert.deepEqual(await loadTaskGroupItems(db, 'company'), [{ name: 'Edited', payrollMode: 'included', id: 'brush' }, { name: 'Skim', id: 'skim' }]);
  assert.equal(db.version, 0);
});
test('missing groups return no tasks without making writes', async () => {
  const db = new MemoryFirestore({}); assert.deepEqual(await loadTaskGroupItems(db, 'company'), []); assert.equal(db.version, 0);
});
