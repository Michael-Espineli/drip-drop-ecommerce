import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { fetchRecurringTaskGroupOptions, fetchTaskGroupTasks } from './recurringServiceStopTasks';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args.filter(arg => typeof arg === 'string').join('/')),
  doc: jest.fn((...args) => args.filter(arg => typeof arg === 'string').join('/')),
  getDoc: jest.fn(), getDocs: jest.fn(), query: jest.fn(), setDoc: jest.fn(), where: jest.fn(),
}));
const db = {};
const canonical = 'companies/company/settings/taskGroup/taskGroup';
const plural = 'companies/company/settings/taskGroups/taskGroups';
const snapshot = (id, data) => ({ id, data: () => data });
beforeEach(() => {
  jest.clearAllMocks();
  collection.mockImplementation((...args) => args.filter(arg => typeof arg === 'string').join('/'));
  doc.mockImplementation((...args) => args.filter(arg => typeof arg === 'string').join('/'));
  getDoc.mockResolvedValue({ exists: () => false }); getDocs.mockResolvedValue({ docs: [] });
});

test('options deduplicate by document ID and prefer canonical historical-name records', async () => {
  getDocs.mockImplementation(async path => ({ docs: path === canonical
    ? [snapshot('shared', { id: 'stale', groupName: 'Canonical' })]
    : [snapshot('shared', { name: 'Old' }), snapshot('plural-only', { name: 'Legacy' })] }));
  const groups = await fetchRecurringTaskGroupOptions({ db, companyId: 'company' });
  expect(groups.map(group => group.id)).toEqual(['shared', 'plural-only']);
  expect(groups[0]).toEqual(expect.objectContaining({ id: 'shared', name: 'Canonical', sourcePath: 'canonical' }));
});
test('an existing empty canonical group wins even if the selected option came from plural storage', async () => {
  getDoc.mockResolvedValue({ exists: () => true });
  const tasks = await fetchTaskGroupTasks({ db, companyId: 'company', taskGroup: { id: 'group', sourcePath: 'plural' } });
  expect(tasks).toEqual([]);
  expect(getDocs).toHaveBeenCalledTimes(1);
  expect(getDocs).toHaveBeenCalledWith(`${canonical}/group/taskItems`);
});
test('fallback reads both older plural item spellings and deduplicates with web edits winning', async () => {
  getDocs.mockImplementation(async path => ({ docs: path === `${plural}/group/taskItems`
    ? [snapshot('brush', { id: 'wrong', name: 'Old' }), snapshot('skim', { name: 'Skim' })]
    : path === `${plural}/group/tasks` ? [snapshot('brush', { name: 'Edited' })] : [] }));
  expect(await fetchTaskGroupTasks({ db, companyId: 'company', taskGroup: { id: 'group' } })).toEqual([
    { id: 'brush', name: 'Edited' }, { id: 'skim', name: 'Skim' },
  ]);
});
test('canonical items preserve fields and use document identity', async () => {
  getDocs.mockResolvedValue({ docs: [snapshot('brush', { id: 'wrong', payrollMode: 'included', name: 'Brush' })] });
  expect(await fetchTaskGroupTasks({ db, companyId: 'company', taskGroup: { id: 'group' } })).toEqual([
    { id: 'brush', payrollMode: 'included', name: 'Brush' },
  ]);
});
test('missing company or group does not read Firebase', async () => {
  expect(await fetchRecurringTaskGroupOptions({ db, companyId: '' })).toEqual([]);
  expect(await fetchTaskGroupTasks({ db, companyId: 'company', taskGroup: null })).toEqual([]);
  expect(getDocs).not.toHaveBeenCalled(); expect(getDoc).not.toHaveBeenCalled();
});
